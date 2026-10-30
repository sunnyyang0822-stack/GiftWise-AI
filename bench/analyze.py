#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""汇总并打印性能归档（bench/runs/*.json）。

用法：
  python bench/analyze.py                 # 打印所有 ramp 归档的对比表
  python bench/analyze.py --file X.json   # 只看一个
  python bench/analyze.py --json          # 机器可读输出（供 report 子命令/PPT 取数）
"""
from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "bench" / "runs"


def mib(x):
    return f"{x / 1048576:.1f}" if isinstance(x, int) else "-"


def level_table(d: dict) -> str:
    lines = []
    head = (f"{'c':>4} {'rps':>8} {'p50':>8} {'p95':>9} {'p99':>9} {'p99.9':>9} {'max':>9} "
            f"{'>100ms':>7} {'>1s':>5} {'err':>5} {'thr':>4} {'memMiB':>7}")
    lines.append(head)
    lines.append("-" * len(head))
    for r in d.get("levels", []):
        L = r["latency"]
        t = L.get("tail", {})
        res = r.get("resource", {}) or {}
        lines.append(
            f"{r['concurrency']:>4} {r['throughput_rps']:>8} {L['p50_ms']:>8} {L['p95_ms']:>9} "
            f"{L['p99_ms']:>9} {L.get('p999_ms', '-'):>9} {L['max_ms']:>9} "
            f"{str(t.get('over_100ms_pct', 0)) + '%':>7} {t.get('over_1000ms', 0):>5} "
            f"{r['error_count']:>5} {str(res.get('threads_peak', '-')):>4} {mib(res.get('mem_peak_bytes')):>7}"
        )
    return "\n".join(lines)


def error_report(d: dict) -> str:
    out = []
    for r in d.get("levels", []):
        if r.get("error_samples"):
            out.append(f"  c={r['concurrency']}: {r['error_samples'][:3]}")
    return "\n".join(out) if out else "  （无错误样本）"


def status_report(d: dict) -> str:
    return "\n".join(
        f"  c={r['concurrency']:<4} {r['status_counts']}  ok200={r['ok_200']} http408={r['http_408']}"
        for r in d.get("levels", [])
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    files = [Path(args.file)] if args.file else sorted(RUNS.glob("ramp-*.json"))
    if not files:
        print("没有 ramp 归档。先跑：python bench/bench.py ramp --url ... --container ...")
        return

    bundle = {}
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        bundle[f.name] = d
        if not args.json:
            print(f"\n===== {f.name} =====")
            print(f"  目标 {d.get('url')}  容器 {d.get('container')}  每 worker {d.get('requests_per_worker')} 请求")
            print(level_table(d))
            print("  错误样本：")
            print(error_report(d))
            print("  状态码：")
            print(status_report(d))

    if args.json:
        print(json.dumps(bundle, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
