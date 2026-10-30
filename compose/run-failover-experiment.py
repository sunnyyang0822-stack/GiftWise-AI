"""失败转移实验：真的把一个副本停掉，看 LB 如何表现。

诚实目标（不粉饰）：
  1. 停掉一个副本后，请求是否仍然成功？-> 应该成功（另一个副本顶上）。
  2. 成功是"免费的"吗？-> 不是。健康探测发现之前，落到死副本的请求必须先失败一次
     再转投，客户端要多等一个"连接被拒"的时间。这个代价要如实测量。
  3. 健康探测发现之后，是否还会打到死副本？-> 不应该（健康优先排序）。

跑法：
    python compose/run-failover-experiment.py --lb 127.0.0.1:18080 --dead validator-b:8000
前置：docker compose stop validator-b 由本脚本自己调用（通过 docker CLI）。
"""

from __future__ import annotations

import argparse
import http.client
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "lb"))

# 文件名带连字符，不能直接 import；用 importlib 按路径加载，复用它里面的 one_request/fetch_lb_stats。
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("mre", str(HERE / "run-multireplica-experiment.py"))
_mre = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mre)
one_request = _mre.one_request
fetch_lb_stats = _mre.fetch_lb_stats

EVIDENCE_DIR = HERE / "evidence"
DOCKER = "docker"


def stats(lb: str) -> dict:
    try:
        return fetch_lb_stats(lb)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"}


def send_batch(lb: str, seqs: range, session: str) -> list[dict]:
    host, _, port = lb.rpartition(":")
    port = int(port)
    out = []
    for seq in seqs:
        out.append(one_request(host, port, seq, session))
    return out


