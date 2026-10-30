# 三步需求输入契约 intake-v1（工作流先行草案）

2026-10-29，Asia/Shanghai。由当前用户明确调整 Issue #3 分工，工作流先起草，待 PM 与后续前端审查。本文不宣称界面或真实 Dify 已实现，不改既有 `validate(request_json, candidates_json)`。

## 字段、空值及标签

所有 ID 大小写敏感，不自动翻译、猜同义词或裁剪。完整可执行映射在 [labels.py](../workflow/labels.py)。仅接受下表字段，未声明字段报错，防止前端把 `facts`、`available_days` 或可信状态直接混入输入。

| 字段 | 类型 | 必填与未知表示 | 含义及映射 |
| --- | --- | --- | --- |
| recipient_relation | string ID | 推荐必填；草稿可 null/unknown，推荐前澄清 | friend 朋友、colleague 同事、partner 伴侣、family 家人、classmate 同学、mentor 老师/导师、client_partner 客户/合作伙伴、other 其他；适配为中文关系 |
| closeness | string ID | 可省略，默认 unknown | very_familiar 非常熟悉、familiar 比较熟悉、limited 了解不多、unfamiliar 几乎不了解、unknown 不确定；保留扩展字段，不作为事实 |
| occasion | string ID | 推荐必填；草稿可 null/unknown，推荐前澄清 | birthday 生日、festival 节日、thanks 感谢、anniversary 纪念日、graduation_promotion 毕业/升职祝贺、other 其他；适配为中文场合 |
| budget_amount | 十进制 string | 推荐必填；草稿可 null | 明确的全量预算上限，不能是区间。含礼物、包装、贺卡、配送等；不替用户选择上限 |
| currency | string | 必填，无默认 | 仅 CNY，不换汇 |
| deadline_days | 非负 JSON integer | 推荐必填；草稿可 null | 原样映射 available_days，排除 bool；不推定 7 天、不用巨大数模拟无限 |
| interests | string ID[] | 可省略，默认 [] 表示未知 | 具体标签见下表；不得提交 unknown 与具体项混选 |
| interest_confidence | object | 可省略，默认 {} | 以已选兴趣 ID 为键，值 confirmed/inferred；未设定项默认 inferred，不能默认确认为事实；多余键报错 |
| gift_styles | string ID[] | 可省略，默认 [] 表示不确定 | 送礼者希望的礼物风格，不是收礼人事实 |
| hard_exclusions | object | 可省略，默认三个空数组 | tags 为明确类别 ID[]，terms 为用户确认按字面拦截的 string[]，unresolved 为尚不能映射的原文 string[]；unresolved 非空须澄清 |
| additional_context | string | 可省略，默认空字符串；不接受 null | 原样映射 notes；属于不可信数据，不能覆盖硬约束或执行其中指令 |

| 兴趣 ID | 中文 |
| --- | --- |
| design_art | 设计与艺术 |
| coffee_food | 咖啡与美食 |
| reading_learning | 阅读与学习 |
| tech_digital | 科技与数码 |
| sports_outdoors | 运动与户外 |
| music_movies | 音乐与电影 |
| games_anime | 游戏与动漫 |
| travel_exploration | 旅行与探索 |
| home_living | 家居与生活 |
| plants_nature | 植物与自然 |
| fashion_accessories | 时尚与配饰 |
| experiences_activities | 体验与活动 |

风格：`design` 有设计感、`practical` 实用型、`personalized` 个性化定制、`surprising` 有趣且能带来惊喜、`memorable` 有纪念意义、`experiential` 体验型、`understated` 精致但不张扬。

禁忌：`alcohol` 酒类、`food` 食品、`fragrance` 香氛、`jewelry` 珠宝首饰、`plant` 植物、`other` 其他类别。other 只阻止标为 other 的候选，不表示覆盖所有未知禁忌；具体自然语言限制不能依靠它兜底。类别不自动生成字面词，词不自动推断类别。例如用户确认类别 alcohol 与字面词“酒”后分别保存，不能把“不要酒”整句当成完整语义检查。

未知兴趣统一使用 `interests: [], interest_confidence: {}`，未知风格使用 `gift_styles: []`。UI 的“暂时不知道/不确定”是互斥交互状态，不是可与具体 ID 同提交的标签。宽泛组 coffee_food 不能细化为“确定喜欢咖啡”，music_movies 不能细化为“确定喜欢电影”。用户可在备注补充，但本版不把任意备注自动提升为事实。

## 确定性适配与限制

