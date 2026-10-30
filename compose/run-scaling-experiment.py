"""扩容实验：到底该加副本，还是该先解决别的瓶颈？

本脚本回答一个问题：**验证器是 CPU 密集还是 I/O 密集？加副本有用吗？**

它同时测量四种路径，因为只看一种会得出错误结论：
  1. 直连单个副本         -> 单副本的真实上限
  2. 直连两个副本(客户端轮询) -> 加副本的**真实**收益（不受 LB 单进程上限影响）
  3. 通过 LB(2 副本)      -> 加副本在**当前 LB 之下**能兑现多少
  4. 通过 LB(1 副本)      -> 对照组

依赖假设（会实测验证，不空谈）：
  H1「/validate 是纯 CPU」——若成立，直连吞吐应随副本数近线性增长。
  H2「单进程 LB 会先饱和」——若成立，通过 LB 的吞吐不会随副本数增长。

跑法：
    python compose/run-scaling-experiment.py --replicas 127.0.0.1:19001,127.0.0.1:19002
"""

from __future__ import annotations

import argparse
import http.client
import itertools
import json
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lb"))

import payload  # noqa: E402

EVIDENCE_DIR = HERE / "evidence"

_counter = itertools.count(4000)
_counter_lock = threading.Lock()


def next_seq() -> int:
    with _counter_lock:
        return next(_counter)


def post(host: str, port: int, seq: int, timeout: float = 30.0) -> dict:
    body = payload.body(seq)
    t0 = time.perf_counter()
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        conn.request("POST", "/validate", body=body, headers={
            "Content-Type": "application/json", "Connection": "close",
            "X-GiftWise-Seq": str(seq),
        })
        resp = conn.getresponse()
        raw = resp.read()
        ms = (time.perf_counter() - t0) * 1000
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            parsed = {}
        return {"ms": ms, "http": resp.status, "ok": parsed.get("all_passed") is True,
                "upstream": resp.getheader("X-GiftWise-Upstream") or f"{host}:{port}"}
    except Exception as exc:  # noqa: BLE001
        return {"ms": (time.perf_counter() - t0) * 1000, "http": None, "ok": False,
                "upstream": f"{host}:{port}", "error": f"{type(exc).__name__}: {exc}"}
    finally:
        conn.close()


