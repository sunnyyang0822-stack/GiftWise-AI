# 节点级输入输出原文 · case1_normal_three_candidates

- 发起时间（浏览器本地，UTC）：`2026-10-30T12:58:12.870Z`
- HTTP：`200`　Content-Type：`text/event-stream; charset=utf-8`
- 端到端耗时：`1259 ms`
- 预期路径：N3 全通过 → N4 [true] → N7a → End A

> 数据来源：`POST /console/api/apps/5abdb13c-a633-4a9c-96c3-dabd44072511/workflows/draft/run`
> 返回的 SSE 流，逐字记录，未做改写。`placeholder: true` 与 `model_called: false` 表示该节点未调用模型。

## 用户输入

- 节点 ID：`1793273634593`　状态：`succeeded`　节点耗时：`7.8e-05 s`　时间戳：`1793365091`

**输入（Dify 服务端回传的节点 inputs）**

```json
{
  "intake_json": "{\n  \"recipient_relation\": \"pursuit\",\n  \"closeness\": \"limited\",\n  \"occasion\": \"birthday\",\n  \"budget_amount\": \"200.00\",\n  \"currency\": \"CNY\",\n  \"deadline_days\": 2,\n  \"interests\": [\"coffee_food\", \"design_art\"],\n  \"interest_confidence\": {\"coffee_food\": \"confirmed\", \"design_art\": \"inferred\"},\n  \"gift_styles\": [\"practical\", \"understated\"],\n  \"hard_exclusions\": {\"tags\": [\"alcohol\"], \"terms\": [\"酒\"], \"unresolved\": []},\n  \"additional_context\": \"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\"\n}",
  "trusted_repair_count": 0,
  "inject_candidates_json": "",
  "inject_repair_json": ""
}
```

**输出（Dify 服务端回传的节点 outputs）**

```json
{
  "intake_json": "{\n  \"recipient_relation\": \"pursuit\",\n  \"closeness\": \"limited\",\n  \"occasion\": \"birthday\",\n  \"budget_amount\": \"200.00\",\n  \"currency\": \"CNY\",\n  \"deadline_days\": 2,\n  \"interests\": [\"coffee_food\", \"design_art\"],\n  \"interest_confidence\": {\"coffee_food\": \"confirmed\", \"design_art\": \"inferred\"},\n  \"gift_styles\": [\"practical\", \"understated\"],\n  \"hard_exclusions\": {\"tags\": [\"alcohol\"], \"terms\": [\"酒\"], \"unresolved\": []},\n  \"additional_context\": \"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\"\n}",
  "trusted_repair_count": 0,
  "inject_candidates_json": "",
  "inject_repair_json": ""
}
```

## N1 用户输入与确定性适配

- 节点 ID：`1793357958534`　状态：`succeeded`　节点耗时：`0.237655 s`　时间戳：`1793365091`

**输入（Dify 服务端回传的节点 inputs）**

```json
{
  "intake_json": "{\n  \"recipient_relation\": \"pursuit\",\n  \"closeness\": \"limited\",\n  \"occasion\": \"birthday\",\n  \"budget_amount\": \"200.00\",\n  \"currency\": \"CNY\",\n  \"deadline_days\": 2,\n  \"interests\": [\"coffee_food\", \"design_art\"],\n  \"interest_confidence\": {\"coffee_food\": \"confirmed\", \"design_art\": \"inferred\"},\n  \"gift_styles\": [\"practical\", \"understated\"],\n  \"hard_exclusions\": {\"tags\": [\"alcohol\"], \"terms\": [\"酒\"], \"unresolved\": []},\n  \"additional_context\": \"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\"\n}"
}
```

**输出（Dify 服务端回传的节点 outputs）**

```json
{
  "request_json": "{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"200.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}}",
  "errors_json": "[]",
  "status": "ready"
}
```

## N2 需求分析与三候选（占位·未接模型）

- 节点 ID：`1793400000001`　状态：`succeeded`　节点耗时：`0.137521 s`　时间戳：`1793365091`

**输入（Dify 服务端回传的节点 inputs）**

```json
{
  "request_json": "{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"200.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}}",
  "inject_candidates_json": ""
}
```

**输出（Dify 服务端回传的节点 outputs）**

