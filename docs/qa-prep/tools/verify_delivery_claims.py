# -*- coding: utf-8 -*-
"""答辩现场可用的交付镜像自证脚本（零第三方依赖）。

验证四条会在问答里被追问的声明：
  1. /healthz 的 rules_source_sha256 与本机 validator/rules.py 一致
  2. 半开正文（Content-Length: 100 只发 5 字节）→ 约 10 秒返回 408 且服务端关闭连接
  3. 并发 40 请求后，默认入口日志**不出现粘连行**
  4. /metrics 默认不暴露（404），且容器以非 root 运行

用法（Windows，Git-Bash 或 cmd 均可）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/qa-prep/tools/verify_delivery_claims.py
可选：--img <镜像>  --port <宿主端口>
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import http.client
import json
import os
import re
import socket
import subprocess
import sys
import time

DOCKER_CANDIDATES = [
    r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    r"C:\Program Files\Docker\Docker\resources\bin\docker",
]
NAME = "qa-prep-probe"


def find_docker() -> str | None:
    for c in DOCKER_CANDIDATES:
        if os.path.exists(c):
            return c
    from shutil import which

    return which("docker")


def sh(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")


def local_rules_hash() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, "..", "..", ".."))
    p = os.path.join(repo, "validator", "rules.py")
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def check_healthz(port: int) -> tuple[int, dict | str]:
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=6)
        c.request("GET", "/healthz")
        r = c.getresponse()
        body = r.read().decode("utf-8", "replace")
        c.close()
        try:
            return r.status, json.loads(body)
        except Exception:
            return r.status, body
    except Exception as e:  # pragma: no cover
        return 0, f"{type(e).__name__}: {e}"


def half_open(port: int, host: str = "127.0.0.1") -> dict:
    """发 Content-Length: 100，实际只发 5 字节。等响应或等服务端关闭。"""
    s = socket.create_connection((host, port), timeout=30)
    # 关键：必须保持连接**不发 FIN**，否则服务端看到 EOF 会立刻关闭，
    # 那模拟的是"客户端提前结束"，不是慢速攻击（半开正文）。
    s.settimeout(25)
    head = (
        b"POST /validate HTTP/1.1\r\n"
        b"Host: " + host.encode() + b"\r\n"
        b"Content-Type: application/json\r\n"
        b"Content-Length: 100\r\n"
        b"\r\n"
    )
    t0 = time.monotonic()
    try:
        s.sendall(head + b"{\"a\":")
    except OSError:
        pass
    buf = b""
    closed_by_server = False
    try:
        while True:
            chunk = s.recv(4096)
            if not chunk:
                closed_by_server = True
                break
            buf += chunk
            if b"\r\n\r\n" in buf:
                # 头部已到；HTTP/1.0 会在响应后关闭连接，继续读到 EOF 以确认关闭。
                s.settimeout(2.0)
                try:
                    while True:
                        more = s.recv(4096)
                        if not more:
                            closed_by_server = True
                            break
                        buf += more
                except socket.timeout:
                    pass
                break
    except socket.timeout:
        pass
    dt = time.monotonic() - t0
    try:
        s.close()
    except OSError:
        pass
    # 注意：本服务端回的是 **HTTP/1.0**（BaseHTTPRequestHandler 默认），
    # 所以正则必须同时接受 1.0 与 1.1，否则会误判为"无响应"。
    m = re.search(rb"HTTP/1\.[01] (\d{3})", buf)
    server_hdr = re.search(rb"Server: ([^\r\n]+)", buf)
    return {
        "seconds": round(dt, 2),
        "status": int(m.group(1)) if m else None,
        "http_version": (buf.split(b" ")[0].decode("ascii", "replace") if buf else ""),
        "server_header": (server_hdr.group(1).decode("utf-8", "replace") if server_hdr else ""),
        "server_closed": closed_by_server,
        "raw_head": buf.split(b"\r\n\r\n")[0].decode("utf-8", "replace")[:200],
    }


def _one_request(port: int) -> int:
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=8)
        c.request("POST", "/validate", body=b"{}", headers={"Content-Type": "application/json"})
        r = c.getresponse()
        r.read()
        code = r.status
        c.close()
        return code
    except Exception:
        return 0


def concurrency_and_logs(port: int, docker: str, n: int = 40) -> dict:
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as ex:
        codes = list(ex.map(lambda _: _one_request(port), range(n)))
    time.sleep(0.5)
    logs = sh(docker, "logs", NAME).stdout + sh(docker, "logs", NAME).stderr
    lines = [ln for ln in logs.splitlines() if ln.strip()]
    # 粘连判定：一行里出现两次 HTTP 状态摘要（形如 `" 400 `）
    glued = [ln for ln in lines if len(re.findall(r'"\s\d{3}\s', ln)) >= 2]
    return {
        "requests": n,
        "codes": {str(c): codes.count(c) for c in sorted(set(codes))},
        "log_lines": len(lines),
        "glued_lines": len(glued),
        "glued_sample": (glued[0][:160] if glued else ""),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--img", default="giftwise-validator:submission-20261101")
    ap.add_argument("--port", type=int, default=18472)
    ap.add_argument("--skip-concurrency", action="store_true")
    a = ap.parse_args()

    docker = find_docker()
    if not docker:
        print("❌ 找不到 docker 可执行文件；请把 Docker 加入 PATH 或用 --docker 指定")
        return 2

    print(f"镜像: {a.img}")
    print(f"本机规则哈希: {local_rules_hash()}")
    sh(docker, "rm", "-f", NAME)
    r = sh(docker, "run", "-d", "--name", NAME, "-p", f"{a.port}:8000", a.img)
    if r.returncode != 0:
        print("❌ 起容器失败：", (r.stderr or r.stdout).strip()[:300])
        return 2

    results: dict = {}
    try:
        time.sleep(2.5)
        code, body = check_healthz(a.port)
        declared = body.get("rules_source_sha256") if isinstance(body, dict) else None
        ok1 = declared == local_rules_hash()
        results["1_healthz_hash"] = {"http": code, "declared": declared, "match": ok1}
        print(f"\n[1] /healthz   HTTP {code}  rules_source_sha256={declared}  一致={ok1}")

        h = half_open(a.port)
        ok2 = h["status"] == 408 and h["server_closed"] and h["seconds"] <= 15
        results["2_half_open"] = {**h, "pass": ok2}
        print(f"[2] 半开正文   {h['seconds']}s  状态={h['status']}  服务端关闭={h['server_closed']}  通过={ok2}")

        who = sh(docker, "exec", NAME, "id", "-u").stdout.strip()
        mc = http.client.HTTPConnection("127.0.0.1", a.port, timeout=6)
        mc.request("GET", "/metrics")
        mr = mc.getresponse()
        mr.read()
        mc.close()
        ok4 = (mr.status == 404) and (who not in ("0", ""))
        results["4_metrics_and_user"] = {
            "metrics_http": mr.status,
            "uid": who,
            "non_root": who not in ("0", ""),
            "pass": ok4,
        }
        print(f"[4] /metrics HTTP {mr.status}（期望 404）  容器 uid={who}  非 root={who not in ('0','')}  通过={ok4}")

        if not a.skip_concurrency:
            cl = concurrency_and_logs(a.port, docker)
            ok3 = cl["glued_lines"] == 0
            results["3_concurrent_logs"] = {**cl, "pass": ok3}
            print(f"[3] 并发 {cl['requests']} 请求  响应码={cl['codes']}  日志 {cl['log_lines']} 行  "
                  f"粘连 {cl['glued_lines']} 行  通过={ok3}")
            if not ok3:
                print(f"    粘连样例: {cl['glued_sample']}")
    finally:
        sh(docker, "rm", "-f", NAME)

    print("\n=== 结论 ===")
    checks = {k: v.get("match", v.get("pass")) for k, v in results.items()}
    for k, v in checks.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
