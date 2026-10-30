"""每请求 CPU 成本实测（cgroup 计数，不靠估算）。

为什么必须测这个：
    单看 `validate()` 的纯 CPU 成本（约 171 us/次）会得出「542 req/s 只需 9% 单核」，
    但 docker stats 实测该副本占了 110%~171% 单核。差了约 15 倍。
    说明**绝大部分 CPU 不在业务校验上，而在 HTTP 框架/线程/socket 这些管道开销上**。
    这个结论直接决定「加副本有没有用」——如果瓶颈是管道开销，加副本确实有用；
    如果是 I/O 等待，加副本用处就有限。

测法（可复核）：
    读容器 cgroup 的累计 CPU 微秒数（/sys/fs/cgroup/cpu.stat 的 usage_usec），
    在**同一容器**上分别测「空转」与「压 N 个请求」两段的 CPU 增量，
    相减得到净 CPU 消耗，再除以请求数。

跑法：
    python compose/run-perrequest-cpu.py --target 127.0.0.1:19001 --container giftwise-cloudnative-lab-validator-a-1
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location("scaling", str(HERE / "run-scaling-experiment.py"))
_scaling = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_scaling)
post = _scaling.post
next_seq = _scaling.next_seq

EVIDENCE_DIR = HERE / "evidence"
DOCKER = "docker"


def cgroup_cpu_usec(container: str) -> int:
    """容器累计 CPU 微秒数（cgroup v2）。失败则抛异常。"""
    proc = subprocess.run(
        [DOCKER, "exec", container, "cat", "/sys/fs/cgroup/cpu.stat"],
        capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        # cgroup v1 回退
        proc = subprocess.run(
            [DOCKER, "exec", container, "cat", "/sys/fs/cgroup/cpuacct/cpuacct.usage"],
            capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(f"cannot read cgroup cpu accounting: {proc.stderr.strip()[:200]}")
        return int(proc.stdout.strip()) // 1000
    for line in proc.stdout.splitlines():
        if line.startswith("usage_usec"):
            return int(line.split()[1])
    raise RuntimeError("usage_usec not found in cpu.stat")


def load(host: str, port: int, total: int, concurrency: int) -> tuple[int, float]:
    results: list[dict] = []
    lock = threading.Lock()

    def work(_i: int) -> None:
        r = post(host, port, next_seq())
        with lock:
            results.append(r)

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(work, range(total)))
    wall = time.perf_counter() - t0
    return sum(1 for r in results if r["ok"]), wall


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="127.0.0.1:19001")
    ap.add_argument("--container", default="giftwise-cloudnative-lab-validator-a-1")
    ap.add_argument("--requests", type=int, default=3000)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--idle-seconds", type=float, default=10.0)
    ap.add_argument("--validate-us", type=float, default=170.87)
    ap.add_argument("--label", default="main")
    args = ap.parse_args()

    host, _, port_s = args.target.rpartition(":")
    port = int(port_s)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    print("# 每请求 CPU 成本实测（cgroup usage_usec）")
    print(f"# 时刻={time.strftime('%Y-%m-%d %H:%M:%S %z')}")
    print(f"# 目标={args.target}  容器={args.container}")
    print(f"# 请求数={args.requests}  并发={args.concurrency}  空转基线={args.idle_seconds}s")
    print(f"# validate() 纯 CPU 参照={args.validate_us} us/次（容器内实测）")
    print()

    # ---- 1. 空转基线：容器在无请求时的 CPU 消耗 ----
    print(f"--- [1] 空转基线：静默 {args.idle_seconds}s，测容器的背景 CPU 消耗 ---")
    b0 = cgroup_cpu_usec(args.container)
    t0 = time.perf_counter()
    time.sleep(args.idle_seconds)
    idle_wall = time.perf_counter() - t0
    b1 = cgroup_cpu_usec(args.container)
    idle_usec = b1 - b0
    idle_per_sec = idle_usec / idle_wall
    print(f"  usage_usec 前={b0}  后={b1}  增量={idle_usec} us")
    print(f"  空转 CPU = {idle_per_sec:.1f} us/s = {idle_per_sec/1e6*100:.3f}% 单核")
    print(f"  （背景消耗来自 peer 的 /healthz 健康探测等）")
    print()

    # ---- 2. 压力段 ----
    print(f"--- [2] 压 {args.requests} 个请求 / 并发 {args.concurrency} ---")
    c0 = cgroup_cpu_usec(args.container)
    ok, wall = load(host, port, args.requests, args.concurrency)
    c1 = cgroup_cpu_usec(args.container)
    busy_usec = c1 - c0
    print(f"  usage_usec 前={c0}  后={c1}  增量={busy_usec} us")
    print(f"  成功 {ok}/{args.requests}  墙上时间 {wall:.3f}s  吞吐 {ok/wall:.2f} req/s")
    print()

    # ---- 3. 扣除空转基线，得到净每请求 CPU ----
    overhead_usec = idle_per_sec * wall
    net_usec = busy_usec - overhead_usec
    per_req_us = net_usec / args.requests
    core_frac = (net_usec / 1e6) / wall
    validate_share = args.validate_us / per_req_us * 100 if per_req_us else 0

    print("--- [3] 结论 ---")
    print(f"  压力段总 CPU          : {busy_usec} us = {busy_usec/1e6:.4f} core-seconds")
    print(f"  扣除空转基线({overhead_usec:.0f} us) : {net_usec} us = {net_usec/1e6:.4f} core-seconds")
    print(f"  每请求净 CPU          : {per_req_us:.2f} us")
    print(f"  平均占用核数          : {core_frac:.3f} core（stress 期间）")
    print(f"  其中 validate() 占     : {args.validate_us:.2f} us = {validate_share:.1f}%")
    print(f"  其余(HTTP/线程/socket): {per_req_us - args.validate_us:.2f} us = {100-validate_share:.1f}%")
    print()
    print(f"  单核可承载上限(按净每请求 CPU) = {1e6/per_req_us:.1f} req/s/核")
    print(f"  若换成纯 validate 计算量     = {1e6/args.validate_us:.1f} req/s/核")
    print(f"  => 框架开销使单核吞吐上限降低约 {per_req_us/args.validate_us:.1f} 倍")

    report = {
        "label": args.label, "run_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "target": args.target, "container": args.container,
        "requests": args.requests, "concurrency": args.concurrency, "ok": ok,
        "wall_s": round(wall, 3), "throughput_rps": round(ok / wall, 2),
        "idle_cpu_us_per_s": round(idle_per_sec, 2),
        "busy_usec": busy_usec, "idle_baseline_usec": round(overhead_usec, 1),
        "net_usec": net_usec, "per_request_cpu_us": round(per_req_us, 3),
        "cores_used": round(core_frac, 4),
        "validate_us_reference": args.validate_us,
        "validate_share_percent": round(validate_share, 2),
        "framework_share_percent": round(100 - validate_share, 2),
        "single_core_limit_rps": round(1e6 / per_req_us, 1),
    }
    out = EVIDENCE_DIR / f"perrequest-cpu-{args.label}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n# 原始结果已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