```json
{
  "candidates_json": "{\n  \"candidates\": [\n    {\n      \"id\": \"c1\",\n      \"name\": \"简洁杯具与杯垫\",\n      \"description\": \"以日常饮用器具为方向，不涉及具体豆种或食品口味。\",\n      \"estimated_total\": \"150.00\",\n      \"currency\": \"CNY\",\n      \"estimated_preparation_days\": 1,\n      \"tags\": [\"other\"],\n      \"reason\": \"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\",\n      \"fact_refs\": [\"interest:coffee_food\"],\n      \"inferences\": [\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\"],\n      \"unknowns\": [\"对方是否已有同类物品\", \"具体饮用偏好\", \"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]\n    },\n    {\n      \"id\": \"c2\",\n      \"name\": \"空白便笺与书写笔\",\n      \"description\": \"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\",\n      \"estimated_total\": \"120.00\",\n      \"currency\": \"CNY\",\n      \"estimated_preparation_days\": 2,\n      \"tags\": [\"other\"],\n      \"reason\": \"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\",\n      \"fact_refs\": [],\n      \"inferences\": [\"了解不多时，通用用品可能较稳妥，不保证适合对方。\"],\n      \"unknowns\": [\"对方是否使用纸笔\", \"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]\n    },\n    {\n      \"id\": \"c3\",\n      \"name\": \"可自主挑选的通用消费额度\",\n      \"description\": \"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\",\n      \"estimated_total\": \"80.00\",\n      \"currency\": \"CNY\",\n      \"estimated_preparation_days\": 1,\n      \"tags\": [\"other\"],\n      \"reason\": \"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\",\n      \"fact_refs\": [],\n      \"inferences\": [\"自主选择可能更灵活，但额度类礼物也可能显得直接。\"],\n      \"unknowns\": [\"对方对额度类礼物的接受程度\", \"可用范围和有效期\", \"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\"]\n    }\n  ]\n}\n",
  "status": "placeholder_fixed_snapshot",
  "placeholder": true,
  "model_called": false,
  "candidate_ids": "[\"c1\", \"c2\", \"c3\"]"
}
```

## N3 Code 首次校验

- 节点 ID：`1793400000002`　状态：`succeeded`　节点耗时：`0.187912 s`　时间戳：`1793365091`

**输入（Dify 服务端回传的节点 inputs）**

```json
{
  "request_json": "{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"200.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}}",
  "candidates_json": "{\n  \"candidates\": [\n    {\n      \"id\": \"c1\",\n      \"name\": \"简洁杯具与杯垫\",\n      \"description\": \"以日常饮用器具为方向，不涉及具体豆种或食品口味。\",\n      \"estimated_total\": \"150.00\",\n      \"currency\": \"CNY\",\n      \"estimated_preparation_days\": 1,\n      \"tags\": [\"other\"],\n      \"reason\": \"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\",\n      \"fact_refs\": [\"interest:coffee_food\"],\n      \"inferences\": [\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\"],\n      \"unknowns\": [\"对方是否已有同类物品\", \"具体饮用偏好\", \"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]\n    },\n    {\n      \"id\": \"c2\",\n      \"name\": \"空白便笺与书写笔\",\n      \"description\": \"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\",\n      \"estimated_total\": \"120.00\",\n      \"currency\": \"CNY\",\n      \"estimated_preparation_days\": 2,\n      \"tags\": [\"other\"],\n      \"reason\": \"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\",\n      \"fact_refs\": [],\n      \"inferences\": [\"了解不多时，通用用品可能较稳妥，不保证适合对方。\"],\n      \"unknowns\": [\"对方是否使用纸笔\", \"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]\n    },\n    {\n      \"id\": \"c3\",\n      \"name\": \"可自主挑选的通用消费额度\",\n      \"description\": \"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\",\n      \"estimated_total\": \"80.00\",\n      \"currency\": \"CNY\",\n      \"estimated_preparation_days\": 1,\n      \"tags\": [\"other\"],\n      \"reason\": \"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\",\n      \"fact_refs\": [],\n      \"inferences\": [\"自主选择可能更灵活，但额度类礼物也可能显得直接。\"],\n      \"unknowns\": [\"对方对额度类礼物的接受程度\", \"可用范围和有效期\", \"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\"]\n    }\n  ]\n}\n",
  "repair_count": 0
}
```

**输出（Dify 服务端回传的节点 outputs）**

