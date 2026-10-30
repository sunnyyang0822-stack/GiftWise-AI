"""GiftWise 多副本分发 / 无会话保持 实验驱动程序（仅标准库）。

跑法（栈已在 compose 里起来之后）：
    python compose/run-multireplica-experiment.py --lb 127.0.0.1:18080 --count 60

它做三件事，每件都打印**可直接粘贴的原始输出**：
  A. 顺序 60 请求：证明轮询分发 + 证明同一「会话」被拆到两个副本。
  B. 每请求一连接 vs 假设复用连接：证明无 keep-alive 的代价（TCP 握手次数）。
  C. 并发压力下的分发与失败统计。

本脚本只读不写业务代码；结果写到 compose/evidence/ 下。
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lb"))

import payload  # noqa: E402  (compose/lb/payload.py)

EVIDENCE_DIR = HERE / "evidence"


def one_request(lb_host: str, lb_port: int, seq: int, session: str, timeout: float = 30.0) -> dict:
    """通过 LB 发一次 /validate。每请求新建连接（LB 讲 HTTP/1.0，无法复用）。

    计时必须用 time.perf_counter()：本宿主（Windows）的 time.monotonic() 粒度实测为
    15.625 ms（64 Hz），用它测毫秒级请求会把所有延迟量化成 0/15.6/31.2/46.9 ms 的台阶。
    perf_counter 粒度实测 200 ns。见 compose/evidence/clock-granularity.txt。
    """
    body = payload.body(seq)
    started = time.perf_counter()
    conn = http.client.HTTPConnection(lb_host, lb_port, timeout=timeout)
    try:
        headers = {
            "Content-Type": "application/json",
            "X-GiftWise-Seq": str(seq),
            "X-GiftWise-Session": session,
            "Connection": "close",
        }
        conn.request("POST", "/validate", body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:
            parsed = {}
        return {
            "seq": seq,
            "session": session,
            "http_status": resp.status,
            "lb_version": resp.version,
            "protocol": {9: "HTTP/0.9", 10: "HTTP/1.0", 11: "HTTP/1.1"}.get(resp.version, f"?{resp.version}"),
            "upstream": resp.getheader("X-GiftWise-Upstream") or "-",
            "attempt": resp.getheader("X-GiftWise-Attempt") or "-",
            "validate_status": parsed.get("status", "-"),
            "all_passed": parsed.get("all_passed"),
            "ms": elapsed_ms,
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001 - 实验脚本要如实记录任何失败
        return {
            "seq": seq, "session": session, "http_status": None, "lb_version": None,
            "protocol": "-",
            "upstream": "-", "attempt": "-", "validate_status": "-", "all_passed": None,
            "ms": round((time.perf_counter() - started) * 1000, 3),
            "error": f"{type(exc).__name__}: {exc}",
        }
    finally:
        conn.close()


def banner(text: str) -> None:
    print()
    print("=" * 78)
    print(text)
    print("=" * 78)


def phase_a(lb: str, count: int) -> list[dict]:
    host, _, port = lb.rpartition(":")
    port = int(port)
    banner(f"A. 顺序 {count} 请求 · 全部携带同一个会话标识 X-GiftWise-Session: sess-A")
    print("（会话标识是给 LB 看的；本 LB 刻意不解析它，只用它取证「同一会话落到不同副本」）")
    print()
    print(f"{'seq':>4}  {'session':<8} {'HTTP':<4} {'proto':<9} {'validate':<8} {'attempt':<7} {'upstream':<22} {'ms':>9}")
    print("-" * 92)
    results = []
    for seq in range(1, count + 1):
        r = one_request(host, port, seq, "sess-A")
        results.append(r)
        print(f"{r['seq']:>4}  {r['session']:<8} {str(r['http_status']):<4} "
              f"{r['protocol']:<9} {r['validate_status']:<8} {r['attempt']:<7} "
              f"{r['upstream']:<22} {r['ms']:>9.3f}")
    return results


def summarize_a(results: list[dict], expected_upstreams: list[str]) -> dict:
    by_upstream: dict[str, int] = {}
    for r in results:
        by_upstream[r["upstream"]] = by_upstream.get(r["upstream"], 0) + 1
    sessions: dict[str, set[str]] = {}
    for r in results:
        sessions.setdefault(r["session"], set()).add(r["upstream"])
    ok = [r for r in results if r["all_passed"] is True]
    lat = [r["ms"] for r in results]
    errors = [r for r in results if r["error"] or r["http_status"] != 200]

    distinct_upstreams = sorted(k for k in by_upstream if k != "-")
    multi_upstream_sessions = {s: sorted(u) for s, u in sessions.items() if len(u) > 1}

    # 轮询理想分布：每个上游收到 count/len 个，差值 ≤ 1
    counts = [by_upstream.get(u, 0) for u in expected_upstreams]
    balanced = bool(counts) and (max(counts) - min(counts)) <= 1 and sum(counts) == len(results)

    return {
        "requests": len(results),
        "by_upstream": by_upstream,
        "distinct_upstreams": distinct_upstreams,
        "all_validate_passed": len(ok),
        "errors": len(errors),
        "expected_upstreams": expected_upstreams,
        "every_upstream_used": sorted(distinct_upstreams) == sorted(expected_upstreams),
        "round_robin_balanced_within_1": balanced,
        "counts_per_upstream": counts,
        "sessions": {s: sorted(u) for s, u in sessions.items()},
        "sessions_spanning_multiple_upstreams": multi_upstream_sessions,
        "session_affinity_held": not multi_upstream_sessions,
        "latency_ms_min": min(lat) if lat else None,
        "latency_ms_median": round(statistics.median(lat), 3) if lat else None,
        "latency_ms_max": max(lat) if lat else None,
    }


def print_summary_a(s: dict) -> None:
    banner("A 小结（原始计数）")
    print(f"请求总数                : {s['requests']}")
    print(f"实际落到的副本          : {s['distinct_upstreams']}")
    print(f"期望副本                : {s['expected_upstreams']}")
    print(f"每副本请求数            : {s['counts_per_upstream']}")
    print(f"轮询是否均衡(差值<=1)   : {s['round_robin_balanced_within_1']}")
    print(f"每个副本是否都被用到    : {s['every_upstream_used']}")
    print(f"validate 全部 passed    : {s['all_validate_passed']} / {s['requests']}")
    print(f"HTTP 非 200 或异常      : {s['errors']}")
    print(f"延迟 min/median/max ms  : {s['latency_ms_min']} / {s['latency_ms_median']} / {s['latency_ms_max']}")
    print()
    print(f"会话语义：同一 session 是否只落在**一个**副本上？ -> {s['session_affinity_held']}")
    print(f"  同一 session 跨多个副本的证据 : {s['sessions_spanning_multiple_upstreams']}")


def phase_b(lb: str, count: int = 30) -> dict:
    """无 keep-alive 的代价：每个请求都新建 TCP 连接。"""
    host, _, port = lb.rpartition(":")
    port = int(port)
    banner(f"B. 连接开销 · {count} 个请求，每个都单独建 TCP 连接（LB 讲 HTTP/1.0，响应后关闭）")
    print("做法：先测量「connect+close 但不发请求」的纯握手代价，再与完整请求耗时对比。")
    print()
    handshake = []
    for _ in range(count):
        t0 = time.perf_counter()
        s = __import__("socket").create_connection((host, port), timeout=10)
        s.close()
        handshake.append((time.perf_counter() - t0) * 1000)

    print(f"{'i':>3}  {'tcp_handshake_ms':>17}")
    print("-" * 24)
    for i, ms in enumerate(handshake[:10], 1):
        print(f"{i:>3}  {ms:>17.3f}")
    print(f"... （共 {count} 次，下面只汇总）")
    print()
    med_h = statistics.median(handshake)
    print(f"纯 TCP 握手 min/median/max ms : {min(handshake):.3f} / {med_h:.3f} / {max(handshake):.3f}")

    # 再确认：同一个连接上发第二个请求会怎样（证明无法复用）
    print()
    print("复用尝试：在同一 socket 上连发两个 POST /validate（模拟 keep-alive）……")
    body = payload.body(901)
    s = __import__("socket").create_connection((host, port), timeout=30)
    req = (b"POST /validate HTTP/1.1\r\nHost: lb\r\nContent-Type: application/json\r\n"
           + f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
    s.sendall(req)
    time.sleep(1.0)
    first = s.recv(65536)
    reused_ok = None
    reused_detail = ""
    try:
        s.sendall(req)
        s.settimeout(5)
        second = s.recv(65536)
        reused_ok = bool(second)
        reused_detail = f"第二个响应 {len(second)} 字节"
    except Exception as exc:  # noqa: BLE001
        reused_ok = False
        reused_detail = f"{type(exc).__name__}: {exc}"
    finally:
        s.close()

    first_status = first.split(b"\r\n", 1)[0].decode("latin-1") if first else "(空)"
    # 判定「连接是否被关闭」的唯一可靠证据是：在同一个 socket 上再发一次能否拿到响应。
    # 不要去看 `Connection: close` 头——HTTP/1.0 默认就是关闭，
    # 服务端并不需要（本实验里也确实没有）显式发这个头。
    print(f"  第一个响应状态行        : {first_status}")
    print(f"  响应头里是否显式含 close : {b'connection: close' in first.lower()}")
    print(f"  第二个请求是否被处理     : {reused_ok}  ({reused_detail})")
    print("  -> 结论依据取「第二个请求的字节数」，不取 close 头：")
    print("     HTTP/1.0 默认响应后关闭连接，因此复用同一 socket 的第二个请求收不到任何响应。")
    return {
        "handshake_ms_min": min(handshake),
        "handshake_ms_median": round(med_h, 3),
        "handshake_ms_max": max(handshake),
        "first_status_line": first_status,
        "connection_reuse_worked": reused_ok,
        "connection_reuse_detail": reused_detail,
    }


def phase_c(lb: str, total: int = 60, concurrency: int = 12) -> dict:
    """并发下分发是否仍然均衡，失败如何。"""
    host, _, port = lb.rpartition(":")
    port = int(port)
    banner(f"C. 并发压力 · {total} 请求 / {concurrency} 并发（每请求新连接）")
    results: list[dict] = []
    lock = threading.Lock()

    def work(seq: int) -> None:
        r = one_request(host, port, seq, f"sess-{seq % 3}")
        with lock:
            results.append(r)

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(work, range(1000, 1000 + total)))
    wall = time.perf_counter() - t0

    results.sort(key=lambda r: r["seq"])
    by: dict[str, int] = {}
    for r in results:
        by[r["upstream"]] = by.get(r["upstream"], 0) + 1
    lat = sorted(r["ms"] for r in results)
    ok = sum(1 for r in results if r["all_passed"] is True)
    fails = [r for r in results if r["error"] or r["http_status"] != 200]
    failovers = sum(1 for r in results if str(r["attempt"]) != "1")

    print(f"墙上时间            : {wall:.3f} s")
    print(f"吞吐                : {total / wall:.1f} req/s")
    print(f"每副本请求数        : {by}")
    print(f"validate passed     : {ok} / {total}")
    print(f"失败/非200          : {len(fails)}")
    print(f"发生失败转移的请求  : {failovers}")
    print(f"延迟 p50/p95/max ms : {lat[len(lat)//2]:.3f} / {lat[int(len(lat)*0.95)]:.3f} / {lat[-1]:.3f}")
    if fails:
        print("失败明细（最多 5 条）:")
        for r in fails[:5]:
            print(f"  seq={r['seq']} http={r['http_status']} err={r['error']}")
    return {
        "requests": total, "concurrency": concurrency, "wall_s": round(wall, 3),
        "throughput_rps": round(total / wall, 2), "by_upstream": by,
        "validate_passed": ok, "failed_or_non200": len(fails),
        "failovers": failovers,
        "latency_ms_p50": round(lat[len(lat)//2], 3),
        "latency_ms_p95": round(lat[int(len(lat) * 0.95)], 3),
        "latency_ms_max": round(lat[-1], 3),
        "failures": [{"seq": r["seq"], "http": r["http_status"], "error": r["error"]} for r in fails[:5]],
    }


def fetch_lb_stats(lb: str) -> dict:
    host, _, port = lb.rpartition(":")
    conn = http.client.HTTPConnection(host, int(port), timeout=10)
    try:
        conn.request("GET", "/lb-stats")
        resp = conn.getresponse()
        return json.loads(resp.read().decode("utf-8"))
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lb", default="127.0.0.1:18080")
    ap.add_argument("--count", type=int, default=60)
    ap.add_argument("--concurrency", type=int, default=12)
    ap.add_argument("--upstreams", default="validator-a:8000,validator-b:8000")
    ap.add_argument("--label", default="main")
    args = ap.parse_args()

    expected = [u.strip() for u in args.upstreams.split(",") if u.strip()]
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    print(f"# GiftWise 多副本实验 · label={args.label}")
    print(f"# LB={args.lb}  期望副本={expected}")
    print(f"# 运行时刻={time.strftime('%Y-%m-%d %H:%M:%S %z')}")

    try:
        stats_before = fetch_lb_stats(args.lb)
    except Exception as exc:  # noqa: BLE001
        print(f"!! 无法读取 LB 统计（{type(exc).__name__}: {exc}）；确认栈已启动。")
        return 2
    print(f"# LB 启动时报告的拓扑={stats_before.get('upstreams')}")

    a = phase_a(args.lb, args.count)
    sa = summarize_a(a, expected)
    print_summary_a(sa)

    sb = phase_b(args.lb)
    sc = phase_c(args.lb, total=max(60, args.count), concurrency=args.concurrency)

    stats_after = fetch_lb_stats(args.lb)
    banner("D. LB 自报的累计计数（/lb-stats）")
    print(json.dumps(stats_after, ensure_ascii=False, indent=2))

    report = {
        "label": args.label,
        "run_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
        "lb": args.lb,
        "expected_upstreams": expected,
        "lb_stats_before": stats_before,
        "lb_stats_after": stats_after,
        "phase_a": sa,
        "phase_b": sb,
        "phase_c": sc,
        "phase_a_raw": a,
    }
    out = EVIDENCE_DIR / f"multireplica-{args.label}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print()
    print(f"# 原始结果已写入 {out}")

    # 退出码反映实验是否达成两个核心断言，便于 CI 式核对
    core_ok = sa["every_upstream_used"] and sa["round_robin_balanced_within_1"] and sa["all_validate_passed"] == sa["requests"]
    if not core_ok:
        print("!! 核心断言未全部成立，见上。")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
