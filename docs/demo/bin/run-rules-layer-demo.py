#!/usr/bin/env python
"""GiftWise AI · 纯规则层现场演示（DEMO-001 兜底方案 B）

这是**最不可能挂**的一段：只用本机 Python 标准库 + 本机真实规则代码，
不调模型、不访问公网、不依赖 Dify、不依赖 node。

现场用法（两个终端）：
    终端 A:  python -m deploy.server
    终端 B:  python docs/demo/bin/run-rules-layer-demo.py

它做的事：把候选送进真实校验器，依次展示
    1) 基线三候选  → passed
    2) 超预算      → failed / OVER_BUDGET       （"硬约束拒绝"）
    3) 禁忌词      → failed / FORBIDDEN_TERM
    4) 禁忌类别    → failed / FORBIDDEN_TAG
    5) 只改文本不改标签 → 仍然 passed（说明规则语义，避免现场误判）

诚实边界：这是**本机校验器**的真实结果，**不是**「Dify 现场跑出了超预算」。
"""

from __future__ import annotations

import copy
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Windows 控制台默认 codepage 936；打印 ↳/✅/⚠ 会直接抛 UnicodeEncodeError 并 exit 1。
# 已复现，所以脚本内自救，不依赖调用者设环境变量。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

BASE = os.environ.get("GW_VALIDATOR_BASE", "http://127.0.0.1:8000")
EXAMPLE_INTAKE = ROOT / "workflow/examples/intake.json"
EXAMPLE_CANDIDATES = ROOT / "workflow/examples/candidates.json"
TERM_INTAKE = ROOT / "workflow/examples/demo-intake-judge-forbidden-term.json"
TERM_CANDIDATES = ROOT / "workflow/examples/demo-candidates-violating.json"

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def hr(title: str) -> None:
    print(f"\n{'-' * 74}\n{title}\n{'-' * 74}")


