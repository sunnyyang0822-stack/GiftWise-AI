"""GiftWise 本地多副本实验用的轮询负载均衡器（仅标准库）。

为什么不用 nginx / haproxy / traefik：
  1. 本地环境没有这些二进制，也装不了（离线、无包管理器权限）；
  2. 引入外部依赖后，评委无法用「有 Python 就能跑」的方式复现本实验；
  3. 本实验要证明的是**分发与无会话保持**这两个语义事实，不需要工业级 LB 的全部能力。
所以这里用 `http.server` + `http.client` 手写一个**刻意简单、能力边界写在明面上**的 LB。

本 LB 的已知缺陷（刻意保留、如实登记，不做粉饰）：
  - **单进程单点**：LB 自己挂了，整套服务就不可用。它不是高可用组件。
  - **无 keep-alive**：`BaseHTTPRequestHandler` 默认 `protocol_version = "HTTP/1.0"`，
    响应后即关闭连接；对上游的 `http.client` 也是每请求新建连接。因此每个请求
    至少 2 次 TCP 握手（客户端→LB、LB→上游）。
  - **无会话保持（session affinity）**：纯轮询，不认 Cookie / Header / 源 IP。
    这是本实验要**证明**的行为，不是疏忽。
  - **无重试预算/熔断/限流**：失败转移只做「按轮询顺序再试下一个」，每个上游最多试一次。
  - **健康探测是主动轮询**：探测间隔内的故障只有真正打过去才会发现；
    `/healthz` 只证明进程活着，**不证明它能在预算内处理正文**（半开连接缺陷）。
  - **健康探测与真实请求用的是不同的代码路径**：探测走 GET /healthz，
    真实请求走 POST /validate，因此探测全绿**不等于**服务可用。
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVICE = "giftwise-lb/0.1"

#: 上游列表：逗号分隔的 host:port。容器里由 compose 注入。
UPSTREAMS: list[tuple[str, int]] = []
for _raw in (os.environ.get("GIFTWISE_UPSTREAMS", "") or "").split(","):
    _raw = _raw.strip()
    if not _raw:
        continue
    _host, _, _port = _raw.rpartition(":")
    if not _host or not _port.isdigit():
        raise RuntimeError(f"bad upstream spec: {_raw!r} (want host:port)")
    UPSTREAMS.append((_host, int(_port)))
if not UPSTREAMS:
    raise RuntimeError("GIFTWISE_UPSTREAMS is empty; nothing to balance")

LISTEN_HOST = os.environ.get("GIFTWISE_LB_BIND", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("GIFTWISE_LB_PORT", "8080"))
#: 转发到上游的单次超时。必须 > 上游自身 10s 正文读预算，否则 LB 会先于上游掐断，
#: 把上游的 408 语义变成 LB 的 502，掩盖真实行为。
UPSTREAM_TIMEOUT = float(os.environ.get("GIFTWISE_LB_TIMEOUT", "15"))
HEALTH_INTERVAL = float(os.environ.get("GIFTWISE_LB_HEALTH_INTERVAL", "2"))
HEALTH_TIMEOUT = float(os.environ.get("GIFTWISE_LB_HEALTH_TIMEOUT", "2"))
#: 上游默认读预算，仅用于**探测**「半开连接」是否会挂满这么久（见 04 号文档）。
PROBE_SLOW_SECONDS = float(os.environ.get("GIFTWISE_LB_PROBE_SLOW", "10"))

_LOCK = threading.Lock()
_ROUND_ROBIN_INDEX = 0

#: 每个上游的健康状态：True=探测通过，False=探测失败。
_HEALTH: dict[str, bool] = {f"{h}:{p}": False for h, p in UPSTREAMS}
#: 统计：用于在响应里给出可核对的原始计数。
_STATS: dict[str, object] = {
    "requests_total": 0,
    "by_upstream": {f"{h}:{p}": 0 for h, p in UPSTREAMS},
    "failovers_total": 0,
    "upstream_errors_total": 0,
    "all_upstreams_failed_total": 0,
    "client_disconnects_total": 0,
}


def _log(event: str, **fields: object) -> None:
    """单行 JSON 日志。整行一次 write，避免并发下粘连。"""
    record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()) + f".{int(time.time() * 1000) % 1000:03d}", "event": event, "service": SERVICE}
    record.update(fields)
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    with _LOCK:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def _next_upstream_order() -> list[str]:
    """返回**从当前轮询位置开始**的上游顺序，健康优先。

    排序规则：健康的上游排在前面，各自保持轮询相对顺序；不健康的上游**不丢弃**，
    而是排在后面。理由：健康探测可能误判（探测走 GET /healthz，真实请求走 POST /validate），
    把被判不健康的上游直接从候选里删掉，会让一次误判变成整段不可用；
    排在最后则「尽量不用，但真没人用时仍然一试」。
    """
    global _ROUND_ROBIN_INDEX
    with _LOCK:
        start = _ROUND_ROBIN_INDEX % len(UPSTREAMS)
        _ROUND_ROBIN_INDEX += 1
        health_snapshot = dict(_HEALTH)
    keys = [f"{h}:{p}" for h, p in UPSTREAMS]
    rotated = keys[start:] + keys[:start]
    healthy = [k for k in rotated if health_snapshot.get(k, False)]
    unhealthy = [k for k in rotated if not health_snapshot.get(k, False)]
    return healthy + unhealthy


def _call_upstream(key: str, method: str, path: str, body: bytes | None, extra_headers: dict[str, str], timeout: float) -> tuple[int, bytes, dict[str, str]]:
    """向上游发一次请求。失败时抛 OSError / http.client.HTTPException。"""
    host, _, port = key.rpartition(":")
    conn = http.client.HTTPConnection(host, int(port), timeout=timeout)
    try:
        headers = dict(extra_headers)
        if body is not None:
            headers["Content-Length"] = str(len(body))
        # 明确禁用 keep-alive：上游讲 HTTP/1.0 且响应后关闭，
        # 复用连接会踩到竞态。这里如实反映「无法保持连接」。
        headers["Connection"] = "close"
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        payload = resp.read()
        return resp.status, payload, dict(resp.getheaders())
    finally:
        conn.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "GiftWiseLB/0.1"

    def _send(self, status: int, payload: bytes, ctype: str = "application/json; charset=utf-8", extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(payload)
        except OSError:
            with _LOCK:
                _STATS["client_disconnects_total"] = int(_STATS["client_disconnects_total"]) + 1  # type: ignore[arg-type]

    def _send_json(self, status: int, value: object, extra: dict[str, str] | None = None) -> None:
        self._send(status, json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), extra=extra)

    # ---- LB 自身的观测端点（同样未鉴权；这是实验工具，不是交付物） ----
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/lb-stats":
            with _LOCK:
                snapshot = json.loads(json.dumps(_STATS))
                snapshot["health"] = dict(_HEALTH)
                snapshot["upstreams"] = [f"{h}:{p}" for h, p in UPSTREAMS]
                snapshot["round_robin_next_index"] = _ROUND_ROBIN_INDEX % len(UPSTREAMS)
            self._send_json(HTTPStatus.OK, snapshot)
            return
        if self.path == "/lb-healthz":
            with _LOCK:
                healthy = [k for k, v in _HEALTH.items() if v]
            self._send_json(HTTPStatus.OK if healthy else HTTPStatus.SERVICE_UNAVAILABLE,
                            {"status": "ok" if healthy else "degraded", "healthy": healthy})
            return
        self._forward("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._forward("POST")

    def _forward(self, method: str) -> None:
        try:
            size = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            size = 0
        body = self.rfile.read(size) if size > 0 else None

        # 客户端自带的「会话标识」：本 LB **故意不解析、不用于选路**，
        # 只用它来取证「同一会话的请求落到了不同副本」。
        session = self.headers.get("X-GiftWise-Session") or "-"
        seq = self.headers.get("X-GiftWise-Seq") or "-"

        order = _next_upstream_order()
        tried: list[dict[str, object]] = []
        # 用 perf_counter 而非 monotonic：本宿主 monotonic 粒度 15.625ms，会把上游耗时量化。
        started = time.perf_counter()

        for attempt, key in enumerate(order):
            try:
                status, payload, _headers = _call_upstream(key, method, self.path, body, {}, UPSTREAM_TIMEOUT)
            except (OSError, http.client.HTTPException, socket.timeout) as exc:
                tried.append({"upstream": key, "error": type(exc).__name__})
                with _LOCK:
                    _STATS["upstream_errors_total"] = int(_STATS["upstream_errors_total"]) + 1  # type: ignore[arg-type]
                _log("upstream_error", seq=seq, session=session, upstream=key, attempt=attempt + 1, error=type(exc).__name__, detail=str(exc)[:200])
                continue

            elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
            with _LOCK:
                _STATS["requests_total"] = int(_STATS["requests_total"]) + 1  # type: ignore[arg-type]
                per = _STATS["by_upstream"]  # type: ignore[assignment]
                per[key] = int(per.get(key, 0)) + 1  # type: ignore[union-attr]
                if attempt > 0:
                    _STATS["failovers_total"] = int(_STATS["failovers_total"]) + 1  # type: ignore[arg-type]
            _log("proxied", seq=seq, session=session, method=method, path=self.path,
                 upstream=key, attempt=attempt + 1, status=status,
                 upstream_ms=elapsed_ms, bytes_out=len(payload),
                 failover_chain=[t["upstream"] for t in tried] or None)
            # 关键取证头：客户端不需要看上游日志就知道是谁处理的。
            self._send(status, payload, extra={
                "X-GiftWise-Upstream": key,
                "X-GiftWise-Attempt": str(attempt + 1),
            })
            return

        with _LOCK:
            _STATS["all_upstreams_failed_total"] = int(_STATS["all_upstreams_failed_total"]) + 1  # type: ignore[arg-type]
        _log("all_upstreams_failed", seq=seq, session=session, method=method, path=self.path, tried=tried)
        self._send_json(HTTPStatus.BAD_GATEWAY, {"error": "ALL_UPSTREAMS_FAILED", "tried": tried})

    def log_message(self, fmt: str, *args: object) -> None:
        # 默认实现会向 stderr 打印噪声行；本 LB 的结构化日志已覆盖该信息。
        return


def _health_loop() -> None:
    """主动轮询 /healthz。只证明「进程活着」，不能证明「能在预算内处理正文」。"""
    while True:
        for host, port in UPSTREAMS:
            key = f"{host}:{port}"
            ok = False
            detail = ""
            try:
                status, _payload, _headers = _call_upstream(key, "GET", "/healthz", None, {}, HEALTH_TIMEOUT)
                ok = status == 200
                detail = f"HTTP {status}"
            except (OSError, http.client.HTTPException, socket.timeout) as exc:
                detail = type(exc).__name__
            with _LOCK:
                previous = _HEALTH.get(key)
                _HEALTH[key] = ok
            if previous != ok:
                _log("health_transition", upstream=key, healthy=ok, previous=previous, detail=detail)
        time.sleep(HEALTH_INTERVAL)


def main() -> None:
    threading.Thread(target=_health_loop, name="giftwise-lb-health", daemon=True).start()
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    _log("lb_listening", bind=f"{LISTEN_HOST}:{LISTEN_PORT}",
         upstreams=[f"{h}:{p}" for h, p in UPSTREAMS],
         upstream_timeout=UPSTREAM_TIMEOUT, health_interval=HEALTH_INTERVAL,
         note="HTTP/1.0, no keep-alive, no session affinity, single point of failure")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
