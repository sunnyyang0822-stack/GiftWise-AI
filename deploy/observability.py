"""GiftWise 阶段 14 采集实现：结构化访问日志 + 进程级指标。

设计依据：`deploy/observability-collection.md`（采集与落点方案）。
字段语义的权威来源是 Issue #5（ARCH-001）与 `docs/architecture.md`，本模块**不重新定义语义**，
只负责"把本服务确实知道的事记录下来"，且**绝不记录请求体**。

本模块不导入 `deploy/server.py`，也不修改它；它只提供：
  - `Metrics`：线程安全的进程级指标（请求数、错误数、延迟分桶与分位、RSS、在途请求、成本常量）；
  - `AccessLog`：单行 JSON 结构化访问日志（`logging` 模块，自带锁，避免并发交错）；
  - `route_label()` / `sanitize_path()`：指标标签基数控制与路径脱敏；
  - `process_rss_bytes()`：Windows / Linux 双平台的进程常驻内存。

只用标准库。无第三方依赖。
"""

from __future__ import annotations

import ctypes
import json
import logging
import logging.handlers
import os
import platform
import re
import statistics
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

SERVICE = "giftwise-validator"
CN = timezone(timedelta(hours=8))

#: 已知路由（用于指标标签基数控制：任何未匹配路径都归入 __unmatched__）
KNOWN_ROUTES = frozenset({"/", "/healthz", "/validate", "/metrics", "/readyz"})

#: 延迟直方图分桶（毫秒）。+Inf 由渲染时补上。
LATENCY_BUCKETS_MS = (1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500)

#: 分位数用的滑动窗口大小（每个路由），防止内存无界增长。
RESERVOIR_SIZE = 4096

#: 路径字段最大长度（超出截断，避免日志膨胀）。
PATH_MAX = 160

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def now_iso() -> str:
    """本地时间（东八区）ISO8601，毫秒精度。"""
    return datetime.now(CN).isoformat(timespec="milliseconds")


def new_request_id() -> str:
    """本服务生成的请求 id（与跨组件 run id 区分，见方案第 2 节）。"""
    return uuid.uuid4().hex[:16]


def sanitize_path(raw: str) -> str:
    """脱敏被请求的原始路径：剔除控制字符（防日志注入）、限长。"""
    cleaned = _CONTROL_CHARS.sub("?", raw or "")
    return cleaned[:PATH_MAX]


def route_label(raw: str) -> str:
    """把原始 path 归一到已知路由；未匹配一律 `__unmatched__`（基数保护）。"""
    path_only = (raw or "").split("?", 1)[0]
    return path_only if path_only in KNOWN_ROUTES else "__unmatched__"


def sanitize_id(value: str | None, limit: int = 64) -> str | None:
    """清洗由调用方传入的标识（request/run/stage）：仅保留可打印安全字符。"""
    if not value:
        return None
    cleaned = _CONTROL_CHARS.sub("", str(value)).strip()
    if not cleaned:
        return None
    cleaned = re.sub(r"[^0-9A-Za-z._:\-]", "_", cleaned)
    return cleaned[:limit]