```json
{
  "envelope_json": "{\"request_json\":\"{\\\"recipient_relation\\\":\\\"追求对象\\\",\\\"recipient_relation_id\\\":\\\"pursuit\\\",\\\"occasion\\\":\\\"生日\\\",\\\"budget_amount\\\":\\\"200.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"available_days\\\":2,\\\"facts\\\":[{\\\"id\\\":\\\"interest:coffee_food\\\",\\\"text\\\":\\\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\\"}],\\\"forbidden_tags\\\":[\\\"alcohol\\\"],\\\"forbidden_terms\\\":[\\\"酒\\\"],\\\"notes\\\":\\\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\\\",\\\"closeness\\\":\\\"limited\\\",\\\"preference_inferences\\\":[{\\\"interest_id\\\":\\\"design_art\\\",\\\"text\\\":\\\"用户猜测：对方可能对“设计与艺术”感兴趣\\\"}],\\\"gift_styles\\\":[\\\"practical\\\",\\\"understated\\\"],\\\"hard_exclusions_original\\\":{\\\"tags\\\":[\\\"alcohol\\\"],\\\"terms\\\":[\\\"酒\\\"],\\\"unresolved\\\":[]}}\",\"candidates_json\":\"{\\n  \\\"candidates\\\": [\\n    {\\n      \\\"id\\\": \\\"c1\\\",\\n      \\\"name\\\": \\\"简洁杯具与杯垫\\\",\\n      \\\"description\\\": \\\"以日常饮用器具为方向，不涉及具体豆种或食品口味。\\\",\\n      \\\"estimated_total\\\": \\\"150.00\\\",\\n      \\\"currency\\\": \\\"CNY\\\",\\n      \\\"estimated_preparation_days\\\": 1,\\n      \\\"tags\\\": [\\\"other\\\"],\\n      \\\"reason\\\": \\\"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\\\",\\n      \\\"fact_refs\\\": [\\\"interest:coffee_food\\\"],\\n      \\\"inferences\\\": [\\\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\\\"],\\n      \\\"unknowns\\\": [\\\"对方是否已有同类物品\\\", \\\"具体饮用偏好\\\", \\\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\\"]\\n    },\\n    {\\n      \\\"id\\\": \\\"c2\\\",\\n      \\\"name\\\": \\\"空白便笺与书写笔\\\",\\n      \\\"description\\\": \\\"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\\\",\\n      \\\"estimated_total\\\": \\\"120.00\\\",\\n      \\\"currency\\\": \\\"CNY\\\",\\n      \\\"estimated_preparation_days\\\": 2,\\n      \\\"tags\\\": [\\\"other\\\"],\\n      \\\"reason\\\": \\\"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\\\",\\n      \\\"fact_refs\\\": [],\\n      \\\"inferences\\\": [\\\"了解不多时，通用用品可能较稳妥，不保证适合对方。\\\"],\\n      \\\"unknowns\\\": [\\\"对方是否使用纸笔\\\", \\\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\\"]\\n    },\\n    {\\n      \\\"id\\\": \\\"c3\\\",\\n      \\\"name\\\": \\\"可自主挑选的通用消费额度\\\",\\n      \\\"description\\\": \\\"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\\\",\\n      \\\"estimated_total\\\": \\\"80.00\\\",\\n      \\\"currency\\\": \\\"CNY\\\",\\n      \\\"estimated_preparation_days\\\": 1,\\n      \\\"tags\\\": [\\\"other\\\"],\\n      \\\"reason\\\": \\\"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\\\",\\n      \\\"fact_refs\\\": [],\\n      \\\"inferences\\\": [\\\"自主选择可能更灵活，但额度类礼物也可能显得直接。\\\"],\\n      \\\"unknowns\\\": [\\\"对方对额度类礼物的接受程度\\\", \\\"可用范围和有效期\\\", \\\"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\\\"]\\n    }\\n  ]\\n}\\n\",\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"repair_count\":0,\"repairable\":false,\"workflow_errors\":[]}",
  "status": "passed",
  "all_passed": true,
  "repairable": false,
  "repair_count": 0,
  "validation_json": "{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"}",
  "preserved_candidates_json": "{\"c1\":{\"id\":\"c1\",\"name\":\"简洁杯具与杯垫\",\"description\":\"以日常饮用器具为方向，不涉及具体豆种或食品口味。\",\"estimated_total\":\"150.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\"],\"unknowns\":[\"对方是否已有同类物品\",\"具体饮用偏好\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},\"c2\":{\"id\":\"c2\",\"name\":\"空白便笺与书写笔\",\"description\":\"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\",\"estimated_total\":\"120.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":2,\"tags\":[\"other\"],\"reason\":\"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\",\"fact_refs\":[],\"inferences\":[\"了解不多时，通用用品可能较稳妥，不保证适合对方。\"],\"unknowns\":[\"对方是否使用纸笔\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},\"c3\":{\"id\":\"c3\",\"name\":\"可自主挑选的通用消费额度\",\"description\":\"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\",\"estimated_total\":\"80.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\",\"fact_refs\":[],\"inferences\":[\"自主选择可能更灵活，但额度类礼物也可能显得直接。\"],\"unknowns\":[\"对方对额度类礼物的接受程度\",\"可用范围和有效期\",\"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\"]}}"
}
```