def measure(targets: list[tuple[str, int]], total: int, concurrency: int, label: str) -> dict:
    """对 targets 做客户端轮询，压 total 个请求。返回吞吐与延迟分布。"""
    rr = itertools.count()
    rr_lock = threading.Lock()

    def pick() -> tuple[str, int]:
        with rr_lock:
            return targets[next(rr) % len(targets)]

    results: list[dict] = []
    lock = threading.Lock()

    def work(_i: int) -> None:
        host, port = pick()
        r = post(host, port, next_seq())
        with lock:
            results.append(r)

    wall0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(work, range(total)))
    wall = time.perf_counter() - wall0

    ok = sum(1 for r in results if r["ok"])
    lat = sorted(r["ms"] for r in results)
    by_up: dict[str, int] = {}
    for r in results:
        by_up[r["upstream"]] = by_up.get(r["upstream"], 0) + 1
    row = {
        "label": label,
        "targets": [f"{h}:{p}" for h, p in targets],
        "requests": total,
        "concurrency": concurrency,
        "wall_s": round(wall, 3),
        "throughput_rps": round(total / wall, 2),
        "ok": ok,
        "failed": total - ok,
        "latency_ms_p50": round(lat[len(lat) // 2], 3),
        "latency_ms_p95": round(lat[int(len(lat) * 0.95)], 3),
        "latency_ms_max": round(lat[-1], 3),
        "by_upstream": by_up,
    }
    print(f"  {label:<34} thr={row['throughput_rps']:>8.2f} req/s  "
          f"p50={row['latency_ms_p50']:>8.3f}  p95={row['latency_ms_p95']:>8.3f}  "
          f"max={row['latency_ms_max']:>9.3f}  ok={ok}/{total}  dist={by_up}")
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--replicas", default="127.0.0.1:19001,127.0.0.1:19002",
                    help="直连副本的 host:port 列表")
    ap.add_argument("--lb2", default="127.0.0.1:18080", help="指向 2 副本的 LB")
    ap.add_argument("--lb1", default="127.0.0.1:18082", help="指向 1 副本的 LB")
    ap.add_argument("--requests", type=int, default=400)
    ap.add_argument("--label", default="main")
    args = ap.parse_args()

    def split(spec: str) -> list[tuple[str, int]]:
        out = []
        for item in spec.split(","):
            item = item.strip()
            if item:
                h, _, p = item.rpartition(":")
                out.append((h, int(p)))
        return out

    replicas = split(args.replicas)
    one = replicas[:1]

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    print("# GiftWise 扩容实验")
    print(f"# 时刻={time.strftime('%Y-%m-%d %H:%M:%S %z')}")
    print(f"# 直连副本={replicas}   2副本LB={args.lb2}   1副本LB={args.lb1}")
    print(f"# 每档 {args.requests} 个请求；延迟用 perf_counter(200ns 粒度)")

    rows: list[dict] = []
    for conc in (1, 4, 16, 48):
        print()
        print(f"=== 并发 {conc} ===")
        rows.append(measure(one, args.requests, conc, f"直连 1 副本 / conc={conc}"))
        rows.append(measure(replicas, args.requests, conc, f"直连 2 副本 / conc={conc}"))
        rows.append(measure(split(args.lb1), args.requests, conc, f"经 LB 1 副本 / conc={conc}"))
        rows.append(measure(split(args.lb2), args.requests, conc, f"经 LB 2 副本 / conc={conc}"))

    # ---- 结论：2 副本相对 1 副本的吞吐增益 ----
    print()
    print("=" * 78)
    print("扩容增益（2 副本吞吐 / 1 副本吞吐）")
    print("=" * 78)
    print(f"{'并发':>5}  {'直连 1':>10} {'直连 2':>10} {'增益':>8}   {'LB 1':>10} {'LB 2':>10} {'增益':>8}")
    gains = {}
    for conc in (1, 4, 16, 48):
        d1 = next(r for r in rows if r["label"] == f"直连 1 副本 / conc={conc}")
        d2 = next(r for r in rows if r["label"] == f"直连 2 副本 / conc={conc}")
        l1 = next(r for r in rows if r["label"] == f"经 LB 1 副本 / conc={conc}")
        l2 = next(r for r in rows if r["label"] == f"经 LB 2 副本 / conc={conc}")
        gd = d2["throughput_rps"] / d1["throughput_rps"] if d1["throughput_rps"] else 0
        gl = l2["throughput_rps"] / l1["throughput_rps"] if l1["throughput_rps"] else 0
        gains[conc] = {"direct_gain": round(gd, 3), "lb_gain": round(gl, 3),
                       "direct_1": d1["throughput_rps"], "direct_2": d2["throughput_rps"],
                       "lb_1": l1["throughput_rps"], "lb_2": l2["throughput_rps"]}
        print(f"{conc:>5}  {d1['throughput_rps']:>10.2f} {d2['throughput_rps']:>10.2f} {gd:>7.2f}x   "
              f"{l1['throughput_rps']:>10.2f} {l2['throughput_rps']:>10.2f} {gl:>7.2f}x")
    print()
    print("读法：直连增益≈2 说明副本是 CPU/进程级瓶颈、加副本有效；")
    print("      直连增益≈1 说明瓶颈不在副本（在客户端/网络/宿主机）；")
    print("      LB 增益≈1 而直连增益≈2 说明瓶颈在**单进程 LB**，不是在验证器。")

    report = {"label": args.label, "run_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
              "requests_per_point": args.requests, "rows": rows, "gains": gains}
    out = EVIDENCE_DIR / f"scaling-{args.label}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n# 原始结果已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
