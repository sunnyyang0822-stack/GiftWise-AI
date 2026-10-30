# 节点级输入输出原文（真实模型调用） · real2_budget_1_repair

- 发起时间（UTC）：`2026-10-30T13:17:04.350Z`
- HTTP：`200`　端到端：`5771 ms`
- 预期：N2 真实生成超预算 → N4[repairable] → N5 真实修订 → N6 → N7b → End B

> 数据来源：`POST /console/api/apps/5abdb13c-a633-4a9c-96c3-dabd44072511/workflows/draft/run` 的 SSE 原文。
> N2 / N5 为真实 LLM 节点（provider `langgenius/deepseek/deepseek`，model `deepseek-v4-flash`，
> `thinking=false`、`response_format=json_object`、`max_tokens=16384`、`temperature=0.2`）。

## 用户输入

- 节点 ID：`1793273634593`　状态：`succeeded`　耗时：`8.1e-05 s`　服务端时间戳：`1793366222`

**输入**

```json
{
  "intake_json": "{\n  \"recipient_relation\": \"pursuit\",\n  \"closeness\": \"limited\",\n  \"occasion\": \"birthday\",\n  \"budget_amount\": \"1.00\",\n  \"currency\": \"CNY\",\n  \"deadline_days\": 2,\n  \"interests\": [\n    \"coffee_food\",\n    \"design_art\"\n  ],\n  \"interest_confidence\": {\n    \"coffee_food\": \"confirmed\",\n    \"design_art\": \"inferred\"\n  },\n  \"gift_styles\": [\n    \"practical\",\n    \"understated\"\n  ],\n  \"hard_exclusions\": {\n    \"tags\": [\n      \"alcohol\"\n    ],\n    \"terms\": [\n      \"酒\"\n    ],\n    \"unresolved\": []\n  },\n  \"additional_context\": \"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\"\n}",
  "trusted_repair_count": 0
}
```

**输出**

```json
{
  "intake_json": "{\n  \"recipient_relation\": \"pursuit\",\n  \"closeness\": \"limited\",\n  \"occasion\": \"birthday\",\n  \"budget_amount\": \"1.00\",\n  \"currency\": \"CNY\",\n  \"deadline_days\": 2,\n  \"interests\": [\n    \"coffee_food\",\n    \"design_art\"\n  ],\n  \"interest_confidence\": {\n    \"coffee_food\": \"confirmed\",\n    \"design_art\": \"inferred\"\n  },\n  \"gift_styles\": [\n    \"practical\",\n    \"understated\"\n  ],\n  \"hard_exclusions\": {\n    \"tags\": [\n      \"alcohol\"\n    ],\n    \"terms\": [\n      \"酒\"\n    ],\n    \"unresolved\": []\n  },\n  \"additional_context\": \"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\"\n}",
  "trusted_repair_count": 0
}
```

## N1 用户输入与确定性适配

- 节点 ID：`1793357958534`　状态：`succeeded`　耗时：`0.114536 s`　服务端时间戳：`1793366222`

**输入**

```json
{
  "intake_json": "{\n  \"recipient_relation\": \"pursuit\",\n  \"closeness\": \"limited\",\n  \"occasion\": \"birthday\",\n  \"budget_amount\": \"1.00\",\n  \"currency\": \"CNY\",\n  \"deadline_days\": 2,\n  \"interests\": [\n    \"coffee_food\",\n    \"design_art\"\n  ],\n  \"interest_confidence\": {\n    \"coffee_food\": \"confirmed\",\n    \"design_art\": \"inferred\"\n  },\n  \"gift_styles\": [\n    \"practical\",\n    \"understated\"\n  ],\n  \"hard_exclusions\": {\n    \"tags\": [\n      \"alcohol\"\n    ],\n    \"terms\": [\n      \"酒\"\n    ],\n    \"unresolved\": []\n  },\n  \"additional_context\": \"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\"\n}"
}
```

