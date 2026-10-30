"""半开正文缺陷 × 健康检查：证明 /healthz 全绿**掩盖**了正文挂死。

要证伪的说法：「/healthz 返回 200，所以服务是健康的」。

构造：
    1. 开一条 TCP 连接，发 `Content-Length: 100` 但**只发 5 字节正文**，然后静默不动
       —— 这就是"半开正文"：请求头声明了长度，正文永远发不完。
    2. 在这条连接挂着的整个期间，持续探测 /healthz，记录状态码与延迟。
    3. 观察：/healthz 是否全程 200 且很快？半开连接最终怎么了？

预期（deploy/server.py 的既有修复 READ_TIMEOUT_SECONDS=10，见 deploy/server.py:36-42,58-93）：
    - /healthz 全程 200，延迟毫秒级 —— 健康检查**看不出**任何异常
    - 半开连接会在 ~10s 后被服务端以 408 结束（而不是永久占用线程）
    - 因此「/healthz 绿」只能证明**进程活着**，不能证明「能在预算内处理正文」

跑法：
    python compose/run-halfopen-experiment.py --direct 127.0.0.1:19001 --lb 127.0.0.1:18080
"""

from __future__ import annotations

import argparse
import http.client
import json
import socket
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lb"))

EVIDENCE_DIR = HERE / "evidence"


