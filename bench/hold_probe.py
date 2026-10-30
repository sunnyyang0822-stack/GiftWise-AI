#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""并发连接承载上限探针：直接压住 N 条连接，看服务端能同时接受多少条。

为什么需要它
------------
`bench.py ramp` 测的是"请求吞吐"（连接开了就关）。但审计里明确写着
「I-2 高并发上限：**只验到 9 条连接**，未压测 OOM 行为，不推测」。
要回答"这个单进程 HTTP 服务的**实际并发承载上限**是多少"，必须**同时压住**连接不放，
而不是快速开关。

做法
----
每条连接发一个**故意半开**的请求（声明 `Content-Length: 100` 只发 5 字节），
然后**保持不放**。服务端会为每条连接占一个线程，并在 `GIFTWISE_READ_TIMEOUT`
（默认 10 秒）后回 408 并关闭——所以本探针能同时测出：
  1. 服务端**同时接受**多少条连接（ESTABLISHED 计数 / 建立失败计数）
  2. I-2 修复是否生效（半开连接是否在约 10 秒时被 408 关闭，而不是永久挂住）

测量口径
--------
服务端并发连接数取自 `netstat -ano` 中**本地地址为被测端口**的 ESTABLISHED 行
（只数服务端侧，不把客户端侧算两次）。
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def split_url(url: str):
    u = url.replace("http://", "").rstrip("/")
    host, _, port = u.partition(":")
    return host, int(port or 80)


def server_established(port: int) -> int | None:
    """只数服务端侧的 ESTABLISHED 连接（本地地址 = 被测端口）。"""
    try:
        if os.name == "nt":
            txt = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                                 timeout=20, encoding="utf-8", errors="replace").stdout or ""
            n = 0
            for ln in txt.splitlines():
                parts = ln.split()
                if len(parts) >= 4 and parts[0].upper() == "TCP" and parts[3].upper() == "ESTABLISHED":
                    if parts[1].endswith(f":{port}"):
                        n += 1
            return n
        txt = subprocess.run(["ss", "-tan"], capture_output=True, text=True, timeout=20).stdout or ""
        return sum(1 for ln in txt.splitlines()
                   if "ESTAB" in ln and ln.split()[3].endswith(f":{port}"))
    except Exception:  # noqa: BLE001
        return None


def _docker(args: list[str], timeout: float = 15.0) -> str:
    env = dict(os.environ)
    env["PATH"] = env.get("PATH", "") + os.pathsep + r"C:\Program Files\Docker\Docker\resources\bin"
    env["MSYS_NO_PATHCONV"] = "1"
    try:
        p = subprocess.run(["docker"] + args, capture_output=True, text=True, timeout=timeout,
                           env=env, encoding="utf-8", errors="replace")
        return (p.stdout or "").strip() or (p.stderr or "").strip()
    except Exception as e:  # noqa: BLE001
        return f"<err {type(e).__name__}>"


def container_threads(container: str) -> int | None:
    v = _docker(["exec", container, "sh", "-c", "grep -h Threads /proc/1/status"])
    for tok in v.splitlines():
        if tok.startswith("Threads:"):
            try:
                return int(tok.split(":")[1].strip())
            except Exception:  # noqa: BLE001
                pass
    return None


def container_mem(container: str) -> int | None:
    for p in ("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"):
        v = _docker(["exec", container, "sh", "-c", f"cat {p} 2>/dev/null"])
        if v.isdigit():
            return int(v)
    return None


class ContainerSampler(threading.Thread):
    """**在 hold 期间**采样容器线程数与内存。

    ⚠️ 第一版把 `docker exec` 写在探针**之后**，采到的是空闲态 `Threads: 1`——
    时机错了就等于没测。必须在连接被压住的那段时间里采。
    """

    def __init__(self, container: str, interval: float = 0.3):
        super().__init__(daemon=True)
        self.container = container
        self.interval = interval
        self.stop_flag = threading.Event()
        self.rows: list[tuple[int | None, int | None]] = []

    def run(self):
        self.rows.append((container_threads(self.container), container_mem(self.container)))
        while not self.stop_flag.is_set():
            self.rows.append((container_threads(self.container), container_mem(self.container)))
            self.stop_flag.wait(self.interval)

    def stop(self):
        self.stop_flag.set()

    def peaks(self):
        thr = [t for t, _ in self.rows if isinstance(t, int)]
        mem = [m for _, m in self.rows if isinstance(m, int)]
        return {
            "samples": len(self.rows),
            "threads_peak": max(thr) if thr else None,
            "threads_min": min(thr) if thr else None,
            "mem_peak_bytes": max(mem) if mem else None,
            "mem_baseline_bytes": mem[0] if mem else None,
            "mem_delta_bytes": (max(mem) - mem[0]) if mem else None,
        }


