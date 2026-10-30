"""GiftWise 可观测入口（阶段 14 实现）。

本模块**不修改** `deploy/server.py`：它通过**子类化** `deploy.server.Handler` 增加采集能力，
因此 `/healthz`、`/`、`/validate` 的响应体仍由原实现逐字节产出（可回归对比），只在响应头
额外加一个 `X-GiftWise-Request-Id`，并新增两个只读端点。

新增能力：
  1. **结构化请求日志**：每请求一行 JSON（方法/路由/状态码/耗时/请求 id/字节数/错误码/规则指纹），
     **绝不记录请求体**；只记请求体与候选串的 sha256 指纹。用 `logging` 落盘/落 stdout，并发不交错。
  2. **健康与就绪**：`GET /healthz` 与原实现完全一致；新增 `GET /readyz`（检查进程、规则指纹、日志落点可写）。
  3. **进程级指标**：`GET /metrics`（Prometheus 文本 v0.0.4）或 `GET /metrics?format=json`；
     含请求数、错误数、延迟直方图与 p50/p95/p99、RSS、在途请求、成本常量（恒 0）。
  4. **优雅退出**：SIGTERM/SIGINT 后打印末次指标 JSON 并 flush 日志（便于容器 `docker stop` 取证）。

运行：
    cd <仓库根>
    GIFTWISE_BIND=127.0.0.1 GIFTWISE_PORT=8765 python -m deploy.observable_server

环境变量（除下列外，`GIFTWISE_BIND`/`GIFTWISE_PORT` 语义与原实现相同）：
    GIFTWISE_ACCESS_LOG              JSONL 访问日志文件路径（默认不落文件，只写 stdout）
    GIFTWISE_ACCESS_STDOUT           1/0，是否同时写 stdout（默认 1）
    GIFTWISE_ACCESS_LOG_BACKUP_DAYS  日志保留天数（默认 7，按天轮转）
    GIFTWISE_HIDE_PY_VERSION         1 = 响应头 Server 不暴露 Python 版本（默认 0，保持与原实现一致）
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import signal
import sys
import threading
import time
from http import HTTPStatus
from http.server import ThreadingHTTPServer

from deploy.observability import (
    SERVICE,
    Metrics,
    access_log_from_env,
    new_request_id,
    now_iso,
    process_rss_bytes,
    route_label,
    sanitize_id,
    sanitize_path,
)
from deploy.server import MAX_BODY_BYTES, RULES_HASH, Handler as BaseHandler, _json_bytes

REJECTED_CODE_KEYS = ("error",)


def _candidates_fingerprint(body: bytes) -> str | None:
    """候选串指纹：只留 sha256，不留内容（语义见 observability-collection.md 第 2 节）。"""
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    value = payload.get("candidates_json")
    if not isinstance(value, str):
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class ObservableHandler(BaseHandler):
    """父类逻辑 + 采集。父类一行未改。"""

    #: 由 main() 注入（单进程内共享）
    metrics: Metrics | None = None
    access = None

    # ------------------------------------------------------------------ 生命周期

    def handle_one_request(self) -> None:
        self._obs_t_start = time.perf_counter()
        self._obs_t_process = None
        self._obs_status = None
        self._obs_route = None
        self._obs_error_codes: tuple[str, ...] = ()
        self._obs_val_status = None
        self._obs_all_passed = None
        self._obs_bytes_in = 0
        self._obs_bytes_out = 0
        self._obs_payload_sha256 = None
        self._obs_candidates_sha256 = None
        # 先给一个本服务生成的 id：即使请求行畸形（parse_request 失败）也能留下可关联记录
        self._obs_request_id = new_request_id()
        self._obs_run_id = None
        self._obs_stage = None
        self._obs_header_sent = False
        if self.metrics is not None:
            self.metrics.inc_in_flight()
        try:
            super().handle_one_request()
        finally:
            if self.metrics is not None:
                self.metrics.dec_in_flight()
            # 只有真正产生了响应的请求才记录（连接探测、空请求行不产生噪声记录）
            if self._obs_status is not None:
                self._record_request()

    def parse_request(self) -> bool:
        ok = super().parse_request()
        if ok:
            self._obs_t_process = time.perf_counter()
            headers = self.headers
            # 调用方带了就按其值记录（清洗后），否则沿用本服务生成的那个 id
            self._obs_request_id = sanitize_id(headers.get("X-GiftWise-Request-Id")) or self._obs_request_id
            self._obs_run_id = sanitize_id(headers.get("X-GiftWise-Run-Id"))
            self._obs_stage = sanitize_id(headers.get("X-GiftWise-Stage"))
            try:
                declared = int(headers.get("Content-Length", "0"))
            except (TypeError, ValueError):
                declared = 0
            # 记的是 Content-Length 声明值：413 场景下服务端并未真正读取这个体积，文档已注明
            self._obs_bytes_in = declared if declared > 0 else 0
        return ok

    # ------------------------------------------------------------------ 响应钩子

    def send_response(self, code: int, message: str | None = None) -> None:
        self._obs_status = int(code)
        super().send_response(code, message)

    def end_headers(self) -> None:
        if self._obs_request_id and not self._obs_header_sent:
            self._obs_header_sent = True
            try:
                self.send_header("X-GiftWise-Request-Id", self._obs_request_id)
            except Exception:
                pass
        super().end_headers()

    def _send(self, status: int, value: object) -> None:
        super()._send(status, value)
        try:
            self._obs_bytes_out = len(_json_bytes(value))
            if not isinstance(value, dict):
                return
            # 只有 /validate 响应体里的 status/all_passed/errors 才是【校验结果】；
            # /healthz 的 {"status":"ok"} 与 /readyz 的 {"status":"ready"} 不是校验结果，
            # 若不按路由区分就会污染指标（实测踩到过）。
            if route_label(getattr(self, "path", "") or "") == "/validate":
                val_status = value.get("status")
                if isinstance(val_status, str):
                    self._obs_val_status = val_status
                if isinstance(value.get("all_passed"), bool):
                    self._obs_all_passed = bool(value["all_passed"])
                codes: list[str] = []
                errors = value.get("errors")
                if isinstance(errors, list):
                    for item in errors:
                        if isinstance(item, dict) and isinstance(item.get("code"), str):
                            codes.append(item["code"])
                if codes:
                    self._obs_error_codes = tuple(codes)
            # 接口层错误码（INVALID_JSON / INVALID_PAYLOAD / REQUEST_TOO_LARGE / NOT_FOUND…）任何路由都记
            rejected = [value[key] for key in REJECTED_CODE_KEYS if isinstance(value.get(key), str)]
            if rejected:
                self._obs_error_codes = tuple(self._obs_error_codes) + tuple(rejected)
        except Exception:
            pass

    def log_message(self, fmt: str, *args: object) -> None:
        """父类用 print 打非结构化日志；本入口改为静默，统一由 JSONL 记录。"""
        return

    # ------------------------------------------------------------------ 新增只读端点

    def do_GET(self) -> None:  # noqa: N802
        route = route_label(self.path)
        if route == "/metrics":
            self._serve_metrics()
            return
        if route == "/readyz":
            self._serve_readyz()
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        # 为了给"候选版本"留指纹，先按 Content-Length 精确读体并用同长度 BytesIO 顶替 rfile，
        # 父类随后读到的字节完全一致（超长/非法长度不读，保持 413 行为不变），最后一定还原 rfile。
        original_rfile = self.rfile
        try:
            body = self._peek_body()
        except TimeoutError:
            # I-2/S-5：本入口同样不能挂在 rfile.read 上。父类只会在 handle_one_request 里
            # 静默关闭连接（不产生响应），所以这里必须显式走父类的 408 路径。
            self._send_request_timeout()
            return
        try:
            if body is not None:
                self._obs_bytes_in = len(body)
                self._obs_payload_sha256 = hashlib.sha256(body).hexdigest()
                self._obs_candidates_sha256 = _candidates_fingerprint(body)
                self.rfile = io.BytesIO(body)
            super().do_POST()
        finally:
            self.rfile = original_rfile

    def _peek_body(self) -> bytes | None:
        try:
            declared = int(self.headers.get("Content-Length", "-1"))
        except (TypeError, ValueError):
            return None
        if declared < 0 or declared > MAX_BODY_BYTES:
            return None
        try:
            # 复用父类的带预算读取（与默认入口同一套超时语义），而不是直接 rfile.read
            return self._read_body(declared)
        except TimeoutError:
            raise  # 交给 do_POST 统一返回 408；此处吞掉会变成"无响应"或错误的 400
        except Exception:
            return None

    def _serve_metrics(self) -> None:
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        if "format=json" in query:
            body = json.dumps(self.metrics.snapshot(), ensure_ascii=False, indent=2).encode("utf-8")
            content_type = "application/json; charset=utf-8"
        else:
            body = self.metrics.render_prometheus().encode("utf-8")
            content_type = "text/plain; version=0.0.4; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
        self._obs_bytes_out = len(body)

    def _serve_readyz(self) -> None:
        log_ok, log_detail = (True, "disabled")
        if self.access is not None:
            log_ok, log_detail = self.access.healthy()
        uptime = time.time() - self.metrics.started_at if self.metrics else 0.0
        rss = process_rss_bytes()
        healthy = bool(RULES_HASH) and log_ok and uptime > 0
        payload = {
            "status": "ready" if healthy else "not_ready",
            "service": SERVICE,
            "uptime_seconds": round(uptime, 3),
            "rules_source_sha256": RULES_HASH,
            "access_log": {"ok": log_ok, "detail": log_detail},
            "process_resident_memory_bytes": rss,
        }
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(HTTPStatus.OK if healthy else HTTPStatus.SERVICE_UNAVAILABLE)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
        self._obs_bytes_out = len(body)

    # ------------------------------------------------------------------ 记录

    def _record_request(self) -> None:
        route = route_label(self.path)
        self._obs_route = route
        end = time.perf_counter()
        origin = self._obs_t_process or self._obs_t_start
        duration_ms = max(0.0, (end - origin) * 1000.0)
        record = {
            "ts": now_iso(),
            "service": SERVICE,
            "request_id": self._obs_request_id,
            "run_id": self._obs_run_id,
            "stage": self._obs_stage,
            "method": getattr(self, "command", None) or "-",
            "route": route,
            "path": sanitize_path(getattr(self, "path", "") or ""),
            "http_status": self._obs_status,
            "val_status": self._obs_val_status,
            "all_passed": self._obs_all_passed,
            "error_codes": list(self._obs_error_codes),
            "payload_sha256": self._obs_payload_sha256,
            "candidates_sha256": self._obs_candidates_sha256,
            "duration_ms": round(duration_ms, 3),
            "bytes_in": self._obs_bytes_in,
            "bytes_out": self._obs_bytes_out,
            "remote": self.client_address[0] if getattr(self, "client_address", None) else None,
            "model_calls": 0,
            "cost": {"unit": "CNY", "amount": 0.0, "source": "deterministic_rules_only"},
            "rules_source_sha256": RULES_HASH,
        }
        if self.access is not None:
            self.access.emit(record)
        if self.metrics is not None:
            self.metrics.observe(
                method=record["method"],
                route=route,
                status=int(self._obs_status),
                duration_ms=duration_ms,
                bytes_in=self._obs_bytes_in,
                bytes_out=self._obs_bytes_out,
                val_status=self._obs_val_status,
                error_codes=self._obs_error_codes,
            )


def main() -> None:
    host = os.environ.get("GIFTWISE_BIND", "0.0.0.0")
    port = int(os.environ.get("GIFTWISE_PORT", "8000"))
    if os.environ.get("GIFTWISE_HIDE_PY_VERSION") in ("1", "true", "True"):
        # 安全自查 S-4 的最小修复：只在明确开启时隐藏 Python 版本，默认与原实现一致。
        ObservableHandler.sys_version = ""
        ObservableHandler.server_version = "GiftWiseValidator/0.1"

    metrics = Metrics(service=SERVICE, rules_sha256=RULES_HASH)
    access = access_log_from_env()
    ObservableHandler.metrics = metrics
    ObservableHandler.access = access

    server = ThreadingHTTPServer((host, port), ObservableHandler)
    stop_event = threading.Event()

    def _request_shutdown(signum: int, _frame: object) -> None:
        if stop_event.is_set():
            return
        stop_event.set()
        # shutdown() 必须由另一个线程调用，否则会与 serve_forever 死锁
        threading.Thread(target=server.shutdown, name="giftwise-shutdown", daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM, getattr(signal, "SIGBREAK", None)):
        if sig is None:
            continue
        try:
            signal.signal(sig, _request_shutdown)
        except (ValueError, OSError, AttributeError):
            pass

    startup = {
        "ts": now_iso(),
        "event": "startup",
        "service": SERVICE,
        "bind": host,
        "port": port,
        "rules_source_sha256": RULES_HASH,
        "access_log_path": access.path,
        "pid": os.getpid(),
        "python_version": sys.version.split()[0],
    }
    print(json.dumps(startup, ensure_ascii=False), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        access.close()
        summary = {"ts": now_iso(), "event": "shutdown", "service": SERVICE}
        summary.update(metrics.snapshot())
        print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
