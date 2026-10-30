"""QA-001 故障注入：实际触达 `INTERNAL_ERROR` 的两条真实代码路径。

背景：`INTERNAL_ERROR` 是兜底分支，正常输入**不可达**（`INVALID_JSON` 在它之前就把 status 置为 error）。
因此用**受控故障注入**（monkeypatch 一个内部函数令其抛异常）走通真实代码路径，
而不是伪造它的输出。注入只在进程内生效，`finally` 中必然还原。

两条路径（均在本文件实测）：
  1. `validator/rules.py` 顶层 `except Exception` → `{"code": "INTERNAL_ERROR", "path": "$"}`（`:270–273`）
  2. `workflow/intake.py` 在 `checked["status"] == "error"` 时 → `{"code": "INTERNAL_ERROR", "path": "intake"}`（`:134–135`）

**不修改 `validator/**` 与 `workflow/**`**：注入只改内存中的模块属性并在结束时还原。

运行：
    python tests/acceptance/boundary/probe_internal_error.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

import validator.rules as rules_module            # noqa: E402
from workflow.intake import adapt_intake          # noqa: E402

OUT_JSON = ROOT / "docs/test-reports/boundary-001/evidence/internal-error-injection.json"


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def request():
    return {
        "recipient_relation": "追求对象", "recipient_relation_id": "pursuit", "occasion": "生日",
        "budget_amount": "200.00", "currency": "CNY", "available_days": 3,
        "facts": [{"id": "f1", "text": "对方喜欢手冲咖啡"}],
        "forbidden_tags": [], "forbidden_terms": [], "notes": "",
        "closeness": "unknown", "preference_inferences": [], "gift_styles": [],
        "hard_exclusions_original": {"tags": [], "terms": [], "unresolved": []},
    }


def candidates():
    def one(cid, name, total, days):
        return {"id": cid, "name": name, "description": f"{name}：虚构方案说明",
                "estimated_total": total, "currency": "CNY", "estimated_preparation_days": days,
                "tags": ["other"], "reason": "匹配用户已确认的偏好与预算上限", "fact_refs": ["f1"],
                "inferences": ["可能偏好实用礼物"], "unknowns": ["实际价格以商家为准"],
                "presentation": "简要呈现"}
    return {"candidates": [one("c1", "手冲咖啡礼盒", "150.00", 1),
                           one("c2", "陶瓷马克杯", "120.00", 2),
                           one("c3", "咖啡豆订阅卡", "80.00", 3)]}


def intake_payload():
    return {
        "recipient_relation": "pursuit", "closeness": "familiar", "occasion": "birthday",
        "budget_amount": "200.00", "currency": "CNY", "deadline_days": 2,
        "interests": ["coffee_food"], "interest_confidence": {"coffee_food": "confirmed"},
        "gift_styles": ["practical"],
        "hard_exclusions": {"tags": ["alcohol"], "terms": [], "unresolved": []},
        "additional_context": "希望低调一些",
    }


def boom(*_args, **_kwargs):
    raise RuntimeError("QA 故障注入：模拟未预期内部异常")


def codes(result):
    collected = list(result.get("errors") or [])
    for candidate in result.get("candidate_results") or []:
        collected.extend(candidate.get("errors") or [])
    return [(e["code"], e["path"]) for e in collected]


def main():
    evidence = {"probe": "INTERNAL_ERROR 故障注入触达", "note": "注入仅在进程内生效，finally 还原"}

    # ---- 基线：不注入，不应出现 INTERNAL_ERROR
    base_rules = rules_module.validate(dump(request()), dump(candidates()))
    base_intake = adapt_intake(dump(intake_payload()))
    evidence["baseline"] = {
        "validator_status": base_rules["status"],
        "validator_codes": codes(base_rules),
        "intake_status": base_intake["status"],
        "intake_codes": codes(base_intake),
    }
    print("=== 基线（不注入）===")
    print(f"  validator: status={base_rules['status']} codes={codes(base_rules)}")
    print(f"  intake   : status={base_intake['status']} codes={codes(base_intake)}")

    original_norm = rules_module._norm
    try:
        rules_module._norm = boom
        injected_rules = rules_module.validate(dump(request()), dump(candidates()))
        injected_intake = adapt_intake(dump(intake_payload()))
    finally:
        rules_module._norm = original_norm

    evidence["injected"] = {
        "fault": "validator.rules._norm 被替换为抛 RuntimeError 的函数",
        "validator_status": injected_rules["status"],
        "validator_all_passed": injected_rules.get("all_passed"),
        "validator_codes": codes(injected_rules),
        "validator_business_data_verification": injected_rules.get("business_data_verification"),
        "validator_has_traceback": any("Traceback" in str(e.get("message", "")) for e in injected_rules["errors"]),
        "intake_status": injected_intake["status"],
        "intake_codes": codes(injected_intake),
        "intake_request_json_released": injected_intake["request_json"] is not None,
    }
    print("\n=== 注入后：validator/rules.py 顶层 except → path='$' ===")
    print(f"  status={injected_rules['status']} all_passed={injected_rules.get('all_passed')}")
    print(f"  codes={codes(injected_rules)}")
    print(f"  business_data_verification={injected_rules.get('business_data_verification')}")
    print(f"  响应中含堆栈文本={evidence['injected']['validator_has_traceback']}（必须为 False）")

    print("\n=== 注入后：workflow/intake.py status=='error' → path='intake' ===")
    print(f"  status={injected_intake['status']} codes={codes(injected_intake)}")
    print(f"  是否释放 request_json={evidence['injected']['intake_request_json_released']}（必须为 False）")

    # ---- 还原后自证无副作用
    restored = rules_module.validate(dump(request()), dump(candidates()))
    evidence["after_restore"] = {"validator_status": restored["status"], "validator_codes": codes(restored),
                                 "norm_is_original": rules_module._norm is original_norm}
    print("\n=== 还原后自证 ===")
    print(f"  _norm 已还原={rules_module._norm is original_norm}")
    print(f"  validator: status={restored['status']} codes={codes(restored)}")

    ok = (
        base_rules["status"] == "passed" and not codes(base_rules)
        and injected_rules["status"] == "error"
        and ("INTERNAL_ERROR", "$") in codes(injected_rules)
        and ("INTERNAL_ERROR", "intake") in codes(injected_intake)
        and not evidence["injected"]["validator_has_traceback"]
        and not evidence["injected"]["intake_request_json_released"]
        and restored["status"] == "passed" and rules_module._norm is original_norm
    )
    evidence["reached_both_paths"] = ok
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n两条路径均已触达={ok}")
    print("证据:", OUT_JSON)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
