# 三步需求输入契约 intake-v1（工作流先行草案）

2026-10-29，Asia/Shanghai。由当前用户明确调整 Issue #3 分工，工作流先起草，待 PM 与后续前端审查。本文不宣称界面或真实 Dify 已实现，不改既有 `validate(request_json, candidates_json)`。

> **2026-10-30 契约更新（DEC-1／DEC-1b／DEC-2／DEC-3，产品负责人已拍板）**：关系枚举新增独立值 `pursuit`（追求对象），与 `partner` 并列互斥，`partner` 中文统一为“恋人”，`colleague` 标注“仅技术回归”；兴趣“未知”明确为 `interests: []` + `interest_confidence: {}`，不引入 `unknown` 机器值；`request` 新增服务端产出的 `recipient_relation_id`。决定依据见 [阶段 4/5 契约决策](./pm-reviews/contract-decisions-draft-2026-10-30.md)。

> **2026-10-30 独立契约复核（Issue #6 CONTRACT-001）**：本文已与 `workflow/intake.py`、`validator/rules.py`、`workflow/runtime.py` 逐字段、逐错误码、逐边界对账，以代码为唯一事实源。结论、差集与待裁决项见文末[独立契约复核](#contract-001-独立契约复核2026-10-30)。本轮**只改文档**；复核发现的代码侧差异按文件线单独上报，未在本轮修改 `workflow/` 或 `validator/`。

## 字段、空值及标签

所有 ID 大小写敏感，不自动翻译、猜同义词或裁剪。完整可执行映射在 [labels.py](../workflow/labels.py)。仅接受下表字段，未声明字段报错，防止前端把 `facts`、`available_days` 或可信状态直接混入输入。

| 字段 | 类型 | 必填与未知表示 | 含义及映射 |
| --- | --- | --- | --- |
| recipient_relation | string ID | 推荐必填；草稿可 null/unknown，推荐前澄清 | 产品面**冻结 8 个稳定 ID**：`partner` 恋人、`pursuit` 追求对象、`friend` 朋友、`family` 家人、`classmate` 同学、`mentor` 老师/导师、`client_partner` 客户/合作伙伴、`other` 其他。`pursuit` 与 `partner` **并列互斥**，不得合并，也不得把追求对象落入 `other`。另有 `colleague` 同事**仅技术回归**（产品场景已完全移出，界面/导航/演示/验收不得出现，不对产品暴露）；`unknown` 只表示"关系暂不确定"，推荐前必须澄清。适配为中文关系 |
| closeness | string ID | 可省略，默认 unknown | very_familiar 非常熟悉、familiar 比较熟悉、limited 了解不多、unfamiliar 几乎不了解、unknown 不确定；保留扩展字段，不作为事实 |
| occasion | string ID | 推荐必填；草稿可 null/unknown，推荐前澄清 | birthday 生日、festival 节日、thanks 感谢、anniversary 纪念日、graduation_promotion 毕业/升职祝贺、other 其他、unknown 场合暂不确定（推荐前必须澄清）；适配为中文场合。枚举共 7 个键，与 `labels.py:OCCASIONS` 一致 |
| budget_amount | 十进制 string | 推荐必填；草稿可 null | 明确的全量预算上限，不能是区间。含礼物、包装、贺卡、配送等；不替用户选择上限 |
| currency | string | 必填，无默认 | 仅 CNY，不换汇 |
| deadline_days | 非负 JSON integer | 推荐必填；草稿可 null | 原样映射 available_days，排除 bool；不推定 7 天、不用巨大数模拟无限 |
| interests | string ID[] | 可省略，默认 [] 表示未知 | 具体标签见下表；不得提交 unknown 与具体项混选。**"未知"不是机器值**，只能用空数组表示 |
| interest_confidence | object | 可省略，默认 {} | 以已选兴趣 ID 为键，值**只允许** `confirmed`/`inferred`；未设定项默认 inferred，不能默认确认为事实；多余键报错。不存在 `unknown` 取值 |
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

未知兴趣统一使用 `interests: [], interest_confidence: {}`，未知风格使用 `gift_styles: []`。UI 的“暂时不知道/不确定”是互斥交互状态，**不是可提交的机器值**：`interests` 中不存在 `unknown`，`interest_confidence` 只接受 `confirmed`/`inferred`，提交 `unknown` 会被 `INTAKE_UNKNOWN_LABEL` 或 `INTAKE_CONFIDENCE_MISMATCH` 拒绝。宽泛组 coffee_food 不能细化为“确定喜欢咖啡”，music_movies 不能细化为“确定喜欢电影”。用户可在备注补充，但本版不把任意备注自动提升为事实。

