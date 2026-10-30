#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""独立复验交付镜像里的 I-2 修复（讲稿与计时线自用，只读探针，不改任何文件）。

为什么要自己跑：S10 的口播稿是**基于"该修复已在交付镜像内生效"这条事实**改写的，
所以这条事实不能只引部署线的记录，必须自己复现一次。
探针只做三件事，全部是外部可观测行为：
  1) 半开正文（声明 Content-Length: 200，只发 100 字节）→ 期望约 10 秒收到 408 且连接被服务端关闭；
  2) 半开期间并发请求 /healthz → 期望仍 200 且极快（这正是"健康检查会掩盖缺陷"的证据）；
  3) 对照：/healthz 的 rules_source_sha256 应等于本机 validator/rules.py 的 sha256。

用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/verify_i2_in_image.py
"""
from __future__ import annotations

import hashlib
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOCKER = r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"
IMAGE = "giftwise-validator:submission-20261101"
PORT = 18099          # 与部署线测试端口错开，避免互相干扰


def dk(*args: str, timeout: int = 180) -> subprocess.CompletedProcess:
    return subprocess.run([DOCKER, *args], capture_output=True, text=True, timeout=timeout)


def healthz() -> tuple[str, float]:
    """返回 (原始响应, 耗时秒)。任何网络异常都收敛成空响应，不抛。"""
    t0 = time.time()
    buf = b""
    try:
        s = socket.create_connection(("127.0.0.1", PORT), 3)
        s.sendall(b"GET /healthz HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        s.settimeout(5)
        try:
            while b"\r\n\r\n" not in buf:
                c = s.recv(4096)
                if not c:
                    break
                buf += c
        except socket.timeout:
            pass
        s.close()
    except OSError:
        pass
    return buf.decode("utf-8", "replace"), time.time() - t0


def wait_healthz(deadline: float = 45.0) -> tuple[str, float] | None:
    """必须等**应用**就绪，不能只等端口通。

    坑：Docker Desktop for Windows 由宿主代理先绑定端口，TCP connect 在容器应用
    尚未开始服务时就已成功。所以这里重试真实的 GET /healthz，直到拿到 200。
    """
    end = time.time() + deadline
    while time.time() < end:
        h, dt = healthz()
        if h.splitlines() and " 200 " in h.splitlines()[0]:
            return h, dt
        time.sleep(0.5)
    return None


def main() -> int:
    if not dk("image", "inspect", IMAGE).returncode == 0:
        print(f"❌ 找不到镜像 {IMAGE}")
        return 1
    local_sha = hashlib.sha256((ROOT / "validator" / "rules.py").read_bytes()).hexdigest()
    print(f"本机 validator/rules.py sha256 = {local_sha}")

    cid = dk("run", "-d", "--rm", "-p", f"{PORT}:8000", IMAGE).stdout.strip()
    if not cid:
        print("❌ 容器启动失败")
        return 1
    print(f"容器已启动 {cid[:12]}  端口 {PORT}")
    try:
        ready = wait_healthz()
        if not ready:
            print("❌ /healthz 未在 45 秒内返回 200")
            return 1
        h0, dt0 = ready
        m = [l for l in h0.splitlines() if "rules_source_sha256" in l]
        print(f"\n① /healthz（空载）：{h0.splitlines()[0]}  {dt0 * 1000:.0f} ms")
        print(f"   {m[0].strip() if m else '（未找到 rules_source_sha256）'}")
        ok_sha = local_sha in h0
        print(f"   → 镜像内规则 = 本机规则：{'✅ 一致' if ok_sha else '❌ 不一致'}")

        # ② 半开正文 + 并发 /healthz
        cap: dict = {}

        def probe_health() -> None:
            time.sleep(1.0)
            h, dt = healthz()
            cap["status"] = h.splitlines()[0] if h else "(无响应)"
            cap["ms"] = dt * 1000

        th = threading.Thread(target=probe_health)
        th.start()
        s = socket.create_connection(("127.0.0.1", PORT), 5)
        s.sendall(b"POST /validate HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
                  b"Content-Length: 200\r\n\r\n" + b"x" * 100)
        t0 = time.time()
        s.settimeout(45)
        buf = b""
        first = None
        while True:
            try:
                c = s.recv(4096)
            except socket.timeout:
                break
            if not c:
                break
            if first is None:
                first = time.time() - t0
            buf += c
        elapsed = time.time() - t0
        th.join(timeout=10)
        s.close()
        status = buf.split(b"\r\n", 1)[0].decode("utf-8", "replace") if buf else "(零响应)"
        print(f"\n② 半开正文（声明 200 字节，只发 100）：")
        print(f"   状态行：{status}")
        print(f"   首字节：{first:.2f} s   总耗时：{elapsed:.2f} s")
        ok_408 = "408" in status
        print(f"   → 10 秒级 408：{'✅' if ok_408 else '❌'}")
        print(f"\n③ 半开期间并发 /healthz：{cap.get('status')}  {cap.get('ms', 0):.0f} ms")
        print(f"   → 健康检查被掩盖（仍 200 且毫秒级）：{'✅ 已复现' if '200' in cap.get('status', '') else '⚠️ 未复现'}")
        return 0 if (ok_sha and ok_408) else 1
    finally:
        dk("stop", cid, timeout=60)
        print("\n容器已停止")


if __name__ == "__main__":
    sys.exit(main())
