# 契约专项独立验收报告（关系 ID 全量 + 边界值 + 错误码对账）

> 本报告数字为 2026-10-30 时点真值；后续变更见 `docs/acceptance-criteria.md` 第 13 节。

- 复核角色：GiftWise｜测试验收 Agent（独立执行；**不以开发方声明代替证据**）
- 复核时间：2026-10-30（Asia/Shanghai）
- 复核对象：`workflow/intake.py`（适配层）、`validator/rules.py`（规则层）、`workflow/runtime.py`（包装层）
- 契约来源：`docs/intake-contract.md`、`workflow/workflow-spec.md`
- 仓库版本：`HEAD = 46d1b48`
- 复核套件：`tests/acceptance/contract/run_contract.py`（可重跑）
- 证据：`docs/test-reports/contract-001/evidence/contract-specials.json`
- 原始输出：`docs/test-reports/contract-001/evidence/raw-layer-boundary.txt`

## ⚠️ 作废范围声明（2026-10-31 补，不改原始结论）

本报告生成于 `HEAD = 46d1b48`，依据的是契约文档的**中间状态**。此后 PM 已就请求侧数值范围作出裁决并落地，
本报告**部分结论已被取代**。为保留历史，**下方原文一字未删**，仅在受影响处加「已作废」标注并指向新裁决。

**以 [`docs/validator-contract-decisions.md`](../validator-contract-decisions.md) §5／§7 为准**，取代关系如下：

| 本报告位置 | 原结论 | 现行裁决（取代后） |
| --- | --- | --- |
| §0 第 2 条、§2.1 表格 | 金额与天数"**无上限**"属已声明的已知限制、不是缺陷 | **请求侧已有范围**：预算 `[1, 10000]`、可用天数 `[0, 365]`（均含端点），超限 `LIMIT_EXCEEDED` + 请求侧 `needs_input`；见 §5 2026-10-30 修订、§6。**候选侧仍不受约束** |
| §2.1 `"0"` 行、§2.2 `0` 行 | 请求预算 `"0"`／`"0.00"` → `ready` ✅ | **已作废**：请求预算 `0` 现被拒（`LIMIT_EXCEEDED`）。**可用天数 `0` 仍保留**（未被取代） |
| §2.1 对 `docs/intake-contract.md` `:151`／`:155` 的行号引用 | 引用该文件的具体行 | **行号已悬空**：那两行的内容与编号在本轮修订后已变动，行号引用不再可靠；请以裁决文档 §5／§6 的表述为准 |
| §0 第 4 条（R-1） | "需 PM 定性与二选一" | **PM 已定性为分层设计**、采纳方案 (a)：`/validate` 是规则门、不消费关系枚举，**intake 适配层必须前置**。见本报告末「R-1 定性落档」 |
| §3 对 `workflow/runtime.py` 的码计数 | 记为 4 个码 | **更正为 3 个**，见下 §更正 ① |
| §4 未核实第 1 条 | `INTERNAL_ERROR` 输入不可达、未核实 | **更正**：本轮已用受控故障注入**实际触达两条路径**，见下 §更正 ② |

> 本报告的**其余结论仍然有效**，尤其是：关系枚举 10 值全量行为、`pursuit`／`partner` 独立性、
> 格式规则"格式优先于范围"、候选侧不受请求侧范围约束、`workflow-spec.md:166` 所示 7 个码零实现。
> 独立复验见 [`docs/test-reports/boundary-001/`](../boundary-001/)。

## 0. 独立结论（先说结论）

1. **关系契约成立**：10 个关系枚举值（8 个产品值 + `colleague` 技术回归 + `unknown` 未确认态）行为与契约一致，**无遗漏、无多余**。
2. **边界值行为与契约记载逐条一致**：含 `docs/intake-contract.md` 自己标注为 ⚠️ 的两处"无上限"（金额、天数）——我**独立复现**了该记录，它们属**已声明的已知限制**，不是隐藏缺陷。
   > **⚠️ 已作废（2026-10-31）**：请求侧现已加范围 `[1,10000]`／`[0,365]`，"无上限"只对**候选侧**成立。见顶部作废声明与 [`validator-contract-decisions.md`](../validator-contract-decisions.md) §5／§6。
