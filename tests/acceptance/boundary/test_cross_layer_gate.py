"""QA-001 跨层用例：`/validate` 是**规则门**，不是契约门（PM 已定性的分层设计）。

**PM 定性（2026-10-30，采纳方案 (a)）**：容器 `/validate` 只是一道**规则门**，它根本不消费关系枚举；
关系白名单在 **intake 层**（未知关系 → `INTAKE_UNKNOWN_LABEL`）。因此
**intake 适配层必须前置**，**不得**把 `/validate` 的 `passed` 当作"输入符合 intake-v1 契约"。

本用例同时记录两层的真实行为，把"分层设计"从一句声明变成可复跑的证据：

| 层 | 输入：未知关系值 + 伪造的 `recipient_relation_id` | 期望 |
| --- | --- | --- |
| intake 适配层 `adapt_intake` | 客户端直接提交该对象 | **拒绝**：`INTAKE_UNKNOWN_LABEL`（+ `INTAKE_UNKNOWN_FIELD`） |
| 规则层 `validate`（容器 `/validate` 暴露的就是它） | 同样的语义内容作为 `request_json` | **`passed`**（关系枚举与本字段都不在校验器职责内） |

原始输出另存 `docs/test-reports/boundary-001/evidence/cross-layer.txt`。

运行：
    python -m unittest discover -s tests/acceptance/boundary -v
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate       # noqa: E402
from workflow.intake import adapt_intake   # noqa: E402


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def intake_payload(**overrides):
    payload = {
        "recipient_relation": "pursuit",
        "closeness": "familiar",
        "occasion": "birthday",
        "budget_amount": "200.00",
        "currency": "CNY",
        "deadline_days": 2,
        "interests": ["coffee_food"],
        "interest_confidence": {"coffee_food": "confirmed"},
        "gift_styles": ["practical"],
        "hard_exclusions": {"tags": ["alcohol"], "terms": [], "unresolved": []},
        "additional_context": "希望低调一些",
    }
    payload.update(overrides)
    return payload


def candidates():
    def one(cid, name, total, days):
        return {"id": cid, "name": name, "description": f"{name}：虚构方案说明，含包装与贺卡设想",
                "estimated_total": total, "currency": "CNY", "estimated_preparation_days": days,
                "tags": ["other"], "reason": "匹配用户已确认的偏好与预算上限",
                "fact_refs": ["interest:coffee_food"], "inferences": ["可能偏好实用礼物"],
                "unknowns": ["实际价格以商家为准"], "presentation": "简要呈现"}
    return {"candidates": [one("c1", "手冲咖啡礼盒", "150.00", 1),
                           one("c2", "陶瓷马克杯", "120.00", 2),
                           one("c3", "咖啡豆订阅卡", "80.00", 1)]}


def all_errors(result):
    collected = list(result.get("errors") or [])
    for candidate in result.get("candidate_results") or []:
        collected.extend(candidate.get("errors") or [])
    return collected


class CrossLayerContractGate(unittest.TestCase):
    """未知关系值 + 伪造的服务端专属机器字段，两层行为对照。"""

    #: 客户端**自定义**的机器值：契约规定 `recipient_relation_id` 只由服务端产生，前端不得提交。
    FORGED_ID = "pursuit"

    def _intake_result(self):
        payload = intake_payload(recipient_relation="boss", recipient_relation_id=self.FORGED_ID)
        return adapt_intake(dump(payload))

    def _rule_gate_request(self):
        """取适配层对一个**合法**关系的产物（保证其余字段契约内合法），再把两层关系字段换成伪造值。"""
        valid = adapt_intake(dump(intake_payload()))
        self.assertIsNotNone(valid["request_json"], "前置：合法 intake 必须产出 request_json")
        request = json.loads(valid["request_json"])
        request["recipient_relation"] = "boss"          # 未声明的关系值
        request["recipient_relation_id"] = self.FORGED_ID  # 客户端伪造的机器值
        return request

    def test_intake_layer_rejects_unknown_relation_and_forged_machine_field(self):
        """intake 层必须拒绝：未知关系 → `INTAKE_UNKNOWN_LABEL`；伪造字段 → `INTAKE_UNKNOWN_FIELD`。"""
        result = self._intake_result()
        codes = sorted({e["code"] for e in result["errors"]})
        paths = {e["path"] for e in result["errors"]}

        self.assertEqual("needs_input", result["status"],
                         f"intake 必须拒绝，实际 status={result['status']}，errors={result['errors']}")
        self.assertIn("INTAKE_UNKNOWN_LABEL", codes,
                      f"未知关系值必须报 INTAKE_UNKNOWN_LABEL，实际={codes}")
        self.assertIn("INTAKE_UNKNOWN_FIELD", codes,
                      f"客户端伪造服务端专属字段必须报 INTAKE_UNKNOWN_FIELD，实际={codes}")
        self.assertIn("intake.recipient_relation", paths,
                      f"关系错误的路径应为 intake.recipient_relation，实际={paths}")
        self.assertIsNone(result["request_json"], "intake 拒绝时不得释放 request_json")

    def test_rule_gate_accepts_the_same_payload(self):
        """同一份伪造语义送到规则层（即容器 `/validate`）会 `passed` —— 这是既定的分层事实。"""
        request = self._rule_gate_request()
        result = validate(dump(request), dump(candidates()))
        codes = sorted({e["code"] for e in all_errors(result)})

        self.assertEqual("passed", result["status"],
                         f"规则层不消费关系枚举，故应 passed；实际={result['status']}，errors={codes}")
        self.assertTrue(result["all_passed"], f"三个候选应全部通过，实际 all_passed={result['all_passed']}")
        self.assertEqual([], codes, f"规则层不应报任何码，实际={codes}")

    def test_layering_is_by_design(self):
        """把定性写成断言：两层行为**不同且都正确**，不是缺陷。

        依据：`docs/validator-contract-decisions.md` §5/§7 与 PM 对 R-1 的定性（采纳方案 (a)）；
        `docs/intake-contract.md:60` 已自述校验器对 `request` 无字段白名单。
        """
        intake_status = self._intake_result()["status"]
        rule_status = validate(dump(self._rule_gate_request()), dump(candidates()))["status"]

        self.assertEqual("needs_input", intake_status)
        self.assertEqual("passed", rule_status)
        self.assertNotEqual(
            intake_status, rule_status,
            "两层对本输入本就应当不同：intake 管契约、规则层管规则。"
            "若两者相同，说明有一层的职责被扩大或丢失。")

    def test_forged_machine_field_alone_is_still_rejected_by_intake(self):
        """单独伪造机器字段（关系值合法）也必须被 intake 拦住。"""
        result = adapt_intake(dump(intake_payload(recipient_relation_id="partner")))
        codes = sorted({e["code"] for e in result["errors"]})
        self.assertIn("INTAKE_UNKNOWN_FIELD", codes,
                      f"服务端专属字段不得由前端提交，实际={codes}")
        self.assertEqual("needs_input", result["status"])

    def test_adapter_output_is_contract_valid_and_passes_the_rule_gate(self):
        """闭环：适配层对**合法**输入的产物，送进规则层必须通过（证明分层不是靠放宽两边实现）。"""
        valid = adapt_intake(dump(intake_payload()))
        self.assertEqual("ready", valid["status"], f"合法 intake 应 ready，实际 errors={valid['errors']}")
        request = json.loads(valid["request_json"])
        self.assertEqual("追求对象", request["recipient_relation"])
        self.assertEqual("pursuit", request["recipient_relation_id"])
        result = validate(dump(request), dump(candidates()))
        self.assertEqual("passed", result["status"],
                         f"适配层产物应通过规则层，实际 errors="
                         f"{[(e['code'], e['path']) for e in all_errors(result)]}")

    def test_relation_enum_has_exactly_the_frozen_membership(self):
        """枚举成员集是冻结的：8 个产品值 + `colleague`（技术回归）+ `unknown`（界面未确认态）。

        `unknown` 也在 `RELATIONS` 里，但它不是产品关系值，而是"关系暂不确定"的界面态，
        intake 对它单独发 `INTAKE_CLARIFICATION_REQUIRED`（见 `intake.py:60–62`）。
        """
        from workflow.labels import RELATIONS
        product_ids = {k for k in RELATIONS if k not in ("colleague", "unknown")}
        self.assertEqual(
            {"partner", "pursuit", "friend", "family", "classmate", "mentor", "client_partner", "other"},
            product_ids, f"产品关系值集应恰为 8 个，实际={sorted(product_ids)}")
        self.assertIn("colleague", RELATIONS, "colleague 保留为技术回归夹具")
        self.assertIn("unknown", RELATIONS, "unknown 为界面未确认态")
        self.assertEqual(10, len(RELATIONS),
                         f"枚举总数应为 10（8 产品 + colleague + unknown），实际={sorted(RELATIONS)}")
        self.assertNotEqual(RELATIONS["partner"], RELATIONS["pursuit"],
                            "恋人与追求对象必须是两个独立值，显示文本也不得相同")


if __name__ == "__main__":
    unittest.main(verbosity=2)
