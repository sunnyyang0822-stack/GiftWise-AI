#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""架构线独立探针：核验「交付镜像的 /validate」与「本机 validator/rules.py」是否逐字节一致。

这是 ARCH-001 关于「容器与本机规则一致」这一断言的**独立复核工具**（辅助脚本，不属于交付文档）。

用法：
    python docs/architecture/probes/verify_container_parity.py [镜像tag] [宿主端口]

默认镜像 `giftwise-validator:submission-20261101`，默认端口 18401（避开其他线常用的 8000/8787）。
脚本行为：docker run 一个临时容器（-d --rm，**不构建、不推送、不联网**），跑完 docker rm -f。
它不修改仓库任何文件，只读夹具、只发 HTTP 请求。

夹具来源（可复现）：
    node web/tools/gen-parity-fixtures.mjs      # 生成 .tmp/web-parity/fixtures.json（未入库）
本探针默认读 .tmp/web-parity/fixtures.json，也可用第 3 个参数指定路径。

判定：对每一组 (request_json, candidates_json)，比较
    本机 validator.rules.validate(...)  与  容器 POST /validate 返回的 JSON 文本
逐字节是否相同（ensure_ascii=False 序列化后比较），并额外覆盖越界请求。
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

# Windows 中文控制台默认 GBK（cp936）：本脚本会打印 ✅/❌ 等字符，不重配置 stdout 会在
# 打印时抛 UnicodeEncodeError 崩溃，看起来像"功能失败"，其实是编码问题。
# （2026-10-31 由性能调优线踩到、PM 补修；不加 PYTHONIOENCODING=utf-8 时必现。）
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REPO = pathlib.Path(__file__).resolve().parents[3]
RULES = REPO / "validator" / "rules.py"
sys.path.insert(0, str(REPO))
from validator.rules import validate  # noqa: E402

IMAGE = sys.argv[1] if len(sys.argv) > 1 else "giftwise-validator:submission-20261101"
PORT = sys.argv[2] if len(sys.argv) > 2 else "18401"
FIXTURES = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else REPO / ".tmp" / "web-parity" / "fixtures.json"
NAME = "arch-parity-probe"
BASE = f"http://127.0.0.1:{PORT}"


def sh(*args: str, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=check)


def canon(obj) -> str:
    """去掉所有空格差异后的规范化文本，用于逐字节比较。"""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def post(path: str, payload: dict, timeout: float = 15.0):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main() -> int:
    print(f"镜像           : {IMAGE}")
    print(f"宿主端口       : {PORT}")
    print(f"本机 rules.py  : sha256={hashlib.sha256(RULES.read_bytes()).hexdigest()}")
    if not FIXTURES.exists():
        print(f"❌ 夹具不存在：{FIXTURES}\n   先跑：node web/tools/gen-parity-fixtures.mjs")
        return 2

    sh("docker", "rm", "-f", NAME)
    run = sh("docker", "run", "-d", "--rm", "--name", NAME, "-p", f"127.0.0.1:{PORT}:8000", IMAGE)
    if run.returncode != 0:
        print(f"❌ docker run 失败：{run.stderr.strip()}")
        return 2
    print(f"容器已启动     : {run.stdout.strip()[:20]}")

    try:
        health = None
        for _ in range(40):
            try:
                with urllib.request.urlopen(BASE + "/healthz", timeout=2) as r:
                    health = json.loads(r.read().decode("utf-8"))
                break
            except Exception:
                time.sleep(0.5)
        if health is None:
            print("❌ /healthz 在 20 秒内未就绪")
            return 1

        local_hash = hashlib.sha256(RULES.read_bytes()).hexdigest()
        remote_hash = health.get("rules_source_sha256")
        print(f"\n/healthz       : {json.dumps(health, ensure_ascii=False)}")
        same_hash = local_hash == remote_hash
        print(f"规则哈希一致   : {'✅ 是' if same_hash else '❌ 否'}  (容器 {str(remote_hash)[:16]}… vs 本机 {local_hash[:16]}…)")

        data = json.loads(FIXTURES.read_text(encoding="utf-8"))
        base_req = data["request_json"]
        batches = data.get("candidate_batches", [])
        pairs: list[tuple[str, str, str]] = []
        for b in batches[:6]:
            cand = b.get("candidates_json")
            if cand is None and "candidates" in b:
                cand = json.dumps(b["candidates"], ensure_ascii=False)
            if isinstance(cand, str):
                pairs.append((b.get("id", "?"), base_req, cand))
        # 越界请求：把预算/天数改成越界值，验证两侧在边界上是否也一致
        for label, mutate in (
            ("越界 budget=10000.01", {"budget_amount": "10000.01"}),
            ("越界 budget=10001", {"budget_amount": "10001"}),
            ("越界 days=366", {"available_days": 366}),
        ):
            rq = json.loads(base_req)
            rq.update(mutate)
            pairs.append((label, json.dumps(rq, ensure_ascii=False), pairs[0][2] if pairs else "[]"))

        print(f"\n比对用例       : {len(pairs)} 组（前 6 组合法夹具 + 3 组越界请求）")
        bad = 0
        for label, rq, cand in pairs:
            local = validate(rq, cand)
            try:
                status, remote = post("/validate", {"request_json": rq, "candidates_json": cand})
            except urllib.error.HTTPError as e:
                status, remote = e.code, {"error": e.read().decode("utf-8", "replace")}
            ok = status == 200 and canon(local) == canon(remote)
            if not ok:
                bad += 1
            print(f"  [{'PASS' if ok else 'FAIL'}] {label:<24} HTTP {status}  local={canon(local)[:70]}")
            if not ok:
                print(f"         remote={canon(remote)[:120]}")

        print(f"\n结论           : {len(pairs) - bad}/{len(pairs)} 组逐字节一致；"
              f"规则哈希{'一致' if same_hash else '不一致'}")
        return 0 if (bad == 0 and same_hash) else 1
    finally:
        sh("docker", "rm", "-f", NAME)
        print("临时容器已移除。")


if __name__ == "__main__":
    raise SystemExit(main())