3. **错误码对账通过**：契约错误码表中所列 **12 个码全部已实现且我全部触达**；`workflow-spec.md` 明示"代码中不存在"的 7 个码，我 **独立 grep 确认零实现点**，与文档一致；仅 `INTERNAL_ERROR` 为兜底分支，**输入不可达**。
   > **更正（2026-10-31）**：`INTERNAL_ERROR` 本轮已用受控故障注入**实际触达**（`path='$'` 与 `path='intake'`），不再是"未核实"。见下方 §更正 ②。
4. **发现 1 项需要 PM 决策的分层风险**（R-1）：**容器 `/validate` 不强制关系枚举**，未知关系值与原样伪造的 `recipient_relation_id` 都会 `passed`。这是"分层设计"还是"缺口"，需按部署契约定性。
   > **已定性（2026-10-31）**：PM 定性为**分层设计**、采纳方案 (a)，**不再需要二选一**。见下方「R-1 定性落档」。
5. 87 项用例 **87 通过 / 0 失败**。

## 1. 关系 ID 全量矩阵（10 个枚举值）

`workflow/labels.py` 实际声明的 `RELATIONS`：`classmate, client_partner, colleague, family, friend, mentor, other, partner, pursuit`（+ UI 态 `unknown`）。

| 关系值 | 产品语义 | `adapt_intake` 结果 | 输出 `recipient_relation` / `_id` | 判定 |
| --- | --- | --- | --- | --- |
| `partner` | 恋人 | `ready` | 恋人 / `partner` | ✅ |
| `pursuit` | 追求对象（**与恋人独立**） | `ready` | 追求对象 / `pursuit` | ✅ |
| `friend` | 朋友 | `ready` | 朋友 / `friend` | ✅ |
| `family` | 家人 | `ready` | 家人 / `family` | ✅ |
| `classmate` | 同学 | `ready` | 同学 / `classmate` | ✅ |
| `mentor` | 师长/上司 | `ready` | 师长 / `mentor` | ✅ |
| `client_partner` | 客户/合作方 | `ready` | 客户或合作方 / `client_partner` | ✅ |
| `other` | 其他 | `ready` | 其他 / `other` | ✅ |
| `colleague` | **仅技术回归夹具**（已移出产品场景） | `ready` | 同事 / `colleague` | ✅ 机器枚举保留、未向 UI 暴露 |
| `unknown` | 界面未确认态 | `needs_input` + `INTAKE_CLARIFICATION_REQUIRED` | — | ✅ |

**反向用例（全部按契约拒绝）**

| 输入 | 实际结果 | 判定 |
| --- | --- | --- |
| 缺 `recipient_relation` | `needs_input` + `INTAKE_CLARIFICATION_REQUIRED` | ✅ |
| `recipient_relation: null` | 同上 | ✅ |
| `"boss"`（未声明值） | `needs_input` + `INTAKE_UNKNOWN_LABEL` | ✅ |
| `"追求对象"`（前端误传显示文本） | `needs_input` + `INTAKE_UNKNOWN_LABEL` | ✅ |
| `"PURSUIT"`（大小写敏感） | `needs_input` + `INTAKE_UNKNOWN_LABEL` | ✅ |

**关于 `pursuit` 与 `partner` 必须独立**：两者均为独立枚举值，`labels.RELATIONS` 无任何"追求 ⇒ 双向好感"的合并或推导；我构造 `pursuit` 输入时输出 `recipient_relation_id="pursuit"`，未被提升为 `partner`。**成立。**

### R-1【需定性】容器 `/validate` 不强制关系枚举（分层边界）

同一未声明关系值，两层行为不同（原始输出 `evidence/raw-layer-boundary.txt`）：

| 层 | 输入 | 结果 |
| --- | --- | --- |
| **intake 层** `adapt_intake` | `recipient_relation="boss"` | `needs_input`，码 `INTAKE_UNKNOWN_LABEL`（+`INVALID_TYPE`） |
| **规则层** `validate`（容器 `/validate` 暴露的就是它） | `recipient_relation="boss-未声明关系"` | **`passed: true`** |
| **规则层** `validate` | 原样加入 `recipient_relation_id="pursuit"` | **`passed: true`** |

**性质**：`docs/intake-contract.md:60` **已自述**"`validator/rules.py:119–157` 对 `request` **无字段白名单**"，因此这不是隐藏缺陷，而是**分层契约的既有事实**。但它对部署有实际含义：