def show(title: str, rows: list[dict]) -> None:
    print()
    print(title)
    print(f"{'seq':>5}  {'HTTP':<5} {'attempt':<8} {'upstream':<22} {'ms':>10}  error")
    print("-" * 78)
    for r in rows:
        print(f"{r['seq']:>5}  {str(r['http_status']):<5} {str(r['attempt']):<8} "
              f"{r['upstream']:<22} {r['ms']:>10.3f}  {r['error'] or ''}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lb", default="127.0.0.1:18080")
    ap.add_argument("--container", default="giftwise-cloudnative-lab-validator-b-1")
    ap.add_argument("--dead", default="validator-b:8000")
    ap.add_argument("--batch", type=int, default=12)
    ap.add_argument("--label", default="failover")
    args = ap.parse_args()

    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    report: dict = {"label": args.label, "run_at": time.strftime("%Y-%m-%d %H:%M:%S %z"), "lb": args.lb,
                    "killed_container": args.container, "dead_upstream": args.dead}

    print("=" * 78)
    print("失败转移实验")
    print("=" * 78)
    print(f"LB={args.lb}  即将停掉的副本={args.dead}  容器={args.container}")

    print("\n--- [0] 停之前：LB 自报状态 ---")
    before = stats(args.lb)
    print(json.dumps(before, ensure_ascii=False, indent=2))
    report["stats_before"] = before

    # ---------------- 独立的探测延迟测量线程 ----------------
    # 上一版把「等健康探测发现」放在批次之后测量，结果被批次自身的 1.3s 停顿污染，
    # 量出 0.0s 这种无意义的值。这里改成：停掉副本后**立刻**起一个独立线程，
    # 每 0.1s 轮询一次 /lb-stats，记录 health 从 True 翻成 False 的墙钟时刻。
    # 该线程与请求批次并行运行，因此测量的是**探测本身的延迟**，与批次耗时无关。
    detection: dict = {"detected": False, "seconds": None, "poll_count": 0, "t0": None}
    poll_stop = threading.Event()

    def poll_health() -> None:
        t0 = time.perf_counter()
        detection["t0"] = t0
        while not poll_stop.is_set() and (time.perf_counter() - t0) < 60:
            detection["poll_count"] += 1
            try:
                s = fetch_lb_stats(args.lb)
                if (s.get("health") or {}).get(args.dead) is False:
                    detection["detected"] = True
                    detection["seconds"] = round(time.perf_counter() - t0, 3)
                    return
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.1)

    # ---------------- 停掉副本 ----------------
    print(f"\n--- [1] 执行: docker stop {args.container} ---")
    poller = threading.Thread(target=poll_health, name="health-poll", daemon=True)
    poller.start()
    proc = subprocess.run([DOCKER, "stop", args.container], capture_output=True, text=True, timeout=120)
    print(f"exit={proc.returncode}")
    print(f"stdout={proc.stdout.strip()}")
    print(f"stderr={proc.stderr.strip()}")
    report["docker_stop"] = {"exit": proc.returncode, "stdout": proc.stdout.strip(), "stderr": proc.stderr.strip()}
    if proc.returncode != 0:
        poll_stop.set()
        print("!! 停容器失败，实验无法继续。")
        return 2

    # ---------------- 立即打一批：探测可能还没发现 ----------------
    print(f"\n--- [2] 停掉后**立刻**发 {args.batch} 个请求（与探测线程并行） ---")
    t_immediate = time.strftime("%H:%M:%S")
    imm = send_batch(args.lb, range(2001, 2001 + args.batch), "sess-imm")
    show("立即批次原始输出：", imm)
    imm_failover = [r for r in imm if str(r["attempt"]) != "1"]
    imm_failed = [r for r in imm if r["http_status"] != 200]
    print(f"\n  触发失败转移(attempt>1)的请求数  : {len(imm_failover)} / {len(imm)}")
    print("    （attempt>1 意味着第一次投递打到了已停的副本并失败，才转到幸存副本）")
    print(f"  最终仍然失败的请求数             : {len(imm_failed)} / {len(imm)}")
    print(f"  这些转移请求的额外耗时 (ms)      : {[r['ms'] for r in imm_failover]}")
    report["immediate"] = {"at": t_immediate, "rows": imm, "failover_count": len(imm_failover),
                           "failed_count": len(imm_failed),
                           "failover_ms": [r["ms"] for r in imm_failover]}

    # ---------------- 等探测线程给出结果 ----------------
    print("\n--- [3] 等待独立的探测延迟线程给出结果 ---")
    deadline = time.perf_counter() + 60
    while not detection["detected"] and time.perf_counter() < deadline:
        time.sleep(0.2)
    poll_stop.set()
    if detection["detected"]:
        print(f"  -> 健康探测发现副本不可用用了 {detection['seconds']} s（轮询 {detection['poll_count']} 次，间隔 0.1s）")
        print(f"     这是【探测本身】的延迟，与批次耗时无关（上一版量出 0.0s 是被批次本身的 1.3s 停顿污染的假值）。")
    else:
        print("  !! 60s 内探测未发现副本不可用（异常，需排查）")
    report["detection"] = detection
    report["stats_after_detection"] = stats(args.lb)

    # ---------------- 再打一批：探测已发现 ----------------
    print(f"\n--- [4] 探测发现后再发 {args.batch} 个请求 ---")
    post = send_batch(args.lb, range(3001, 3001 + args.batch), "sess-post")
    show("发现后批次原始输出：", post)
    post_failover = [r for r in post if str(r["attempt"]) != "1"]
    post_failed = [r for r in post if r["http_status"] != 200]
    print(f"\n  发生失败转移(attempt>1)的请求数 : {len(post_failover)} / {len(post)}")
    print(f"  最终仍然失败的请求数           : {len(post_failed)} / {len(post)}")
    report["after_detection"] = {"rows": post, "failover_count": len(post_failover), "failed_count": len(post_failed)}

    print("\n--- [5] 最终 LB 计数 ---")
    final = stats(args.lb)
    print(json.dumps(final, ensure_ascii=False, indent=2))
    report["stats_final"] = final

    print("\n--- [6] 恢复副本: docker start " + args.container + " ---")
    proc2 = subprocess.run([DOCKER, "start", args.container], capture_output=True, text=True, timeout=120)
    print(f"exit={proc2.returncode} stdout={proc2.stdout.strip()} stderr={proc2.stderr.strip()}")
    report["docker_start"] = {"exit": proc2.returncode, "stdout": proc2.stdout.strip()}
    # 等它重新变健康
    for _ in range(30):
        s = stats(args.lb)
        if (s.get("health") or {}).get(args.dead) is True:
            print(f"  -> 副本 {args.dead} 已重新被探测为健康")
            break
        time.sleep(1.0)
    report["stats_after_recovery"] = stats(args.lb)
    print(json.dumps(report["stats_after_recovery"], ensure_ascii=False, indent=2))

    out = EVIDENCE_DIR / f"failover-{args.label}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n# 原始结果已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