## N4 校验结果分支

- 节点 ID：`1793400000003`　状态：`succeeded`　节点耗时：`0.000128 s`　时间戳：`1793365091`

**输入（Dify 服务端回传的节点 inputs）**

```json
{
  "conditions": [
    {
      "actual_value": true,
      "comparison_operator": "is",
      "expected_value": true
    }
  ]
}
```

**输出（Dify 服务端回传的节点 outputs）**

```json
{
  "result": true,
  "selected_case_id": "true"
}
```

## N7a 未修订报告

- 节点 ID：`1793400000006`　状态：`succeeded`　节点耗时：`0.064194 s`　时间戳：`1793365091`

**输入（Dify 服务端回传的节点 inputs）**

```json
{
  "state_json": "{\"request_json\":\"{\\\"recipient_relation\\\":\\\"追求对象\\\",\\\"recipient_relation_id\\\":\\\"pursuit\\\",\\\"occasion\\\":\\\"生日\\\",\\\"budget_amount\\\":\\\"200.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"available_days\\\":2,\\\"facts\\\":[{\\\"id\\\":\\\"interest:coffee_food\\\",\\\"text\\\":\\\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\\"}],\\\"forbidden_tags\\\":[\\\"alcohol\\\"],\\\"forbidden_terms\\\":[\\\"酒\\\"],\\\"notes\\\":\\\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\\\",\\\"closeness\\\":\\\"limited\\\",\\\"preference_inferences\\\":[{\\\"interest_id\\\":\\\"design_art\\\",\\\"text\\\":\\\"用户猜测：对方可能对“设计与艺术”感兴趣\\\"}],\\\"gift_styles\\\":[\\\"practical\\\",\\\"understated\\\"],\\\"hard_exclusions_original\\\":{\\\"tags\\\":[\\\"alcohol\\\"],\\\"terms\\\":[\\\"酒\\\"],\\\"unresolved\\\":[]}}\",\"candidates_json\":\"{\\n  \\\"candidates\\\": [\\n    {\\n      \\\"id\\\": \\\"c1\\\",\\n      \\\"name\\\": \\\"简洁杯具与杯垫\\\",\\n      \\\"description\\\": \\\"以日常饮用器具为方向，不涉及具体豆种或食品口味。\\\",\\n      \\\"estimated_total\\\": \\\"150.00\\\",\\n      \\\"currency\\\": \\\"CNY\\\",\\n      \\\"estimated_preparation_days\\\": 1,\\n      \\\"tags\\\": [\\\"other\\\"],\\n      \\\"reason\\\": \\\"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\\\",\\n      \\\"fact_refs\\\": [\\\"interest:coffee_food\\\"],\\n      \\\"inferences\\\": [\\\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\\\"],\\n      \\\"unknowns\\\": [\\\"对方是否已有同类物品\\\", \\\"具体饮用偏好\\\", \\\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\\"]\\n    },\\n    {\\n      \\\"id\\\": \\\"c2\\\",\\n      \\\"name\\\": \\\"空白便笺与书写笔\\\",\\n      \\\"description\\\": \\\"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\\\",\\n      \\\"estimated_total\\\": \\\"120.00\\\",\\n      \\\"currency\\\": \\\"CNY\\\",\\n      \\\"estimated_preparation_days\\\": 2,\\n      \\\"tags\\\": [\\\"other\\\"],\\n      \\\"reason\\\": \\\"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\\\",\\n      \\\"fact_refs\\\": [],\\n      \\\"inferences\\\": [\\\"了解不多时，通用用品可能较稳妥，不保证适合对方。\\\"],\\n      \\\"unknowns\\\": [\\\"对方是否使用纸笔\\\", \\\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\\"]\\n    },\\n    {\\n      \\\"id\\\": \\\"c3\\\",\\n      \\\"name\\\": \\\"可自主挑选的通用消费额度\\\",\\n      \\\"description\\\": \\\"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\\\",\\n      \\\"estimated_total\\\": \\\"80.00\\\",\\n      \\\"currency\\\": \\\"CNY\\\",\\n      \\\"estimated_preparation_days\\\": 1,\\n      \\\"tags\\\": [\\\"other\\\"],\\n      \\\"reason\\\": \\\"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\\\",\\n      \\\"fact_refs\\\": [],\\n      \\\"inferences\\\": [\\\"自主选择可能更灵活，但额度类礼物也可能显得直接。\\\"],\\n      \\\"unknowns\\\": [\\\"对方对额度类礼物的接受程度\\\", \\\"可用范围和有效期\\\", \\\"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\\\"]\\n    }\\n  ]\\n}\\n\",\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"repair_count\":0,\"repairable\":false,\"workflow_errors\":[]}"
}
```