- 容器 `/validate` **只是规则门，不是契约门**。若调用方把它的 `passed` 当作"输入符合 intake-v1 契约"，则**未知关系值**与**伪造的 `recipient_relation_id`（服务端才可产出的机器字段）都会通过**。
- 该机器字段按契约"只由服务端 intake 产出，前端不得提交"，而当前规则层**不拦截外部提交**。

**建议（由 PM 定性与部署线决定）**：二者取一——(a) 在部署文档中明确 `/validate` 为规则层门禁、**intake 适配层必须前置**；(b) 或在规则层补关系枚举与 `recipient_relation_id` 白名单校验。**我未修改任何相关文件。**

## 2. 边界值矩阵

### 2.1 预算 `budget_amount`（ASCII 十进制字符串）

| 输入 | 实际结果 | 契约记载 | 判定 |
| --- | --- | --- | --- |
| `"0"` | `ready` | 允许（当天/零预算） | ✅ ⚠️ **已作废**：请求预算 `0` 现被拒 |
| `"0.00"` | `ready` | 允许 | ✅ ⚠️ **已作废**：同上（`LIMIT_EXCEEDED`） |
| `"200.00"` | `ready` | 允许 | ✅ |
| `"200.01"` | `ready`（请求侧是上限；候选超限才 `OVER_BUDGET`） | 一致 | ✅ |
| `"-1"` | `needs_input` + `INVALID_AMOUNT` | 拒绝 | ✅ |
| `"-0"` | `needs_input` + `INVALID_AMOUNT` | 拒绝 | ✅ |
| `"1e3"` | `needs_input` + `INVALID_AMOUNT` | 拒绝 | ✅ |
| `"２００"`（全角） | `needs_input` + `INVALID_AMOUNT` | 拒绝 | ✅ |
| `"1,000.00"` | `needs_input` + `INVALID_AMOUNT` | 拒绝 | ✅ |
| `" 200.00 "`（空白） | `needs_input` + `INVALID_AMOUNT` | 拒绝 | ✅ |
| `".5"` / `"1."` / `"0.001"` | 均 `INVALID_AMOUNT` | 拒绝 | ✅ |
| `""` | `needs_input` + `INVALID_AMOUNT` | 拒绝 | ✅ |
| `200`（JSON 数字类型） | `needs_input`（`INVALID_TYPE`/`INVALID_AMOUNT`） | 仅接受字符串 | ✅ |
| **`"9"×400`（400 位）** | **`ready`** | **:151 已注明"无数值上限"，1000 位仍通过，1001 码点才 `LIMIT_EXCEEDED`** | ✅ ⚠️ **已作废**：`:151` 行号已悬空；请求侧现已限 `[1,10000]`，400 位数字串数值远超上限 → `LIMIT_EXCEEDED`。**候选侧仍无数值上限** |

### 2.2 期限 `deadline_days` / `available_days`

| 输入 | 实际结果 | 契约记载 | 判定 |
| --- | --- | --- | --- |
| `0` | `ready`（当天，不保证送达） | 允许 | ✅ |
| `1` / `2` / `365` | `ready` | 允许 | ✅ |
| `-1` | `needs_input` + **`INVALID_TYPE`** | :154 记为 `INVALID_TYPE` | ✅ **独立复现一致** |
| **`100000`** | **`ready`** | **:155 已注明"无上限"，`10^20` 仍 `ready`** | ✅ ⚠️ **已作废**：`:155` 行号已悬空；请求侧现已限 `[0,365]`，`100000` 与 `10^20` → `LIMIT_EXCEEDED`。**候选侧准备天数仍不受此范围约束** |

### 2.3 兴趣与可信度

| 输入 | 实际结果 | 判定 |
| --- | --- | --- |
| `interests: []` + `interest_confidence: {}` | **`ready`**（偏好未知≠输入无效） | ✅ |
| `interests: ["unknown"]` | `needs_input` + `INTAKE_UNKNOWN_LABEL` | ✅ |
| `confidence: {"coffee_food":"unknown"}` | `needs_input` + `INTAKE_CONFIDENCE_MISMATCH` | ✅ |
| `confidence` 含**未选**兴趣的键 | `needs_input` + `INTAKE_CONFIDENCE_MISMATCH` | ✅ |
| `confidence` 非对象 | `needs_input` + `INVALID_TYPE` | ✅ |
| `interests` 非数组 | `needs_input` + `INVALID_TYPE` | ✅ |
| `interests` 重复 | `needs_input` + `DUPLICATE_ID` | ✅ |
| `interests` 21 项（含重复） | `needs_input` + `LIMIT_EXCEEDED` | ✅ |
| `interests` 含 1001 码点未知标签 | `needs_input` + `INTAKE_UNKNOWN_LABEL` | ✅ |