**输出**

```json
{
  "request_json": "{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"1.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}}",
  "errors_json": "[]",
  "status": "ready"
}
```

## N2 需求分析与三候选（真实 LLM）

- 节点 ID：`1793400000001`　状态：`succeeded`　耗时：`4.48922 s`　服务端时间戳：`1793366223`

**输入**

```json
{
  "#1793357958534.request_json#": "{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"1.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}}",
  "model_provider": "langgenius/deepseek/deepseek",
  "model_name": "deepseek-v4-flash"
}
```

**输出**

```json
{
  "text": "{\"candidates\":[{\"id\":\"c1\",\"name\":\"挂耳咖啡小样组合\",\"description\":\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能愿意尝试不同风味的咖啡小样\"],\"unknowns\":[\"对方对咖啡因的接受程度\",\"具体口味偏好\",\"可购买渠道与库存\"]},{\"id\":\"c2\",\"name\":\"手写生日祝福卡配小份点心\",\"description\":\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能接受小份独立包装的点心\"],\"unknowns\":[\"对方是否有饮食限制或过敏\",\"具体口味偏好\",\"配送费用与时效\"]},{\"id\":\"c3\",\"name\":\"简约桌面小摆件\",\"description\":\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\",\"fact_refs\":[],\"inferences\":[\"对方可能欣赏简洁风格的桌面小物\"],\"unknowns\":[\"对方对桌面摆件的实际喜好\",\"房间或办公桌风格\",\"可购买渠道与库存\"]}]}",
  "reasoning_content": "",
  "usage": {
    "completion_price": "0",
    "completion_price_unit": "0",
    "completion_tokens": 498,
    "completion_unit_price": "0",
    "currency": "USD",
    "latency": 4.486,
    "prompt_price": "0",
    "prompt_price_unit": "0",
    "prompt_tokens": 915,
    "prompt_unit_price": "0",
    "time_to_first_token": 1.255,
    "time_to_generate": 3.231,
    "total_price": "0",
    "total_tokens": 1413
  },
  "finish_reason": "stop"
}
```

## N3 Code 首次校验

- 节点 ID：`1793400000002`　状态：`succeeded`　耗时：`0.100474 s`　服务端时间戳：`1793366227`

**输入**

```json
{
  "request_json": "{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"1.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}}",
  "candidates_json": "{\"candidates\":[{\"id\":\"c1\",\"name\":\"挂耳咖啡小样组合\",\"description\":\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能愿意尝试不同风味的咖啡小样\"],\"unknowns\":[\"对方对咖啡因的接受程度\",\"具体口味偏好\",\"可购买渠道与库存\"]},{\"id\":\"c2\",\"name\":\"手写生日祝福卡配小份点心\",\"description\":\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能接受小份独立包装的点心\"],\"unknowns\":[\"对方是否有饮食限制或过敏\",\"具体口味偏好\",\"配送费用与时效\"]},{\"id\":\"c3\",\"name\":\"简约桌面小摆件\",\"description\":\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\",\"fact_refs\":[],\"inferences\":[\"对方可能欣赏简洁风格的桌面小物\"],\"unknowns\":[\"对方对桌面摆件的实际喜好\",\"房间或办公桌风格\",\"可购买渠道与库存\"]}]}",
  "repair_count": 0
}
```

**输出**