**输出（Dify 服务端回传的节点 outputs）**

```json
{
  "envelope_json": "{\"status\":\"passed\",\"all_passed\":true,\"request\":{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"200.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}},\"candidates\":[{\"id\":\"c1\",\"name\":\"简洁杯具与杯垫\",\"description\":\"以日常饮用器具为方向，不涉及具体豆种或食品口味。\",\"estimated_total\":\"150.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\"],\"unknowns\":[\"对方是否已有同类物品\",\"具体饮用偏好\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},{\"id\":\"c2\",\"name\":\"空白便笺与书写笔\",\"description\":\"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\",\"estimated_total\":\"120.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":2,\"tags\":[\"other\"],\"reason\":\"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\",\"fact_refs\":[],\"inferences\":[\"了解不多时，通用用品可能较稳妥，不保证适合对方。\"],\"unknowns\":[\"对方是否使用纸笔\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},{\"id\":\"c3\",\"name\":\"可自主挑选的通用消费额度\",\"description\":\"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\",\"estimated_total\":\"80.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\",\"fact_refs\":[],\"inferences\":[\"自主选择可能更灵活，但额度类礼物也可能显得直接。\"],\"unknowns\":[\"对方对额度类礼物的接受程度\",\"可用范围和有效期\",\"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\"]}],\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"workflow_errors\":[],\"repair_count\":0,\"remaining_repairs\":1,\"selected_candidate_id\":null,\"selectable_candidate_ids\":[\"c1\",\"c2\",\"c3\"],\"business_data_verification\":\"not_verified\",\"report_text\":\"三个方案均通过代码规则检查，请自行选择。\\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\\n已用自动修订次数：0 / 1。\\n\\nc1：简洁杯具与杯垫\\n以日常饮用器具为方向，不涉及具体豆种或食品口味。\\n理由：用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：日常用品可能较便于表达低压力祝福，不保证对方喜欢。\\n未知：对方是否已有同类物品；具体饮用偏好；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\n全量估算：150.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc2：空白便笺与书写笔\\n以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\\n理由：回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\\n用户事实：未提供可引用事实\\n推断：了解不多时，通用用品可能较稳妥，不保证适合对方。\\n未知：对方是否使用纸笔；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\n全量估算：120.00 CNY；准备天数：2\\n代码检查：通过，可选择\\n\\nc3：可自主挑选的通用消费额度\\n以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\\n理由：具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\\n用户事实：未提供可引用事实\\n推断：自主选择可能更灵活，但额度类礼物也可能显得直接。\\n未知：对方对额度类礼物的接受程度；可用范围和有效期；实际价格、库存和交付均未核实；估算含基础呈现及交付费用\\n全量估算：80.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。\"}",
  "status": "passed",
  "all_passed": true,
  "repairable": false,
  "repair_count": 0,
  "report_text": "三个方案均通过代码规则检查，请自行选择。\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\n已用自动修订次数：0 / 1。\n\nc1：简洁杯具与杯垫\n以日常饮用器具为方向，不涉及具体豆种或食品口味。\n理由：用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：日常用品可能较便于表达低压力祝福，不保证对方喜欢。\n未知：对方是否已有同类物品；具体饮用偏好；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\n全量估算：150.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc2：空白便笺与书写笔\n以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\n理由：回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\n用户事实：未提供可引用事实\n推断：了解不多时，通用用品可能较稳妥，不保证适合对方。\n未知：对方是否使用纸笔；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\n全量估算：120.00 CNY；准备天数：2\n代码检查：通过，可选择\n\nc3：可自主挑选的通用消费额度\n以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\n理由：具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\n用户事实：未提供可引用事实\n推断：自主选择可能更灵活，但额度类礼物也可能显得直接。\n未知：对方对额度类礼物的接受程度；可用范围和有效期；实际价格、库存和交付均未核实；估算含基础呈现及交付费用\n全量估算：80.00 CNY；准备天数：1\n代码检查：通过，可选择\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。"
}
```

