"""容器内自测量：每请求 CPU 成本（单次 exec，避免 exec 开销污染）。

为什么要在容器内跑、而且只跑**一次** exec：
    实测发现（compose/evidence/exec-overhead.txt）每次 `docker exec` 会给目标容器的
    cgroup 记上约 17~21 ms 的 CPU。用「两次 exec 夹一段 sleep」的方法测空转 CPU，
    测到的几乎全是 exec 自己的开销——sleep 容器的"空转 CPU"就是这么来的假值。
    因此这里把整个测量塞进**一次** exec：
        exec 开销 ≈ 20 ms，而负载段是数秒级，相对误差 < 1%。

怎么把「服务端的 CPU」从 cgroup 总量里分离出来：
    cgroup_delta = 服务端(PID 1) CPU + 本测量进程(客户端线程) CPU + exec 开销
    本测量进程自己的 CPU 用 time.process_time() 直接读出（含其全部线程），
    相减即得服务端 CPU。

跑法（单次 exec，脚本走 stdin）：
    docker exec -i <container> python - < compose/lb/incontainer_cpu_probe.py
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import sys
import threading
import time

TARGET_PORT = int(os.environ.get("PROBE_PORT", "8000"))
REQUESTS = int(os.environ.get("PROBE_REQUESTS", "3000"))
CONCURRENCY = int(os.environ.get("PROBE_CONCURRENCY", "8"))
VALIDATE_US_REFERENCE = float(os.environ.get("PROBE_VALIDATE_US", "170.87"))


def cgroup_usec() -> int:
    for path in ("/sys/fs/cgroup/cpu.stat", "/sys/fs/cgroup/cpuacct/cpuacct.usage"):
        try:
            with open(path, "r", encoding="ascii") as fh:
                text = fh.read()
        except OSError:
            continue
        if path.endswith("cpu.stat"):
            for line in text.splitlines():
                if line.startswith("usage_usec"):
                    return int(line.split()[1])
        else:
            return int(text.strip()) // 1000
    raise RuntimeError("no cgroup cpu accounting available")


def request_body(seq: int) -> bytes:
    """与 compose/lb/payload.py 等价的载荷生成（容器内没有 compose/ 目录，故内联）。"""
    req = {
        "recipient_relation": "恋人", "occasion": "生日", "budget_amount": "500",
        "currency": "CNY", "available_days": 14,
        "facts": [{"id": "f1", "text": "喜欢手冲咖啡"}, {"id": "f2", "text": "酒精过敏"}],
        "forbidden_tags": ["alcohol"], "forbidden_terms": ["香烟"],
        "notes": f"probe-seq-{seq}",
    }
    cands = {"candidates": [{
        "id": f"c{i+1}", "name": f"候选方案{i+1}-序号{seq}",
        "description": f"第 {seq} 次请求的第 {i+1} 个候选方案。",
        "estimated_total": str(200 + (i + 1) * 50), "currency": "CNY",
        "estimated_preparation_days": 3 + (i + 1), "tags": ["food"],
        "reason": "预算与可用天数均满足。", "fact_refs": ["f1"],
        "inferences": [], "unknowns": [],
    } for i in range(3)]}
    return json.dumps({"request_json": json.dumps(req, ensure_ascii=False, separators=(",", ":")),
                       "candidates_json": json.dumps(cands, ensure_ascii=False, separators=(",", ":"))},
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def main() -> int:
    print("# 容器内每请求 CPU 自测量（单次 exec）")
    print(f"# 目标端口={TARGET_PORT} 请求数={REQUESTS} 并发={CONCURRENCY}")
    print(f"# validate() 纯 CPU 参照={VALIDATE_US_REFERENCE} us/次（compose/evidence/cpu-cost-container.txt）")
    try:
        host = socket.gethostname()
    except OSError:
        host = "localhost"

    results: list[int] = []
    lock = threading.Lock()
    ready = threading.Barrier(CONCURRENCY + 1)

    def worker(idx: int) -> None:
        mine = []
        ready.wait()
        for i in range(idx, REQUESTS, CONCURRENCY):
            body = request_body(i + 1)
            c = http.client.HTTPConnection("127.0.0.1", TARGET_PORT, timeout=30)
            try:
                c.request("POST", "/validate", body=body,
                          headers={"Content-Type": "application/json", "Connection": "close"})
                r = c.getresponse()
                r.read()
                mine.append(1 if r.status == 200 else 0)
            except Exception:  # noqa: BLE001
                mine.append(0)
            finally:
                c.close()
        with lock:
            results.extend(mine)

    threads = [threading.Thread(target=worker, args=(i,), daemon=True) for i in range(CONCURRENCY)]

    cpu0 = cgroup_usec()
    proc0 = time.process_time()
    wall0 = time.perf_counter()
    for t in threads:
        t.start()
    ready.wait()  # 所有客户端同时开始，避免启动偏斜
    for t in threads:
        t.join(timeout=120)
    wall = time.perf_counter() - wall0
    proc_cpu = time.process_time() - proc0
    cpu1 = cgroup_usec()

    total = len(results)
    ok = sum(results)
    cgroup_delta = cpu1 - cpu0
    server_cpu_us = cgroup_delta - proc_cpu * 1e6
    per_req = server_cpu_us / total if total else 0

    print()
    print(f"  完成请求              : {total}（HTTP 200: {ok}）")
    print(f"  墙上时间              : {wall:.3f} s")
    print(f"  吞吐                  : {total/wall:.2f} req/s")
    print()
    print(f"  cgroup CPU 增量       : {cgroup_delta} us")
    print(f"  客户端(本进程)CPU     : {proc_cpu*1e6:.0f} us   <- time.process_time()，含全部客户端线程")
    print(f"  服务端 CPU (相减)     : {server_cpu_us:.0f} us  = {server_cpu_us/1e6:.4f} core-seconds")
    print(f"  平均占用核数(服务端)  : {(server_cpu_us/1e6)/wall:.3f} core")
    print(f"  每请求服务端 CPU      : {per_req:.2f} us")
    print()
    print(f"  其中 validate() 纯计算 : {VALIDATE_US_REFERENCE:.2f} us = {VALIDATE_US_REFERENCE/per_req*100:.1f}%")
    print(f"  其余(HTTP/线程/socket) : {per_req-VALIDATE_US_REFERENCE:.2f} us = {100-VALIDATE_US_REFERENCE/per_req*100:.1f}%")
    print()
    print(f"  单核吞吐上限(按实测每请求 CPU) = {1e6/per_req:.1f} req/s/核")
    print(f"  单核吞吐上限(若只有 validate)  = {1e6/VALIDATE_US_REFERENCE:.1f} req/s/核")
    print(f"  => 框架开销把单核上限压低约 {per_req/VALIDATE_US_REFERENCE:.1f} 倍")

    out = {
        "requests": total, "ok": ok, "wall_s": round(wall, 3),
        "throughput_rps": round(total / wall, 2),
        "cgroup_delta_usec": cgroup_delta,
        "client_process_cpu_usec": round(proc_cpu * 1e6, 1),
        "server_cpu_usec": round(server_cpu_us, 1),
        "server_cores_avg": round((server_cpu_us / 1e6) / wall, 4),
        "per_request_server_cpu_us": round(per_req, 2),
        "validate_us_reference": VALIDATE_US_REFERENCE,
        "validate_share_percent": round(VALIDATE_US_REFERENCE / per_req * 100, 2) if per_req else None,
        "single_core_limit_rps": round(1e6 / per_req, 1) if per_req else None,
    }
    print()
    print("PROBE_JSON " + json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