def call(request_json, candidates_json):
    body = json.dumps({"request_json": request_json, "candidates_json": candidates_json}).encode("utf-8")
    req = urllib.request.Request(f"{BASE}/validate", data=body, headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
        status = resp.status
    return status, payload, (time.perf_counter() - t0) * 1000


def show(label: str, expect: str, status, payload, ms) -> bool:
    got = payload.get("status")
    codes = sorted({e["code"] for c in payload.get("candidate_results", []) for e in c["errors"]})
    passed = got == expect
    flag = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
    print(f"  [{flag}] {label}")
    print(f"        HTTP {status} ｜ batch.status = {got} ｜ all_passed = {payload.get('all_passed')}")
    print(f"        错误码 = {codes or '（无）'} ｜ 耗时 {ms:.1f} ms ｜ 期望 = {expect}")
    per = {c["id"]: ("通过" if c["passed"] else "拒绝") for c in payload.get("candidate_results", [])}
    print(f"        逐候选 = {per}")
    return passed


def main() -> int:
    print("=" * 74)
    print("GiftWise AI · 纯规则层现场演示（零模型调用 / 零公网依赖）")
    print("=" * 74)
    print(f"校验器地址：{BASE}   工作目录：{ROOT}")

    # 0. 健康检查
    hr("0. 校验器健康检查（先确认这段兜底真的能跑）")
    try:
        with urllib.request.urlopen(f"{BASE}/healthz", timeout=5) as r:
            health = json.loads(r.read().decode("utf-8"))
        print(f"  {GREEN}校验器在线{RESET}：{json.dumps(health, ensure_ascii=False)}")
    except Exception as exc:  # noqa: BLE001
        print(f"  {RED}校验器不可达{RESET}：{exc}")
        print(f"\n  先启动它：{YELLOW}python -m deploy.server{RESET}")
        print("  若 8000 被占：GIFTWISE_PORT=8001 python -m deploy.server，")
        print("  然后 GW_VALIDATOR_BASE=http://127.0.0.1:8001 运行本脚本。")
        print(f"\n  连 Python 都起不来时：直接打开 {YELLOW}docs/demo/replay/offline-replay.html{RESET}")
        print("  的「② 本机真实规则代码」一节，结果已内联，不需要任何运行时。")
        return 2

    fails = 0
    intake = json.loads(EXAMPLE_INTAKE.read_text(encoding="utf-8"))
    from workflow.intake import adapt_intake, dump  # noqa: PLC0415

    request_json = adapt_intake(dump(intake))["request_json"]
    base_candidates = json.loads(EXAMPLE_CANDIDATES.read_text(encoding="utf-8"))

    # 1. 基线通过
    hr("1. 基线三候选 → 应当全部通过（说明校验器不是「一律拒绝」）")
    status, payload, ms = call(request_json, dump(base_candidates))
    fails += 0 if show("基线三候选", "passed", status, payload, ms) else 1

    # 2. 超预算
    hr("2. 把 c1 抬到 250.00（预算上限 200）→ 应当被硬约束拒绝")
    over = copy.deepcopy(base_candidates)
    over["candidates"][0]["estimated_total"] = "250.00"
    status, payload, ms = call(request_json, dump(over))
    fails += 0 if show("超预算候选", "failed", status, payload, ms) else 1

    # 3. 禁忌词
    hr("3. 评委临场指定禁忌词「巧克力」→ 应当命中 FORBIDDEN_TERM")
    term_intake = json.loads(TERM_INTAKE.read_text(encoding="utf-8"))
    term_request = adapt_intake(dump(term_intake))["request_json"]
    term_candidates = json.loads(TERM_CANDIDATES.read_text(encoding="utf-8"))
    status, payload, ms = call(term_request, dump(term_candidates))
    fails += 0 if show("禁忌词「巧克力」", "failed", status, payload, ms) else 1

    # 4. 禁忌类别
    hr("4. 候选自己声明 tags=[alcohol] → 应当命中 FORBIDDEN_TAG")
    tag_intake = copy.deepcopy(intake)
    tag_intake["hard_exclusions"] = {"tags": ["alcohol"], "terms": [], "unresolved": []}
    tag_request = adapt_intake(dump(tag_intake))["request_json"]
    tag_candidates = copy.deepcopy(base_candidates)
    tag_candidates["candidates"][1]["tags"] = ["alcohol"]
    status, payload, ms = call(tag_request, dump(tag_candidates))
    fails += 0 if show("禁忌类别 alcohol", "failed", status, payload, ms) else 1

    # 5. 关键陷阱：只改文本不改 tags
    hr("5. 反例：只把名字改成「精酿啤酒品鉴套装」、**不动 tags** → 实测仍然 passed")
    trap = copy.deepcopy(base_candidates)
    trap["candidates"][1]["name"] = "精酿啤酒品鉴套装"
    trap["candidates"][1]["description"] = "含酒精饮品，用于说明规则语义。"
    status, payload, ms = call(tag_request, dump(trap))
    ok5 = show("只改文本、不声明标签", "passed", status, payload, ms)
    print(f"        {YELLOW}这不是缺陷，是规则语义{RESET}：禁忌**类别**只在候选自己声明的 tags 上匹配；")
    print("        自由文本由 forbidden_terms 负责。现场要演示 FORBIDDEN_TAG，必须改 tags，不能只改名字。")
    fails += 0 if ok5 else 1

    # 收尾
    hr("收尾口径（照读）")
    print("  · 以上是**本机校验器**的真实结果，用的是仓库里的真实规则代码。")
    print("  · 这一段**没有调用任何模型**，也**没有访问公网**；断网、无额度都照样能跑。")
    print("  · 不要说成「Dify 现场跑出了超预算」——Dify 侧没有自然触发的 OVER_BUDGET 证据（B8）。")
    print("  · 价格、库存未核实：校验结果固定携带 business_data_verification = not_verified。")
    print(f"\n  校验器规则源码 sha256：{health.get('rules_source_sha256')}")
    print(f"  冻结 HEAD：{_head_readonly()}")
    print(f"\n=== 6 项用例，失败 {fails} 项 ===")
    return 1 if fails else 0


def _head_readonly() -> str:
    """直接读 .git 元数据。

    不用 subprocess：本机沙箱下 subprocess 建管道会抛
    PermissionError [WinError 5]，脚本直接崩（已复现）。
    """
    git = ROOT / ".git"
    try:
        txt = (git / "HEAD").read_text(encoding="utf-8").strip()
    except OSError:
        return "?"
    if not txt.startswith("ref:"):
        return txt
    ref = txt.split(":", 1)[1].strip()
    p = git / ref
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    packed = git / "packed-refs"
    if packed.exists():
        for line in packed.read_text(encoding="utf-8").splitlines():
            parts = line.split(" ", 1)
            if len(parts) == 2 and parts[1].strip() == ref:
                return parts[0]
    return "?"


if __name__ == "__main__":
    raise SystemExit(main())