def _proc_rss_linux() -> int | None:
    """Linux：读 /proc/self/statm 的常驻页数（容器内走这条路）。"""
    try:
        with open("/proc/self/statm", "r", encoding="ascii") as handle:
            resident_pages = int(handle.read().split()[1])
        return resident_pages * os.sysconf("SC_PAGE_SIZE")
    except Exception:
        pass
    try:  # 退路：/proc/self/status 的 VmRSS（kB）
        with open("/proc/self/status", "r", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except Exception:
        return None
    return None


def _proc_rss_windows() -> int | None:
    """Windows：GetProcessMemoryInfo 的 WorkingSetSize。"""
    class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
            ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    try:
        kernel32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
        handle = kernel32.OpenProcess(0x0400 | 0x0010, False, os.getpid())
        if not handle:
            return None
        try:
            counters = PROCESS_MEMORY_COUNTERS()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
                return None
            return int(counters.WorkingSetSize)
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        return None


def process_rss_bytes() -> int | None:
    """当前进程常驻内存（字节）。平台不支持时返回 None，绝不编造数字。"""
    if platform.system() == "Windows":
        return _proc_rss_windows()
    return _proc_rss_linux()


def percentile(sorted_values: list[float], q: float) -> float:
    """对已排序样本取分位数（线性插值），q ∈ [0,1]。"""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    position = q * (len(sorted_values) - 1)
    low = int(position)
    high = min(low + 1, len(sorted_values) - 1)
    fraction = position - low
    return float(sorted_values[low]) + (float(sorted_values[high]) - float(sorted_values[low])) * fraction


class Metrics:
    """线程安全的进程级指标。所有 `*_total` 为单调计数，`rss`/`in_flight` 为瞬时值。"""

    def __init__(self, service: str = SERVICE, rules_sha256: str = "") -> None:
        self.service = service
        self.rules_sha256 = rules_sha256
        self.started_at = time.time()
        self._lock = threading.Lock()
        self.requests: dict[tuple[str, str, int], int] = {}
        self.errors: dict[int, int] = {}
        self.validate_results: dict[str, int] = {}
        self.error_codes: dict[str, int] = {}
        self.bytes_in_total = 0
        self.bytes_out_total = 0
        self.in_flight = 0
        self.metrics_scrapes = 0
        self.ready_checks = 0
        # 延迟：分桶 + 求和 + 计数（Prometheus 直方图）；另存滑动窗口用于分位数
        self._bucket_counts: dict[str, list[int]] = {}
        self._latency_sum: dict[str, float] = {}
        self._latency_count: dict[str, int] = {}
        self._reservoir: dict[str, deque[float]] = {}
        self._nonzero_latency_count = 0

    # ---------------------------------------------------------------- 写入

    def inc_in_flight(self) -> None:
        with self._lock:
            self.in_flight += 1

    def dec_in_flight(self) -> None:
        with self._lock:
            self.in_flight = max(0, self.in_flight - 1)

    def observe(
        self,
        *,
        method: str,
        route: str,
        status: int,
        duration_ms: float,
        bytes_in: int = 0,
        bytes_out: int = 0,
        val_status: str | None = None,
        error_codes: tuple[str, ...] = (),
    ) -> None:
        with self._lock:
            self.requests[(method, route, status)] = self.requests.get((method, route, status), 0) + 1
            if status >= 400:
                self.errors[status] = self.errors.get(status, 0) + 1
            if route == "/metrics":
                self.metrics_scrapes += 1
            if route == "/readyz":
                self.ready_checks += 1
            self.bytes_in_total += max(0, int(bytes_in))
            self.bytes_out_total += max(0, int(bytes_out))
            if val_status:
                self.validate_results[val_status] = self.validate_results.get(val_status, 0) + 1
            for code in error_codes:
                if code:
                    self.error_codes[code] = self.error_codes.get(code, 0) + 1
            if duration_ms > 0:
                self._nonzero_latency_count += 1
            buckets = self._bucket_counts.setdefault(route, [0] * len(LATENCY_BUCKETS_MS))
            for index, upper in enumerate(LATENCY_BUCKETS_MS):
                if duration_ms <= upper:
                    buckets[index] += 1
            self._latency_sum[route] = self._latency_sum.get(route, 0.0) + duration_ms
            self._latency_count[route] = self._latency_count.get(route, 0) + 1
            reservoir = self._reservoir.setdefault(route, deque(maxlen=RESERVOIR_SIZE))
            reservoir.append(duration_ms)

    # ---------------------------------------------------------------- 读取

    def snapshot(self) -> dict:
        with self._lock:
            uptime = time.time() - self.started_at
            routes = sorted(set(self._bucket_counts) | set(self._latency_count))
            latency: dict[str, dict] = {}
            for route in routes:
                samples = sorted(self._reservoir.get(route, ()))
                latency[route] = {
                    "count": self._latency_count.get(route, 0),
                    "sum_ms": round(self._latency_sum.get(route, 0.0), 3),
                    "p50_ms": round(percentile(samples, 0.50), 3),
                    "p95_ms": round(percentile(samples, 0.95), 3),
                    "p99_ms": round(percentile(samples, 0.99), 3),
                    "max_ms": round(samples[-1], 3) if samples else 0.0,
                    "reservoir_size": len(samples),
                }
            total_requests = sum(self.requests.values())
            total_errors = sum(self.errors.values())
            rss = process_rss_bytes()
            return {
                "ts": now_iso(),
                "service": self.service,
                "rules_source_sha256": self.rules_sha256,
                "uptime_seconds": round(uptime, 3),
                "requests_total": total_requests,
                "errors_total": total_errors,
                "error_rate": round(total_errors / total_requests, 6) if total_requests else 0.0,
                "requests_by_key": {
                    f"{method} {route} {status}": count
                    for (method, route, status), count in sorted(self.requests.items())
                },
                "errors_by_status": {str(k): v for k, v in sorted(self.errors.items())},
                "validate_results_total": dict(sorted(self.validate_results.items())),
                "error_codes_total": dict(sorted(self.error_codes.items())),
                "latency_by_route": latency,
                "in_flight_requests": self.in_flight,
                "metrics_scrapes_total": self.metrics_scrapes,
                "ready_checks_total": self.ready_checks,
                "bytes_in_total": self.bytes_in_total,
                "bytes_out_total": self.bytes_out_total,
                "nonzero_latency_samples": self._nonzero_latency_count,
                "process_resident_memory_bytes": rss,
                "model_calls_total": 0,
                "cost": {"unit": "CNY", "amount": 0.0, "source": "deterministic_rules_only"},
                "python_version": platform.python_version(),
                "platform": platform.system(),
            }

    def render_prometheus(self) -> str:
        """Prometheus 文本展示格式（v0.0.4）。标签值只来自已知路由/方法/状态码。"""
        data = self.snapshot()
        lines: list[str] = []

        def metric(name: str, help_text: str, kind: str) -> None:
            lines.append(f"# HELP {name} {help_text}")
            lines.append(f"# TYPE {name} {kind}")

        metric("giftwise_up", "服务是否在运行（进程存活则恒为 1）", "gauge")
        lines.append("giftwise_up 1")

        metric("giftwise_build_info", "版本与规则源指纹", "gauge")
        lines.append(
            f'giftwise_build_info{{service="{self.service}",rules_source_sha256="{self.rules_sha256}",'
            f'python_version="{data["python_version"]}"}} 1'
        )

        metric("giftwise_uptime_seconds", "进程运行时长（秒）", "gauge")
        lines.append(f'giftwise_uptime_seconds {data["uptime_seconds"]}')

        metric("giftwise_process_resident_memory_bytes", "进程常驻内存（字节）", "gauge")
        lines.append(f'giftwise_process_resident_memory_bytes {data["process_resident_memory_bytes"] or 0}')

        metric("giftwise_in_flight_requests", "当前正在处理的请求数", "gauge")
        lines.append(f'giftwise_in_flight_requests {data["in_flight_requests"]}')

        metric("giftwise_http_requests_total", "按方法/路由/状态码统计的请求数", "counter")
        for key, count in data["requests_by_key"].items():
            method, route, status = key.split(" ")
            lines.append(
                f'giftwise_http_requests_total{{method="{method}",route="{route}",status="{status}"}} {count}'
            )

        metric("giftwise_http_errors_total", "状态码 >= 400 的响应数", "counter")
        for status, count in data["errors_by_status"].items():
            lines.append(f'giftwise_http_errors_total{{status="{status}"}} {count}')

        metric("giftwise_validate_results_total", "校验结果分布（status 字段）", "counter")
        for result, count in data["validate_results_total"].items():
            lines.append(f'giftwise_validate_results_total{{result="{result}"}} {count}')

        metric("giftwise_validate_error_codes_total", "校验/接口错误码计数（语义见 validator 契约）", "counter")
        for code, count in data["error_codes_total"].items():
            lines.append(f'giftwise_validate_error_codes_total{{code="{code}"}} {count}')

        metric("giftwise_http_request_duration_ms", "请求处理耗时直方图（毫秒）", "histogram")
        with self._lock:
            for route in sorted(self._bucket_counts):
                buckets = self._bucket_counts[route]
                for index, upper in enumerate(LATENCY_BUCKETS_MS):
                    lines.append(
                        f'giftwise_http_request_duration_ms_bucket{{route="{route}",le="{upper}"}} {buckets[index]}'
                    )
                total = self._latency_count.get(route, 0)
                lines.append(f'giftwise_http_request_duration_ms_bucket{{route="{route}",le="+Inf"}} {total}')
                lines.append(f'giftwise_http_request_duration_ms_sum{{route="{route}"}} '
                             f'{round(self._latency_sum.get(route, 0.0), 3)}')
                lines.append(f'giftwise_http_request_duration_ms_count{{route="{route}"}} {total}')

        metric("giftwise_latency_p95_ms", "最近窗口内的 p95 延迟（毫秒，本服务自算）", "gauge")
        for route, stats in data["latency_by_route"].items():
            lines.append(f'giftwise_latency_p95_ms{{route="{route}"}} {stats["p95_ms"]}')

        metric("giftwise_bytes_in_total", "累计请求体字节数（不记录内容）", "counter")
        lines.append(f'giftwise_bytes_in_total {data["bytes_in_total"]}')

        metric("giftwise_bytes_out_total", "累计响应体字节数", "counter")
        lines.append(f'giftwise_bytes_out_total {data["bytes_out_total"]}')

        metric("giftwise_metrics_scrapes_total", "/metrics 被抓取次数（自计，可据此从请求总数中剔除）", "counter")
        lines.append(f'giftwise_metrics_scrapes_total {data["metrics_scrapes_total"]}')

        metric("giftwise_ready_checks_total", "/readyz 被检查次数", "counter")
        lines.append(f'giftwise_ready_checks_total {data["ready_checks_total"]}')

        metric("giftwise_model_calls_total", "模型调用次数（本服务为确定性校验，恒为 0）", "counter")
        lines.append("giftwise_model_calls_total 0")

        metric("giftwise_cost_cny_total", "累计成本（人民币元；本服务不调模型，恒为 0）", "counter")
        lines.append("giftwise_cost_cny_total 0.0")

        return "\n".join(lines) + "\n"


class AccessLog:
    """单行 JSON 访问日志。

    - 落点：`GIFTWISE_ACCESS_LOG`（文件，按天轮转 7 份）；未设置时只写 stdout。
    - stdout 可由 `GIFTWISE_ACCESS_STDOUT=0` 关闭。
    - 使用标准库 `logging`（自带锁），因此并发下不会像 `print` 那样把两行粘在一起。
    - 只写结构化摘要，**永不写请求体**。
    """

    def __init__(self, path: str | None = None, stdout: bool = True, backup_days: int = 7) -> None:
        self.path = path
        self.logger = logging.getLogger(f"giftwise.access.{id(self)}")
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        formatter = logging.Formatter("%(message)s")
        if path:
            target = Path(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            handler: logging.Handler = logging.handlers.TimedRotatingFileHandler(
                str(target), when="midnight", backupCount=max(1, backup_days), encoding="utf-8", delay=False
            )
        else:
            handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)
        self._stdout_handler: logging.Handler | None = None
        if stdout and path:
            stream = logging.StreamHandler()
            stream.setFormatter(formatter)
            self.logger.addHandler(stream)
            self._stdout_handler = stream

    def emit(self, record: dict) -> None:
        try:
            self.logger.info(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
        except Exception:  # 日志失败绝不能影响请求处理
            pass

    def healthy(self) -> tuple[bool, str]:
        """就绪检查用：日志落点是否真的可写。只做一次 append 试探，不写内容。"""
        if not self.path:
            return True, "stdout-only"
        try:
            target = Path(self.path)
            if not target.parent.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "a", encoding="utf-8"):
                pass
            return True, "writable"
        except OSError as exc:
            return False, f"{type(exc).__name__}: {exc}"

    def close(self) -> None:
        for handler in list(self.logger.handlers):
            try:
                handler.flush()
                handler.close()
            except Exception:
                pass
            self.logger.removeHandler(handler)


def access_log_from_env() -> AccessLog:
    path = os.environ.get("GIFTWISE_ACCESS_LOG") or None
    stdout = os.environ.get("GIFTWISE_ACCESS_STDOUT", "1") not in ("0", "false", "False")
    backup = int(os.environ.get("GIFTWISE_ACCESS_LOG_BACKUP_DAYS", "7"))
    return AccessLog(path=path, stdout=stdout, backup_days=backup)


def summarize_jsonl(path: str | Path) -> dict:
    """把 JSONL 访问日志汇总成统计（阶段 14 的 L2：只读、无第三方依赖）。"""
    target = Path(path)
    total = 0
    invalid = 0
    statuses: dict[str, int] = {}
    routes: dict[str, int] = {}
    results: dict[str, int] = {}
    codes: dict[str, int] = {}
    durations: list[float] = []
    run_ids: dict[str, int] = {}
    for line in target.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        total += 1
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            invalid += 1
            continue
        statuses[str(record.get("http_status"))] = statuses.get(str(record.get("http_status")), 0) + 1
        routes[str(record.get("route"))] = routes.get(str(record.get("route")), 0) + 1
        if record.get("val_status"):
            results[str(record["val_status"])] = results.get(str(record["val_status"]), 0) + 1
        for code in record.get("error_codes") or []:
            codes[str(code)] = codes.get(str(code), 0) + 1
        if isinstance(record.get("duration_ms"), (int, float)):
            durations.append(float(record["duration_ms"]))
        run_id = record.get("run_id")
        if run_id:
            run_ids[str(run_id)] = run_ids.get(str(run_id), 0) + 1
    durations.sort()
    return {
        "source": str(target),
        "lines_total": total,
        "lines_invalid_json": invalid,
        "statuses": dict(sorted(statuses.items())),
        "routes": dict(sorted(routes.items())),
        "validate_results": dict(sorted(results.items())),
        "error_codes": dict(sorted(codes.items())),
        "duration_ms": {
            "n": len(durations),
            "min": round(durations[0], 3) if durations else 0.0,
            "median": round(statistics.median(durations), 3) if durations else 0.0,
            "p95": round(percentile(durations, 0.95), 3) if durations else 0.0,
            "max": round(durations[-1], 3) if durations else 0.0,
        },
        "run_ids": dict(sorted(run_ids.items())),
    }