## End A 未修订输出

- 节点 ID：`1793400000008`　状态：`succeeded`　节点耗时：`6.7e-05 s`　时间戳：`1793365091`

**输入（Dify 服务端回传的节点 inputs）**

```json
{
  "status": "passed",
  "all_passed": true,
  "repair_count": 0,
  "report_json": "{\"status\":\"passed\",\"all_passed\":true,\"request\":{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"200.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}},\"candidates\":[{\"id\":\"c1\",\"name\":\"简洁杯具与杯垫\",\"description\":\"以日常饮用器具为方向，不涉及具体豆种或食品口味。\",\"estimated_total\":\"150.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\"],\"unknowns\":[\"对方是否已有同类物品\",\"具体饮用偏好\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},{\"id\":\"c2\",\"name\":\"空白便笺与书写笔\",\"description\":\"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\",\"estimated_total\":\"120.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":2,\"tags\":[\"other\"],\"reason\":\"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\",\"fact_refs\":[],\"inferences\":[\"了解不多时，通用用品可能较稳妥，不保证适合对方。\"],\"unknowns\":[\"对方是否使用纸笔\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},{\"id\":\"c3\",\"name\":\"可自主挑选的通用消费额度\",\"description\":\"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\",\"estimated_total\":\"80.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\",\"fact_refs\":[],\"inferences\":[\"自主选择可能更灵活，但额度类礼物也可能显得直接。\"],\"unknowns\":[\"对方对额度类礼物的接受程度\",\"可用范围和有效期\",\"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\"]}],\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"workflow_errors\":[],\"repair_count\":0,\"remaining_repairs\":1,\"selected_candidate_id\":null,\"selectable_candidate_ids\":[\"c1\",\"c2\",\"c3\"],\"business_data_verification\":\"not_verified\",\"report_text\":\"三个方案均通过代码规则检查，请自行选择。\\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\\n已用自动修订次数：0 / 1。\\n\\nc1：简洁杯具与杯垫\\n以日常饮用器具为方向，不涉及具体豆种或食品口味。\\n理由：用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：日常用品可能较便于表达低压力祝福，不保证对方喜欢。\\n未知：对方是否已有同类物品；具体饮用偏好；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\n全量估算：150.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc2：空白便笺与书写笔\\n以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\\n理由：回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\\n用户事实：未提供可引用事实\\n推断：了解不多时，通用用品可能较稳妥，不保证适合对方。\\n未知：对方是否使用纸笔；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\n全量估算：120.00 CNY；准备天数：2\\n代码检查：通过，可选择\\n\\nc3：可自主挑选的通用消费额度\\n以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\\n理由：具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\\n用户事实：未提供可引用事实\\n推断：自主选择可能更灵活，但额度类礼物也可能显得直接。\\n未知：对方对额度类礼物的接受程度；可用范围和有效期；实际价格、库存和交付均未核实；估算含基础呈现及交付费用\\n全量估算：80.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。\"}",
  "report_text": "三个方案均通过代码规则检查，请自行选择。\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\n已用自动修订次数：0 / 1。\n\nc1：简洁杯具与杯垫\n以日常饮用器具为方向，不涉及具体豆种或食品口味。\n理由：用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：日常用品可能较便于表达低压力祝福，不保证对方喜欢。\n未知：对方是否已有同类物品；具体饮用偏好；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\n全量估算：150.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc2：空白便笺与书写笔\n以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\n理由：回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\n用户事实：未提供可引用事实\n推断：了解不多时，通用用品可能较稳妥，不保证适合对方。\n未知：对方是否使用纸笔；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\n全量估算：120.00 CNY；准备天数：2\n代码检查：通过，可选择\n\nc3：可自主挑选的通用消费额度\n以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\n理由：具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\n用户事实：未提供可引用事实\n推断：自主选择可能更灵活，但额度类礼物也可能显得直接。\n未知：对方对额度类礼物的接受程度；可用范围和有效期；实际价格、库存和交付均未核实；估算含基础呈现及交付费用\n全量估算：80.00 CNY；准备天数：1\n代码检查：通过，可选择\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。"
}
```