### 2.4 全角 / emoji / 过宽字段

| 输入 | 实际结果 | 判定 |
| --- | --- | --- |
| `additional_context` 含 emoji、ZWJ 家族、全角字母、零宽空格 | **`ready`**（原样保留，未做破坏性规范化） | ✅ |
| `additional_context` 1001 码点 | `needs_input` + `LIMIT_EXCEEDED` | ✅ |
| `closeness: "İstanbul"`（土耳其 I 混淆） | `needs_input` + `INTAKE_UNKNOWN_LABEL` | ✅ |
| 禁忌 `terms` 单项 1001 码点 | `needs_input` + `LIMIT_EXCEEDED` | ✅ |
| 禁忌 `tags` 21 项 | `needs_input` + `LIMIT_EXCEEDED` | ✅ |
| 禁忌 `terms` 含空白字符串 | `needs_input` + `INVALID_TYPE` | ✅ |
| 禁忌 `unresolved` 非空 | `needs_input` + `INTAKE_CLARIFICATION_REQUIRED` | ✅ |

### 2.5 结构 / 原始字节

| 输入 | 实际结果 | 判定 |
| --- | --- | --- |
| 顶层未声明字段（含伪造 `recipient_relation_id`） | `needs_input` + `INTAKE_UNKNOWN_FIELD` | ✅ 前端不得提交该字段，适配层拦住 |
| 根节点为数组 | `needs_input` + `INVALID_TYPE` | ✅ |
| 重复键 | `needs_input` + `INTAKE_INVALID_JSON` | ✅（严格解析） |
| `NaN` 字面量 | `needs_input` + `INTAKE_INVALID_JSON` | ✅ |
| 非 JSON | `needs_input` + `INTAKE_INVALID_JSON` | ✅ |
| **原始字节恰好 32768（等于上限）** | 通过解析（本例因备注超 1000 码点而 `LIMIT_EXCEEDED`），**未报 `INTAKE_INVALID_JSON`** | ✅ **独立复现"等于上限允许"** |
| **原始字节 32769（超一）** | `needs_input` + **`INTAKE_INVALID_JSON`** | ✅ **边界精确** |

### 2.6 候选侧（validator）边界

| 输入 | 实际结果 | 判定 |
| --- | --- | --- |
| 三候选全部合规 | `passed` | ✅ |
| 候选金额恰好 `200.00`（等于预算上限） | `passed` | ✅ 边界含 |
| 候选金额 `200.01` | `failed` + `OVER_BUDGET` | ✅ |
| 候选金额全角 `"２００"` | `failed` + `INVALID_AMOUNT` | ✅ |
| 候选金额布尔 `true` | `failed` + `INVALID_TYPE` | ✅ |
| 候选准备 9 天 | `failed` + `PREPARATION_TOO_LONG` | ✅ |
| 候选币种 `USD` | `failed` + `CURRENCY_MISMATCH` | ✅ |
| 候选描述 1001 码点 | `failed` + `LIMIT_EXCEEDED` | ✅ |
| 候选仅 2 个 | `failed` + `INVALID_CANDIDATE_COUNT` | ✅ |
| 候选 ID 重复 | `failed` + `DUPLICATE_ID` | ✅ |
| 候选 ID 为 `c9` | `failed` + `INVALID_CANDIDATE_ID` | ✅ |
| 两名候选内容重复 | `failed` + `DUPLICATE_CANDIDATE_CONTENT` | ✅ |
| 候选缺 `name` | `failed` + `MISSING_FIELD` | ✅ |
| 候选引用 `f99` | `failed` + `UNKNOWN_FACT_REF` | ✅ |
| 候选标签 `alcohol` | `failed` + `FORBIDDEN_TAG` | ✅ |
| 候选描述含字面「酒」 | `failed` + `FORBIDDEN_TERM` | ✅ |
| 候选标签不在词表 | `failed` + `UNKNOWN_TAG` | ✅ |
| 候选 JSON 截断 | **`error`** + `INVALID_JSON`（且所有候选 `passed=false`） | ✅ |
| 请求根非对象 | `needs_input` + `INVALID_REQUEST` | ✅ |

