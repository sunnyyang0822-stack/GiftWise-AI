"""CLOUD-001 启动耗时独立测量（带超时，避免无超时 curl 的无限阻塞假象）。

口径说明：Docker Desktop 在容器端口尚未转发时，对 127.0.0.1:port 的 SYN 可能被静默丢弃，
不带超时的 curl 会一直阻塞，从而把"就绪耗时"测成几十秒。本脚本对每次探测都设短超时。

同时给出两条独立口径：
  A. 主机侧：`docker run -d` 返回到首次 HTTP 200
  B. 容器侧：容器 StartedAt 到服务自身打印监听日志的行（docker logs 时间戳）

用法：
    python tests/acceptance/cloud-001/startup_probe.py <image> <out_json> [rounds]
"""

import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOCKER = "docker"


def run(args, timeout=180):
    return subprocess.run([DOCKER] + args, capture_output=True, text=True, timeout=timeout)


def probe_once(image, name, host_port, rounds_note):
    run(["rm", "-f", name])
    t0 = time.monotonic()
    started = run(["run", "-d", "--name", name, "-p", f"127.0.0.1:{host_port}:8000", image])
    if started.returncode != 0:
        return {"error": started.stderr.strip()[:400]}
    run_time = round(time.monotonic() - t0, 3)

    first_200 = None
    attempts = 0
    connect_failures = 0
    while time.monotonic() - t0 < 90:
        attempts += 1
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{host_port}/healthz", timeout=1) as resp:
                if resp.status == 200:
                    first_200 = round(time.monotonic() - t0, 3)
                    break
        except Exception:
            connect_failures += 1
            time.sleep(0.1)
    info = run(["inspect", name, "--format", "{{.State.StartedAt}}"]).stdout.strip()
    logs = run(["logs", name]).stdout.strip()
    return {"note": rounds_note, "docker_run_seconds": run_time, "first_http_200_seconds": first_200,
            "probe_attempts": attempts, "failed_probe_attempts": connect_failures,
            "container_started_at": info, "server_log": logs[:200]}


def main():
    image = sys.argv[1] if len(sys.argv) > 1 else "giftwise-validator:latest"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs/test-reports/cloud-001/evidence/startup-probe.json"
    rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    results = []
    for i in range(rounds):
        results.append(probe_once(image, "gw-start", 18001, f"round {i + 1}"))
        time.sleep(1)
    vals = [r["first_http_200_seconds"] for r in results if r.get("first_http_200_seconds")]
    doc = {
        "suite": "CLOUD-001 启动耗时独立测量",
        "image": image,
        "method": "docker run -d 到首次 HTTP 200；每次探测 1s 超时，避免无超时 curl 的静默阻塞",
        "rounds": results,
        "summary": {"rounds": len(results), "samples": vals,
                    "min": min(vals) if vals else None, "max": max(vals) if vals else None,
                    "median": sorted(vals)[len(vals) // 2] if vals else None},
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(doc["summary"], ensure_ascii=False, indent=2))
    for r in results:
        print(f"  {r.get('note')}: docker_run={r.get('docker_run_seconds')}s "
              f"first_200={r.get('first_http_200_seconds')}s attempts={r.get('probe_attempts')}")
    print("evidence:", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
