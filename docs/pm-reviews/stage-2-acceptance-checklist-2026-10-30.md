# 阶段 2 验收清单：产品设计 / 用户故事 / PRD（PM 对照 Issue #1 权威）

- 日期：2026-10-30（北京时间）
- 验收人：GiftWise｜PM Agent
- 受验文件：[`docs/product-requirements.md`](../product-requirements.md)、[`docs/user-stories.md`](../user-stories.md)、[`docs/product-flow.md`](../product-flow.md)、[`docs/acceptance-criteria.md`](../acceptance-criteria.md)
- 受验版本：**临时提交 `8e8bc27`（未验收、未推送）**
- 依据：[Issue #1 产品定位](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/1)（**定位唯一权威**）、[Issue #3 WEB-WF-001](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/3)（低负担输入任务单）、[Issue #4 阶段 1–14](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/4)、`docs/competition/AI比赛评分规则-赛道B原文.md`、[`docs/requirements-analysis.md`](../requirements-analysis.md)（阶段 1 冻结件）

## 0. 验收结论

**条件通过——待产品负责人对第 2 节 7 项拍板后，再由 PM 标记"阶段 2 冻结"。**

- 4 份文件的主体内容与 Issue #1 定位**不冲突**（见第 1 节 13 项通过项），产品逻辑完整，可作为阶段 3 的输入。
- 但存在 **7 项必须由产品负责人决定的问题**（第 2 节），其中 D-2 与 D-4 会直接决定阶段 4/5 的机器值；D-3 决定演示与测试口径。
- 4 份文件第 3 行均自称"产品对齐完成，待实现与验证"，而 Issue #4 阶段 2 状态为「**待产品负责人对齐**」→ 状态口径不一致（C-1）。
- 在本清单闭环前，这 4 份文件**不作为已验收基线**；相关临时提交不视为验收通过。

## 1. 与 Issue #1 一致（通过项）

| 编号 | Issue #1 要求 | 受验位置 | 判定 |
| --- | --- | --- | --- |
| A-1 | 恋人及追求对象为最高频核心目标；其次朋友；再次职场上司、亲戚家人 | `product-requirements.md:9–:13`；`user-stories.md` US-01/US-02/US-03 | 通过 |
| A-2 | 恋人与追求对象不能合并；不假设对方心意或双向好感 | `product-requirements.md:10`、`:58`；`product-flow.md:52`；`acceptance-criteria.md:11`、`:28`；US-02 | 通过 |
| A-3 | 三方案 → 独立代码校验 → 最多一次修订并重检 | `product-requirements.md:47`、`:66–:67`；`product-flow.md:9–:28`；`acceptance-criteria.md:15–:19` | 通过 |
| A-4 | 用户自己选择通过项，系统不擅自替选 | `product-requirements.md:68`；`acceptance-criteria.md:17`；US-06 | 通过 |
| A-5 | 选择后才生成呈现内容，且顺序为风格配色→包装→贺卡及装饰→赠送时机话术 | `product-requirements.md:49–:54`；`acceptance-criteria.md:20`；US-07 | 通过 |
| A-6 | 跨两阶段合计最多一次自动业务修订 | `product-requirements.md:56`；`acceptance-criteria.md:18` | 通过 |
| A-7 | 分离用户事实／模型推断／仍未知，不编造 | `product-requirements.md:18`、`:37`；`acceptance-criteria.md:13` | 通过 |
| A-8 | 预算与准备天数不得静默补默认值 | `product-requirements.md:33`；`acceptance-criteria.md:8–:10`；US-04 | 通过 |
| A-9 | 首版仅人民币 CNY，不静默换汇 | `product-requirements.md:31`；`acceptance-criteria.md:10` | 通过 |
| A-10 | 不承诺对方一定喜欢；无真实商品源时价格与时间仅为估算 | `product-requirements.md:18`、`:75`；`acceptance-criteria.md:40` | 通过 |
| A-11 | 网站默认简体中文 | `acceptance-criteria.md`、`product-flow.md` 全文中文 | 通过 |
| A-12 | 同事生日案例保留为技术回归基线 | `product-requirements.md:14` | **部分不一致**，见 D-3 |
| A-13 | 未知可以留空，不编造 | US-03；`product-flow.md` 状态表 | 通过 |

## 2. 必须由产品负责人拍板（冲突项）

### D-1｜阶段状态口径
`product-requirements.md:3`、`user-stories.md:3`、`product-flow.md:3`、`acceptance-criteria.md:3` 均写「产品对齐完成，待实现与验证」，Issue #4 阶段 2 写「待产品负责人对齐」。
→ **请确认阶段 2 是否视为对齐完成。** 未确认前 PM 不把"产品对齐完成"当作事实。

### D-2｜关系枚举在三个权威处不一致（**最高优先，阻塞产品核心场景**）
| 来源 | 关系取值 | 追求对象 | 同事 | 恋人用词 |
| --- | --- | --- | --- | --- |
| Issue #1（定位权威） | 追求对象为最高优先；同事"仍可覆盖，但不能反过来主导" | 有（最高优先） | 可覆盖 | "恋人" |
| Issue #3（已发布任务单）第一步对象单选 | 朋友、同事、伴侣、家人、同学、老师/导师、客户/合作伙伴、其他 | **无** | 有 | **"伴侣"** |
| `product-requirements.md:26` | 恋人、追求对象、朋友、家人、同学、老师／导师、客户／合作伙伴、其他 | 有 | **无** | "恋人" |
| `workflow/labels.py:3`（代码） | friend/colleague/partner/family/classmate/mentor/client_partner/other/unknown | **无** | 有 | "伴侣" |

→ **请确认最终关系集合与中文口径。** 该项直接决定契约草案的 DEC-1 / DEC-3。当前后果是：**产品最高优先场景"追求对象"在链路上无法提交**（会被 `workflow/intake.py` 拒为 `INTAKE_UNKNOWN_LABEL`）。

### D-3｜同事的最终地位（三选一）
- Issue #1 原文：同事仍可覆盖，但不能主导产品定位；同事生日案例保留为技术回归基线。
- `product-requirements.md:14`：「同事送礼场景从产品主展示和验收范围中移除，不再作为产品场景保留」——**比 Issue #1 更严**。
- `acceptance-criteria.md:12`：同事"不出现在产品主场景、主导航和验收案例中"。
- 但 `docs/demo-script.md:8`、`:17`、`workflow/workflow-spec.md:9`、`docs/test-plan.md:7` **仍以"同事生日"为首验收/演示场景**。

→ 请选 (a) 按 Issue #1 原文修正下游文档 / (b) 完全移出（需先修改 Issue #1 正文）/ (c) 保留为次要演示场景。详细选项与代价见契约草案 DEC-3。

### D-4｜"暂时不知道 / 不确定"与兴趣可信度
- `product-requirements.md:37`：把"暂时不知道"列为兴趣标签之一，并写可信度有 `confirmed`、`inferred`、`unknown` **三值**。
- `acceptance-criteria.md:13`、`user-stories.md:27–:29`（US-05）：用"未知"作为第三态。
- Issue #3 第二步：「未确认前默认 inferred；**未知用 unknown**」。
- `docs/intake-contract.md:17/:18/:42` 与 `workflow/intake.py:93`：只接受 `confirmed`/`inferred`，**未知用空数组**；`unknown` 会被 `INTAKE_CONFIDENCE_MISMATCH` 拒绝。

→ 请拍板三选一，见契约草案 DEC-2（推荐 B0）。

### D-5｜"约 60 秒完成输入"的地位
`product-requirements.md:22` 写"目标约 60 秒，实际完成时间待测"。
→ 请确认：**维持"待测目标"**（当前不列入验收项，Issue #3 也要求记录真实耗时后才能宣称），还是升为可验收指标。

### D-6｜第三优先级关系的用户故事缺失
US-01…US-08 只覆盖恋人、追求对象、朋友。职场上司、亲戚家人、同学、老师/导师、客户/合作伙伴**没有用户故事**，而 Issue #1 把它们列为第三优先级。
→ 请确认：补 P1 用户故事，还是明确"MVP 不单独覆盖"。

### D-7｜第三优先级场景是否进入 P0 验收
`acceptance-criteria.md:27–:36` 的场景验收只有恋人、追求对象、朋友与通用边界。
→ 同 D-6，请一并确认。

## 3. 需更正的表述（不改需求，只改口径）

| 编号 | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| C-1 | 4 份文件的第 3 行 | 写"产品对齐完成"，与 Issue #4「待产品负责人对齐」不一致 | D-1 确认前改为"待产品负责人对齐" |
| C-2 | `acceptance-criteria.md:49` | 把"可运行闭环、中文状态、异常处理、真实测试记录和 README"列在"**本产品证据**"列，但当前不存在可运行闭环 | 移入"需要交付/目标证据"列，或标注"待补"（阶段 1 冻结件 OPEN-9） |
| C-3 | `product-requirements.md:37`、`:39` | "暂时不知道"被当作兴趣标签；风格含"不确定"却无对应机器值 | 依赖 D-4 结论后统一 |
| C-4 | `product-requirements.md:26` 与 `workflow/labels.py:3` | 文档"恋人" vs 代码"伴侣"，且 `workflow/intake.py` 会把中文串写入模型输入 | 依赖 D-2 结论后统一（契约草案 OPEN-4） |
| C-5 | `product-requirements.md:39` vs Issue #3 第二步 | 标签中文措辞不完全逐字一致（如"有趣能带来惊喜" vs "有趣且能带来惊喜"） | 标签 ID 与中文在阶段 5 统一，逐字冻结 |
| C-6 | `product-requirements.md:89` | 自述"契约差异待 PM 处理" | 待 D-2/D-4 拍板后由 PM 关闭该段 |

## 4. 覆盖缺口（不阻塞，需登记）

| 编号 | 缺口 | 建议归属 |
| --- | --- | --- |
| G-1 | "低负担输入"的 P0 验收项（跳过、返回、状态不丢失、互斥、窄屏可操作、中文错误）只在 Issue #3，未进入 `acceptance-criteria.md` | 阶段 2 收编 |
| G-2 | 可观测性验收（运行 ID、候选版本、校验输出、修订计数、错误、调用记录）在 `product-requirements.md:71` 提到，验收标准未列；评分规则赛道 B 要求"可观测性证据" | 阶段 2 补，阶段 12–14 取证 |
| G-3 | 评分规则 1.2 赛道 B 明确要求独立的**「异常处理说明」**（工具失败、模型输出异常、超时、重试、状态恢复、人工介入） | 阶段 2 登记，阶段 3 架构负责成文 |
| G-4 | 无成本／性能指标清单（赛道 B 占 10 分） | 阶段 2 给"需测量指标"，阶段 12 实测 |

## 5. 后续动作

1. 产品负责人对 D-1…D-7 拍板（可只回编号 + 选择）。
2. 4 份文件按结论更新，并处理 C-1…C-6、登记 G-1…G-4。
3. PM 复验后标记**阶段 2 冻结**，再进入阶段 3（技术方案设计）。
4. 本清单与阶段 1 冻结件的未决项（OPEN-1…OPEN-9）合并跟踪，不重复建账。

## 6. 决定结果（2026-10-30）

产品负责人已对第 2 节拍板，并与 Issue #1／#3／#4 正文同步（均在 Issue 评论中记录变更）：

| 编号 | 决定 |
| --- | --- |
| D-1 | 阶段 2 视为对齐完成；四份文档状态行已更新，剩余为 G-1…G-4 内容补充 |
| D-2 | 关系枚举冻结为 8 个稳定 ID，**新增 `pursuit`（追求对象）**；`partner` 中文统一为**"恋人"**；**同事完全移出** |
| D-3 | 选 **(b) 同事完全移出产品场景**（界面、导航、演示脚本、验收案例）；机器枚举保留 `colleague`，标注"仅技术回归" |
| D-4 | 选 **B0**：兴趣"未知"不是机器值，提交为 `interests: []` + `interest_confidence: {}`；`interest_confidence` 只接受 `confirmed`/`inferred` |
| D-5 | "约 60 秒"维持**待测目标**，不列入验收项 |
| D-6／D-7 | 第三优先级关系（职场上司、亲戚家人、客户、老师/导师等）**MVP 不单独覆盖，登记为 P1** |
| DEC-1b | 选 **A**：`request` 新增 `recipient_relation_id`（服务端 intake 产出，前端不提交） |

**已完成的本地收口：** C-1（状态行）、C-2（`:49` 夸大表述）、C-3（兴趣未知口径）、C-4（恋人／伴侣口径）、C-6（契约差异段关闭）已更正；G-1…G-4 已在 `acceptance-criteria.md` 登记。

**分配到其他线、PM 不改的项：** `docs/demo-script.md`、`docs/test-plan.md`、`workflow/workflow-spec.md` 中的"同事生日"首场景口径，以及 `workflow-spec.md` 的错误码清单，分别在发布／测试／工作流任务单中处理（避免多人同时改同一文件）。