> **方法学说明（重要）**：候选级错误码在 `candidate_results[i].errors`，**不在顶层 `errors`**。我首轮只读顶层，导致 13 项误报"没有错误码"；改为聚合顶层+候选级后全部通过。**这是我的探针缺陷，服务端行为正确。** 记录在此以免后来者重踩。

## 3. 错误码全量对账

**对账口径**：把"代码中实际出现的码"（逐文件 grep）、"契约文档记载的码"、"spec 预留的码"、"我本轮实际触发的码"四者交叉比对。

```
实现点（grep 结果）
  validator/rules.py  : 19 个
  workflow/intake.py  :  9 个
  workflow/runtime.py :  3 个  ← **更正（2026-10-31）**：原记 4 个，见 §更正 ①
```

| 错误码 | 实现于 | 契约表 | spec 预留 | 本轮触达 |
| --- | --- | :---: | :---: | :---: |
| `CURRENCY_MISMATCH` | rules.py | 是 | - | **是** |
| `DUPLICATE_CANDIDATE_CONTENT` | rules.py | 是 | - | **是** |
| `DUPLICATE_ID` | rules.py, intake.py | 是 | - | **是** |
| `FORBIDDEN_TAG` | rules.py | 是 | - | **是** |
| `FORBIDDEN_TERM` | rules.py | 是 | - | **是** |
| `INTAKE_CLARIFICATION_REQUIRED` | intake.py | 是 | - | **是** |
| `INTAKE_CONFIDENCE_MISMATCH` | intake.py | 是 | - | **是** |
| `INTAKE_INVALID_JSON` | intake.py | 是 | - | **是** |
| `INTAKE_UNKNOWN_FIELD` | intake.py | 是 | - | **是** |
| `INTAKE_UNKNOWN_LABEL` | intake.py | 是 | - | **是** |
| `INTERNAL_ERROR` | rules.py, intake.py, runtime.py | 是 | - | **是（故障注入触达，见 §更正 ②）** |
| `INVALID_AMOUNT` | rules.py | 是 | - | **是** |
| `INVALID_CANDIDATE_COUNT` | rules.py | 是 | - | **是** |
| `INVALID_CANDIDATE_ID` | rules.py | 是 | - | **是** |
| `INVALID_JSON` | rules.py | 是 | - | **是** |
| `INVALID_REQUEST` | rules.py | 是 | - | **是** |
| `INVALID_TYPE` | rules.py, intake.py | 是 | - | **是** |
| `LIMIT_EXCEEDED` | rules.py, intake.py | 是 | - | **是** |
| `MISSING_FIELD` | rules.py | 是 | - | **是** |
| `OVER_BUDGET` | rules.py | 是 | - | **是** |
| `PASSED_CANDIDATE_CHANGED` | runtime.py | 是 | - | 由阶段 C 套件触达 |
| `PREPARATION_TOO_LONG` | rules.py | 是 | - | **是** |
| `REPAIR_NOT_ALLOWED` | runtime.py | 是 | - | 由阶段 C 套件触达 |
| `UNKNOWN_FACT_REF` | rules.py | 是 | - | **是** |
| `UNKNOWN_TAG` | rules.py | 是 | - | **是** |
| `UNSUPPORTED_CURRENCY` | rules.py | 是 | - | **是** |
| `WORKFLOW_INPUT_ERROR` | runtime.py | 是 | - | 由阶段 C 套件触达 |
| `INVALID_SELECTION` | **未实现** | 否 | **是（明示未实现）** | 否 |
| `STALE_RECOMMENDATION` | **未实现** | 否 | **是（明示未实现）** | 否 |
| `UNTRUSTED_RECOMMENDATION` | **未实现** | 否 | **是（明示未实现）** | 否 |
| `CANDIDATE_NOT_PASSED` | **未实现** | 否 | **是（明示未实现）** | 否 |
| `PRESENTATION_INVALID` | **未实现** | 否 | **是（明示未实现）** | 否 |
| `TOTAL_MISMATCH` | **未实现** | 否 | **是（明示未实现）** | 否 |
| `REPAIR_LIMIT_REACHED` | **未实现** | 否 | **是（明示未实现）** | 否 |