```json
{
  "envelope_json": "{\"request_json\":\"{\\\"recipient_relation\\\":\\\"追求对象\\\",\\\"recipient_relation_id\\\":\\\"pursuit\\\",\\\"occasion\\\":\\\"生日\\\",\\\"budget_amount\\\":\\\"1.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"available_days\\\":2,\\\"facts\\\":[{\\\"id\\\":\\\"interest:coffee_food\\\",\\\"text\\\":\\\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\\"}],\\\"forbidden_tags\\\":[\\\"alcohol\\\"],\\\"forbidden_terms\\\":[\\\"酒\\\"],\\\"notes\\\":\\\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\\\",\\\"closeness\\\":\\\"limited\\\",\\\"preference_inferences\\\":[{\\\"interest_id\\\":\\\"design_art\\\",\\\"text\\\":\\\"用户猜测：对方可能对“设计与艺术”感兴趣\\\"}],\\\"gift_styles\\\":[\\\"practical\\\",\\\"understated\\\"],\\\"hard_exclusions_original\\\":{\\\"tags\\\":[\\\"alcohol\\\"],\\\"terms\\\":[\\\"酒\\\"],\\\"unresolved\\\":[]}}\",\"candidates_json\":\"{\\\"candidates\\\":[{\\\"id\\\":\\\"c1\\\",\\\"name\\\":\\\"挂耳咖啡小样组合\\\",\\\"description\\\":\\\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\\\",\\\"estimated_total\\\":\\\"1.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"estimated_preparation_days\\\":1,\\\"tags\\\":[\\\"food\\\"],\\\"reason\\\":\\\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\\\",\\\"fact_refs\\\":[\\\"interest:coffee_food\\\"],\\\"inferences\\\":[\\\"对方可能愿意尝试不同风味的咖啡小样\\\"],\\\"unknowns\\\":[\\\"对方对咖啡因的接受程度\\\",\\\"具体口味偏好\\\",\\\"可购买渠道与库存\\\"]},{\\\"id\\\":\\\"c2\\\",\\\"name\\\":\\\"手写生日祝福卡配小份点心\\\",\\\"description\\\":\\\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\\\",\\\"estimated_total\\\":\\\"1.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"estimated_preparation_days\\\":1,\\\"tags\\\":[\\\"food\\\"],\\\"reason\\\":\\\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\\\",\\\"fact_refs\\\":[\\\"interest:coffee_food\\\"],\\\"inferences\\\":[\\\"对方可能接受小份独立包装的点心\\\"],\\\"unknowns\\\":[\\\"对方是否有饮食限制或过敏\\\",\\\"具体口味偏好\\\",\\\"配送费用与时效\\\"]},{\\\"id\\\":\\\"c3\\\",\\\"name\\\":\\\"简约桌面小摆件\\\",\\\"description\\\":\\\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\\\",\\\"estimated_total\\\":\\\"1.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"estimated_preparation_days\\\":1,\\\"tags\\\":[\\\"other\\\"],\\\"reason\\\":\\\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\\\",\\\"fact_refs\\\":[],\\\"inferences\\\":[\\\"对方可能欣赏简洁风格的桌面小物\\\"],\\\"unknowns\\\":[\\\"对方对桌面摆件的实际喜好\\\",\\\"房间或办公桌风格\\\",\\\"可购买渠道与库存\\\"]}]}\",\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"repair_count\":0,\"repairable\":false,\"workflow_errors\":[]}",
  "status": "passed",
  "all_passed": true,
  "repairable": false,
  "repair_count": 0,
  "validation_json": "{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"}",
  "preserved_candidates_json": "{\"c1\":{\"id\":\"c1\",\"name\":\"挂耳咖啡小样组合\",\"description\":\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能愿意尝试不同风味的咖啡小样\"],\"unknowns\":[\"对方对咖啡因的接受程度\",\"具体口味偏好\",\"可购买渠道与库存\"]},\"c2\":{\"id\":\"c2\",\"name\":\"手写生日祝福卡配小份点心\",\"description\":\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能接受小份独立包装的点心\"],\"unknowns\":[\"对方是否有饮食限制或过敏\",\"具体口味偏好\",\"配送费用与时效\"]},\"c3\":{\"id\":\"c3\",\"name\":\"简约桌面小摆件\",\"description\":\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\",\"fact_refs\":[],\"inferences\":[\"对方可能欣赏简洁风格的桌面小物\"],\"unknowns\":[\"对方对桌面摆件的实际喜好\",\"房间或办公桌风格\",\"可购买渠道与库存\"]}}"
}
```

