"""持续负载下的 CPU 占用采样：回答「验证器到底吃不吃 CPU」。

先算一个可检验的预测，再用 docker stats 去核对：
    validate() 纯 CPU 成本（宿主实测，见 compose/evidence/cpu-cost.txt）
        约 176 us/次  ->  单核 1 秒最多 ~5680 次
    若某副本实测吞吐为 T req/s，则该副本的 CPU 占用预测值 = T * 176us / 1s
        例如 T=496 -> 496 * 176e-6 = 0.0873 -> 约 8.7% 单核

    若实测 CPU% 远低于 100% 且与预测接近，则结论是「**不是** CPU 瓶颈」，
    加副本也就无法提升吞吐（因为瓶颈不在这里）。

跑法：
    python compose/run-cpu-sampling.py --target 127.0.0.1:19001 --seconds 20 --concurrency 8
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("scaling", str(HERE / "run-scaling-experiment.py"))
_scaling = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_scaling)
post = _scaling.post
next_seq = _scaling.next_seq

EVIDENCE_DIR = HERE / "evidence"
DOCKER = "docker"


def docker_stats(names: list[str]) -> dict:
    """一次性取容器 CPU%。--no-stream 取的是「自上次采样以来的平均」，因此要连续采样看趋势。"""
    out = {}
    proc = subprocess.run(
        [DOCKER, "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"] + names,
        capture_output=True, text=True, timeout=60)
    for line in proc.stdout.strip().splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            out[parts[0]] = {"cpu_perc": parts[1], "mem": parts[2] if len(parts) > 2 else "?"}
    if proc.returncode != 0:
        out["_error"] = proc.stderr.strip()[:300]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="127.0.0.1:19001")
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--containers", default="giftwise-cloudnative-lab-validator-a-1,giftwise-cloudnative-lab-validator-b-1,giftwise-cloudnative-lab-lb-1,giftwise-cloudnative-lab-lb-one-1")
    ap.add_argument("--cpu-us-per-validate", type=float, default=176.26,
                    help="validate() 纯 CPU 微秒数，来自 compose/evidence/cpu-cost.txt")
    ap.add_argument("--label", default="main")
    args = ap.parse_args()

    host, _, port_s = args.target.rpartition(":")
    port = int(port_s)
    names = [n.strip() for n in args.containers.split(",") if n.strip()]

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    print("# 持续负载下的 CPU 采样")
    print(f"# 时刻={time.strftime('%Y-%m-%d %H:%M:%S %z')}")
    print(f"# 目标={args.target}  并发={args.concurrency}  持续={args.seconds}s")
    print(f"# validate 纯 CPU 假设={args.cpu_us_per_validate} us/次（来自 compose/evidence/cpu-cost.txt）")

    stop = threading.Event()
    done: list[dict] = []
    lock = threading.Lock()

    def work() -> None:
        while not stop.is_set():
            r = post(host, port, next_seq())
            with lock:
                done.append(r)

    samples: list[dict] = []
    print()
    print(f"{'t(s)':>6}  {'CPU% of validator-a':>22} {'MEM validator-a':>18}")
    print("-" * 56)

    workers = [threading.Thread(target=work, daemon=True) for _ in range(args.concurrency)]
    wall0 = time.perf_counter()
    for w in workers:
        w.start()

    next_sample = 0.0
    while True:
        elapsed = time.perf_counter() - wall0
        if elapsed >= args.seconds:
            break
        if elapsed >= next_sample:
            st = docker_stats(names)
            samples.append({"t": round(elapsed, 2), "stats": st})
            va = st.get("giftwise-cloudnative-lab-validator-a-1", {})
            print(f"{elapsed:>6.1f}  {va.get('cpu_perc','?'):>22} {va.get('mem','?'):>18}")
            next_sample = elapsed + 2.0
        time.sleep(0.1)

    stop.set()
    for w in workers:
        w.join(timeout=10)
    wall = time.perf_counter() - wall0

    total = len(done)
    ok = sum(1 for r in done if r["ok"])
    thr = total / wall
    predicted_cpu_perc = thr * args.cpu_us_per_validate / 1e6 * 100

    print()
    print("=" * 56)
    print(f"实际完成请求      : {total}（成功 {ok}）")
    print(f"墙上时间          : {wall:.3f} s")
    print(f"实测吞吐          : {thr:.2f} req/s")
    print(f"CPU 占用预测值     : {thr:.2f} * {args.cpu_us_per_validate}us = {predicted_cpu_perc:.2f}% 单核")
    print()
    print("各容器最后一次采样：")
    if samples:
        for name, val in sorted(samples[-1]["stats"].items()):
            if name.startswith("_"):
                continue
            print(f"  {name:<45} CPU={val['cpu_perc']:>10}  MEM={val['mem']}")

    report = {"label": args.label, "run_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
              "target": args.target, "concurrency": args.concurrency, "seconds": args.seconds,
              "requests": total, "ok": ok, "wall_s": round(wall, 3), "throughput_rps": round(thr, 2),
              "cpu_us_per_validate_assumed": args.cpu_us_per_validate,
              "predicted_cpu_perc_of_one_core": round(predicted_cpu_perc, 3),
              "samples": samples}
    out = EVIDENCE_DIR / f"cpu-sampling-{args.label}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n# 原始结果已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