**本轮触达 23 个码**（完整清单见证据 JSON 的 `triggered_by_this_suite`）。

### 三条对账结论

1. **契约错误码表中列出的每一个码都已实现**（`documented_in_contract` 与实现集的差集为**空**）。没有"文档承诺了但代码里没有"的码。
2. **`workflow-spec.md:166` 明示"代码中不存在的 7 个码"**，并写明"截至 2026-10-30 在 `validator/rules.py` 与 `workflow/` 中均无实现点（已逐项 grep 核实）"。**我的独立逐文件 grep 结论完全相同**：该 7 码零命中。文档的自我披露**准确**，不存在把设计预留冒充已实现的情况。
3. ~~**`INTERNAL_ERROR` 是唯一"已实现但我无法由输入触发"的码**。~~ 它是 `validate()` 顶层 `except Exception` 的兜底（`rules.py:270`）以及 intake 在 `checked["status"]=="error"` 时的兜底（`intake.py:134`）。我构造了 `validate("", "")` 等极端输入，得到的仍是 `INVALID_JSON`（因为 `INVALID_JSON` 在兜底之前就把 `status` 置为 `error`），未能由**普通输入**进入该分支。
   > **更正（2026-10-31）**：本条对"输入不可达"的观察仍成立，但结论已推进——改用**受控故障注入**后已实际触达该分支（两条路径），见 §更正 ②。故不再列为"未核实"。

> **我自己的对账口径更正**：我最初的正则把 `rules.py` 里的 `"NFKC"` 也当成了错误码，实为规范化标记字符串。已在报告中剔除，避免虚增码数量。

## 4. 未核实 / 限制

1. ~~**`INTERNAL_ERROR` 的运行时行为未核实**：输入不可达（见 §3 结论 3）。我不推断其输出内容。~~
   > **已移出未核实（2026-10-31）**：经受控故障注入已实际触达并记录原始输出，见 §更正 ②。
2. **`PASSED_CANDIDATE_CHANGED`／`REPAIR_NOT_ALLOWED`／`WORKFLOW_INPUT_ERROR`** 未在本套件内重跑，依据的是阶段 C 套件（39 项）的既有结论；本报告不重复主张。
3. **`TOTAL_MISMATCH` 等 7 个预留码的"未来是否会实现"** 属设计决策，不在测试范围。
4. **本轮未覆盖**：Dify 节点边界（`payload_json` 262144 字节信封）、LLM 修订链路的端到端行为（需模型调用，本轮 **0 次模型调用**）。

## 5. 边界与副作用

- **未修改** `validator/**`、`workflow/**`、`deploy/**`、`web/**`。R-1 以报告形式提交，由 PM 定性与对应文件线处理。
- 本轮新增：`tests/acceptance/contract/run_contract.py`、`docs/test-reports/contract-001/`（本报告+证据）。
- 套件为**只读调用**：仅 import 公开函数并传入数据，不写仓库文件、不访问网络、不调用模型。

## 6. 证据索引

| 文件 | 内容 |
| --- | --- |
| `docs/test-reports/contract-001/evidence/contract-specials.json` | 87 例完整结果 + 错误码对账表 + 实现点 grep 结果 |
| `docs/test-reports/contract-001/evidence/raw-layer-boundary.txt` | R-1 分层边界原始输出 |
| `tests/acceptance/contract/run_contract.py` | 可重跑套件（`python tests/acceptance/contract/run_contract.py`） |

## 更正 ①（2026-10-31）：`workflow/runtime.py` 实发 **3** 个码，不是 4 个

本报告 §3 的静态 grep 用了 `"[A-Z][A-Z_]{3,}"`，把 `runtime.py` 里**只被比较、并未发出**的 `INTERNAL_ERROR` 也算作实现点。
逐行核实后：

| 位置 | 该码的角色 | 是否实发 |
| --- | --- | --- |
| `workflow/runtime.py:16` | `e["path"].startswith("request") or e["code"] == "INTERNAL_ERROR"` | **仅比较**，不发出 |
| `workflow/runtime.py:17` | `internal = any(e["code"] == "INTERNAL_ERROR" ...)` | **仅比较**，不发出 |

`runtime.py` **实发 3 个码**：`REPAIR_NOT_ALLOWED`、`PASSED_CANDIDATE_CHANGED`、`WORKFLOW_INPUT_ERROR`。
这与 `workflow/workflow-spec.md:93`／`validator-contract-decisions.md:93` 的记载一致。