## N4 校验结果分支

- 节点 ID：`1793400000003`　状态：`succeeded`　耗时：`0.000129 s`　服务端时间戳：`1793366227`

**输入**

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

**输出**

```json
{
  "result": true,
  "selected_case_id": "true"
}
```

## N7a 未修订报告

- 节点 ID：`1793400000006`　状态：`succeeded`　耗时：`0.131984 s`　服务端时间戳：`1793366227`

**输入**

```json
{
  "state_json": "{\"request_json\":\"{\\\"recipient_relation\\\":\\\"追求对象\\\",\\\"recipient_relation_id\\\":\\\"pursuit\\\",\\\"occasion\\\":\\\"生日\\\",\\\"budget_amount\\\":\\\"1.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"available_days\\\":2,\\\"facts\\\":[{\\\"id\\\":\\\"interest:coffee_food\\\",\\\"text\\\":\\\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\\"}],\\\"forbidden_tags\\\":[\\\"alcohol\\\"],\\\"forbidden_terms\\\":[\\\"酒\\\"],\\\"notes\\\":\\\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\\\",\\\"closeness\\\":\\\"limited\\\",\\\"preference_inferences\\\":[{\\\"interest_id\\\":\\\"design_art\\\",\\\"text\\\":\\\"用户猜测：对方可能对“设计与艺术”感兴趣\\\"}],\\\"gift_styles\\\":[\\\"practical\\\",\\\"understated\\\"],\\\"hard_exclusions_original\\\":{\\\"tags\\\":[\\\"alcohol\\\"],\\\"terms\\\":[\\\"酒\\\"],\\\"unresolved\\\":[]}}\",\"candidates_json\":\"{\\\"candidates\\\":[{\\\"id\\\":\\\"c1\\\",\\\"name\\\":\\\"挂耳咖啡小样组合\\\",\\\"description\\\":\\\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\\\",\\\"estimated_total\\\":\\\"1.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"estimated_preparation_days\\\":1,\\\"tags\\\":[\\\"food\\\"],\\\"reason\\\":\\\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\\\",\\\"fact_refs\\\":[\\\"interest:coffee_food\\\"],\\\"inferences\\\":[\\\"对方可能愿意尝试不同风味的咖啡小样\\\"],\\\"unknowns\\\":[\\\"对方对咖啡因的接受程度\\\",\\\"具体口味偏好\\\",\\\"可购买渠道与库存\\\"]},{\\\"id\\\":\\\"c2\\\",\\\"name\\\":\\\"手写生日祝福卡配小份点心\\\",\\\"description\\\":\\\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\\\",\\\"estimated_total\\\":\\\"1.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"estimated_preparation_days\\\":1,\\\"tags\\\":[\\\"food\\\"],\\\"reason\\\":\\\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\\\",\\\"fact_refs\\\":[\\\"interest:coffee_food\\\"],\\\"inferences\\\":[\\\"对方可能接受小份独立包装的点心\\\"],\\\"unknowns\\\":[\\\"对方是否有饮食限制或过敏\\\",\\\"具体口味偏好\\\",\\\"配送费用与时效\\\"]},{\\\"id\\\":\\\"c3\\\",\\\"name\\\":\\\"简约桌面小摆件\\\",\\\"description\\\":\\\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\\\",\\\"estimated_total\\\":\\\"1.00\\\",\\\"currency\\\":\\\"CNY\\\",\\\"estimated_preparation_days\\\":1,\\\"tags\\\":[\\\"other\\\"],\\\"reason\\\":\\\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\\\",\\\"fact_refs\\\":[],\\\"inferences\\\":[\\\"对方可能欣赏简洁风格的桌面小物\\\"],\\\"unknowns\\\":[\\\"对方对桌面摆件的实际喜好\\\",\\\"房间或办公桌风格\\\",\\\"可购买渠道与库存\\\"]}]}\",\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"repair_count\":0,\"repairable\":false,\"workflow_errors\":[]}"
}
```

