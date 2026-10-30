# 阶段 4/5 契约决策草案（预备件）

- 日期：2026-10-30（北京时间）
- 起草：GiftWise｜PM Agent
- 状态：**产品负责人已于 2026-10-30 拍板，决定生效**；落地动作见文末「决定结果」。
- 目的：阶段 1–6 必须先冻结契约才进入阶段 7（Issue #4「流程依赖」）。本件把阶段 4（数据模型）与阶段 5（API 契约）的**待决点、影响面与代价**一次列清，避免对齐后再二次返工。
- 依据：Issue #1 正文（定位权威）、Issue #3（低负担输入任务单）、Issue #4「共享字段或接口发生变化时，先记录差异并由 PM 统一确认」。
- **本件不修改任何代码或契约文件。**

## 已核实现状（证据）

| 事实 | 位置 |
| --- | --- |
| 契约关系枚举 8 个 ID，**无追求对象**；`unknown` 只作为"建议澄清"的表示，不在 ID 列表中 | `docs/intake-contract.md:11` |
| 代码关系枚举 9 键（多 `unknown`），**无追求对象** | `workflow/labels.py:3`；5 个生成物各自 `:280` |
| 提交"追求对象"会被拒：`INTAKE_UNKNOWN_LABEL` → `status=needs_input`、`request_json=None` | `workflow/intake.py:52–:54`、`:131` |
| 校验器**不校验关系枚举**，只要求非空字符串 | `validator/rules.py:125–:127` |
| 合同层把关系写成**中文显示文本**，提示词只能靠中文串匹配 | `workflow/intake.py:117` |
| 兴趣可信度只接受 `confirmed`/`inferred`；未知用空数组；无独立 `unknown` 机器值 | `workflow/intake.py:65`、`:75–:76`、`:93`；`docs/intake-contract.md:17`、`:42` |
| 生成物当前与 manifest 全部一致（9 项哈希）；改 `labels.py` 后 5 个 artifact 立刻 STALE | `workflow/generated/manifest.json`；`workflow/build_code_node.py:46–:72` |
| 7 个文档错误码在代码中不存在 | `workflow/workflow-spec.md:163` |

## DEC-1｜"追求对象"的机器值（对应 OPEN-1，最高优先）

**决策内容：** 在 `RELATIONS` 新增独立机器值 `pursuit` = "追求对象"，与 `partner` **并列且互斥**；"追求对象"不得复用 `partner`，也不得落入 `other`。

**影响面：** `workflow/labels.py:3` → 必须执行 `python workflow/build_code_node.py` 重建 `workflow/generated/` 下 5 个文件与 `manifest.json`（**禁止手改生成物**）；`docs/intake-contract.md:11` 补 ID。

**待确认（产品负责人一句话即可）：**
- 是否新增 `pursuit`？
- `partner` 的中文用**"恋人"**（与 PRD 一致）还是保留**"伴侣"**（与代码一致）？

## DEC-1b｜低压力语义如何承载（DEC-1 的必要配套）

**问题：** `workflow/intake.py:117` 只把关系写成中文文本，因此"追求对象→低压力"的分支判断只能靠**中文串匹配**；一旦改文案（例如"伴侣"↔"恋人"）就会**静默改变模型输入**。而 `validator/rules.py:125–:127` 不做枚举校验，规则引擎**无法保证**任何关系语义。

| 选项 | 做法 | 代价 |
| --- | --- | --- |
| **A（推荐）** | `request` 新增稳定字段 `recipient_relation_id`（机器值：`pursuit`/`partner`/`friend`…），保留 `recipient_relation` 中文以兼容现有校验器与提示词 | 改 `workflow/intake.py:116–:125` + 契约 + 重建生成物；validator 无需改动 |
| B | 不新增字段，改为**冻结**中文串与 ID 的映射表，提示词按冻结中文串匹配 | 零代码；但语义耦合在中文文案上，任何文案调整都需同步提示词与测试 |

→ 请选 A 或 B。

## DEC-2｜兴趣"暂时不知道"的表达（对应 OPEN-2）

| 选项 | 做法 | 影响面 |
| --- | --- | --- |
| **B0（推荐）** | 维持 `interests: []` + `interest_confidence: {}`；把 Issue #3 的"未知用 unknown"明确为 **UI 互斥状态**，不是可提交机器值 | **0 代码改动**；更正 `product-requirements.md:37` 与 Issue #3 表述 |
| B1 | 新增兴趣 `unknown` 机器值（建议命名 `interest_unknown`，避免与 relation/closeness/occasion 的 `unknown` 混淆） | 改 `labels.py:6`、`intake.py:75–:76`、`:120`、`:123`、契约 `:17`/`:42`、`workflow/verify_local.py:86`，重建生成物 |
| B2 | 允许 `interest_confidence = unknown` 三值 | 改 `intake.py:93`、契约 `:18`、`product-requirements.md:37`；与契约"未设定项默认 `inferred`"冲突，需重新定义默认 |

**推荐 B0**：它与现有契约、代码、46 项本地探针全部一致，且"未知不编造"的语义已由"空数组 + 不生成 facts"完整表达；引入第三个值只增加分支，不增加信息。

→ 请选 B0 / B1 / B2。

## DEC-3｜同事场景口径（对应 OPEN-3）

