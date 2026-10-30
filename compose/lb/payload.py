"""多副本实验用的确定性 /validate 载荷。

载荷契约来自 validator/rules.py：
  - request 必填：recipient_relation, occasion, budget_amount, currency, available_days
    （rules.py:124）
  - candidates 必填字段见 rules.py:173；数组长度必须恰好为 3（rules.py:229）
本模块只负责生成合法载荷，不含任何网络逻辑，便于被负载均衡器与压测脚本复用。
"""

from __future__ import annotations

import json

#: 递增的序号用于让每个请求的载荷**内容不同**，这样负载均衡器的日志里
#: 可以按 seq 反查「哪个副本处理了哪个请求」。若载荷完全相同，
#: 就无法证明分发确实发生了（两个副本的响应字节会一模一样）。
_BASE_REQUEST = {
    "recipient_relation": "恋人",
    "occasion": "生日",
    # 金额必须是十进制字符串（rules.py:88-97 `_amount`），不能是 JSON 数字。
    "budget_amount": "500",
    "currency": "CNY",
    # 天数必须是 JSON 整数且非布尔（rules.py:100-104 `_days`）。
    "available_days": 14,
    "facts": [
        {"id": "f1", "text": "对方喜欢手冲咖啡"},
        {"id": "f2", "text": "对方对酒精过敏"},
    ],
    "forbidden_tags": ["alcohol"],
    "forbidden_terms": ["香烟"],
}


#: 契约要求候选 ID 必须恰好是 c1/c2/c3（区分大小写），
#: 因此**不能**用 ID 区分请求；序号写在 request.notes 与候选 name/description 里。
_CANDIDATE_IDS = ("c1", "c2", "c3")


def _candidate(index: int, seq: int) -> dict:
    return {
        "id": _CANDIDATE_IDS[index],
        "name": f"候选方案{index + 1}-序号{seq}",
        "description": f"第 {seq} 次请求的第 {index + 1} 个候选方案，用于多副本分发取证。",
        # 与 request.budget_amount 同理，候选金额也必须是十进制字符串。
        "estimated_total": str(200 + index * 50),
        "currency": "CNY",
        "estimated_preparation_days": 3 + index,
        "tags": ["food"],
        "reason": "预算与可用天数均满足，且不含禁忌标签。",
        "fact_refs": ["f1"],
        "inferences": [],
        "unknowns": [],
    }


def build(seq: int) -> tuple[str, str]:
    """返回 (request_json, candidates_json)，两者都是 JSON 字符串（服务端契约要求）。"""
    request = dict(_BASE_REQUEST)
    # 让每个请求的 request_json 字节都不同，便于在日志/响应里追踪。
    request["notes"] = f"probe-seq-{seq}"
    candidates = {"candidates": [_candidate(i, seq) for i in range(3)]}
    return (
        json.dumps(request, ensure_ascii=False, separators=(",", ":")),
        json.dumps(candidates, ensure_ascii=False, separators=(",", ":")),
    )


def body(seq: int) -> bytes:
    """返回可直接作为 POST 正文的 UTF-8 字节。"""
    request_json, candidates_json = build(seq)
    return json.dumps(
        {"request_json": request_json, "candidates_json": candidates_json},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