**输出**

```json
{
  "envelope_json": "{\"status\":\"passed\",\"all_passed\":true,\"request\":{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"1.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}},\"candidates\":[{\"id\":\"c1\",\"name\":\"挂耳咖啡小样组合\",\"description\":\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能愿意尝试不同风味的咖啡小样\"],\"unknowns\":[\"对方对咖啡因的接受程度\",\"具体口味偏好\",\"可购买渠道与库存\"]},{\"id\":\"c2\",\"name\":\"手写生日祝福卡配小份点心\",\"description\":\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能接受小份独立包装的点心\"],\"unknowns\":[\"对方是否有饮食限制或过敏\",\"具体口味偏好\",\"配送费用与时效\"]},{\"id\":\"c3\",\"name\":\"简约桌面小摆件\",\"description\":\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\",\"fact_refs\":[],\"inferences\":[\"对方可能欣赏简洁风格的桌面小物\"],\"unknowns\":[\"对方对桌面摆件的实际喜好\",\"房间或办公桌风格\",\"可购买渠道与库存\"]}],\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"workflow_errors\":[],\"repair_count\":0,\"remaining_repairs\":1,\"selected_candidate_id\":null,\"selectable_candidate_ids\":[\"c1\",\"c2\",\"c3\"],\"business_data_verification\":\"not_verified\",\"report_text\":\"三个方案均通过代码规则检查，请自行选择。\\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\\n已用自动修订次数：0 / 1。\\n\\nc1：挂耳咖啡小样组合\\n选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\\n理由：对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：对方可能愿意尝试不同风味的咖啡小样\\n未知：对方对咖啡因的接受程度；具体口味偏好；可购买渠道与库存\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc2：手写生日祝福卡配小份点心\\n以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\\n理由：在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：对方可能接受小份独立包装的点心\\n未知：对方是否有饮食限制或过敏；具体口味偏好；配送费用与时效\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc3：简约桌面小摆件\\n选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\\n理由：用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\\n用户事实：未提供可引用事实\\n推断：对方可能欣赏简洁风格的桌面小物\\n未知：对方对桌面摆件的实际喜好；房间或办公桌风格；可购买渠道与库存\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。\"}",
  "status": "passed",
  "all_passed": true,
  "repairable": false,
  "repair_count": 0,
  "report_text": "三个方案均通过代码规则检查，请自行选择。\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\n已用自动修订次数：0 / 1。\n\nc1：挂耳咖啡小样组合\n选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\n理由：对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：对方可能愿意尝试不同风味的咖啡小样\n未知：对方对咖啡因的接受程度；具体口味偏好；可购买渠道与库存\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc2：手写生日祝福卡配小份点心\n以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\n理由：在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：对方可能接受小份独立包装的点心\n未知：对方是否有饮食限制或过敏；具体口味偏好；配送费用与时效\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc3：简约桌面小摆件\n选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\n理由：用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\n用户事实：未提供可引用事实\n推断：对方可能欣赏简洁风格的桌面小物\n未知：对方对桌面摆件的实际喜好；房间或办公桌风格；可购买渠道与库存\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。"
}
```

## End A 未修订输出

- 节点 ID：`1793400000008`　状态：`succeeded`　耗时：`6.9e-05 s`　服务端时间戳：`1793366227`

**输入**

