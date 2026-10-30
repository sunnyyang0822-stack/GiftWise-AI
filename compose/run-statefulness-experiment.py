"""有状态 vs 无状态：默认入口与可观测入口的对照实验。

要回答的问题（第 1 号文档的核心结论之一）：
    「当前是否真有进程内状态？」
    答案不是简单的"有"或"没有"，而是**分入口**：
      - 默认入口 `deploy.server`      ：没有进程内可变状态（纯函数校验）
      - 非默认入口 `deploy.observable_server`：**有**（Metrics 计数器）
    本脚本用可测的数字把这件事钉死。

方法：
    1. 分别抓取两个可观测副本各自的 /metrics，读出
       `giftwise_http_requests_total{method="POST",route="/validate",status="200"}` 的**前值**。
    2. 通过 LB 打 N 个请求（轮询会平分给两个副本）。
    3. 再抓一次，读出**后值**；每个副本的增量就是「它自己以为处理了多少」。
    4. 两个副本的增量之和 == N，但**没有任何一个副本**知道 N。

跑法：
    python compose/run-statefulness-experiment.py --lb 127.0.0.1:18081 \
        --replica-metrics 127.0.0.1:19101,127.0.0.1:19102 --requests 40
"""

from __future__ import annotations

import argparse
import http.client
import importlib.util
import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lb"))

import payload  # noqa: E402

EVIDENCE_DIR = HERE / "evidence"
COUNTER_RE = re.compile(
    r'^giftwise_http_requests_total\{method="(?P<method>[^"]*)",route="(?P<route>[^"]*)",status="(?P<status>[^"]*)"\}\s+(?P<value>\d+)$',
    re.MULTILINE)


def scrape(host: str, port: int, auth: str | None = None) -> dict:
    c = http.client.HTTPConnection(host, port, timeout=15)
    try:
        headers = {"Connection": "close"}
        if auth:
            headers["Authorization"] = auth
        c.request("GET", "/metrics", headers=headers)
        r = c.getresponse()
        text = r.read().decode("utf-8", "replace")
        counters = {}
        for m in COUNTER_RE.finditer(text):
            counters[(m.group("method"), m.group("route"), m.group("status"))] = int(m.group("value"))
        return {"status": r.status, "bytes": len(text), "counters": counters, "text_head": text[:400]}
    finally:
        c.close()


def validate_count(host: str, port: int, auth: str | None = None) -> int:
    s = scrape(host, port, auth)
    return s["counters"].get(("POST", "/validate", "200"), 0), s["status"]


def post(lb_host: str, lb_port: int, seq: int) -> dict:
    body = payload.body(seq)
    c = http.client.HTTPConnection(lb_host, lb_port, timeout=30)
    try:
        c.request("POST", "/validate", body=body, headers={
            "Content-Type": "application/json", "Connection": "close",
            "X-GiftWise-Seq": str(seq), "X-GiftWise-Session": "sess-state"})
        r = c.getresponse()
        r.read()
        return {"seq": seq, "http": r.status, "upstream": r.getheader("X-GiftWise-Upstream") or "-"}
    except Exception as exc:  # noqa: BLE001
        return {"seq": seq, "http": None, "upstream": "-", "error": f"{type(exc).__name__}: {exc}"}
    finally:
        c.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lb", default="127.0.0.1:18081")
    ap.add_argument("--replica-metrics", default="127.0.0.1:19101,127.0.0.1:19102")
    ap.add_argument("--requests", type=int, default=40)
    ap.add_argument("--label", default="main")
    args = ap.parse_args()

    lh, _, lp = args.lb.rpartition(":")
    lp = int(lp)
    replicas = []
    for item in args.replica_metrics.split(","):
        item = item.strip()
        if item:
            h, _, p = item.rpartition(":")
            replicas.append((h, int(p)))

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    print("# 有状态 vs 无状态 · 对照实验")
    print(f"# 时刻={time.strftime('%Y-%m-%d %H:%M:%S %z')}")
    print(f"# LB(可观测入口, 2 副本)={args.lb}")
    print(f"# 各副本 /metrics 地址={[f'{h}:{p}' for h, p in replicas]}")
    print(f"# 请求数={args.requests}")
    print()

    # ---- 0. 鉴权现状 ----
    print("--- [0] /metrics 鉴权现状（可观测入口） ---")
    anon_status = scrape(*replicas[0])["status"]
    forged = scrape(*replicas[0], auth="Basic Zm9vOmJhcg==")["status"]
    print(f"  匿名 GET /metrics            -> HTTP {anon_status}")
    print(f"  伪造 Authorization: Basic    -> HTTP {forged}")
    print(f"  => 未鉴权：{'是' if anon_status == 200 and forged == 200 else '否'}")
    print()

    # ---- 1. 前值 ----
    print("--- [1] 抓取各副本 /metrics 的 /validate 计数（前值） ---")
    before = {}
    for h, p in replicas:
        cnt, st = validate_count(h, p)
        before[f"{h}:{p}"] = cnt
        print(f"  {h}:{p}  HTTP {st}  POST /validate status=200 计数 = {cnt}")
    print()

    # ---- 2. 打请求 ----
    print(f"--- [2] 经 LB 打 {args.requests} 个请求（轮询平分给两个副本） ---")
    rows = []
    for i in range(1, args.requests + 1):
        rows.append(post(lh, lp, 10000 + i))
    dist: dict[str, int] = {}
    for r in rows:
        dist[r["upstream"]] = dist.get(r["upstream"], 0) + 1
    ok = sum(1 for r in rows if r["http"] == 200)
    print(f"  成功 {ok}/{args.requests}")
    print(f"  分发到：{dist}")
    print(f"  样例前 5 条与后 5 条：")
    for r in rows[:5] + rows[-5:]:
        print(f"    seq={r['seq']} HTTP={r['http']} upstream={r['upstream']}")
    print()

    # ---- 3. 后值 ----
    print("--- [3] 再抓一次（后值），看每个副本「自己以为」处理了多少 ---")
    after = {}
    total_delta = 0
    for h, p in replicas:
        cnt, st = validate_count(h, p)
        after[f"{h}:{p}"] = cnt
        d = cnt - before[f"{h}:{p}"]
        total_delta += d
        print(f"  {h}:{p}  计数 {before[f'{h}:{p}']} -> {cnt}   增量 = {d}")
    print()
    print(f"  两个副本增量之和 = {total_delta}")
    print(f"  实际发出的请求数 = {args.requests}")
    print(f"  某个副本单独能看到的最大值 = {max(after[f'{h}:{p}'] - before[f'{h}:{p}'] for h, p in replicas)}")
    print()
    print("  结论：")
    print(f"    - 计数器之和({'=' if total_delta == args.requests else '!='} {total_delta}) 能对上总请求数，")
    print(f"    - 但**没有任何一个副本**知道总数：单看一个副本的 /metrics 会少报约一半。")
    print(f"    - 这就是「进程内状态」在多副本下的直接后果：状态被按副本切片。")

    report = {
        "label": args.label, "run_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "lb": args.lb, "replicas": [f"{h}:{p}" for h, p in replicas], "requests": args.requests,
        "metrics_auth": {"anonymous": anon_status, "forged_basic": forged},
        "before": before, "after": after, "distribution": dist, "ok": ok,
        "counter_delta_sum": total_delta,
        "max_single_replica_delta": max(after[f"{h}:{p}"] - before[f"{h}:{p}"] for h, p in replicas),
    }
    out = EVIDENCE_DIR / f"statefulness-{args.label}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n# 原始结果已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
