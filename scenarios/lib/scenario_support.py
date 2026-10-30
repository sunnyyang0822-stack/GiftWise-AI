# -*- coding: utf-8 -*-
"""场景线的共享支撑：适配层调用、规则层调用、契约化候选构造。

只读调用 `workflow.intake.adapt_intake` 与 `validator.rules.validate`；零第三方依赖；零模型调用。
"""

import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from workflow.intake import adapt_intake       # noqa: E402
from validator.rules import validate           # noqa: E402

INTAKE_BASE = {
    "recipient_relation": "pursuit",
    "closeness": "limited",
    "occasion": "birthday",
    "budget_amount": "200.00",
    "currency": "CNY",
    "deadline_days": 2,
    "interests": ["coffee_food"],
    "interest_confidence": {"coffee_food": "confirmed"},
    "gift_styles": ["practical"],
    "hard_exclusions": {"tags": [], "terms": [], "unresolved": []},
    "additional_context": "完全虚构的探针请求。",
}


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def build_request(intake_dict):
    """intake → 确定性适配 → (request_json, adapted)。若未 ready，request_json 为 None。"""
    adapted = adapt_intake(dump(intake_dict))
    if adapted.get("status") != "ready":
        return None, adapted
    return adapted["request_json"], adapted


def call_validate(request_json, candidates_batch):
    return validate(request_json, dump(candidates_batch))


def cand(cid, name, desc, total, days, tags, reason, refs=None, inf=None, unk=None, currency="CNY"):
    return {
        "id": cid, "name": name, "description": desc, "estimated_total": total,
        "currency": currency, "estimated_preparation_days": days, "tags": list(tags),
        "reason": reason, "fact_refs": list(refs or []),
        "inferences": list(inf or []),
        "unknowns": list(unk or ["实际价格、库存与送达均未核实；估算含基础包装、贺卡与配送"]),
    }


def batch(*cands):
    return {"candidates": list(cands)}


def codes_of(validation):
    return sorted({e["code"] for e in validation.get("errors", [])})