```json
{
  "status": "passed",
  "all_passed": true,
  "repair_count": 0,
  "report_json": "{\"status\":\"passed\",\"all_passed\":true,\"request\":{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"1.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}},\"candidates\":[{\"id\":\"c1\",\"name\":\"挂耳咖啡小样组合\",\"description\":\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能愿意尝试不同风味的咖啡小样\"],\"unknowns\":[\"对方对咖啡因的接受程度\",\"具体口味偏好\",\"可购买渠道与库存\"]},{\"id\":\"c2\",\"name\":\"手写生日祝福卡配小份点心\",\"description\":\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能接受小份独立包装的点心\"],\"unknowns\":[\"对方是否有饮食限制或过敏\",\"具体口味偏好\",\"配送费用与时效\"]},{\"id\":\"c3\",\"name\":\"简约桌面小摆件\",\"description\":\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\",\"fact_refs\":[],\"inferences\":[\"对方可能欣赏简洁风格的桌面小物\"],\"unknowns\":[\"对方对桌面摆件的实际喜好\",\"房间或办公桌风格\",\"可购买渠道与库存\"]}],\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"workflow_errors\":[],\"repair_count\":0,\"remaining_repairs\":1,\"selected_candidate_id\":null,\"selectable_candidate_ids\":[\"c1\",\"c2\",\"c3\"],\"business_data_verification\":\"not_verified\",\"report_text\":\"三个方案均通过代码规则检查，请自行选择。\\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\\n已用自动修订次数：0 / 1。\\n\\nc1：挂耳咖啡小样组合\\n选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\\n理由：对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：对方可能愿意尝试不同风味的咖啡小样\\n未知：对方对咖啡因的接受程度；具体口味偏好；可购买渠道与库存\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc2：手写生日祝福卡配小份点心\\n以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\\n理由：在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：对方可能接受小份独立包装的点心\\n未知：对方是否有饮食限制或过敏；具体口味偏好；配送费用与时效\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc3：简约桌面小摆件\\n选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\\n理由：用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\\n用户事实：未提供可引用事实\\n推断：对方可能欣赏简洁风格的桌面小物\\n未知：对方对桌面摆件的实际喜好；房间或办公桌风格；可购买渠道与库存\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。\"}",
  "report_text": "三个方案均通过代码规则检查，请自行选择。\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\n已用自动修订次数：0 / 1。\n\nc1：挂耳咖啡小样组合\n选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\n理由：对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：对方可能愿意尝试不同风味的咖啡小样\n未知：对方对咖啡因的接受程度；具体口味偏好；可购买渠道与库存\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc2：手写生日祝福卡配小份点心\n以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\n理由：在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：对方可能接受小份独立包装的点心\n未知：对方是否有饮食限制或过敏；具体口味偏好；配送费用与时效\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc3：简约桌面小摆件\n选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\n理由：用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\n用户事实：未提供可引用事实\n推断：对方可能欣赏简洁风格的桌面小物\n未知：对方对桌面摆件的实际喜好；房间或办公桌风格；可购买渠道与库存\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。"
}
```

**输出**