| 选项 | 做法 | 需要改动 |
| --- | --- | --- |
| **(a) 推荐** | 按 **Issue #1 原文**：同事仍可覆盖、但不得主导定位；产品主展示与首验收/演示案例改为**恋人、追求对象**，朋友次之；同事保留在 `tests/` 作技术回归基线 | `docs/demo-script.md:8`、`:17`；`workflow/workflow-spec.md:9`、`:23`、`:56`；`docs/test-plan.md:7`、`:37` |
| (b) | 完全移出产品场景（按 `product-requirements.md:14`、`acceptance-criteria.md:12`） | 需**先修改 Issue #1 正文**（它是定位权威且写"仍可覆盖"），否则文档与权威定位冲突 |
| (c) | 保留同事为**次要**演示场景，主案例仍为恋人与追求对象 | 在 (a) 基础上只调整演示脚本 |

**推荐 (a)**：它是唯一与 Issue #1 权威、AGENTS.md「同事生日保留为技术回归案例」同时自洽的选项，且工作量最小。

→ 请选 (a) / (b) / (c)。

## DEC-4｜关系字段的语义域断层（阶段 5 API 契约）

**问题：** `docs/intake-contract.md:11` 要求关系是**稳定 ID**；`workflow/workflow-spec.md:23` 的 request 示例却是**中文自由文本**；实现上 `intake.py:117` 输出中文，`rules.py:125–:127` 只校验非空字符串。文档读起来像同一字段同一契约，实际是**两层不同定义**。

**决策：** 明确两层契约——
1. `recipient_relation`（intake 输入）= 稳定 ID，必须属于冻结枚举；
2. `request.recipient_relation`（传给校验器/模型）= 冻结的中文显示文本；
3. 新增 `recipient_relation_id`（见 DEC-1b）供代码分支使用。

**风险：** 若不明确，跨阶段校验与关系分叉逻辑只能依赖中文串，评分规则赛道 B 的"状态管理清晰"会被评委追问。

## DEC-5｜错误码与旧清单补漏（阶段 5）

1. `workflow/intake.py:130` 的 `INTERNAL_ERROR` 未列入 `docs/intake-contract.md:58–:66` 的错误码表 → 补入。
2. `validator/rules.py:181` 的 `INVALID_CANDIDATE_ID`、`:242` 的 `DUPLICATE_CANDIDATE_CONTENT` 未列入 `workflow/workflow-spec.md:93` 的 16 码清单（`docs/validator-contract-decisions.md:27`/`:35` 已有定义）→ 补入。
3. `workflow/workflow-spec.md:163` 的 7 个码（`INVALID_SELECTION`、`STALE_RECOMMENDATION`、`UNTRUSTED_RECOMMENDATION`、`CANDIDATE_NOT_PASSED`、`PRESENTATION_INVALID`、`TOTAL_MISMATCH`、`REPAIR_LIMIT_REACHED`）在代码中**不存在** → 标注"未实现"或删除，避免被读成已实现。

## 依赖与顺序

```
阶段 2 对齐（D-2/D-3/D-4）
      ↓
DEC-1 / DEC-1b / DEC-2  ──→ 阶段 4 数据模型冻结
DEC-4 / DEC-5            ──→ 阶段 5 API 契约冻结
      ↓
阶段 6 PM 任务拆分 ──→ 阶段 7 开发（此时才允许大规模并行）
```

## 需要产品负责人一句话确认的清单（4 项）

1. **DEC-1**：是否新增 `pursuit`？`partner` 中文用"恋人"还是"伴侣"？
2. **DEC-1b**：选 **A**（新增 `recipient_relation_id`，推荐）还是 **B**（冻结中文映射）？
3. **DEC-2**：兴趣未知选 **B0**（推荐）/ B1 / B2？
4. **DEC-3**：同事口径选 **(a)**（推荐）/ (b) / (c)？

确认后由 PM 归档为阶段 4/5 冻结决定，并分派：`workflow/labels.py` + 契约文档 + 生成物重建（工作流/规则边界）、`request` 字段调整（工作流）、文档口径更正（阶段 2）。

## 决定结果（2026-10-30，已生效）

| 决策 | 结果 |
| --- | --- |
| DEC-1 | 新增 `pursuit`＝追求对象，与 `partner` 并列互斥；`partner` 中文统一为"恋人" |
| DEC-1b | 选 **A**：`request` 新增 `recipient_relation_id`（机器值），保留 `recipient_relation` 中文；validator 不改（`rules.py:119–157` 对 request 无字段白名单） |
| DEC-2 | 选 **B0**：`interests: []` + `interest_confidence: {}`，不引入 `unknown` 机器值 |
| DEC-3 | 选 **(b)** 同事完全移出产品场景；**机器枚举保留 `colleague`，标注"仅技术回归"**（避免破坏 46 项本地探针与 `workflow/examples/intake.json`） |
| DEC-4 | 两层契约成立：intake 输入用稳定 ID；`request` 同时也带中文显示文本与 `recipient_relation_id` |
| DEC-5 | 错误码补漏仍待执行（阶段 5） |

**仍未落地（等待阶段 4/5 执行）：** `workflow/labels.py` 增加 `pursuit` → `python workflow/build_code_node.py` 重建 5 个生成物；`docs/intake-contract.md` 关系枚举与兴趣口径同步；`workflow/intake.py` 输出 `recipient_relation_id`；`workflow-spec.md` 错误码补漏。