## 两层关系字段（DEC-1b／DEC-4）

`request` 同时携带两个关系字段，语义不同，且**都不由前端提交**：

| 字段 | 出处 | 值域 | 用途 |
| --- | --- | --- | --- |
| `request.recipient_relation` | 服务端 intake 由 `recipient_relation` 适配 | 冻结中文显示文本（如“恋人”“追求对象”） | 兼容既有提示词与校验器；`validator/rules.py` 只要求非空字符串 |
| `request.recipient_relation_id` | 服务端 intake 由 `recipient_relation` 原样透出 | 冻结机器值（`pursuit`/`partner`/`friend`…） | 关系优先级、追求对象低压力等**代码分支必须按它判断**，不得依赖中文文案匹配 |

两条硬约束：

1. `recipient_relation_id` **不在** `workflow/intake.py` 的输入字段白名单内，前端提交它会得到 `INTAKE_UNKNOWN_FIELD`；它只由服务端 intake 产出。
2. `validator/rules.py:119–157` 对 `request` **无字段白名单**（`_limits` 只递归遍历嵌套容器，检查字符串长度与数组条数；**不限制嵌套深度**，深层防护只来自解析器的递归上限，超出后归 `INVALID_JSON`，见 [边界矩阵](#3-边界值矩阵实测2026-10-30)），因此新增该字段不破坏既有校验。新增后已实测 322 项 unittest（`python -m unittest discover -s tests` → `Ran 322 tests ... OK`）与 46 项本地探针（`workflow/verify_local.py`，静态展开计数 46，与既有记录一致）无回归。

## 确定性适配与限制

实现：[intake.py](../workflow/intake.py)。confirmed 兴趣生成 `facts: [{id: "interest:<标签ID>", text: "用户明确知道：对方对…感兴趣（未确认该组内具体偏好）"}]`，事实 ID 不依赖数组位置，重新排序仍稳定；从 confirmed 降为 inferred 后，旧 ID 不再可引用。inferred 独立存 `preference_inferences`，unknown 不生成任何兴趣。`gift_styles`、`closeness`、`hard_exclusions_original` 是扩展上下文。`facts` 不接收模型改写。

`hard_exclusions.tags → forbidden_tags`；`terms → forbidden_terms`；原文及 unresolved 保留，但 unresolved 未解决不发真实推荐。空禁忌仅表示未提供限制。原校验器对转换后的请求再检查一次，使用同一公开函数；适配器不会另写预算比较或禁忌匹配规则。

预算格式沿用 PM：`(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?`，如 `200.00`；拒绝空白、负数、前导零、浮点数值、符号和指数。**金额没有数值上限**：实测 `"0"`、`"0.0"`、`"0.00"` 与 1000 位数字串均通过（受字段字符串上限约束），`"200"` 与 `"200.00"` 等价。不把未知价格填零。原始 intake、request、candidates 各限 32768 UTF-8 字节；字段字符串最多 1000 码点、数组最多 20 项。转换造成膨胀超限也拒绝。**两层上限会互相牵制**：字段级（1000 码点）合法不代表整体合法，中文/emoji 约 3–4 字节每码点，实测把 `hard_exclusions.terms` 填满 20×1000 码点中文再加 1000 码点备注，`intake_json` 达 63,442 字节，整体按字节超限被拒且错误码是 `INTAKE_INVALID_JSON`（而非 `LIMIT_EXCEEDED`）；该场景下可接受的最大实长仅约 15 KB。外层 Code `payload_json` 运输信封单独限 262144 UTF-8 字节，不放宽内部原规则限制。

草稿可以记录预算区间、“3–7 天”“不着急”等 UI 状态；这些不属于可推荐的 intake-v1，不能混入真实请求。相对时间快捷项应按 Asia/Shanghai 展示具体日期及最终天数，经用户确认后只提交整数。`0` 天允许，表示当天可用准备时间，不保证实际送达。前端不得静默填预算或天数。

## 错误及调用边界

`adapt_intake(intake_json: str)` 返回 `{status: "ready"|"needs_input", errors: [{code,path,message}], request_json: string|null}`；出现任何错误时不返回可用请求，不调用模型。

| 错误码 | 来源层 | 含义 |
| --- | --- | --- |
| INTAKE_INVALID_JSON | 适配层 `intake.py:39` | 非严格 JSON、重复键、非法常量、无效编码、**嵌套过深（解析递归超限）**或 intake 超过 32768 UTF-8 字节 |
| INTAKE_UNKNOWN_FIELD | 适配层 `intake.py:45`、`:101` | 顶层未声明字段，或 `hard_exclusions` 内未声明字段；需确认契约版本 |
| INTAKE_UNKNOWN_LABEL | 适配层 `intake.py:53`、`:76`、`:114` | 标签 ID 无效：精确匹配、大小写敏感、不去首尾空白，不自动猜同义词 |
| INTAKE_CONFIDENCE_MISMATCH | 适配层 `intake.py:91`、`:94` | 可信度键不在本次已选兴趣内，或值不是 `confirmed`/`inferred`（含 `unknown`、`null`、非字符串） |
| INTAKE_CLARIFICATION_REQUIRED | 适配层 `intake.py:48`、`:62`、`:109` | 必填字段缺失或值为 null、关系/场合为 `unknown`、`unresolved` 非空 |
| INVALID_TYPE | 适配层 `intake.py:41`、`:67`、`:88`、`:98`、`:105`，以及原校验器 `rules.py:33` 等 | 根节点非对象、标签数组非数组、可信度非对象、禁忌结构与元素类型错误；以及转换后 `request` 字段类型错误 |
| INVALID_AMOUNT | 原校验器 `rules.py:93` | 金额非合法 ASCII 十进制字符串：负数（含 `-0`）、前导零、全角数字、空白、指数、千位分隔符、超两位小数、`.5`、`1.` |
| UNSUPPORTED_CURRENCY | 原校验器 `rules.py:131` | 币种非 `CNY`（大小写敏感，`cny` 同样被拒）；不换汇 |
| LIMIT_EXCEEDED | 适配层 `intake.py:70`、`:107`，以及原校验器 `rules.py:41`、`:57`、`:60` | 业务数组超 20 项、字段字符串超 1000 码点、参数字符串超 32768 字节 |
| DUPLICATE_ID | 适配层 `intake.py:78`，以及原校验器 `rules.py:146`、`:233` | 同一选择数组内标签重复；`request.facts` 的 ID 重复与候选 ID 重复沿用同一码 |
| UNKNOWN_TAG | 原校验器 `rules.py:152`（候选 `tags` 见 `rules.py:191`） | 转换后 `request.forbidden_tags` 含词表外类别。**适配层会先发 `INTAKE_UNKNOWN_LABEL`，同一根因因此同时出现两码** |
| INTERNAL_ERROR | 适配层 `intake.py:134–135` | 适配后送原校验器复核时，校验器自身返回 `status=error`（基础设施/内部异常）。**不是输入问题**，不泄露堆栈，不回显用户原文 |

**错误聚合（实测）**：适配层不做去重，同一根因可能产生多条错误，`request` 侧复核还会为同一根因追加第二个路径。实测缺 `recipient_relation` / 值为 null → 3 条（`INTAKE_CLARIFICATION_REQUIRED` + `INTAKE_UNKNOWN_LABEL` + `request.recipient_relation` 的 `INVALID_TYPE`）；非法关系值（`""`、`"COLLEAGUE"`、`1`）→ 2 条；`hard_exclusions.tags = [1]` → `INTAKE_UNKNOWN_LABEL` + `INVALID_TYPE`（与 [VAL-001 §2](./validator-contract-decisions.md) “非字符串不归为未知标签”的口径不一致，见文末待裁决）；`tags = ["nonsense"]` → `INTAKE_UNKNOWN_LABEL` + `UNKNOWN_TAG`。前端必须按 `errors` 数组聚合展示，不得假定一因一码。

`request` 侧校验器的完整错误码（19 个）见 [VAL-001 §7](./validator-contract-decisions.md)。

上述 INTAKE 前缀属于适配层，不增加 validator 错误码。一般错误为中文，不回显用户原文。原始 JSON 格式错误与字段业务错误在 intake 边界均为 needs_input；候选校验状态仍完全沿用 PM 决定。

虚构完整请求见 [intake.json](../workflow/examples/intake.json)：**追求对象**生日、了解不多、总预算上限 200.00 CNY、两天、coffee_food confirmed、design_art inferred、不送 alcohol 与字面“酒”。它生成且只生成 `interest:coffee_food` 事实，design_art 不进入 facts，并输出 `recipient_relation: "追求对象"` 与 `recipient_relation_id: "pursuit"`。

同事的**技术回归夹具**单独放在 [intake-colleague.json](../workflow/examples/intake-colleague.json)，只用于验证 `colleague` 机器值与既有回归链路不退化；它**不是产品样例**，不得用于界面、导航、演示或验收。

## 后续前端与服务端约束

前端三步只负责采集上述 intake；服务端重新执行确定性适配，不信任浏览器传入的派生事实、检查结果或修订次数。仓库当前 Python 适配是参考实现；若前端使用其他语言，须跑同一虚构样例并比对请求语义，不重新命名字段或自建另一套标签。

服务端保管 Dify Key 与可信任务记录。调用 Dify 时传 String 类型的 intake/request/candidates JSON，LLM 文本原样送代码检查，不剥离 Markdown、不修补 JSON。报告字段见 runtime.py：`status`、`all_passed`、`request`、`candidates`、原始 `validation`、`workflow_errors`、`repair_count`、`remaining_repairs`、`selected_candidate_id: null`、`selectable_candidate_ids`、`report_text`、`business_data_verification: not_verified`。若 workflow_errors 非空，即使底层规则通过也不能选择。

服务端需生成运行 ID 并保存可信原始请求、两次候选与规则输出、修订计数和最终可选 ID；本轮不实现存储/API。后续选择事件仍用 `{recommendation_run_id, selected_candidate_id}`，不能直接把浏览器的候选或 passed 当可信输入。推荐阶段修订用掉一次，后续包装必须沿用剩余 0，不得重置；本轮到等待选择为止。

## CONTRACT-001 独立契约复核（2026-10-30）

本轮为 Issue #6 的**契约专项审计**：以代码为唯一事实源，把本文与实现逐字段、逐错误码、逐边界对账，补齐 PM 本地验收后遗留的「待独立复核」缺口。**本轮只改文档**，未修改 `workflow/` 或 `validator/` 下任何代码；发现的代码侧差异在 §5 列出并交对应文件线处置。

### 1. 复核方法与证据

| 项 | 内容 |
| --- | --- |
| 事实源 | `workflow/intake.py`、`workflow/labels.py`、`workflow/runtime.py`、`validator/rules.py`、`workflow/verify_local.py`；`docs/intake-contract.md`、`docs/validator-contract-decisions.md`、`workflow/workflow-spec.md` |
| 错误码清点 | AST 静态提取 `_error(...)`/`err(...)`/`{"code": ...}` 字面量，再用探针逐码动态触发 |
| 动态覆盖 | 实测触发 26 个错误码；`validator/rules.py` 的 19 个码 **19/19 全部实际触发**，`workflow/runtime.py` 3 个全部触发，适配层 9 个字面量全部触发，另加透传的 `UNKNOWN_TAG` |
| 回归基线 | `python -m unittest discover -s tests` → `Ran 322 tests ... OK`；`workflow/verify_local.py` 静态展开 46 项探针（与文档既有记载一致）。本轮未执行 `verify_local.py` 本体，以免覆盖 `workflow/evidence/` 下既存验收证据 |
| 探针位置 | 临时目录脚本，**未写入仓库**；全部结论可用同样输入复现 |
| 未覆盖 | 真实 Dify 沙箱、模型输出、HTTP 容器（`workflow/tools/verify-container.py` 另有 `INVALID_PAYLOAD`，不属本契约） |

### 2. 字段逐项对账

| 项 | 文档写的 | 代码实际 | 是否一致 | 处置建议 |
| --- | --- | --- | --- | --- |
| 输入字段集合 | 11 个字段，未声明字段报错 | `intake.py:43` 白名单恰为同 11 个；注入 `recipient_relation_id`/`facts`/`available_days` 均得 `INTAKE_UNKNOWN_FIELD` | ✅ | 保持 |
| `recipient_relation` | 推荐必填；草稿可 null/unknown | 缺失或 null → 3 条错误（`INTAKE_CLARIFICATION_REQUIRED`+`INTAKE_UNKNOWN_LABEL`+`request.recipient_relation` 的 `INVALID_TYPE`）；合法值仅 `unknown` → 1 条；非法值 → 2 条 | ⚠️ | 文档已补错误聚合说明；是否收敛为单码见 §5 |
| `recipient_relation` 枚举 | 8 个产品 ID + `colleague`（仅技术回归）+ `unknown`，`pursuit`/`partner` 互斥 | `labels.py:RELATIONS` 10 键，完全一致；实测 `colleague` → `("同事","colleague")`、`unknown` → `needs_input` | ✅ | 保持 |
| `closeness` | 可省略，默认 `unknown`；5 值 | 省略 → `unknown` ✅；显式 `null` → `INTAKE_UNKNOWN_LABEL`（文档未写） | ⚠️ | 文档已列；如需 null 等价于省略须改代码 |
| `occasion` | 推荐必填；草稿可 null/unknown | 同 `recipient_relation`；非法值 2 条；`unknown` → `INTAKE_CLARIFICATION_REQUIRED` | ⚠️ | 文档枚举已补 `unknown`（原表遗漏） |
| `budget_amount` | 十进制 string；推荐必填；含包装/贺卡/配送；不能是区间 | ✅；`"0"`/`"0.0"`/`"0.00"`/`"200"`/`"12.30"` 通过；`"-1"`/`"-0"`/`"00"`/`"01.00"`/`"1e3"`/`"200.000"`/`".5"`/`"1."`/`" 200"`/`"２００"`/`"1,000"`/`"200😀"` 全部 `INVALID_AMOUNT`；**无数值上限**，1000 位数字串仍通过，1001 码点才 `LIMIT_EXCEEDED` | ✅（文档未写上限缺失） | 文档已补「金额无数值上限」 |
| `currency` | 必填无默认；仅 `CNY` | ✅；`"cny"`/`"CNY "`/`"USD"` → `UNSUPPORTED_CURRENCY`；`""` → `INVALID_TYPE`+`UNSUPPORTED_CURRENCY` | ⚠️ | 文档已补空串双码；大小写敏感已明确 |
| `deadline_days` | 非负 JSON integer，排除 bool；原样映射 `available_days` | ✅ 完全一致；`0`/`1`/`365`/`366`/`100000`/`10^20` 通过（**无上限**）；`-1`/`True`/`False`/`1.0`/`"3"` → `INVALID_TYPE` | ✅ | 保持；文档可注明无上限 |
| `interests` | 可省略默认 `[]`；未知用空数组；不得与 `unknown` 混选 | ✅；`[]` → `ready` 且 `facts: []`；`["unknown"]`/全角/中文/emoji/空串 → `INTAKE_UNKNOWN_LABEL`；重复 → `DUPLICATE_ID`；>20 项 → `LIMIT_EXCEEDED`；`null` → `INVALID_TYPE` | ✅（null 未写） | 文档已列 null 行为 |
| `interest_confidence` | 可选，默认 `{}`；只允许 `confirmed`/`inferred`；未设定项默认 `inferred`；多余键报错；无 `unknown` 取值 | ✅ 全部一致；`"unknown"`/`"CONFIRMED"`/`null`/`1` → `INTAKE_CONFIDENCE_MISMATCH`；键对应被丢弃的未知兴趣时额外叠加 `INTAKE_UNKNOWN_LABEL` | ✅（叠加未写） | 文档已补聚合说明 |
| `gift_styles` | 可省略默认 `[]`；7 值 | ✅；>20 项 → `LIMIT_EXCEEDED`（重复时同时 `DUPLICATE_ID`） | ✅ | 保持 |
| `hard_exclusions` | 可省略，默认三个空数组；`unresolved` 非空须澄清 | ✅；`{}` 合法；`null`/非对象 → `INVALID_TYPE`；多余键 → `INTAKE_UNKNOWN_FIELD`；元素空串 → `INVALID_TYPE`（文档未写）；`terms` 超 1000 码点或超 20 项 → `LIMIT_EXCEEDED`，且同一根因在 `request.forbidden_terms` 与 `request.hard_exclusions_original` 重复报路径 | ⚠️ | 文档已补空串与重复路径；见 §5 |
| `additional_context` | 可省略默认 `""`；不接受 null | ✅；`""`/`"   "`/`"\n"` 通过；`null` → `INVALID_TYPE`（路径 `request.notes`）；1000 码点通过、1001 码点 → `LIMIT_EXCEEDED`；按 Python 码点计数（1000 个 emoji 通过，201 个家族 emoji = 1005 码点被拒） | ✅ | 保持 |
| 关系两层字段 | `recipient_relation` 为冻结中文；`request.recipient_relation_id` 为机器值且不由前端提交 | ✅；9 个可用 ID 全部输出正确中文与 ID 对；`unknown` 不产出请求 | ✅ | 保持 |
| 适配输出结构 | `{status, errors, request_json}`，`ready`/`needs_input` | ✅ 实测输出键恰为 `errors`/`request_json`/`status` | ✅ | 保持 |
| 报告字段 | `runtime.py` 的 12 个字段 | ✅ 实测 report 顶层恰 12 键，名称一致 | ✅ | 保持 |

### 3. 边界值矩阵（实测，2026-10-30）

| 输入 | 期望行为 | 实测结果 | 是否一致 | 处置建议 |
| --- | --- | --- | --- | --- |
| `budget_amount: "0"` | 允许（VAL-001 §5） | `ready`；配正估算 → `OVER_BUDGET`，配 `"0.00"` 估算 → `passed` | ✅ | 保持 |
| `budget_amount: "-1"` / `"-0"` | 拒绝 | `INVALID_AMOUNT` | ✅ | 保持 |
| `budget_amount` 超大 | 文档未定义 | 1000 位数字串 `ready`；1001 码点 → `LIMIT_EXCEEDED`；**无业务数值上限** | ⚠️ | 文档已注明 |
| `deadline_days: 0` | 允许，表示当天 | `ready`；配 1 天准备 → `PREPARATION_TOO_LONG`；配 0 天 → `passed` | ✅ | 保持 |
| `deadline_days: 1` / `365` | 允许 | `ready` | ✅ | 保持 |
| `deadline_days: -1` / `True` / `1.0` / `"3"` | 拒绝（排除 bool） | `INVALID_TYPE` | ✅ | 保持 |
| `deadline_days` 超大 | 文档未定义 | `10^20` 仍 `ready`，**无上限** | ⚠️ | 文档已注明 |
| `interests: []` | 未知，不编造事实 | `ready`，`facts: []`，`preference_inferences: []` | ✅ | 保持 |
| `interests: []` + `interest_confidence: {}` | 同上 | `ready` | ✅ | 保持 |
| `interests: null` | 文档未定义 | `INVALID_TYPE`（+ 若残留键则 `INTAKE_CONFIDENCE_MISMATCH`） | ⚠️ | 文档已列 |
| `interests` 含全角/emoji/中文 | 未知标签，不猜测 | `INTAKE_UNKNOWN_LABEL` | ✅ | 保持 |
| `budget` 含全角数字/emoji | 拒绝 | `INVALID_AMOUNT` | ✅ | 保持 |
| 字段 1000 / 1001 码点 | 上限含、上限+1 拒 | `notes` 1000 码点 `passed`、1001 → `LIMIT_EXCEEDED`；1000 个 emoji 通过、1001 个 → 拒；家族 emoji 按 5 码点计 | ✅ | 保持 |
| 数组 20 / 21 项 | 上限含、上限+1 拒 | 候选 `unknowns` 20 项 `passed`、21 项 → `LIMIT_EXCEEDED`；`gift_styles`/`interests` 同上 | ✅ | 保持 |
| 参数 32768 / 32769 字节 | 等于上限允许 | `request_json` 恰 32768 → 正常解析（报 `INVALID_REQUEST`，未报超限）；恰 32769 → `LIMIT_EXCEEDED` | ✅ | 保持 |
| 字段合法但整体超 32768 字节 | 文档只说「转换膨胀也拒」 | 中文 `terms` 20×1000 码点 + 1000 码点备注 = 63,442 字节 → `INTAKE_INVALID_JSON`；该场景可接受最大实长约 15 KB | ⚠️ | 文档已补两层上限互相牵制 |
| 未知关系值 `""`/`"COLLEAGUE"`/`1` | `INTAKE_UNKNOWN_LABEL` | 该码 + `request.recipient_relation` 的 `INVALID_TYPE` | ⚠️ | 见 §5 |
| `colleague`（技术回归值） | `ready`，可适配 | `ready`，输出 `("同事","colleague")` | ✅ | 保持；不得出现在产品面 |
| `pursuit` | `ready`，与 `partner` 互斥 | `ready`，输出 `("追求对象","pursuit")` | ✅ | 保持 |
| `recipient_relation_id` 注入 | `INTAKE_UNKNOWN_FIELD` | `needs_input` / `INTAKE_UNKNOWN_FIELD` | ✅ | 保持（`verify_local.py:139` 断言同一行为） |
| `hard_exclusions.tags: ["ALCOHOL"]` / 全角 | 适配层精确匹配 → 拒 | `INTAKE_UNKNOWN_LABEL`（**不做** NFKC/大小写折叠/去空白） | ⚠️ | 与 VAL-001 §2 冲突，见 §5 |
| 直接调用 validator 传 `forbidden_tags: ["ALCOHOL"]` | VAL-001 §2：NFKC+折叠后匹配 | `passed`（归一化生效） | ⚠️ | 同一输入走完整链路被拒、直调校验器通过；见 §5 |
| `hard_exclusions.tags: ["nonsense"]` | `INTAKE_UNKNOWN_LABEL` | 该码 + `UNKNOWN_TAG` | ❌ 表缺码 | 错误码表已补 `UNKNOWN_TAG` |
| `hard_exclusions.tags: [1]` | VAL-001 §2：非字符串不归为未知标签 | `INTAKE_UNKNOWN_LABEL` + `INVALID_TYPE` | ❌ 跨文档冲突 | 见 §5 |
| `hard_exclusions.terms: [""]` | 文档未定义 | `INVALID_TYPE` | ⚠️ | 文档已注明 |
| `hard_exclusions.unresolved: ["x"]` | 须澄清 | `INTAKE_CLARIFICATION_REQUIRED` | ✅ | 保持 |
| JSON 嵌套约 2000 / 3000 层 | 文档未定义 | 2000 层可解析（约 12 KB）；3000 层（约 18 KB）→ `INVALID_JSON`（解析递归超限）；无显式深度限制 | ❌ 未记载 | 文档已注明；见 §5 |
| 孤立代理项字符串参数 | VAL-001 §1：按 `INVALID_JSON` | `error` / `INVALID_JSON` | ✅ | 保持 |
| 重复 `name`+`description`（全角/大小写/多空格） | VAL-001 §4：标准化二元组相同即重复 | `DUPLICATE_CANDIDATE_CONTENT`（含全角字母、全角空格、制表符、大小写折叠用例） | ✅ | 保持 |
| `name`/`description` 仅空白存在差异（无空格 vs 有空格） | §4 只说折叠连续空白 | `passed`（折叠为空格的串不等于无空格串） | ✅ | 保持 |
| `candidates` 顶层 21 项 | `INVALID_CANDIDATE_COUNT`，不以通用列表错误取代 | 只有 `INVALID_CANDIDATE_COUNT` 等候选码，**无** `LIMIT_EXCEEDED`（`_batch` 有意排除 `candidates` 键） | ✅ | 保持 |

### 4. 错误码差集

| 集合 | 数量 | 清单 |
| --- | --- | --- |
| `validator/rules.py` 实际发出（AST 19 个，19/19 已动态触发） | 19 | `INVALID_TYPE`、`INVALID_JSON`、`LIMIT_EXCEEDED`、`MISSING_FIELD`、`INVALID_AMOUNT`、`INVALID_REQUEST`、`UNSUPPORTED_CURRENCY`、`DUPLICATE_ID`、`UNKNOWN_TAG`、`INVALID_CANDIDATE_ID`、`OVER_BUDGET`、`PREPARATION_TOO_LONG`、`CURRENCY_MISMATCH`、`FORBIDDEN_TAG`、`UNKNOWN_FACT_REF`、`FORBIDDEN_TERM`、`INVALID_CANDIDATE_COUNT`、`DUPLICATE_CANDIDATE_CONTENT`、`INTERNAL_ERROR` |
| `workflow/intake.py` 适配层可达 | 10 | 上述 9 个字面量 `INTAKE_*`/`INVALID_TYPE`/`DUPLICATE_ID`/`LIMIT_EXCEEDED`/`INTERNAL_ERROR`，**加透传的 `UNKNOWN_TAG`** |
| `workflow/runtime.py` 包装层 | 3 | `REPAIR_NOT_ALLOWED`、`PASSED_CANDIDATE_CHANGED`、`WORKFLOW_INPUT_ERROR` |
| 本文错误码表原列 | 11 | 11 个全部可达 ✅；**缺 `UNKNOWN_TAG`** ❌（本轮已补） |
| `workflow/workflow-spec.md:96` 的「既有错误代码」清单 | 18 | validator 19 码中**缺 `LIMIT_EXCEEDED`** ❌；该清单同时已含 `INVALID_CANDIDATE_ID`/`DUPLICATE_CANDIDATE_CONTENT`（DEC-5 第 2 项已落地） |
| `workflow/workflow-spec.md:166` 明示未实现的 7 码 | 7 | `INVALID_SELECTION`、`STALE_RECOMMENDATION`、`UNTRUSTED_RECOMMENDATION`、`CANDIDATE_NOT_PASSED`、`PRESENTATION_INVALID`、`TOTAL_MISMATCH`、`REPAIR_LIMIT_REACHED` — greps 核实代码中确无实现点 ✅ |

重点核对结论：`INTERNAL_ERROR` 在表中但**行号引用陈旧**（文档原写 `intake.py:130`，实际 `:134–135`，本轮已修）；`INVALID_CANDIDATE_ID`、`DUPLICATE_CANDIDATE_CONTENT` 不在本文的 intake 边界表中（本文表只管适配边界），已在 [VAL-001 §7](./validator-contract-decisions.md) 建全量表收录，语义与实现一致；`LIMIT_EXCEEDED` 在 validator 侧可达却漏于 `workflow-spec.md:96`，属该文件线的待修项。

### 5. 待裁决事项

| # | 事项 | 建议 | 影响 |
| --- | --- | --- | --- |
| 1 | 适配层对非法关系/缺关系/缺预算产生 2–3 条同根因错误（如 `INTAKE_CLARIFICATION_REQUIRED` 与 `INTAKE_UNKNOWN_LABEL` 同时命中） | 本轮按实测如实记载，不改代码；若要一因一码须改 `workflow/intake.py` | 前端错误展示与验收用例断言 |
| 2 | `hard_exclusions.tags` 元素非字符串时同时发 `INTAKE_UNKNOWN_LABEL`，与 [VAL-001 §2](./validator-contract-decisions.md)「非字符串不归为未知标签」口径冲突 | 建议由 `workflow/intake.py` 文件线收敛为只发 `INVALID_TYPE` | 契约一致性、测试断言 |
| 3 | 适配层对标签精确匹配（大小写敏感、不裁剪、不 NFKC），使 [VAL-001 §2](./validator-contract-decisions.md) 的 NFKC/折叠规则在真实链路上永不生效 | 建议在 VAL-001 明确「归一化只适用于直接调用校验器的场景；经适配层的输入以精确匹配为准」，或改适配层对齐归一化 | 用户输入容错口径、两层契约边界 |
| 4 | 词表外硬禁忌标签同时产生 `INTAKE_UNKNOWN_LABEL` + `UNKNOWN_TAG`（后者由 `request.forbidden_tags` 复核得出） | 文档已收录 `UNKNOWN_TAG`；若要单码须改适配层不再透传原始标签 | 错误展示、修订触发 |
| 5 | JSON 嵌套深度无显式限制，约 3000 层触发解析递归上限并归 `INVALID_JSON` | 建议只写「深层嵌套由解析递归上限兜底并归 `INVALID_JSON`」，不写死层数 | 拒绝服务防护、错误语义 |
| 6 | `workflow/workflow-spec.md:96` 的 18 码清单缺 `LIMIT_EXCEEDED` | 指派该文件线补入（超出本轮可改边界） | 文档间一致性 |
| 7 | `budget_amount` 与 `deadline_days` 均无数值上限（仅非负/码点约束） | 若产品需要上限，须改 `validator/rules.py` 规则；否则在契约显式声明「无业务数值上限」 | 预算与工期语义、PM 决策 |

### 6. 复核结论

- **不一致条数：12 条**（3 条文档缺陷 + 5 条文档遗漏/措辞不准 + 2 条跨层语义冲突 + 2 条文档间差集）。
- **文档缺陷 3 条**：错误码表缺 `UNKNOWN_TAG`；`INTERNAL_ERROR` 行号引用陈旧；`occasion` 枚举漏列 `unknown`。已在本文修正。
- **文档遗漏/措辞 5 条**：金额与天数无数值上限；`null` 与空串在各字段的实际处置；错误聚合形态；两层上限互相牵制；嵌套深度行为。已在本文补记。
- **跨层冲突 2 条**：标签归一化口径（VAL-001 §2 vs 适配层精确匹配）；非字符串标签归类（VAL-001 §2 vs 适配层同时发 `INTAKE_UNKNOWN_LABEL`）。见 §5 第 2、3 项。
- **文档间差集 2 条**：`workflow-spec.md:96` 缺 `LIMIT_EXCEEDED`；`workflow-spec.md` 与本文对适配层错误码的分工未交叉引用（已在本文补链接）。
- 未发现字段名、类型、必填性、默认值、枚举值与上限（含 32768 字节）本身的实质性不符；`recipient_relation_id` 不可注入、`interest_confidence` 拒绝 `unknown`、`verify_local.py:131` 严格相等断言三项均保持不变。