def one(host, port, idx, hold, results, partial):
    t0 = time.perf_counter()
    rec = {"idx": idx, "connected": False, "err": None, "first_byte_s": None, "bytes": 0}
    s = None
    try:
        s = socket.create_connection((host, port), timeout=hold + 5)
        rec["connected"] = True
        s.settimeout(hold + 3)
        s.sendall(partial)
        try:
            data = s.recv(4096)
            rec["first_byte_s"] = round(time.perf_counter() - t0, 3)
            rec["bytes"] = len(data)
            rec["resp_head"] = data[:60].decode("latin-1")
        except socket.timeout:
            rec["err"] = "recv_timeout"
    except Exception as e:  # noqa: BLE001
        rec["err"] = f"{type(e).__name__}: {e}"
    finally:
        if s is not None:
            try:
                s.close()
            except Exception:  # noqa: BLE001
                pass
    results[idx] = rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--connections", type=int, required=True)
    ap.add_argument("--hold", type=float, default=6.0, help="建立后保持秒数（应 > 服务端读超时才能看到 408）")
    ap.add_argument("--container", default="", help="容器名；给了就在 hold 期间采样线程与内存")
    ap.add_argument("--label", default="")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    host, port = split_url(args.url)
    # 故意半开：声明 100 字节，只发 5 字节
    partial = (b"POST /validate HTTP/1.1\r\nHost: bench\r\n"
               b"Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"a\":")
    assert len(partial.split(b"\r\n\r\n", 1)[1]) == 5

    base = server_established(port)
    results: list = [None] * args.connections
    threads = [threading.Thread(target=one, args=(host, port, i, args.hold, results, partial))
               for i in range(args.connections)]

    samples = []
    stop = threading.Event()

    def sampler():
        while not stop.is_set():
            samples.append(server_established(port))
            stop.wait(0.4)

    smp = threading.Thread(target=sampler, daemon=True)
    smp.start()

    csmp = None
    if args.container:
        csmp = ContainerSampler(args.container, 0.3)
        csmp.start()

    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = time.perf_counter() - t0
    stop.set()
    smp.join(timeout=2)
    if csmp is not None:
        csmp.stop()
        csmp.join(timeout=3)

    conn = sum(1 for r in results if r and r["connected"])
    got = sum(1 for r in results if r and r.get("first_byte_s") is not None)
    errs: dict[str, int] = {}
    for r in results:
        if r and r.get("err"):
            k = r["err"].split(":")[0]
            errs[k] = errs.get(k, 0) + 1
    fbs = sorted(r["first_byte_s"] for r in results if r and r.get("first_byte_s") is not None)

    rep = {
        "url": args.url,
        "requested_connections": args.connections,
        "hold_seconds": args.hold,
        "connected": conn,
        "connected_pct": round(100.0 * conn / args.connections, 2),
        "got_response": got,
        "error_kinds": errs,
        "server_established_baseline": base,
        "server_established_peak": max([v for v in samples if v is not None], default=None),
        "server_established_samples": len([v for v in samples if v is not None]),
        "container": csmp.peaks() if csmp is not None else None,
        "first_byte_s": {"min": fbs[0] if fbs else None,
                         "max": fbs[-1] if fbs else None,
                         "mean": round(sum(fbs) / len(fbs), 3) if fbs else None},
        "wall_seconds": round(wall, 3),
        "recorded_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "python": sys.version.split()[0],
    }
    name = args.out or f"hold-c{args.connections}-{datetime.now().strftime('%Y%m%dT%H%M%S')}.json"
    out = ROOT / "bench" / "runs" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(rep, ensure_ascii=False, indent=2))
    print(f"\n归档: {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