**输出（Dify 服务端回传的节点 outputs）**

```json
{
  "status": "passed",
  "all_passed": true,
  "repair_count": 0,
  "report_json": "{\"status\":\"passed\",\"all_passed\":true,\"request\":{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"200.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}},\"candidates\":[{\"id\":\"c1\",\"name\":\"简洁杯具与杯垫\",\"description\":\"以日常饮用器具为方向，不涉及具体豆种或食品口味。\",\"estimated_total\":\"150.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\"],\"unknowns\":[\"对方是否已有同类物品\",\"具体饮用偏好\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},{\"id\":\"c2\",\"name\":\"空白便笺与书写笔\",\"description\":\"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\",\"estimated_total\":\"120.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":2,\"tags\":[\"other\"],\"reason\":\"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\",\"fact_refs\":[],\"inferences\":[\"了解不多时，通用用品可能较稳妥，不保证适合对方。\"],\"unknowns\":[\"对方是否使用纸笔\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},{\"id\":\"c3\",\"name\":\"可自主挑选的通用消费额度\",\"description\":\"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\",\"estimated_total\":\"80.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\",\"fact_refs\":[],\"inferences\":[\"自主选择可能更灵活，但额度类礼物也可能显得直接。\"],\"unknowns\":[\"对方对额度类礼物的接受程度\",\"可用范围和有效期\",\"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\"]}],\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"workflow_errors\":[],\"repair_count\":0,\"remaining_repairs\":1,\"selected_candidate_id\":null,\"selectable_candidate_ids\":[\"c1\",\"c2\",\"c3\"],\"business_data_verification\":\"not_verified\",\"report_text\":\"三个方案均通过代码规则检查，请自行选择。\\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\\n已用自动修订次数：0 / 1。\\n\\nc1：简洁杯具与杯垫\\n以日常饮用器具为方向，不涉及具体豆种或食品口味。\\n理由：用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：日常用品可能较便于表达低压力祝福，不保证对方喜欢。\\n未知：对方是否已有同类物品；具体饮用偏好；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\n全量估算：150.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc2：空白便笺与书写笔\\n以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\\n理由：回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\\n用户事实：未提供可引用事实\\n推断：了解不多时，通用用品可能较稳妥，不保证适合对方。\\n未知：对方是否使用纸笔；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\n全量估算：120.00 CNY；准备天数：2\\n代码检查：通过，可选择\\n\\nc3：可自主挑选的通用消费额度\\n以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\\n理由：具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\\n用户事实：未提供可引用事实\\n推断：自主选择可能更灵活，但额度类礼物也可能显得直接。\\n未知：对方对额度类礼物的接受程度；可用范围和有效期；实际价格、库存和交付均未核实；估算含基础呈现及交付费用\\n全量估算：80.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。\"}",
  "report_text": "三个方案均通过代码规则检查，请自行选择。\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\n已用自动修订次数：0 / 1。\n\nc1：简洁杯具与杯垫\n以日常饮用器具为方向，不涉及具体豆种或食品口味。\n理由：用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：日常用品可能较便于表达低压力祝福，不保证对方喜欢。\n未知：对方是否已有同类物品；具体饮用偏好；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\n全量估算：150.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc2：空白便笺与书写笔\n以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\n理由：回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\n用户事实：未提供可引用事实\n推断：了解不多时，通用用品可能较稳妥，不保证适合对方。\n未知：对方是否使用纸笔；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\n全量估算：120.00 CNY；准备天数：2\n代码检查：通过，可选择\n\nc3：可自主挑选的通用消费额度\n以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\n理由：具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\n用户事实：未提供可引用事实\n推断：自主选择可能更灵活，但额度类礼物也可能显得直接。\n未知：对方对额度类礼物的接受程度；可用范围和有效期；实际价格、库存和交付均未核实；估算含基础呈现及交付费用\n全量估算：80.00 CNY；准备天数：1\n代码检查：通过，可选择\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。"
}
```

## 工作流级输出（workflow_finished）

