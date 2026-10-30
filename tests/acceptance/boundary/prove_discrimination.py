"""QA-001 判别力证明：**证明上面那套边界断言不是"永远通过"的空转**。

做法：把 `validator/rules.py` 的源码读进内存，**仅在内存中**删除请求侧范围校验那 4 行
（`:131–134`），exec 成一个临时模块，再跑同一批输入。
若边界套件有判别力，此时 `budget="0"`、`budget="10001"`、`days=366` 必须**不再**报 `LIMIT_EXCEEDED`。

**不修改 `validator/rules.py`**，全程只读该文件。

运行：
    python tests/acceptance/boundary/prove_discrimination.py
"""

import json
import re
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate as real_validate  # noqa: E402


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def request(**overrides):
    base = {
        "recipient_relation": "追求对象", "recipient_relation_id": "pursuit", "occasion": "生日",
        "budget_amount": "200.00", "currency": "CNY", "available_days": 3,
        "facts": [{"id": "f1", "text": "对方喜欢手冲咖啡"}],
        "forbidden_tags": [], "forbidden_terms": [], "notes": "",
        "closeness": "unknown", "preference_inferences": [], "gift_styles": [],
        "hard_exclusions_original": {"tags": [], "terms": [], "unresolved": []},
    }
    base.update(overrides)
    return base


def candidate(cid, name, total, days):
    return {"id": cid, "name": name, "description": f"{name}：虚构方案说明",
            "estimated_total": total, "currency": "CNY", "estimated_preparation_days": days,
            "tags": ["other"], "reason": "匹配偏好", "fact_refs": ["f1"],
            "inferences": ["可能偏好实用礼物"], "unknowns": ["实际价格"],
            "presentation": "简要呈现"}


BATCH = {"candidates": [candidate("c1", "手冲咖啡礼盒", "150.00", 1),
                        candidate("c2", "陶瓷马克杯", "120.00", 2),
                        candidate("c3", "咖啡豆订阅卡", "80.00", 3)]}

PROBES = [
    ("budget=0（越界，须拒）", request(budget_amount="0"), BATCH, True),
    ("budget=0.00（越界，须拒）", request(budget_amount="0.00"), BATCH, True),
    ("budget=10000（端点，须通过）", request(budget_amount="10000"), BATCH, False),
    ("budget=10000.01（越界，须拒）", request(budget_amount="10000.01"), BATCH, True),
    ("budget=10001（越界，须拒）", request(budget_amount="10001"), BATCH, True),
    ("days=365（端点，须通过）", request(available_days=365), BATCH, False),
    ("days=366（越界，须拒）", request(available_days=366), BATCH, True),
    ("days=10**20（越界，须拒）", request(available_days=10 ** 20), BATCH, True),
]


def load_without_range_check():
    """在内存中整块移除请求侧范围校验，返回一个可调用的 validate。

    必须连着缩进体一起摘掉，只删 `if` 行会留下孤立缩进造成 IndentationError。
    """
    source = (ROOT / "validator" / "rules.py").read_text(encoding="utf-8")
    lines = source.splitlines(keepends=True)
    kept, removed = [], []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("# 请求侧范围只在调用点检查"):
            removed.append(line.rstrip("\n"))
            i += 1
            continue
        if "1 <= budget <= 10000" in stripped or "days > 365" in stripped:
            indent = len(line) - len(line.lstrip())
            removed.append(line.rstrip("\n"))
            i += 1
            # 连同该 if 的缩进体一并摘除
            while i < len(lines):
                nxt = lines[i]
                if not nxt.strip():
                    removed.append(nxt.rstrip("\n"))
                    i += 1
                    continue
                if (len(nxt) - len(nxt.lstrip())) > indent:
                    removed.append(nxt.rstrip("\n"))
                    i += 1
                    continue
                break
            continue
        kept.append(line)
        i += 1
    module = types.ModuleType("rules_without_range_check")
    module.__file__ = str(ROOT / "validator" / "rules.py")
    exec(compile("".join(kept), "<rules-without-range-check>", "exec"), module.__dict__)
    return module.validate, removed


def codes(result):
    collected = list(result.get("errors") or [])
    for c in result.get("candidate_results") or []:
        collected.extend(c.get("errors") or [])
    return sorted({e["code"] for e in collected})


def main():
    print("=== A. 真实实现（validator/rules.py 原样） ===")
    real_rows = []
    for label, req, batch, _must_reject in PROBES:
        res = real_validate(dump(req), dump(batch))
        real_rows.append((label, res["status"], codes(res)))
        print(f"  {label:<28} status={res['status']:<12} codes={codes(res)}")

    patched_validate, removed = load_without_range_check()
    print("\n=== B. 内存中移除范围校验后（不修改 validator/rules.py） ===")
    print("  被摘除的行：")
    for line in removed:
        print(f"    | {line}")
    stub_rows = []
    for label, req, batch, _must_reject in PROBES:
        res = patched_validate(dump(req), dump(batch))
        stub_rows.append((label, res["status"], codes(res)))
        print(f"  {label:<28} status={res['status']:<12} codes={codes(res)}")

    print("\n=== C. 判别力判定 ===")
    print("  判别用例（须拒绝的越界值）：移除范围校验后行为若改变，证明断言有牙。")
    print("  对照用例（范围内端点）：两侧**应当相同**，它们本就该通过，不承担判别职责。")
    discriminating, controls, unexpected = 0, 0, []
    for (label, rs, rc), (_, ss, sc), (_l, _r, _b, must_reject) in zip(real_rows, stub_rows, PROBES):
        differs = (rs, rc) != (ss, sc)
        if must_reject:
            ok = differs
            discriminating += ok
            kind = "判别用例"
        else:
            ok = not differs
            controls += ok
            kind = "对照用例"
        if not ok:
            unexpected.append(label)
        print(f"  [{kind}] {label:<28} A={rs}/{rc}  B={ss}/{sc}  → "
              + ("符合预期" if ok else "**不符合预期**"))

    total_disc = sum(1 for p in PROBES if p[3])
    print(f"\n判别用例有判别力：{discriminating}/{total_disc}；对照用例两侧一致：{controls}/{len(PROBES) - total_disc}")
    if unexpected:
        print("不符合预期（需注意）：", unexpected)
    return 0 if (discriminating == total_disc and controls == len(PROBES) - total_disc) else 1


if __name__ == "__main__":
    sys.exit(main())