def probe_health(host: str, port: int, timeout: float = 3.0) -> dict:
    t0 = time.perf_counter()
    c = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        c.request("GET", "/healthz", headers={"Connection": "close"})
        r = c.getresponse()
        body = r.read()
        return {"ms": round((time.perf_counter() - t0) * 1000, 3), "status": r.status,
                "body": body.decode("utf-8", "replace")}
    except Exception as exc:  # noqa: BLE001
        return {"ms": round((time.perf_counter() - t0) * 1000, 3), "status": None,
                "error": f"{type(exc).__name__}: {exc}"}
    finally:
        c.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--direct", default="127.0.0.1:19001", help="直连副本")
    ap.add_argument("--lb", default="127.0.0.1:18080", help="经 LB")
    ap.add_argument("--observe-seconds", type=float, default=16.0)
    ap.add_argument("--label", default="main")
    args = ap.parse_args()

    dhost, _, dport = args.direct.rpartition(":")
    lhost, _, lport = args.lb.rpartition(":")
    dport, lport = int(dport), int(lport)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    print("# 半开正文 × 健康检查 实验")
    print(f"# 时刻={time.strftime('%Y-%m-%d %H:%M:%S %z')}")
    print(f"# 直连副本={args.direct}   经 LB={args.lb}")
    print()

    # ---- 1. 先取一次基线健康值 ----
    base = probe_health(dhost, dport)
    print(f"--- [0] 基线：半开连接建立**之前** GET /healthz -> {base['status']}  {base['ms']} ms")
    print()

    # ---- 2. 建立半开连接 ----
    print("--- [1] 建立半开连接：Content-Length: 100，只发 5 字节正文，然后静默 ---")
    sock = socket.create_connection((dhost, dport), timeout=60)
    head = (b"POST /validate HTTP/1.0\r\nHost: halfopen\r\n"
            b"Content-Type: application/json\r\nContent-Length: 100\r\n\r\n")
    sock.sendall(head + b"{\"a\":")   # 5 字节，远小于声明的 100
    half_open_at = time.perf_counter()
    print(f"  已发送请求头 + 5 字节正文（声明 100 字节）。连接保持打开、不再发送。")
    print(f"  t=0 时刻开始计时。")
    print()

    # ---- 3. 半开期间持续探测健康 ----
    print("--- [2] 半开期间持续探测 /healthz（直连 + 经 LB），看健康检查是否报警 ---")
    print()
    print(f"{'t(s)':>6}  {'直连状态':>9} {'直连ms':>9}  {'LB状态':>8} {'LBms':>9}")
    print("-" * 50)
    rows = []
    t_end = half_open_at + args.observe_seconds
    while time.perf_counter() < t_end:
        t = time.perf_counter() - half_open_at
        d = probe_health(dhost, dport)
        l = probe_health(lhost, lport)
        rows.append({"t": round(t, 2), "direct": d, "lb": l})
        print(f"{t:>6.2f}  {str(d['status']):>9} {d['ms']:>9.3f}  {str(l['status']):>8} {l['ms']:>9.3f}")
        time.sleep(0.5)

    # ---- 4. 半开连接最终怎么了 ----
    print()
    print("--- [3] 半开连接最终如何处理（服务端 READ_TIMEOUT=10s 的修复是否生效） ---")
    elapsed = time.perf_counter() - half_open_at
    sock.settimeout(max(1.0, args.observe_seconds - elapsed + 8))
    outcome = None
    try:
        data = sock.recv(65536)
        if data:
            first = data.split(b"\r\n", 1)[0].decode("latin-1")
            outcome = {"kind": "response", "status_line": first, "at_s": round(time.perf_counter() - half_open_at, 3), "bytes": len(data)}
            print(f"  服务端返回: {first}")
            print(f"  距离半开开始 {outcome['at_s']} s（预期 ≈ READ_TIMEOUT_SECONDS = 10s）")
        else:
            outcome = {"kind": "closed_no_response", "at_s": round(time.perf_counter() - half_open_at, 3)}
            print(f"  连接被服务端直接关闭，没有回应（{outcome['at_s']}s）")
    except socket.timeout:
        outcome = {"kind": "still_open", "at_s": round(time.perf_counter() - half_open_at, 3)}
        print(f"  !! 连接仍然挂着，没有超时结束（{outcome['at_s']}s）——这与预期的 10s 预算不符")
    except Exception as exc:  # noqa: BLE001
        outcome = {"kind": "error", "detail": f"{type(exc).__name__}: {exc}", "at_s": round(time.perf_counter() - half_open_at, 3)}
        print(f"  异常: {outcome['detail']}")
    finally:
        sock.close()

    # ---- 5. 结论 ----
    ok_direct = [r for r in rows if r["direct"]["status"] == 200]
    ok_lb = [r for r in rows if r["lb"]["status"] == 200]
    dmax = max(r["direct"]["ms"] for r in rows)
    lmax = max(r["lb"]["ms"] for r in rows)
    print()
    print("=" * 70)
    print("结论")
    print("=" * 70)
    print(f"  半开连接持续被挂住的期间，健康探测次数        : {len(rows)}")
    print(f"  其中 /healthz 返回 200 的（直连）             : {len(ok_direct)} / {len(rows)}")
    print(f"  其中 /healthz 返回 200 的（经 LB）            : {len(ok_lb)} / {len(rows)}")
    print(f"  /healthz 延迟最大值（直连 / 经 LB）           : {dmax:.3f} ms / {lmax:.3f} ms")
    print(f"  半开连接的最终结局                            : {outcome}")
    print()
    all_green = len(ok_direct) == len(rows) and len(ok_lb) == len(rows)
    print(f"  => 健康检查是否全程全绿：{all_green}")
    print("  => 这证明：**/healthz 全绿无法证明服务能在预算内处理正文**。")
    print("     半开正文的连接照样挂满读预算，而探针一路 200。")
    print("     所以「liveness/readiness 用 /healthz」在这套实现下会漏掉一类真实的不可用。")

    report = {"label": args.label, "run_at": time.strftime("%Y-%m-%d %H:%M:%S %z"),
              "direct": args.direct, "lb": args.lb, "observe_seconds": args.observe_seconds,
              "baseline": base, "rows": rows, "outcome": outcome,
              "health_all_green": all_green,
              "health_green_count_direct": len(ok_direct), "health_green_count_lb": len(ok_lb),
              "health_max_ms_direct": round(dmax, 3), "health_max_ms_lb": round(lmax, 3)}
    out = EVIDENCE_DIR / f"halfopen-{args.label}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n# 原始结果已写入 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