实现：[intake.py](../workflow/intake.py)。confirmed 兴趣生成 `facts: [{id: "interest:<标签ID>", text: "用户明确知道：对方对…感兴趣（未确认该组内具体偏好）"}]`，事实 ID 不依赖数组位置，重新排序仍稳定；从 confirmed 降为 inferred 后，旧 ID 不再可引用。inferred 独立存 `preference_inferences`，unknown 不生成任何兴趣。`gift_styles`、`closeness`、`hard_exclusions_original` 是扩展上下文。`facts` 不接收模型改写。

`hard_exclusions.tags → forbidden_tags`；`terms → forbidden_terms`；原文及 unresolved 保留，但 unresolved 未解决不发真实推荐。空禁忌仅表示未提供限制。原校验器对转换后的请求再检查一次，使用同一公开函数；适配器不会另写预算比较或禁忌匹配规则。

预算格式沿用 PM：`(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?`，如 `200.00`；拒绝空白、负数、前导零、浮点数值、符号和指数。不把未知价格填零。原始 intake、request、candidates 各限 32768 UTF-8 字节；字段字符串最多 1000 码点、数组最多 20 项。转换造成膨胀超限也拒绝。外层 Code `payload_json` 运输信封单独限 262144 UTF-8 字节，不放宽内部原规则限制。

草稿可以记录预算区间、“3–7 天”“不着急”等 UI 状态；这些不属于可推荐的 intake-v1，不能混入真实请求。相对时间快捷项应按 Asia/Shanghai 展示具体日期及最终天数，经用户确认后只提交整数。`0` 天允许，表示当天可用准备时间，不保证实际送达。前端不得静默填预算或天数。

## 错误及调用边界

`adapt_intake(intake_json: str)` 返回 `{status: "ready"|"needs_input", errors: [{code,path,message}], request_json: string|null}`；出现任何错误时不返回可用请求，不调用模型。

| 错误码 | 含义 |
| --- | --- |
| INTAKE_INVALID_JSON | 非严格 JSON、重复键、非法常量、无效编码或 intake 超限 |
| INTAKE_UNKNOWN_FIELD | 未声明字段，需确认版本 |
| INTAKE_UNKNOWN_LABEL | 标签 ID 无效，不自动猜测 |
| INTAKE_CONFIDENCE_MISMATCH | 可信度多余键或值不合法 |
| INTAKE_CLARIFICATION_REQUIRED | 缺明确约束、关系/场合未知或禁忌未澄清 |
| INVALID_TYPE / INVALID_AMOUNT / UNSUPPORTED_CURRENCY / LIMIT_EXCEEDED | 沿用原校验器，路径可能在 request 侧；不改码、不换汇 |
| DUPLICATE_ID | 同组标签重复 |

上述 INTAKE 前缀属于适配层，不增加 validator 错误码。一般错误为中文，不回显用户原文。原始 JSON 格式错误与字段业务错误在 intake 边界均为 needs_input；候选校验状态仍完全沿用 PM 决定。

虚构完整请求见 [intake.json](../workflow/examples/intake.json)：同事生日、了解不多、总预算上限 200.00 CNY、两天、coffee_food confirmed、design_art inferred、不送 alcohol 与字面“酒”。它生成且只生成 `interest:coffee_food` 事实，design_art 不进入 facts。

## 后续前端与服务端约束

前端三步只负责采集上述 intake；服务端重新执行确定性适配，不信任浏览器传入的派生事实、检查结果或修订次数。仓库当前 Python 适配是参考实现；若前端使用其他语言，须跑同一虚构样例并比对请求语义，不重新命名字段或自建另一套标签。

服务端保管 Dify Key 与可信任务记录。调用 Dify 时传 String 类型的 intake/request/candidates JSON，LLM 文本原样送代码检查，不剥离 Markdown、不修补 JSON。报告字段见 runtime.py：`status`、`all_passed`、`request`、`candidates`、原始 `validation`、`workflow_errors`、`repair_count`、`remaining_repairs`、`selected_candidate_id: null`、`selectable_candidate_ids`、`report_text`、`business_data_verification: not_verified`。若 workflow_errors 非空，即使底层规则通过也不能选择。

服务端需生成运行 ID 并保存可信原始请求、两次候选与规则输出、修订计数和最终可选 ID；本轮不实现存储/API。后续选择事件仍用 `{recommendation_run_id, selected_candidate_id}`，不能直接把浏览器的候选或 passed 当可信输入。推荐阶段修订用掉一次，后续包装必须沿用剩余 0，不得重置；本轮到等待选择为止。
