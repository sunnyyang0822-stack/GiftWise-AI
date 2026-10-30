#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""GiftWise 性能与容量基准（零第三方依赖，只用 Python 标准库）。

设计要点
--------
1. **HTTP/1.0、无 keep-alive**：`deploy/server.py` 用 `BaseHTTPRequestHandler`
   且未设 `protocol_version`，因此**每次请求都会新建 TCP 连接**。
   本工具刻意**每请求新建连接**，使测得的延迟＝真实客户端体验（含连接建立开销）。
2. **同步起跑**：所有 worker 在 `threading.Barrier` 上对齐后才发第一个请求，
   避免"线程逐个启动"把长尾算进 p99。
3. **每 worker 请求数固定**（不是固定时长），使不同并发档的样本量可比。
4. **资源采样**：ramp 模式在压测期间采样容器 cgroup 内存与线程数，
   用于回答"首个瓶颈在哪"。

子命令
------
  http     单档 HTTP 压测（并发 c、每 worker n 个请求）
  rules    纯规则层基准（不经 HTTP，用于区分 HTTP 开销与规则计算开销）
  ramp     并发阶梯（1→10→50→100→200），每档采样资源
  startup  冷/热启动时间
  report   汇总 bench/runs/*.json → docs/performance/

用法示例
--------
  python bench/bench.py rules --iterations 3000
  python bench/bench.py http --url http://127.0.0.1:18901 --concurrency 10 --requests 200
  python bench/bench.py ramp --url http://127.0.0.1:18901 --container gwbench \
      --levels 1,10,50,100,200 --requests 200
"""
from __future__ import annotations

import argparse
import http.client
import json
import math
import os
import platform
import socket
import statistics
import struct
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "bench" / "runs"
BENCH = ROOT / "bench"


# ---------------------------------------------------------------- 工具
def pct(sorted_vals, p: float) -> float:
    if not sorted_vals:
        return float("nan")
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = max(1, math.ceil(p / 100.0 * len(sorted_vals))) - 1
    return sorted_vals[min(k, len(sorted_vals) - 1)]


def summarize(lat_ms: list[float]) -> dict:
    """延迟统计。

    `tail` 里的离群计数是刻意保留的：c=10 实测出现 ~1031 ms 的双峰长尾，
    必须能区分"服务端慢"与"客户端/Docker 端口转发慢"，所以不能只看 p99。
    """
    s = sorted(lat_ms)
    n = len(s)
    res = {
        "n": n,
        "min_ms": round(s[0], 3) if s else None,
        "mean_ms": round(statistics.fmean(s), 3) if s else None,
        "p50_ms": round(pct(s, 50), 3) if s else None,
        "p90_ms": round(pct(s, 90), 3) if s else None,
        "p95_ms": round(pct(s, 95), 3) if s else None,
        "p99_ms": round(pct(s, 99), 3) if s else None,
        "p999_ms": round(pct(s, 99.9), 3) if s else None,
        "max_ms": round(s[-1], 3) if s else None,
    }
    if s:
        res["tail"] = {
            "over_50ms": sum(1 for x in s if x > 50),
            "over_100ms": sum(1 for x in s if x > 100),
            "over_500ms": sum(1 for x in s if x > 500),
            "over_1000ms": sum(1 for x in s if x > 1000),
            "over_100ms_pct": round(100.0 * sum(1 for x in s if x > 100) / n, 2),
        }
    return res


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def stamp() -> str:
    return datetime.now().strftime("%Y%m%dT%H%M%S")


def env_info() -> dict:
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "cpu_logical": os.cpu_count(),
    }


def write_run(kind: str, payload: dict, label: str = "") -> Path:
    RUNS.mkdir(parents=True, exist_ok=True)
    payload["kind"] = kind
    payload["label"] = label
    payload["recorded_at"] = now_iso()
    payload.setdefault("env", env_info())
    name = f"{kind}{('-' + label) if label else ''}-{stamp()}.json"
    path = RUNS / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_payloads():
    rp = BENCH / "_sample_request.json"
    cp = BENCH / "_sample_candidates.json"
    if not rp.exists() or not cp.exists():
        raise SystemExit("缺少样本：请先运行 bench/probe_contract.py 生成 bench/_sample_request.json")
    return rp.read_text(encoding="utf-8"), cp.read_text(encoding="utf-8")


def split_url(url: str):
    u = url.replace("http://", "")
    host, _, port = u.partition(":")
    return host, int(port or 80)


# ---------------------------------------------------------------- HTTP 压测
def _worker(host, port, body: bytes, n: int, barrier, out, idx, timeout, linger0: bool):
    """单个压测 worker：起跑对齐后连发 n 个请求。

    ⚠️ 方法论要点（第一轮踩过的坑）：服务端是 HTTP/1.0、**每请求新建连接**，
    客户端关闭的连接会在 Windows 上进入 TIME_WAIT 数十秒。高并发下**客户端临时端口先耗尽**，
    报 `WinError 10048`（地址已被使用）与 `ConnectionRefused`——**这是客户端假象，不是服务端上限**。
    因此默认对客户端 socket 设 `SO_LINGER(1, 0)` 强制 RST 关闭，跳过 TIME_WAIT。
    """
    lat, codes, errs = [], {}, []
    kinds: dict[str, int] = {}
    conn = None
    try:
        barrier.wait()
        for _ in range(n):
            t0 = time.perf_counter()
            try:
                conn = http.client.HTTPConnection(host, port, timeout=timeout)
                conn.connect()
                if linger0 and conn.sock is not None:
                    conn.sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER,
                                         struct.pack("ii", 1, 0))
                conn.request("POST", "/validate", body=body,
                             headers={"Content-Type": "application/json"})
                resp = conn.getresponse()
                resp.read()
                codes[resp.status] = codes.get(resp.status, 0) + 1
            except Exception as e:  # noqa: BLE001
                k = type(e).__name__
                kinds[k] = kinds.get(k, 0) + 1
                msg = str(e)
                if "10048" in msg:
                    k = k + ":WinError10048(客户端端口耗尽)"
                elif "10061" in msg:
                    k = k + ":WinError10061(连接被拒)"
                elif "10054" in msg:
                    k = k + ":WinError10054(连接被重置)"
                errs.append(f"{k}: {msg}")
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:  # noqa: BLE001
                        pass
                    conn = None
            lat.append((time.perf_counter() - t0) * 1000.0)
    finally:
        out[idx] = (lat, codes, errs, kinds)


def count_time_wait() -> int | None:
    """本机 TIME_WAIT 套接字数（Windows: netstat -ano；Linux: ss）。"""
    try:
        if os.name == "nt":
            p = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=20,
                               encoding="utf-8", errors="replace")
            txt = p.stdout or ""
            return sum(1 for ln in txt.splitlines() if "TIME_WAIT" in ln.upper())
        p = subprocess.run(["ss", "-tan"], capture_output=True, text=True, timeout=20)
        return sum(1 for ln in (p.stdout or "").splitlines() if "TIME-WAIT" in ln)
    except Exception:  # noqa: BLE001
        return None


def run_http(url: str, concurrency: int, requests_per_worker: int, timeout: float = 15.0,
             linger0: bool = True):
    host, port = split_url(url)
    rj, cj = load_payloads()
    body = json.dumps({"request_json": rj, "candidates_json": cj},
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    total = concurrency * requests_per_worker
    barrier = threading.Barrier(concurrency)
    out: list = [None] * concurrency
    threads = [threading.Thread(target=_worker,
                                args=(host, port, body, requests_per_worker, barrier, out, i,
                                      timeout, linger0))
               for i in range(concurrency)]
    tw_before = count_time_wait()
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.perf_counter() - t0
    tw_after = count_time_wait()

    lat, codes, errs = [], {}, []
    kinds: dict[str, int] = {}
    for item in out:
        if not item:
            continue
        lat += item[0]
        for k, v in item[1].items():
            codes[k] = codes.get(k, 0) + v
        errs += item[2]
        for k, v in item[3].items():
            kinds[k] = kinds.get(k, 0) + v

    ok = codes.get(200, 0)
    res = {
        "url": url,
        "concurrency": concurrency,
        "requests_per_worker": requests_per_worker,
        "requests_total": total,
        "wall_seconds": round(wall, 4),
        "throughput_rps": round(total / wall, 2) if wall > 0 else None,
        "throughput_ok_rps": round(ok / wall, 2) if wall > 0 else None,
        "status_counts": {str(k): v for k, v in sorted(codes.items())},
        "ok_200": ok,
        "http_408": codes.get(408, 0),
        "error_count": len(errs),
        "error_kinds": kinds,
        "error_samples": errs[:5],
        "body_bytes": len(body),
        "client_linger0": linger0,
        "client_time_wait_before": tw_before,
        "client_time_wait_after": tw_after,
        "latency": summarize(lat),
    }
    return res


# ---------------------------------------------------------------- 纯规则层
def run_rules(iterations: int, sample: str = "median"):
    sys.path.insert(0, str(ROOT))
    from validator.rules import validate  # noqa: PLC0415

    if sample == "big":
        rj = (BENCH / "_sample_request_big.json").read_text(encoding="utf-8")
        cj = (BENCH / "_sample_candidates_big.json").read_text(encoding="utf-8")
    else:
        rj, cj = load_payloads()

    for _ in range(min(200, iterations)):  # 预热（触发 import/编译缓存）
        validate(rj, cj)

    lat = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        validate(rj, cj)
        lat.append((time.perf_counter() - t0) * 1000.0)

    return {
        "sample": sample,
        "iterations": iterations,
        "request_bytes": len(rj),
        "candidates_bytes": len(cj),
        "latency": summarize(lat),
        "throughput_rps_single_thread": round(1000.0 / statistics.fmean(lat), 1) if lat else None,
    }


# ---------------------------------------------------------------- 容器资源采样
def _docker(args: list[str], timeout: float = 10.0) -> str:
    exe = "docker"
    env = dict(os.environ)
    env["PATH"] = env.get("PATH", "") + os.pathsep + r"C:\Program Files\Docker\Docker\resources\bin"
    env["MSYS_NO_PATHCONV"] = "1"
    try:
        p = subprocess.run([exe] + args, capture_output=True, text=True,
                           timeout=timeout, env=env, encoding="utf-8", errors="replace")
        return (p.stdout or "").strip() or (p.stderr or "").strip()
    except Exception as e:  # noqa: BLE001
        return f"<err {type(e).__name__}>"


def sample_container(container: str) -> dict:
    """取容器内存与线程数。优先 cgroup（快且准），失败再退 docker stats。"""
    mem = None
    for p in ("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"):
        v = _docker(["exec", container, "sh", "-c", f"cat {p} 2>/dev/null"])
        if v.isdigit():
            mem = int(v)
            break
    if mem is None:
        v = _docker(["stats", "--no-stream", "--format", "{{.MemUsage}}", container])
        if "MiB" in v or "GiB" in v:
            mem = v
    thr = _docker(["exec", container, "sh", "-c", "grep -h Threads /proc/1/status 2>/dev/null"])
    return {"mem_bytes": mem, "threads_raw": thr}


class ResourceSampler(threading.Thread):
    """压测期间后台采样容器资源。"""

    def __init__(self, container: str, interval: float = 0.4):
        super().__init__(daemon=True)
        self.container = container
        self.interval = interval
        self.stop_flag = threading.Event()
        self.samples: list[dict] = []

    def run(self):
        while not self.stop_flag.is_set():
            s = sample_container(self.container)
            s["t"] = time.time()
            self.samples.append(s)
            self.stop_flag.wait(self.interval)

    def stop(self):
        self.stop_flag.set()


def _mem_peak(samples: list[dict]):
    vals = [s["mem_bytes"] for s in samples if isinstance(s.get("mem_bytes"), int)]
    return max(vals) if vals else None


def _thr_peak(samples: list[dict]):
    vals = []
    for s in samples:
        for tok in (s.get("threads_raw") or "").split("\n"):
            if tok.startswith("Threads:"):
                try:
                    vals.append(int(tok.split(":")[1].strip()))
                except Exception:  # noqa: BLE001
                    pass
    return max(vals) if vals else None


def run_ramp(url: str, container: str, levels: list[int], requests_per_worker: int,
             linger0: bool = True):
    res = {"url": url, "container": container, "levels": [],
           "requests_per_worker": requests_per_worker, "client_linger0": linger0}
    baseline = sample_container(container) if container and container != "__none__" else None
    res["baseline"] = baseline
    for c in levels:
        s = None
        if container and container != "__none__":
            s = ResourceSampler(container, 0.35)
            s.start()
        r = run_http(url, c, requests_per_worker, linger0=linger0)
        if s is not None:
            s.stop()
            s.join(timeout=3)
            r["resource"] = {
                "mem_peak_bytes": _mem_peak(s.samples),
                "mem_samples": len(s.samples),
                "threads_peak": _thr_peak(s.samples),
                "threads_raw_last": s.samples[-1]["threads_raw"] if s.samples else None,
            }
        else:
            r["resource"] = {"mem_peak_bytes": None, "threads_peak": None, "note": "本机直跑，无容器资源"}
        res["levels"].append(r)
        print(f"  c={c:<4} rps={r['throughput_rps']:<9} ok_rps={r['throughput_ok_rps']:<9} "
              f"p50={r['latency']['p50_ms']:<8} p95={r['latency']['p95_ms']:<9} "
              f"p99={r['latency']['p99_ms']:<9} max={r['latency']['max_ms']:<9} "
              f"408={r['http_408']} err={r['error_count']} "
              f"thr={r['resource']['threads_peak']} mem={r['resource']['mem_peak_bytes']} "
              f"cliTW={r['client_time_wait_before']}->{r['client_time_wait_after']}")
        if r["error_kinds"]:
            print(f"       错误构成: {r['error_kinds']}")
    return res


# ---------------------------------------------------------------- 启动时间
def run_startup(image: str, runs: int, port: int = 18999):
    out = {"image": image, "runs": [], "port": port}
    for i in range(runs):
        name = f"gwstart-{i}"
        _docker(["rm", "-f", name])
        t0 = time.perf_counter()
        _docker(["run", "-d", "--rm", "--name", name, "-p", f"127.0.0.1:{port}:8000", image])
        first = None
        import urllib.request  # noqa: PLC0415
        for _ in range(200):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=0.5) as r:
                    if r.status == 200:
                        first = time.perf_counter() - t0
                        break
            except Exception:  # noqa: BLE001
                time.sleep(0.02)
        out["runs"].append({"run": i + 1, "seconds_to_first_healthz": round(first, 3) if first else None})
        _docker(["rm", "-f", name])
    vals = [r["seconds_to_first_healthz"] for r in out["runs"] if r["seconds_to_first_healthz"]]
    if vals:
        out["summary"] = {"n": len(vals), "min_s": min(vals), "max_s": max(vals),
                          "mean_s": round(statistics.fmean(vals), 3)}
    return out


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="GiftWise 性能基准")
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("http"); a.add_argument("--url", required=True)
    a.add_argument("--concurrency", type=int, default=1)
    a.add_argument("--requests", type=int, default=100, help="每个 worker 的请求数")
    a.add_argument("--timeout", type=float, default=15.0)
    a.add_argument("--label", default="")
    a.add_argument("--no-linger0", action="store_true",
                   help="不设 SO_LINGER=0（用于复现客户端 TIME_WAIT/端口耗尽现象）")

    b = sub.add_parser("rules"); b.add_argument("--iterations", type=int, default=2000)
    b.add_argument("--sample", default="median", choices=["median", "big"])

    c = sub.add_parser("ramp"); c.add_argument("--url", required=True)
    c.add_argument("--container", required=True)
    c.add_argument("--levels", default="1,10,50,100,200")
    c.add_argument("--requests", type=int, default=200)
    c.add_argument("--no-linger0", action="store_true")

    d = sub.add_parser("startup"); d.add_argument("--image", required=True)
    d.add_argument("--runs", type=int, default=3); d.add_argument("--port", type=int, default=18999)

    args = ap.parse_args()
    if args.cmd == "http":
        r = run_http(args.url, args.concurrency, args.requests, args.timeout,
                     linger0=not args.no_linger0)
        p = write_run("http", r, args.label or f"c{args.concurrency}")
        print(json.dumps(r, ensure_ascii=False, indent=2))
        print(f"\n归档: {p.relative_to(ROOT)}")
    elif args.cmd == "rules":
        r = run_rules(args.iterations, args.sample)
        p = write_run("rules", r, args.sample)
        print(json.dumps(r, ensure_ascii=False, indent=2))
        print(f"\n归档: {p.relative_to(ROOT)}")
    elif args.cmd == "ramp":
        levels = [int(x) for x in args.levels.split(",") if x.strip()]
        print(f"并发阶梯 {levels}（每 worker {args.requests} 请求，"
              f"SO_LINGER0={not args.no_linger0}）")
        r = run_ramp(args.url, args.container, levels, args.requests,
                     linger0=not args.no_linger0)
        p = write_run("ramp", r, f"levels{'-'.join(map(str, levels))}")
        print(f"\n归档: {p.relative_to(ROOT)}")
    elif args.cmd == "startup":
        r = run_startup(args.image, args.runs, args.port)
        p = write_run("startup", r, args.image.split(":")[-1])
        print(json.dumps(r, ensure_ascii=False, indent=2))
        print(f"\n归档: {p.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