```json
{
  "status": "passed",
  "all_passed": true,
  "repair_count": 0,
  "report_json": "{\"status\":\"passed\",\"all_passed\":true,\"request\":{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"1.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}},\"candidates\":[{\"id\":\"c1\",\"name\":\"挂耳咖啡小样组合\",\"description\":\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能愿意尝试不同风味的咖啡小样\"],\"unknowns\":[\"对方对咖啡因的接受程度\",\"具体口味偏好\",\"可购买渠道与库存\"]},{\"id\":\"c2\",\"name\":\"手写生日祝福卡配小份点心\",\"description\":\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能接受小份独立包装的点心\"],\"unknowns\":[\"对方是否有饮食限制或过敏\",\"具体口味偏好\",\"配送费用与时效\"]},{\"id\":\"c3\",\"name\":\"简约桌面小摆件\",\"description\":\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\",\"fact_refs\":[],\"inferences\":[\"对方可能欣赏简洁风格的桌面小物\"],\"unknowns\":[\"对方对桌面摆件的实际喜好\",\"房间或办公桌风格\",\"可购买渠道与库存\"]}],\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"workflow_errors\":[],\"repair_count\":0,\"remaining_repairs\":1,\"selected_candidate_id\":null,\"selectable_candidate_ids\":[\"c1\",\"c2\",\"c3\"],\"business_data_verification\":\"not_verified\",\"report_text\":\"三个方案均通过代码规则检查，请自行选择。\\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\\n已用自动修订次数：0 / 1。\\n\\nc1：挂耳咖啡小样组合\\n选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\\n理由：对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：对方可能愿意尝试不同风味的咖啡小样\\n未知：对方对咖啡因的接受程度；具体口味偏好；可购买渠道与库存\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc2：手写生日祝福卡配小份点心\\n以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\\n理由：在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：对方可能接受小份独立包装的点心\\n未知：对方是否有饮食限制或过敏；具体口味偏好；配送费用与时效\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc3：简约桌面小摆件\\n选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\\n理由：用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\\n用户事实：未提供可引用事实\\n推断：对方可能欣赏简洁风格的桌面小物\\n未知：对方对桌面摆件的实际喜好；房间或办公桌风格；可购买渠道与库存\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。\"}",
  "report_text": "三个方案均通过代码规则检查，请自行选择。\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\n已用自动修订次数：0 / 1。\n\nc1：挂耳咖啡小样组合\n选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\n理由：对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：对方可能愿意尝试不同风味的咖啡小样\n未知：对方对咖啡因的接受程度；具体口味偏好；可购买渠道与库存\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc2：手写生日祝福卡配小份点心\n以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\n理由：在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：对方可能接受小份独立包装的点心\n未知：对方是否有饮食限制或过敏；具体口味偏好；配送费用与时效\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc3：简约桌面小摆件\n选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\n理由：用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\n用户事实：未提供可引用事实\n推断：对方可能欣赏简洁风格的桌面小物\n未知：对方对桌面摆件的实际喜好；房间或办公桌风格；可购买渠道与库存\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。"
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
    "report_json": "{\"status\":\"passed\",\"all_passed\":true,\"request\":{\"recipient_relation\":\"追求对象\",\"recipient_relation_id\":\"pursuit\",\"occasion\":\"生日\",\"budget_amount\":\"1.00\",\"currency\":\"CNY\",\"available_days\":2,\"facts\":[{\"id\":\"interest:coffee_food\",\"text\":\"用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\"}],\"forbidden_tags\":[\"alcohol\"],\"forbidden_terms\":[\"酒\"],\"notes\":\"完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。\",\"closeness\":\"limited\",\"preference_inferences\":[{\"interest_id\":\"design_art\",\"text\":\"用户猜测：对方可能对“设计与艺术”感兴趣\"}],\"gift_styles\":[\"practical\",\"understated\"],\"hard_exclusions_original\":{\"tags\":[\"alcohol\"],\"terms\":[\"酒\"],\"unresolved\":[]}},\"candidates\":[{\"id\":\"c1\",\"name\":\"挂耳咖啡小样组合\",\"description\":\"选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能愿意尝试不同风味的咖啡小样\"],\"unknowns\":[\"对方对咖啡因的接受程度\",\"具体口味偏好\",\"可购买渠道与库存\"]},{\"id\":\"c2\",\"name\":\"手写生日祝福卡配小份点心\",\"description\":\"以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"food\"],\"reason\":\"在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\",\"fact_refs\":[\"interest:coffee_food\"],\"inferences\":[\"对方可能接受小份独立包装的点心\"],\"unknowns\":[\"对方是否有饮食限制或过敏\",\"具体口味偏好\",\"配送费用与时效\"]},{\"id\":\"c3\",\"name\":\"简约桌面小摆件\",\"description\":\"选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\",\"estimated_total\":\"1.00\",\"currency\":\"CNY\",\"estimated_preparation_days\":1,\"tags\":[\"other\"],\"reason\":\"用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\",\"fact_refs\":[],\"inferences\":[\"对方可能欣赏简洁风格的桌面小物\"],\"unknowns\":[\"对方对桌面摆件的实际喜好\",\"房间或办公桌风格\",\"可购买渠道与库存\"]}],\"validation\":{\"status\":\"passed\",\"all_passed\":true,\"errors\":[],\"candidate_results\":[{\"id\":\"c1\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c2\",\"passed\":true,\"errors\":[],\"warnings\":[]},{\"id\":\"c3\",\"passed\":true,\"errors\":[],\"warnings\":[]}],\"business_data_verification\":\"not_verified\"},\"workflow_errors\":[],\"repair_count\":0,\"remaining_repairs\":1,\"selected_candidate_id\":null,\"selectable_candidate_ids\":[\"c1\",\"c2\",\"c3\"],\"business_data_verification\":\"not_verified\",\"report_text\":\"三个方案均通过代码规则检查，请自行选择。\\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\\n已用自动修订次数：0 / 1。\\n\\nc1：挂耳咖啡小样组合\\n选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\\n理由：对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：对方可能愿意尝试不同风味的咖啡小样\\n未知：对方对咖啡因的接受程度；具体口味偏好；可购买渠道与库存\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc2：手写生日祝福卡配小份点心\\n以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\\n理由：在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\\n推断：对方可能接受小份独立包装的点心\\n未知：对方是否有饮食限制或过敏；具体口味偏好；配送费用与时效\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n\\nc3：简约桌面小摆件\\n选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\\n理由：用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\\n用户事实：未提供可引用事实\\n推断：对方可能欣赏简洁风格的桌面小物\\n未知：对方对桌面摆件的实际喜好；房间或办公桌风格；可购买渠道与库存\\n全量估算：1.00 CNY；准备天数：1\\n代码检查：通过，可选择\\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。\"}",
    "report_text": "三个方案均通过代码规则检查，请自行选择。\n费用与准备时间仅为估算；未核实真实价格、库存或实际送达。\n已用自动修订次数：0 / 1。\n\nc1：挂耳咖啡小样组合\n选几款不同风味的挂耳咖啡小样，配一张简洁贺卡，用普通快递寄出。整体轻便，适合在有限预算内表达生日祝福。\n理由：对方对咖啡与美食有兴趣，但具体偏好未确认，因此选择小份、可尝试的组合，避免押注单一风味；这是基于已知兴趣的推断，不保证对方喜欢。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：对方可能愿意尝试不同风味的咖啡小样\n未知：对方对咖啡因的接受程度；具体口味偏好；可购买渠道与库存\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc2：手写生日祝福卡配小份点心\n以一张手写生日祝福卡为主，搭配一份独立包装的小点心，控制分量与包装复杂度，方便快速准备。\n理由：在关系尚有限、预算很低的情况下，以祝福卡为主、点心为辅，关系压力较低；点心方向仅来自“咖啡与美食”的宽泛兴趣，属于推断，不保证合口味。\n用户事实：interest:coffee_food＝用户明确知道：对方对“咖啡与美食”感兴趣（未确认该组内具体偏好）\n推断：对方可能接受小份独立包装的点心\n未知：对方是否有饮食限制或过敏；具体口味偏好；配送费用与时效\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n\nc3：简约桌面小摆件\n选一件造型简洁、体积小的桌面摆件，配基础包装与简短生日贺卡，作为低压力的生日心意。\n理由：用户猜测对方可能对设计与艺术感兴趣，因此选择风格克制的桌面小物；该方向来自待确认猜测，仅作尝试，不保证对方喜欢。\n用户事实：未提供可引用事实\n推断：对方可能欣赏简洁风格的桌面小物\n未知：对方对桌面摆件的实际喜好；房间或办公桌风格；可购买渠道与库存\n全量估算：1.00 CNY；准备天数：1\n代码检查：通过，可选择\n等待你选择合格方案；选择后才进入详细包装与贺卡阶段。"
  },
  "elapsed_time": 5.2075010110856965,
  "total_tokens": 1413,
  "error": null,
  "created_at": 1793366222
}
```