```json
{
  "status": "succeeded",
  "outputs": {
    "status": "passed",
    "all_passed": true,
    "repair_count": 0,
    "report_json": "{\"status\":\"passed\",\"all_passed\":true,\"request\":{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"200.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}},\"candidates\":[{\"id\":\"c1\",\"name\":\"简洁杯具与杯垫\",\"description\":\"以日常饮用器具为方向，不涉及具体豆种或食品口味。\",\"estimated_total\":\"150.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"日常用品可能较便于表达低压力祝福，不保证对方喜欢。\"],\"unknowns\":[\"对方是否已有同类物品\",\"具体饮用偏好\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},{\"id\":\"c2\",\"name\":\"空白便笺与书写笔\",\"description\":\"以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\",\"estimated_total\":\"120.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":2,\"tags\":[\"other\"],\"reason\":\"回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\",\"fact_refs\":[],\"inferences\":[\"了解不多时，通用用品可能较稳妥，不保证适合对方。\"],\"unknowns\":[\"对方是否使用纸笔\",\"实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\"]},{\"id\":\"c3\",\"name\":\"可自主挑选的通用消费额度\",\"description\":\"以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\",\"estimated_total\":\"80.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\",\"fact_refs\":[],\"inferences\":[\"自主选择可能更灵活，但额度类礼物也可能显得直接。\"],\"unknowns\":[\"对方对额度类礼物的接受程度\",\"可用范围和有效期\",\"实际价格、库存和交付均未核实；估算含基础呈现及交付费用\"]}],\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"workflow_errors\":[],\"repair_count\":0,\"remaining_repairs\":1,\"selected_candidate_id\":null,\"selectable_candidate_ids\":[\"c1\",\"c2\",\"c3\"],\"business_data_verification\":\"not_verified\",\"report_text\":\"三个方案均通过代码规则检查，请自行选择。\\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\\n已用自动修订次数：0 / 1。\\n\\nc1：简洁杯具与杯垫\\n以日常饮用器具为方向，不涉及具体豆种或食品口味。\\n理由：用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：日常用品可能较便于表达低压力祝福，不保证对方喜欢。\\n未知：对方是否已有同类物品；具体饮用偏好；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\n全量估算：150.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc2：空白便笺与书写笔\\n以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\\n理由：回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\\n用户事实：未提供可引用事实\\n推断：了解不多时，通用用品可能较稳妥，不保证适合对方。\\n未知：对方是否使用纸笔；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\\n全量估算：120.00 CNY；准备天数：2\\n代码检查：通过，可选择\\n\\nc3：可自主挑选的通用消费额度\\n以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\\n理由：具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\\n用户事实：未提供可引用事实\\n推断：自主选择可能更灵活，但额度类礼物也可能显得直接。\\n未知：对方对额度类礼物的接受程度；可用范围和有效期；实际价格、库存和交付均未核实；估算含基础呈现及交付费用\\n全量估算：80.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。\"}",
    "report_text": "三个方案均通过代码规则检查，请自行选择。\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\n已用自动修订次数：0 / 1。\n\nc1：简洁杯具与杯垫\n以日常饮用器具为方向，不涉及具体豆种或食品口味。\n理由：用户确认了咖啡与美食这一宽泛兴趣，杯具是相关但较少依赖口味的方向；未确认对方具体喜欢咖啡或已有器具。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：日常用品可能较便于表达低压力祝福，不保证对方喜欢。\n未知：对方是否已有同类物品；具体饮用偏好；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\n全量估算：150.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc2：空白便笺与书写笔\n以低负担的通用记录用品为方向，不推定其职业或阅读爱好。\n理由：回应送礼者希望实用、精致但不张扬的要求；这是送礼者选择的风格，不是收礼人已确认的偏好。\n用户事实：未提供可引用事实\n推断：了解不多时，通用用品可能较稳妥，不保证适合对方。\n未知：对方是否使用纸笔；实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送\n全量估算：120.00 CNY；准备天数：2\n代码检查：通过，可选择\n\nc3：可自主挑选的通用消费额度\n以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。\n理由：具体兴趣尚不充分时，让对方自主挑选可能降低选错物品的风险；不将用户猜测的设计艺术兴趣当事实。\n用户事实：未提供可引用事实\n推断：自主选择可能更灵活，但额度类礼物也可能显得直接。\n未知：对方对额度类礼物的接受程度；可用范围和有效期；实际价格、库存和交付均未核实；估算含基础呈现及交付费用\n全量估算：80.00 CNY；准备天数：1\n代码检查：通过，可选择\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。"
  },
  "elapsed_time": 0.8881602860055864,
  "total_tokens": 0,
  "error": null,
  "created_at": 1793365091
}
```

