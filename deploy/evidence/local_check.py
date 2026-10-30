"""GiftWise 部署包本地运行取证脚本（CLOUD-001）。

用途：真实启动 `deploy/server.py`，逐个请求端点，记录状态码、响应头、响应体、
延迟统计与进程占用，并把原始结果写入 `deploy/evidence/raw/`。

本脚本只做本机回环请求（默认 127.0.0.1），不上传、不访问云、不产生费用。
运行：在仓库根目录执行 `python deploy/evidence/local_check.py`

沙箱适配说明：本机沙箱禁止子进程管道（CreatePipe 返回 WinError 5），因此所有
子进程输出一律重定向到真实文件后读取，结果反而成为可归档的原始日志。
"""

from __future__ import annotations

import ctypes
import http.client
import json
import os
import platform
import socket
import statistics
import subprocess
import sys
import threading
import time
from ctypes import wintypes
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:  # 保证能 import validator / deploy
    sys.path.insert(0, str(REPO))
EVIDENCE = REPO / "deploy" / "evidence"
RAW = EVIDENCE / "raw"
HOST = "127.0.0.1"
PORT = 8765
PY = sys.executable
CN = timezone(timedelta(hours=8))

INTAKE = json.loads((REPO / "workflow" / "examples" / "intake.json").read_text(encoding="utf-8"))
CANDIDATES = json.loads((REPO / "workflow" / "examples" / "candidates.json").read_text(encoding="utf-8"))
VALID_BODY = json.dumps(
    {
        "request_json": json.dumps(INTAKE, ensure_ascii=False),
        "candidates_json": json.dumps(CANDIDATES, ensure_ascii=False),
    },
    ensure_ascii=False,
).encode("utf-8")


# ---------------------------------------------------------------- 环境与工具


class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def shell_capture(cmd: str, out_path: Path) -> str:
    """用 shell 重定向执行命令（绕开被沙箱禁止的管道），返回文件内容。"""
    try:
        with open(out_path, "w", encoding="utf-8", errors="replace") as fh:
            subprocess.run(cmd, shell=True, cwd=REPO, stdout=fh, stderr=subprocess.STDOUT)
        return out_path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:  # pragma: no cover - 环境相关
        return f"<{type(exc).__name__}: {exc}>"