**复现**（只读，不改 `workflow/**`）：

```bash
grep -n "INTERNAL_ERROR" workflow/runtime.py
# 16:        e["path"].startswith("request") or e["code"] == "INTERNAL_ERROR" for e in request_check["errors"])
# 17:    internal = any(e["code"] == "INTERNAL_ERROR" for e in validation["errors"])
```

> **方法学教训**：静态正则只能数出"字符串出现次数"，不能区分**发出**与**比较**。
> 计数类结论必须回到调用点逐行确认。

## 更正 ②（2026-10-31）：`INTERNAL_ERROR` 已用**受控故障注入**实际触达（两条路径）

`INTERNAL_ERROR` 是兜底分支，**普通输入不可达**（`INVALID_JSON` 在它之前就把 `status` 置为 `error`）。
因此用受控故障注入走通真实代码路径，而非伪造输出。**注入只在进程内生效，`finally` 必然还原**，
不修改 `validator/**` 或 `workflow/**`。

**复现命令**

```bash
python tests/acceptance/boundary/probe_internal_error.py
```

**原始输出**（全文见 `docs/test-reports/boundary-001/evidence/internal-error-injection.txt`）

```
=== 基线（不注入）===
  validator: status=passed codes=[]
  intake   : status=ready codes=[]

=== 注入后：validator/rules.py 顶层 except → path='$' ===
  status=error all_passed=False
  codes=[('INTERNAL_ERROR', '$')]
  business_data_verification=not_verified
  响应中含堆栈文本=False（必须为 False）

=== 注入后：workflow/intake.py status=='error' → path='intake' ===
  status=needs_input codes=[('INTERNAL_ERROR', 'intake')]
  是否释放 request_json=False（必须为 False）

=== 还原后自证 ===
  _norm 已还原=True
  validator: status=passed codes=[]

两条路径均已触达=True
```

**注入方式**：把 `validator.rules._norm` 在内存中替换为抛 `RuntimeError` 的函数。一次注入同时走通两条真实路径：

| 路径 | 代码位置 | 结果 | 附带确认 |
| --- | --- | --- | --- |
| 规则层兜底 | `validator/rules.py:270–273` | `status="error"`，`INTERNAL_ERROR` @ `path="$"` | **不泄露堆栈**；`business_data_verification="not_verified"` |
| 适配层兜底 | `workflow/intake.py:134–135` | `status="needs_input"`，`INTERNAL_ERROR` @ `path="intake"` | **不释放 `request_json`** |

因此 `INTERNAL_ERROR` 不再是"未核实"项：它的两条路径、`path`、`status`、以及"不泄露堆栈"都已实测。
唯一保留的说明是——**它不能由合法或非法输入触发**，只能由内部故障触发，这本身是设计意图。

## R-1 定性落档（2026-10-31）：容器 `/validate` 是规则门，不是契约门

**PM 定性**：R-1 **属分层设计，不是缺口**，采纳方案 (a)。`/validate` 只是一道**规则门**，
它根本不消费关系枚举；关系白名单在 **intake 层**（未知关系 → `INTAKE_UNKNOWN_LABEL`）。

**落档结论（部署与测试文档口径）**：

> **intake 适配层必须前置。不得把 `/validate` 的 `passed` 当作"输入符合 intake-v1 契约"。**

跨层实测（本报告 §F-4 与新增用例）：

| 层 | 输入：未知关系值 + 伪造的 `recipient_relation_id` | 实测结果 |
| --- | --- | --- |
| intake 适配层 | 客户端直接提交该对象 | `needs_input` + `INTAKE_UNKNOWN_LABEL` + `INTAKE_UNKNOWN_FIELD`，**不释放 `request_json`** |
| 规则层 `validate`（即 `/validate`） | 同一语义作为 `request_json` | **`passed`**（关系枚举与该字段都不在校验器职责内） |

两层**行为不同且都正确**；适配层对合法输入的产物送进规则层仍然 `passed`（闭环成立，
说明分层不是靠放宽任何一侧实现的）。可复跑用例：
`tests/acceptance/boundary/test_cross_layer_gate.py`（6 项）。

> 本报告 §0 第 4 条与 §F-4 中"建议 PM 二选一"的措辞**已被本定性取代**；不再作为待决项上报。