def env_spec() -> dict:
    import winreg

    m = MEMORYSTATUSEX()
    m.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))

    def reg(path: str, name: str) -> str:
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path) as key:
                return str(winreg.QueryValueEx(key, name)[0])
        except Exception as exc:  # pragma: no cover - 环境相关
            return f"<unavailable: {exc}>"

    cv = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"
    return {
        "captured_at": datetime.now(CN).isoformat(timespec="seconds"),
        "python_version": sys.version.split()[0],
        "python_executable": PY,
        "platform": platform.platform(),
        "os_kernel_version": platform.version(),
        "windows_product_name": reg(cv, "ProductName"),
        "windows_display_version": reg(cv, "DisplayVersion"),
        "windows_build": reg(cv, "CurrentBuild"),
        "cpu_name": reg(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString").strip(),
        "cpu_logical_count": os.cpu_count(),
        "ram_total_GiB": round(m.ullTotalPhys / 1024**3, 2),
        "ram_avail_GiB": round(m.ullAvailPhys / 1024**3, 2),
        "repo_head": shell_capture("git rev-parse HEAD", RAW / "_git_head.txt").strip(),
        "git_status_deploy": shell_capture("git status --porcelain deploy/", RAW / "_git_status.txt").strip(),
    }


def server_rss_mib(pid: int) -> float | None:
    try:
        k32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
        handle = k32.OpenProcess(0x0400 | 0x0010, False, pid)  # QUERY_INFORMATION|VM_READ
        if not handle:
            return None
        try:
            counters = PROCESS_MEMORY_COUNTERS()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
                return None
            return round(counters.WorkingSetSize / 1024**2, 2)
        finally:
            k32.CloseHandle(handle)
    except Exception:
        return None


class Server:
    """以子进程真实启动 deploy.server，stdout/stderr 落盘为原始日志。"""

    def __init__(self, port: int = PORT, bind: str | None = HOST):
        env = dict(os.environ)
        # bind=None 表示完全不设置 GIFTWISE_BIND，用于验证源码默认值。
        if bind is None:
            env.pop("GIFTWISE_BIND", None)
        else:
            env["GIFTWISE_BIND"] = bind
        env["GIFTWISE_PORT"] = str(port)
        env["PYTHONUNBUFFERED"] = "1"
        self.port, self.bind = port, bind
        RAW.mkdir(parents=True, exist_ok=True)
        self.log_path = RAW / f"server-{port}.log"
        self._fh = open(self.log_path, "w", encoding="utf-8", errors="replace", buffering=1)
        self.proc = subprocess.Popen(
            [PY, "-m", "deploy.server"], cwd=REPO, env=env,
            stdout=self._fh, stderr=subprocess.STDOUT,
        )

    def read_log(self) -> list[str]:
        try:
            return self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return []

    def wait_ready(self, timeout: float = 15.0) -> float:
        start = time.perf_counter()
        target = HOST if self.bind in (None, "0.0.0.0", "") else self.bind
        while time.perf_counter() - start < timeout:
            try:
                with socket.create_connection((target, self.port), 0.5):
                    return round((time.perf_counter() - start) * 1000, 1)
            except OSError:
                time.sleep(0.05)
        raise RuntimeError(f"server not ready within {timeout}s; log={self.read_log()}")

    def stop(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self._fh.close()


def http_request(method: str, path: str, body: bytes | None = None, headers: dict | None = None,
                 port: int = PORT) -> dict:
    conn = http.client.HTTPConnection(HOST, port, timeout=15)
    started = time.perf_counter()
    try:
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        payload = resp.read()
        elapsed = (time.perf_counter() - started) * 1000
        return {
            "request": f"{method} {path}",
            "status": resp.status,
            "reason": resp.reason,
            "headers": dict(resp.getheaders()),
            "body_len": len(payload),
            "body": payload.decode("utf-8", "replace"),
            "elapsed_ms": round(elapsed, 2),
        }
    except Exception as exc:
        return {
            "request": f"{method} {path}",
            "status": None,
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
        }
    finally:
        conn.close()


def raw_socket_request(payload: bytes, read_timeout: float = 5.0) -> dict:
    """发送原始 HTTP 报文，用于探测缺少/非法 Content-Length 等边界。"""
    first_line = payload.split(b"\r\n", 1)[0].decode("latin-1")
    try:
        with socket.create_connection((HOST, PORT), 5) as sock:
            sock.settimeout(read_timeout)
            sock.sendall(payload)
            chunks = []
            while True:
                try:
                    part = sock.recv(65536)
                except socket.timeout:
                    break
                if not part:
                    break
                chunks.append(part)
        raw = b"".join(chunks).decode("utf-8", "replace")
        status = int(raw.split(" ")[1]) if raw.startswith("HTTP/") else None
        return {"request": first_line, "status": status, "raw": raw[:1200]}
    except Exception as exc:
        return {"request": first_line, "status": None, "error": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------- 取证步骤


def step_default_bind() -> dict:
    """证明默认（不设置 GIFTWISE_BIND）时监听 0.0.0.0，即公网可达面。"""
    srv = Server(port=8000, bind=None)
    try:
        srv.wait_ready()
        netstat = shell_capture("netstat -ano -p TCP", RAW / "_netstat_8000.txt")
        lines = [ln.strip() for ln in netstat.splitlines() if ":8000" in ln and "LISTENING" in ln.upper()]
        return {
            "note": "子进程未设置 GIFTWISE_BIND，命中源码默认值 os.environ.get('GIFTWISE_BIND', '0.0.0.0')",
            "netstat_listening": lines,
            "startup_log": srv.read_log()[:5],
            "healthz": http_request("GET", "/healthz", port=8000),
            "healthz_external_interface_note": "此后端同时在 0.0.0.0:8000 可达；本机验证只用回环地址。",
        }
    finally:
        srv.stop()


def step_matrix() -> list[dict]:
    cases: list[dict] = []
    cases.append(http_request("GET", "/healthz"))
    cases.append(http_request("GET", "/"))
    cases.append(http_request("GET", "/unknown-path"))
    cases.append(http_request("GET", "/healthz?x=1"))

    cases.append(http_request("POST", "/validate", VALID_BODY,
                              {"Content-Type": "application/json", "Content-Length": str(len(VALID_BODY))}))
    cases.append(http_request("POST", "/validate", json.dumps({"request_json": "{}"}).encode(),
                              {"Content-Type": "application/json"}))

    # 业务错误仍为 200 + 结构化 errors（契约：只校验，不改写）
    bad = json.dumps({"request_json": "{}",
                      "candidates_json": json.dumps({"candidates": []}, ensure_ascii=False)})
    cases.append(http_request("POST", "/validate", bad.encode(), {"Content-Type": "application/json"}))

    cases.append(http_request("POST", "/validate", b"{not json", {"Content-Type": "application/json"}))
    cases.append(http_request("POST", "/validate", b"[1,2,3]", {"Content-Type": "application/json"}))
    cases.append(http_request("POST", "/validate", b'{"request_json":123,"candidates_json":"{}"}',
                              {"Content-Type": "application/json"}))
    cases.append(http_request("POST", "/validate", b'{"request_json":"\xff\xfe","candidates_json":"{}"}',
                              {"Content-Type": "application/json"}))
    oversized = b'{"request_json":"' + b"a" * (64 * 1024) + b'","candidates_json":"{}"}'
    cases.append(http_request("POST", "/validate", oversized, {"Content-Type": "application/json"}))
    cases.append(http_request("POST", "/other", b"{}", {"Content-Type": "application/json"}))
    cases.append(http_request("HEAD", "/healthz"))
    return cases


def step_raw_socket_edges() -> list[dict]:
    return [
        raw_socket_request(b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        raw_socket_request(b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: abc\r\n\r\n"),
        raw_socket_request(
            b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n"
            b"2e\r\n{\"request_json\":\"{}\",\"candidates_json\":\"{}\"}\r\n0\r\n\r\n"
        ),
        raw_socket_request(b"GET /healthz HTTP/1.0\r\n\r\n"),
        raw_socket_request(b"PUT /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\n\r\n{}"),
    ]


def step_parity() -> dict:
    """HTTP /validate 的响应体是否与进程内 validator.rules.validate 完全一致。"""
    from validator.rules import validate

    directive = validate(json.dumps(INTAKE, ensure_ascii=False), json.dumps(CANDIDATES, ensure_ascii=False))
    expected = json.dumps(directive, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    got = http_request("POST", "/validate", VALID_BODY,
                       {"Content-Type": "application/json", "Content-Length": str(len(VALID_BODY))})
    return {
        "in_process_bytes_len": len(expected),
        "http_bytes_len": got["body_len"],
        "byte_identical": got["body"].encode("utf-8") == expected,
        "in_process": json.loads(expected.decode("utf-8")),
        "http_status": got["status"],
    }


def step_latency(iterations: int = 50, concurrency: int = 8, per_thread: int = 10) -> dict:
    for _ in range(5):
        http_request("GET", "/healthz")
        http_request("POST", "/validate", VALID_BODY, {"Content-Type": "application/json"})

    health = [http_request("GET", "/healthz")["elapsed_ms"] for _ in range(iterations)]
    validate_ms = [
        http_request("POST", "/validate", VALID_BODY, {"Content-Type": "application/json"})["elapsed_ms"]
        for _ in range(iterations)
    ]

    results: list[dict] = []
    lock = threading.Lock()

    def worker() -> None:
        local = [
            http_request("POST", "/validate", VALID_BODY, {"Content-Type": "application/json"})
            for _ in range(per_thread)
        ]
        with lock:
            results.extend(local)

    started = time.perf_counter()
    threads = [threading.Thread(target=worker) for _ in range(concurrency)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.perf_counter() - started
    total = concurrency * per_thread

    def stats(ms: list[float]) -> dict:
        ordered = sorted(ms)
        return {
            "n": len(ms),
            "min_ms": round(ordered[0], 2),
            "median_ms": round(statistics.median(ordered), 2),
            "mean_ms": round(statistics.fmean(ordered), 2),
            "p95_ms": round(ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))], 2),
            "max_ms": round(ordered[-1], 2),
        }

    return {
        "iterations_per_series": iterations,
        "healthz": stats(health),
        "validate_sequential": stats(validate_ms),
        "validate_concurrent": {
            "concurrency": concurrency,
            "per_thread": per_thread,
            "requests": total,
            "wall_seconds": round(wall, 3),
            "throughput_rps": round(total / wall, 1),
            "statuses": sorted({r["status"] for r in results}),
            **stats([r["elapsed_ms"] for r in results]),
        },
    }


def step_passing_case() -> dict:
    """用 tests/test_cases.json 的 T01_normal 做一次真实 HTTP 调用，验证 passed 路径。"""
    cases = json.loads((REPO / "tests" / "test_cases.json").read_text(encoding="utf-8"))["cases"]
    case = next(c for c in cases if c["id"] == "T01_normal")
    body = json.dumps(
        {
            "request_json": json.dumps(case["request"], ensure_ascii=False),
            "candidates_json": json.dumps(case["candidate_batch"], ensure_ascii=False),
        },
        ensure_ascii=False,
    ).encode("utf-8")
    got = http_request("POST", "/validate", body,
                       {"Content-Type": "application/json", "Content-Length": str(len(body))})

    from validator.rules import validate

    in_process = validate(
        json.dumps(case["request"], ensure_ascii=False),
        json.dumps(case["candidate_batch"], ensure_ascii=False),
    )
    expected = json.dumps(in_process, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {
        "fixture": "tests/test_cases.json#T01_normal",
        "fixture_expected": case.get("expected"),
        "http_status": got["status"],
        "http_body": json.loads(got["body"]),
        "byte_identical_to_in_process": got["body"].encode("utf-8") == expected,
    }


def step_server_static() -> dict:
    """服务端安全相关静态属性（用于安全自查，不是运行时探测）。"""
    import deploy.server as dsrv

    return {
        "server_version": dsrv.Handler.server_version,
        "sys_version_leaked_in_header": dsrv.Handler.sys_version,
        "protocol_version": getattr(dsrv.Handler, "protocol_version", "HTTP/1.0"),
        "handler_timeout": getattr(dsrv.Handler, "timeout", None),
        "max_body_bytes": dsrv.MAX_BODY_BYTES,
        "default_bind_source": "os.environ.get('GIFTWISE_BIND', '0.0.0.0')",
        "rules_source_sha256": dsrv.RULES_HASH,
        "server_bind_follows_any_interface": True,
    }


def step_logs_and_memory(srv: Server) -> dict:
    return {
        "server_pid": srv.proc.pid,
        "server_working_set_MiB": server_rss_mib(srv.proc.pid),
        "server_log_path": str(srv.log_path.relative_to(REPO)),
        "server_log_lines": srv.read_log(),
        "response_headers_sample": http_request("GET", "/healthz")["headers"],
    }


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    report: dict = {"generated_at": datetime.now(CN).isoformat(timespec="seconds"), "stamp": stamp}

    print("[1/6] 采集环境规格 ...", flush=True)
    report["environment"] = env_spec()

    print("[2/6] 探测默认监听地址（GIFTWISE_BIND 未设置）...", flush=True)
    report["default_bind"] = step_default_bind()

    print(f"[3/6] 以 GIFTWISE_BIND={HOST} GIFTWISE_PORT={PORT} 启动服务并请求 ...", flush=True)
    srv = Server()
    try:
        report["startup_ms_to_accept"] = srv.wait_ready()
        report["matrix"] = step_matrix()
        report["raw_socket_edges"] = step_raw_socket_edges()
        report["parity"] = step_parity()
        report["passing_case"] = step_passing_case()
        report["server_static"] = step_server_static()
        print("[4/6] 延迟与并发测量 ...", flush=True)
        report["latency"] = step_latency()
        print("[5/6] 日志与内存占用 ...", flush=True)
        report["process"] = step_logs_and_memory(srv)
    finally:
        srv.stop()
    report["server_log_after_stop"] = srv.read_log()
    report["exit_code_after_terminate"] = srv.proc.returncode

    out = RAW / f"local-check-{stamp}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (RAW / "local-check-latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[6/6] 原始结果已写入 {out.relative_to(REPO)}", flush=True)

    print("\n== 状态码速览 ==")
    for case in report["matrix"]:
        body = case.get("body") or case.get("error", "")
        print(f"  {case['request']:<28} -> {case['status']}  {body[:90]}")
    for case in report["raw_socket_edges"]:
        print(f"  [raw] {case['request'][:46]:<48} -> {case['status']}")
    print(f"\nparity byte_identical = {report['parity']['byte_identical']}")
    pc = report["passing_case"]
    print(f"T01_normal over HTTP: status={pc['http_status']} "
          f"all_passed={pc['http_body'].get('all_passed')} byte_identical={pc['byte_identical_to_in_process']}")
    conc = report["latency"]["validate_concurrent"]
    print(f"validate 串行中位数 = {report['latency']['validate_sequential']['median_ms']} ms; "
          f"并发 {conc['concurrency']}x{conc['per_thread']} 吞吐 = {conc['throughput_rps']} rps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
