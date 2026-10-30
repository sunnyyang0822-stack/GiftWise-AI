# 材料中「未发布 / 未创建版本 / 版本 #1」类表述清单

扫描时间：2026-10-31 00:3x（**版本 #2 已发布之后**）

匹配模式：`未发布|未创建版本|版本 #1|版本#1|无版本|尚无版本|没有版本|未上线|未创建任何版本`

排除：`node_modules/`、`.git/`、`.tmp/`、本目录自身。

共 **38 个文件 / 188 处**。

> 这是**扫描原始结果**，未替 PM 判断哪些该改。第 3 节给出我的分类建议。

## 1. 原始清单（文件:行号 + 原句）

### `docs/acceptance-criteria.md`（3 处）
- **docs/acceptance-criteria.md:35** — - **Dify 工作流未发布、未创建版本**：`toolPublished: false`、`version: "draft"`。草稿内的**真实模型调用已完成**（DeepSeek，10 次调用 / 34,127 tokens，`workflow/evidence/WF-003-2026-10-30.md` §4）。
- **docs/acceptance-criteria.md:211** — | Agent 链路 | 三步结构化输入→三候选→检查→一次修订→选择→四段呈现→复核；Dify 草稿内**真实模型**已产出三候选、真实违规、真实修订与真实持续失败 | 链路在 `web/` 是 **mock**；Dify 呈现阶段**未实现**；Dify **未发布** |
- **docs/acceptance-criteria.md:230** — - **Dify 未发布**：`toolPublished: false`、`version: "draft"`；平台级 `trace-runs` 为 `not_collected`。

### `docs/architecture/ARCH-001-report-2026-10-30.md`（4 处）
- **docs/architecture/ARCH-001-report-2026-10-30.md:37** — `workflow/`、`validator/`、`tests/`、`web/`、`deploy/`、`docs/intake-contract.md`、`docs/product-requirements.md`、`docs/acceptance-criteria.md`、`docs/requirements-analysis.md`、`AGENTS.md` 均**未修改**。未执行 `git add .`、未提交、未推送、未发布 Dify 草稿、未创建版本、未使用 `workflow/tools/gh-cred.py`。
- **docs/architecture/ARCH-001-report-2026-10-30.md:145** — 2. Dify 草稿**未发布**（`tool_published: false`），未创建版本。
- **docs/architecture/ARCH-001-report-2026-10-30.md:217** — 2. **Dify 草稿未发布**（`tool_published: false`）、未创建版本；完整业务闭环的对外可演示版本**尚未冻结**。
- **docs/architecture/ARCH-001-report-2026-10-30.md:235** — **本轮未做**：未 `git add .`、未提交、未推送、未发布 Dify 草稿、未创建版本、未采购云资源、未使用 `gh-cred.py`、未调用任何付费模型。

### `docs/architecture.md`（2 处）
- **docs/architecture.md:61** — | Dify 草稿发布 | **未发布**（`tool_published: false`、`version: draft`）；未创建版本（WF-003 §3.2） |
- **docs/architecture.md:99** — subgraph Z3["③ 编排层｜Dify Cloud 1.18.0 草稿（未发布）"]

### `docs/competition/材料清单与自查.md`（7 处）
- **docs/competition/材料清单与自查.md:21** — | 版本快照 / commit | 外部仓库须同时提交代码快照或版本号 | 见第二节 | **本地快照信息已整理**；**快照未发布** |
- **docs/competition/材料清单与自查.md:29** — | Agent 执行流程 | 任务规划、工具调用、上下文与状态管理、多步骤执行 | `workflow/workflow-spec.md`、`答辩PPT骨架.md` 第 4 页 N1–N7、`workflow/evidence/WF-003-2026-10-30.md` | **已接线（11 节点 11 边）并有真实运行证据**（5 类用例）；未完成项见 **B2-5…B2-10**（未发布未建版本、trace 不可用、N4 ELSE 未触发、无自然 `OVER_BUDGET`/`FORBIDDEN_TAG` 证据、修复后修订路径无运行时证据、Dify 侧呈现阶段未实现） |
- **docs/competition/材料清单与自查.md:128** — | B2-5 | 工作流未发布、未创建版本（当前是草稿状态） | 草稿实读 |
- **docs/competition/材料清单与自查.md:162** — | Agent 执行流程（1.2） | 已接线 11 节点 11 边 + 5 类用例真实运行 | **B2-5…B2-10**（未发布、trace、ELSE、无自然触发证据、修复后路径、呈现阶段） | 工作流线 |
- **docs/competition/材料清单与自查.md:223** — 3. **版本快照未发布**：本地 HEAD `89d6624` 未推送；工作区仍有 38 项未提交改动；**提交用的快照需由 PM 决定后冻结**。
- **docs/competition/材料清单与自查.md:233** — | B-2 | **Dify 草稿未发布、未创建版本** | 现场只能演示**草稿**运行，不得称「已上线」 | PM 决定是否发布；本 Agent **未点击发布** |
- **docs/competition/材料清单与自查.md:247** — - **纪律**：未提交、未推送、未发布 Dify 草稿、未采购任何云资源；所有"未完成"项均在材料中显式标注，未以任何形式伪装为已完成。

### `docs/competition/答辩PPT骨架.md`（5 处）
- **docs/competition/答辩PPT骨架.md:16** — > 6. Dify 工作流**未发布、未创建版本**；若现场使用的代码/模型/配置与提交版本不同，**开场主动说明**（评分规则 1.4）。
- **docs/competition/答辩PPT骨架.md:40** — - B2 Dify：未发布未建版本；trace 不可用；N4 ELSE 未触发；无自然 `OVER_BUDGET` / `FORBIDDEN_TAG` 证据；Dify 侧呈现阶段未实现。
- **docs/competition/答辩PPT骨架.md:133** — - **B 未完成**：**未发布、未创建版本**；**trace 不可用**（`not_collected`）；**N4 ELSE 未触发**；**无自然 `OVER_BUDGET` / `FORBIDDEN_TAG` 证据**；**Dify 侧呈现阶段未实现**；**未上云、未推镜像仓库**。
- **docs/competition/答辩PPT骨架.md:275** — 5. 工作流**未发布、未创建版本**（当前是草稿状态）。
- **docs/competition/答辩PPT骨架.md:336** — - ❌「已发布 / 已创建版本」（Dify 工作流未发布、未创建版本）

### `docs/demo-script.md`（12 处）
- **docs/demo-script.md:13** — > 3. Dify 工作流**未发布、未创建版本**（B5）。现场打开的是**草稿**，说辞必须是"草稿真实运行"。
- **docs/demo-script.md:70** — | 1 | Dify Cloud 可登录、草稿 App 可打开 | 草稿处于**未发布**状态，能点「运行」 | 切模式 B/C；**不点发布** |
- **docs/demo-script.md:118** — | **0:00–0:20** | "给追求对象送礼最难的不是买东西，是分寸：既不想冷淡，也不能假定对方已经接受你。今天主路径是**真实运行的 Dify 工作流**。先说明边界：这是**草稿**，**没有发布**；后面的页面是**界面预览，数据是模拟的**。" | 打开 Dify 草稿 App（停在**未发布**状态） | 草稿画布、11 节点、"未发布"标识 | 真实环境（草稿未发布） |
- **docs/demo-script.md:124** — | **2:45–3:00** | "收尾讲边界：工作流**未发布、未创建版本**；**云部署从未发生**；**未推镜像仓库**、无 K8S；Dify 侧呈现阶段未实现；**价格与库存未核实**；DeepSeek **单价未从真实账单核实**。已实测的是本机 46 条探针、322 条单测，Dify 真实 10 次模型调用 34,127 tokens，以及本机 Docker 实测 9/9。" | 展示第 8 页两栏 | A 组 7 条 / B 组 17 条 | 真实记录 |
- **docs/demo-script.md:211** — | D1 | Dify 草稿画布（11 节点 11 边，含「未发布」标识） | 草稿实读 | **未制作** |
- **docs/demo-script.md:231** — | **S2** | 0:15–0:35 | Dify 草稿画布（11 节点 11 边），停在**未发布** | 缓慢平移；**不要**点发布 | "主路径是真实运行的 Dify 工作流；这是**草稿**，**没有发布**。" | **草稿 · 未发布** |
- **docs/demo-script.md:236** — | **S7** | 2:45–3:00 | 第 8 页两栏（A 组 7 条 / B 组 17 条） | 定格 3 秒强调右栏 | "未完成 17 条我不美化：未上云、未推镜像、无 K8S、未发布、呈现阶段未实现、价格库存未核实。" | **未完成项如实列出（B1–B4）** |
- **docs/demo-script.md:242** — - [ ] S2 画面中可见「未发布」状态
- **docs/demo-script.md:294** — 5. 工作流未发布、未创建版本（当前是草稿状态）。
- **docs/demo-script.md:352** — 6. **B 组 17 条中多条无法由本 Agent 消除**（未上云、未推仓库、未发布、trace、ELSE 分支等）。
- **docs/demo-script.md:359** — | Dify 工作流未发布、未创建版本 | 现场只能演示**草稿** | PM 决定是否发布；本 Agent **未点击发布** |
- **docs/demo-script.md:366** — > 本 Agent 未提交、未推送、未发布 Dify 草稿、未采购云资源；本脚本中所有"未完成"项均如实标注。

### `docs/pm-reviews/flow-status-14-stages-2026-10-30.md`（2 处）
- **docs/pm-reviews/flow-status-14-stages-2026-10-30.md:37** — | 2 | Dify 草稿最新状态读回 + 明确写"**未发布、未创建版本**" | 工作流线 | 既是 #7 验收条件，**也是现场 Demo 可运行性的前提** |
- **docs/pm-reviews/flow-status-14-stages-2026-10-30.md:47** — - **Dify 工作流未发布、未创建版本**；平台级 trace 不可用（租户未开 tracing）。

### `docs/product-flow.md`（1 处）
- **docs/product-flow.md:6** — - 适用边界：以下流程是**设计约定**。`web/` 以 **mock** 运行；Dify **未发布**（`draft`，`toolPublished: false`）且**呈现阶段未实现**；**云未部署**；价格与库存**未核实**。流程各节点“是否已被真实证据验证”见 [`acceptance-criteria.md`](acceptance-criteria.md)。

### `docs/product-requirements.md`（1 处）
- **docs/product-requirements.md:142** — - **Dify 未发布**：`toolPublished: false`、`version: "draft"`；平台级 `trace-runs` 为 `not_collected`（该租户无平台追踪）。

### `docs/test-reports/stage-c/acceptance-2026-10-30.md`（6 处）
- **docs/test-reports/stage-c/acceptance-2026-10-30.md:14** — | 草稿 `GiftWise｜推荐工作流开发草稿` 未发布 | **已核实** | 服务端 `tool_published: false`；UI「未发布」；**我未点击发布** |
- **docs/test-reports/stage-c/acceptance-2026-10-30.md:44** — **未读取**个人 Chrome 配置、Cookie、API Key 或任何凭证（个人 Chrome 进程使用 `AppData\Local\Google\Chrome\User Data`，与本任务无关，未干预）。**未点击发布、未创建版本。**
- **docs/test-reports/stage-c/acceptance-2026-10-30.md:123** — | 草稿发布状态 | 未发布 | `tool_published: false`、UI「未发布」 | **一致** |
- **docs/test-reports/stage-c/acceptance-2026-10-30.md:250** — **诚实性核查（正面）**：该线**未伪造能力**——`config.mjs` 明确写"⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify"；`cloud_verified=false`；`business_data_verification=not_verified`。这与我的独立观测一致。
- **docs/test-reports/stage-c/acceptance-2026-10-30.md:342** — 2. 草稿 `GiftWise｜推荐工作流开发草稿`（App ID `5abdb13c-a633-4a9c-96c3-dabd44072511`）**未发布**；`tool_published: false`；**我未点击发布、未创建版本**。
- **docs/test-reports/stage-c/acceptance-2026-10-30.md:409** — **未提交、未推送、未 `git add .`、未发布 Dify 草稿、未创建版本、未调用任何付费模型。**

### `docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205739.json`（3 处）
- **docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205739.json:142** — "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。",
- **docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205739.json:213** — "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。",
- **docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205739.json:229** — "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。",

### `docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205816.json`（4 处）
- **docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205816.json:45** — "mock_mode_notice_sample": "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型",
- **docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205816.json:152** — "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。",
- **docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205816.json:223** — "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。",
- **docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205816.json:239** — "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。",

### `README.md`（3 处）
- **README.md:179** — - [ ] **Dify 草稿发布**：`tool_published: false`，页面持续显示「未发布」。**未上线、未部署。**
- **README.md:213** — | Dify（Cloud 1.18.0） | 模型编排与 Code 节点 | **草稿未发布**；仅 Code 探针真实执行过 | 平台承担编排与节点调度，减少自建工作流框架的工程量 |
- **README.md:225** — 1. 本项目**未部署**，没有在线体验地址；Dify 草稿**未发布**。

### `web/HANDOFF-2026-10-30.md`（2 处）
- **web/HANDOFF-2026-10-30.md:177** — `title` 说明 Dify 未发布、不是模型真实输出。真实模式下变绿并显示「真实 Dify」。
- **web/HANDOFF-2026-10-30.md:179** — 「⚠ 界面预览用的是模拟数据：Dify 礼赠工作流尚未发布……独立规则校验、选择门槛与修订计数是真实实现。」

### `web/README.md`（1 处）
- **web/README.md:16** — **当前是模拟数据模式。** Dify 侧礼赠工作流未发布（草稿只有「用户输入 → 代码执行」两个节点、无模型、无结束节点），

### `web/REPORT-WEB-001.md`（4 处）
- **web/REPORT-WEB-001.md:248** — 界面上的模拟标识：顶部常驻黄色横幅（`MOCK_MODE_NOTICE`，含"Dify 未发布、不是模型真实输出、没有联通"）、
- **web/REPORT-WEB-001.md:317** — - 未配置/未发布时不静默回退：`GW_MODE=dify` 起实例后请求返回 503 `DIFY_NOT_CONFIGURED` 且零候选。
- **web/REPORT-WEB-001.md:328** — **从未成功调用过一次**（无凭证、工作流未发布、`DIFY_PUBLISHED_VERIFIED=0`）。
- **web/REPORT-WEB-001.md:494** — 现在的阻塞不再是"未发布"，而是**两个需要 PM 拍板的契约分歧**：

### `web/server/config.mjs`（3 处）
- **web/server/config.mjs:27** — *   - Dify 侧仍是未发布的草稿，未重新导入生成物，cloud_verified=false；
- **web/server/config.mjs:56** — /** 契约已落地时给用户的如实说明（含未提交、Dify 未发布等限制）。 */
- **web/server/config.mjs:63** — "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），" +

### `web/server/dify.mjs`（1 处）
- **web/server/dify.mjs:11** — * 但本机无凭证、Dify 侧仍是未发布草稿，**从未实际调用成功过一次**。

### `web/server/mock-model.mjs`（1 处）
- **web/server/mock-model.mjs:4** — * 为什么是模拟：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，

### `workflow/evidence/WF-001-2026-10-29.md`（2 处）
- **workflow/evidence/WF-001-2026-10-29.md:50** — 通过 Dify Cloud UI 创建了独立草稿：`GiftWise｜推荐工作流开发草稿`，应用 ID `5abdb13c-a633-4a9c-96c3-dabd44072511`。草稿创建接口返回 201，草稿读取接口返回 200，初始 draft 图为空；随后 UI 已添加“用户输入”开始节点和“代码执行”节点，自动保存页面显示未发布。该草稿没有改动原有 Giftwise 应用。
- **workflow/evidence/WF-001-2026-10-29.md:52** — 尚未在真实 Dify Cloud 运行 sandbox_probe 或提交生成的 Code 源码；Code 节点的输入/输出和 Python 内容仍未完成保存验证。未配置真实模型、未执行生成/模型修订，未导入新 DSL、未发布。Code 标准库兼容性仅本地探针通过；真实租户版本虽已确认，节点代码容量和输出类型仍待确认。真实模型费用/额度与调用授权待确认。本报告的 46 项不能证明线上接通。

### `workflow/evidence/WF-002-2026-10-30.md`（5 处）
- **workflow/evidence/WF-002-2026-10-30.md:5** — 本轮最终状态：**Dify 草稿中的 Code 节点已在真实 Dify Cloud 沙箱执行成功并产出预期输出**（20:20:54）。**完整业务工作流仍未验证，草稿仍未发布，模型调用仍未发生。**
- **workflow/evidence/WF-002-2026-10-30.md:13** — | 尚未发布的 Dify 草稿 | 页面持续显示 `未发布`；本轮**没有**点击发布，也没有创建版本。 |
- **workflow/evidence/WF-002-2026-10-30.md:28** — - 发布状态：`tool_published: false`，页面显示 `未发布`。
- **workflow/evidence/WF-002-2026-10-30.md:159** — 未提交、未推送；未发布 Dify 草稿；未修改 `validator/`、`workflow/generated/` 或任何规则源码。
- **workflow/evidence/WF-002-2026-10-30.md:164** — - **复核成立**：Dify 1.18.0；草稿未发布（`tool_published: false`）；2 节点 1 边且无结束节点，工作流级输出 `{}`；Code 节点在真实沙箱执行成功；`total_tokens: 0`、`exceptions_count: 0`；`trace-runs` 为 `not_collected`。

### `workflow/evidence/WF-003-2026-10-30/tools/scan-stale-claims.py`（4 处）
- **workflow/evidence/WF-003-2026-10-30/tools/scan-stale-claims.py:3** — """扫描材料中「未发布 / 未创建版本 / 版本 #1」类表述，输出带行号与原句的清单。"""
- **workflow/evidence/WF-003-2026-10-30/tools/scan-stale-claims.py:27** — PAT = re.compile(r"未发布|未创建版本|版本 #1|版本#1|无版本|尚无版本|没有版本|未上线|未创建任何版本")
- **workflow/evidence/WF-003-2026-10-30/tools/scan-stale-claims.py:53** — "# 材料中「未发布 / 未创建版本 / 版本 #1」类表述清单",
- **workflow/evidence/WF-003-2026-10-30/tools/scan-stale-claims.py:57** — "匹配模式：`未发布|未创建版本|版本 #1|版本#1|无版本|尚无版本|没有版本|未上线|未创建任何版本`",

### `workflow/evidence/WF-003-2026-10-30.md`（49 处）
- **workflow/evidence/WF-003-2026-10-30.md:21** — | D Dify 发布与创建版本 | **完成** | 2026-10-30 23:04 已发布并创建版本 #1（页头「已发布」，发布菜单项变为「发布更新」）。**未上云、未部署、未推镜像** |
- **workflow/evidence/WF-003-2026-10-30.md:27** — > **2026-10-30 23:04（+08:00）之前**：草稿未创建版本、未发布（页头「未发布」）。
- **workflow/evidence/WF-003-2026-10-30.md:28** — > **2026-10-30 23:04 起**：**已发布，并创建版本 #1**；页头变为「**已发布 几秒前**」，发布菜单项由「发布」变为「发布更新」。详见第 10 节与 `dify-publish-success-evidence.txt`。
- **workflow/evidence/WF-003-2026-10-30.md:30** — > ⚠️ **一处必须纠正的旧判断**：我此前把 `tool_published = false` 当作"未发布"的证据，**这是错的**。`tool_published` 只表示"**是否作为工具供其他应用调用**"（界面原文：工作流作为工具「需要进行配置」），与"应用/工作流是否已发布"无关——**发布后它仍然为 `false`**。同理 `version = "draft"` 与 `version_number = null` 描述的是**当前草稿行**（发布后平台会新建一条干净的草稿），也**不能**用来判断应用有没有发布。**判断发布状态请看页头与版本记录，不要看这三个字段。**
- **workflow/evidence/WF-003-2026-10-30.md:312** — **草稿状态：`tool_published = false`、`version = "draft"`、`version_number = null`、`marked_name = ""`、页面显示"未发布"。未点发布、未创建任何版本。**（UI 截图见 `dify-draft-graph.png`，自动保存时间 20:57:57，右上角标注"未发布"。）
- **workflow/evidence/WF-003-2026-10-30.md:477** — > **结论：本工作流草稿未创建版本、未发布。**
- **workflow/evidence/WF-003-2026-10-30.md:485** — | 草稿页页头 | 显示「**未发布**」（`pageHasUnpublishedLabel = true`） | UI 截图 + 页面文本 |
- **workflow/evidence/WF-003-2026-10-30.md:487** — 同一结论在 21:03、21:08、21:17、21:18、22:40 五次实读中一致。**未执行任何发布操作，未创建任何版本快照。**
- **workflow/evidence/WF-003-2026-10-30.md:522** — | `toolPublished` / `version` / `version_number` | `false` / `"draft"` / `null` | 未发布、无版本 |
- **workflow/evidence/WF-003-2026-10-30.md:757** — | `dify-draft-graph-with-llm.png` | UI 截图，N2/N5 显示 `deepseek-v4-flash CHAT`，右上角"未发布" |
- **workflow/evidence/WF-003-2026-10-30.md:760** — | `dify-post-change-ui-2026-10-30T2240.png` | 22:40 草稿页截图（页头「未发布」） |
- **workflow/evidence/WF-003-2026-10-30.md:809** — - [x] 草稿 `tool_published = false`、`version = "draft"`、`version_number = null`、页面显示"未发布"——**未发布、未创建任何版本**。
- **workflow/evidence/WF-003-2026-10-30.md:836** — - [x] **条件 2**：`toolPublished=false`、`version="draft"`、`version_number=null`、页头「未发布」与**「未创建版本、未发布」**已写入**同一处结论**（第 0 节「发布状态定论」方框 + 3.6 节详表）。
- **workflow/evidence/WF-003-2026-10-30.md:845** — - [x] **已发布并创建版本 #1**（2026-10-30 23:04 +08:00）：界面提示「操作成功」、发布菜单项变为「已发布」且 disabled、弹层出现版本记录「# 1」、页头由「未发布」变为「已发布 几秒前」。7 张截图 + 逐字证据文本已归档。
- **workflow/evidence/WF-003-2026-10-30.md:847** — - [x] **纠正了自己的错误判断**：`tool_published=false` 与"未发布"无关；`version="draft"`、`version_number=null` 描述的是草稿行，均不能证明发布状态。已在第 0 节方框与 10.5 节就地更正。
- **workflow/evidence/WF-003-2026-10-30.md:860** — - [x] 未执行 git add / commit / push；未发布；未创建版本。
- **workflow/evidence/WF-003-2026-10-30.md:887** — - [ ] **是否有可用的版本列表 API**：`/workflows/draft/versions`→404、`/workflows/versions`→405、`/workflows/publish`→401、`/workflows/draft/publish`→404，均未返回版本列表。**「版本 #1」的证据只来自界面与截图，不是 API**。
- **workflow/evidence/WF-003-2026-10-30.md:897** — 2. 本轮发布改变的是 Dify **应用内部的版本状态**（草稿 → 已发布 + 版本 #1），它并不等于本项目获得了对外服务；本项目**从未部署、没有在线体验地址**（`README.md` 已如此声明，本报告不改变该结论）；
- **workflow/evidence/WF-003-2026-10-30.md:1101** — - `dify-published-header-2305.png` —— 页头 **「自动保存 23:05:02 · 已发布 几秒前」**（发布前是「未发布」）
- **workflow/evidence/WF-003-2026-10-30.md:1104** — **结论：已发布，并创建版本 #1。** 未上云、未部署、未推镜像仓库——发布只发生在这个 Dify 应用内。
- **workflow/evidence/WF-003-2026-10-30.md:1119** — | 版本记录 | **# 1**（弹层显示「Dify 发布于 几秒前」） | 已创建版本 #1 |
- **workflow/evidence/WF-003-2026-10-30.md:1120** — | 发布菜单项 | 「发布」→ **「发布更新」** | 表示当前无未发布改动 |
- **workflow/evidence/WF-003-2026-10-30.md:1133** — - **我上一轮把 `tool_published=false` 当成"未发布"的证据，判断错了**，已在第 0 节方框里就地纠正。
- **workflow/evidence/WF-003-2026-10-30.md:1136** — `/workflows/draft/publish`→404，**该版本上没有可用的版本列表端点**。因此"版本 #1"的证据来自界面与截图，**不是**来自 API 列表。
- **workflow/evidence/WF-003-2026-10-30.md:1186** — 发布动作使所有"未发布／未创建版本"的表述过期。以下为**全仓扫描结果**，请 PM 统一派发。
- **workflow/evidence/WF-003-2026-10-30.md:1189** — ### 12.1 必须改：明确写了"未发布／未创建版本"
- **workflow/evidence/WF-003-2026-10-30.md:1193** — | 1 | `README.md` | :179, :213, :225 | "Dify 草稿发布：`tool_published: false`，页面持续显示「未发布」。**未上线、未部署**"；"**草稿未发布**"；"Dify 草稿**未发布**" |
- **workflow/evidence/WF-003-2026-10-30.md:1194** — | 2 | `docs/acceptance-criteria.md` | :35, :211, :230 | "**Dify 工作流未发布、未创建版本**：`toolPublished: false`、`version: "draft"`"；"Dify **未发布**" |
- **workflow/evidence/WF-003-2026-10-30.md:1195** — | 3 | `docs/architecture.md` | :61, :99 | "Dify 草稿发布 \| **未发布**（`tool_published: false`、`version: draft`）；未创建版本"；架构图 `subgraph Z3["③ 编排层｜Dify Cloud 1.18.0 草稿（未发布）"]` |
- **workflow/evidence/WF-003-2026-10-30.md:1196** — | 4 | `docs/architecture/ARCH-001-report-2026-10-30.md` | :145, :217, :235 | "Dify 草稿**未发布**（`tool_published: false`），未创建版本"；"未发布 Dify 草稿、未创建版本" |
- **workflow/evidence/WF-003-2026-10-30.md:1197** — | 5 | `docs/competition/材料清单与自查.md` | :21, :128, :162, :223, :233（等 7 处） | "B2-5 \| 工作流未发布、未创建版本（当前是草稿状态）"；"**Dify 草稿未发布、未创建版本**"；"B2 Dify…**未点击发布**" |
- **workflow/evidence/WF-003-2026-10-30.md:1198** — | 6 | `docs/competition/答辩PPT骨架.md` | :16, :40, :133, :275, :336（等 5 处） | "Dify 工作流**未发布、未创建版本**"；"❌「已发布 / 已创建版本」" |
- **workflow/evidence/WF-003-2026-10-30.md:1199** — | 7 | `docs/demo-script.md` | :13, :70, :118, :124, :211, :231（等 12 处） | "Dify 工作流**未发布、未创建版本**（B5）。现场打开的是**草稿**"；"**不要**点发布"；"**草稿 · 未发布**" |
- **workflow/evidence/WF-003-2026-10-30.md:1200** — | 8 | `docs/pm-reviews/flow-status-14-stages-2026-10-30.md` | :37, :47 | "Dify 草稿最新状态读回 + 明确写「**未发布、未创建版本**」"；"**Dify 工作流未发布、未创建版本**" |
- **workflow/evidence/WF-003-2026-10-30.md:1201** — | 9 | `docs/product-flow.md` | :6 | "Dify **未发布**（`draft`，`toolPublished: false`）" |
- **workflow/evidence/WF-003-2026-10-30.md:1202** — | 10 | `docs/product-requirements.md` | :142 | "**Dify 未发布**：`toolPublished: false`、`version: "draft"`" |
- **workflow/evidence/WF-003-2026-10-30.md:1203** — | 11 | `docs/test-reports/stage-c/acceptance-2026-10-30.md` | :14, :44, :48, :123, :250, :342（等 7 处） | "草稿 `GiftWise｜推荐工作流开发草稿` 未发布 \| **已核实**"；"**我未点击发布**"（该断言在测试当时为真，**现在需补一句"23:04 由工作流 Agent 发布"**） |
- **workflow/evidence/WF-003-2026-10-30.md:1204** — | 12 | `web/HANDOFF-2026-10-30.md` | :159, :161 | "Dify 未发布、不是模型真实输出" |
- **workflow/evidence/WF-003-2026-10-30.md:1205** — | 13 | `web/README.md` | :16 | "Dify 侧礼赠工作流未发布（草稿只有「用户输入 → 代码执行」两个节点…）" |
- **workflow/evidence/WF-003-2026-10-30.md:1206** — | 14 | `web/REPORT-WEB-001.md` | :248, :317, :328 | "含「Dify 未发布、不是模型真实输出、没有联通」"；"工作流未发布、`DIFY_PUBLISHED_VERIFIED=0`" |
- **workflow/evidence/WF-003-2026-10-30.md:1207** — | 15 | `web/server/config.mjs` | :27, :56, :63 | "Dify 侧仍是未发布的草稿"；模拟模式提示语"⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点）" |
- **workflow/evidence/WF-003-2026-10-30.md:1208** — | 16 | `web/server/dify.mjs` | :11 | "本机无凭证、Dify 侧仍是未发布草稿，**从未实际调用成功过一次**" |
- **workflow/evidence/WF-003-2026-10-30.md:1216** — | **第 1 页** | 正文 | "B2 Dify：**未发布未建版本**；trace 不可用；N4 ELSE 未触发；无自然 OVER_BUDGET / FORBIDDEN_TAG 证据；Dify 侧呈现阶段未实现" |
- **workflow/evidence/WF-003-2026-10-30.md:1217** — | **第 4 页** | 正文 | "– **未发布、未创建版本**" |
- **workflow/evidence/WF-003-2026-10-30.md:1219** — | **第 8 页** | 正文 | "5. 工作流**未发布、未创建版本**（当前是草稿状态）。" |
- **workflow/evidence/WF-003-2026-10-30.md:1220** — | **第 8 页** | 备注页 | "…工作流**未发布未创建版本**、trace 不可用、N4 ELSE 未触发、无自然 OVER…"（属"明确未完成"十七条之一） |
- **workflow/evidence/WF-003-2026-10-30.md:1228** — - **GitHub Issue #9 的「明确未完成」清单**：其中"Dify 工作流未发布、未创建版本"一条现已过期。**我无法访问 GitHub**（本会话对 github.com 网络不可达），**需 PM 自行更新该 Issue**。
- **workflow/evidence/WF-003-2026-10-30.md:1229** — - `.tmp/` 目录（约 28 个文件，含 `browser-report.json`、`gate.json` 等）也含"未发布"字样，属临时产物，建议 PM 决定是否清理，不必逐条改。
- **workflow/evidence/WF-003-2026-10-30.md:1333** — - **没有**为版本 #1 命名。

### `workflow/tools/create-stage-issues.py`（1 处）
- **workflow/tools/create-stage-issues.py:107** — - Dify Cloud 1.18.0；草稿 `GiftWise｜推荐工作流开发草稿`（App ID `5abdb13c-a633-4a9c-96c3-dabd44072511`）**未发布**；只有 2 节点 1 边（start→code），**无结束节点**，工作流级输出恒为 `{}`。

### `workflow/tools/gen-includable-tools.py`（1 处）
- **workflow/tools/gen-includable-tools.py:45** — # 扫描材料里「未发布 / 未创建版本 / 版本 #1」类过期表述（纯文本扫描，零模型调用）

### `workflow/tools/pm-closeout.py`（2 处）
- **workflow/tools/pm-closeout.py:33** — - **复核成立**：Dify 1.18.0；草稿未发布（`tool_published: false`）；2 节点 1 边且无结束节点，工作流级输出 `{}`；Code 节点在真实沙箱执行成功；`total_tokens: 0`、`exceptions_count: 0`；`trace-runs` 为 `not_collected`。
- **workflow/tools/pm-closeout.py:61** — - PM 接受其关于 Code 节点沙箱兼容、`0 Tokens`、草稿未发布、无结束节点、`trace-runs` 为 `not_collected` 的独立结论。

### `workflow/tools/scan-stale-claims.py`（4 处）
- **workflow/tools/scan-stale-claims.py:3** — """扫描材料中「未发布 / 未创建版本 / 版本 #1」类表述，输出带行号与原句的清单。"""
- **workflow/tools/scan-stale-claims.py:16** — PAT = re.compile(r"未发布|未创建版本|版本 #1|版本#1|无版本|尚无版本|没有版本|未上线|未创建任何版本")
- **workflow/tools/scan-stale-claims.py:42** — "# 材料中「未发布 / 未创建版本 / 版本 #1」类表述清单",
- **workflow/tools/scan-stale-claims.py:46** — "匹配模式：`未发布|未创建版本|版本 #1|版本#1|无版本|尚无版本|没有版本|未上线|未创建任何版本`",

### `workflow/tools/sync-issues.py`（1 处）
- **workflow/tools/sync-issues.py:155** — - **未做**：未提交、未推送、未发布 Dify 草稿、未启用任何付费模型调用。

### `workflow/tools/tmp/c4d.md`（2 处）
- **workflow/tools/tmp/c4d.md:28** — 2. 工作流线：Dify 草稿最新读回 + 明确写「未发布、未创建版本」（既是 #7 验收条件，**也是现场 Demo 可运行性的前提**）
- **workflow/tools/tmp/c4d.md:37** — Dify 工作流未发布、未创建版本；`web/` 为 mock 模式且 Dify 侧未实现包装/配色/贺卡阶段；

### `workflow/tools/tmp/c7.md`（2 处）
- **workflow/tools/tmp/c7.md:5** — - **草稿图视觉确认**（`dify-draft-graph-with-llm.png`，画布时间 21:16:40 自动保存、页头显示"未发布"）：开始 → N1 → **N2（DeepSeek v4-flash / CHAT）** → N3 → N4 控制结果分支 → {N7A / N5（DeepSeek v4-flash / CHAT）→ N6 → N7B} → 两个 End。11 节点、双 End、LLM 节点真实存在。
- **workflow/tools/tmp/c7.md:13** — 2. **未发布状态需在证据里一句定论**：`toolPublished=false`、`version=draft`、`version_number=null`、页头"未发布"——请与"未创建版本、未发布"写进同一处结论，避免评委误读为已上线。

### `workflow/tools/tmp/c7d.md`（3 处）
- **workflow/tools/tmp/c7d.md:42** — - **与版本 #1 的语义差异**：明确写出"新增了这 5 行请求侧范围检查"（字节差异因 UUID 可能不可比，说明即可）；
- **workflow/tools/tmp/c7d.md:54** — ### 四、顺带：把"引用版本 #1 / 未发布"的位置再给我一份
- **workflow/tools/tmp/c7d.md:55** — 你上次给的 16 处过期文本清单很有用。本轮发布成版本 #2 后，材料里凡是写"未发布""未创建版本""版本 #1"

### `workflow/tools/tmp/c8.md`（1 处）
- **workflow/tools/tmp/c8.md:4** — - PM 接受其关于 Code 节点沙箱兼容、`0 Tokens`、草稿未发布、无结束节点、`trace-runs` 为 `not_collected` 的独立结论。

### `workflow/tools/tmp/c9b.md`（1 处）
- **workflow/tools/tmp/c9b.md:26** — 5. 工作流**未发布、未创建版本**（当前是草稿状态）。

### `workflow/tools/tmp/claims-classification.md`（11 处）
- **workflow/tools/tmp/claims-classification.md:6** — | 文件 | 未发布 | 未创建版本 | 版本 #1 | 未上线 | 无版本 |
- **workflow/tools/tmp/claims-classification.md:31** — **合计**：`未发布` 124、`未创建版本` 46、`版本 #1` 12、`未上线` 2、`无版本` 1。
- **workflow/tools/tmp/claims-classification.md:39** — | `README.md` | `:179`、`:213`、`:225` | 「Dify 草稿**未发布**、未上线、未部署」→ 已**发布版本 #2**；但「未部署、没有在线体验地址」**仍然成立** |
- **workflow/tools/tmp/claims-classification.md:40** — | `docs/architecture.md` | `:61`、`:99` | 「**未发布**（`tool_published: false`、`version: draft`）；未创建版本」→ 已发布 #2；`tool_published: false` 这次**仍是真的**（它只表示"未作为工具供其他应用调用"，不是发布状态） |
- **workflow/tools/tmp/claims-classification.md:41** — | `docs/acceptance-criteria.md` | `:211`、`:230` | 「Dify **未发布**」→ 已发布 #2 |
- **workflow/tools/tmp/claims-classification.md:42** — | `docs/product-flow.md` | `:6` | 「Dify **未发布**（`draft`，`toolPublished: false`）」→ 同上 |
- **workflow/tools/tmp/claims-classification.md:43** — | `docs/product-requirements.md` | `:142` | 「**Dify 未发布**：`toolPublished: false`、`version: "draft"`」→ 同上（注意别把 `toolPublished` 当成发布状态） |
- **workflow/tools/tmp/claims-classification.md:44** — | `docs/competition/材料清单与自查.md` | `:21`、`:128`、`:162`、`:223`、`:233`、`:247` | B2-5「工作流未发布、未创建版本」→ **已消除**；`:233`「PM 决定是否发布；本 Agent 未点击发布」→ 已由 PM 授权并执行 |
- **workflow/tools/tmp/claims-classification.md:46** — | `docs/demo-script.md` | `:13`、`:70`、`:118`、`:124`、`:211`、`:231`、`:236`、`:242`、`:294`、`:352`、`:359`、`:366` | 现场脚本通篇按"草稿/未发布"设计（含"**不要**点发布"），发布后必须重写 S2 画面与说辞 |
- **workflow/tools/tmp/claims-classification.md:65** — - `workflow/evidence/WF-003-2026-10-30.md`：`版本 #1` 等 9 处是**第 10 节对 v1 发布的事实记录**，保留；本次发布 #2 另写新一节（见本节末）。
- **workflow/tools/tmp/claims-classification.md:66** — - `workflow/tools/*.py`（`create-stage-issues.py`、`sync-issues.py`、`pm-closeout.py`）：Issue 文案草稿，"未发布"是当时正文，**GitHub 侧由 PM 更新**。

### `workflow/tools/tmp/issue4-comment.md`（1 处）
- **workflow/tools/tmp/issue4-comment.md:7** — - **未做**：未提交、未推送、未发布 Dify 草稿、未启用任何付费模型调用。

### `workflow/tools/tmp/section10-12.md`（30 处）
- **workflow/tools/tmp/section10-12.md:42** — - `dify-published-header-2305.png` —— 页头 **「自动保存 23:05:02 · 已发布 几秒前」**（发布前是「未发布」）
- **workflow/tools/tmp/section10-12.md:45** — **结论：已发布，并创建版本 #1。** 未上云、未部署、未推镜像仓库——发布只发生在这个 Dify 应用内。
- **workflow/tools/tmp/section10-12.md:60** — | 版本记录 | **# 1**（弹层显示「Dify 发布于 几秒前」） | 已创建版本 #1 |
- **workflow/tools/tmp/section10-12.md:61** — | 发布菜单项 | 「发布」→ **「发布更新」** | 表示当前无未发布改动 |
- **workflow/tools/tmp/section10-12.md:74** — - **我上一轮把 `tool_published=false` 当成"未发布"的证据，判断错了**，已在第 0 节方框里就地纠正。
- **workflow/tools/tmp/section10-12.md:77** — `/workflows/draft/publish`→404，**该版本上没有可用的版本列表端点**。因此"版本 #1"的证据来自界面与截图，**不是**来自 API 列表。
- **workflow/tools/tmp/section10-12.md:127** — 发布动作使所有"未发布／未创建版本"的表述过期。以下为**全仓扫描结果**，请 PM 统一派发。
- **workflow/tools/tmp/section10-12.md:130** — ### 12.1 必须改：明确写了"未发布／未创建版本"
- **workflow/tools/tmp/section10-12.md:134** — | 1 | `README.md` | :179, :213, :225 | "Dify 草稿发布：`tool_published: false`，页面持续显示「未发布」。**未上线、未部署**"；"**草稿未发布**"；"Dify 草稿**未发布**" |
- **workflow/tools/tmp/section10-12.md:135** — | 2 | `docs/acceptance-criteria.md` | :35, :211, :230 | "**Dify 工作流未发布、未创建版本**：`toolPublished: false`、`version: "draft"`"；"Dify **未发布**" |
- **workflow/tools/tmp/section10-12.md:136** — | 3 | `docs/architecture.md` | :61, :99 | "Dify 草稿发布 \| **未发布**（`tool_published: false`、`version: draft`）；未创建版本"；架构图 `subgraph Z3["③ 编排层｜Dify Cloud 1.18.0 草稿（未发布）"]` |
- **workflow/tools/tmp/section10-12.md:137** — | 4 | `docs/architecture/ARCH-001-report-2026-10-30.md` | :145, :217, :235 | "Dify 草稿**未发布**（`tool_published: false`），未创建版本"；"未发布 Dify 草稿、未创建版本" |
- **workflow/tools/tmp/section10-12.md:138** — | 5 | `docs/competition/材料清单与自查.md` | :21, :128, :162, :223, :233（等 7 处） | "B2-5 \| 工作流未发布、未创建版本（当前是草稿状态）"；"**Dify 草稿未发布、未创建版本**"；"B2 Dify…**未点击发布**" |
- **workflow/tools/tmp/section10-12.md:139** — | 6 | `docs/competition/答辩PPT骨架.md` | :16, :40, :133, :275, :336（等 5 处） | "Dify 工作流**未发布、未创建版本**"；"❌「已发布 / 已创建版本」" |
- **workflow/tools/tmp/section10-12.md:140** — | 7 | `docs/demo-script.md` | :13, :70, :118, :124, :211, :231（等 12 处） | "Dify 工作流**未发布、未创建版本**（B5）。现场打开的是**草稿**"；"**不要**点发布"；"**草稿 · 未发布**" |
- **workflow/tools/tmp/section10-12.md:141** — | 8 | `docs/pm-reviews/flow-status-14-stages-2026-10-30.md` | :37, :47 | "Dify 草稿最新状态读回 + 明确写「**未发布、未创建版本**」"；"**Dify 工作流未发布、未创建版本**" |
- **workflow/tools/tmp/section10-12.md:142** — | 9 | `docs/product-flow.md` | :6 | "Dify **未发布**（`draft`，`toolPublished: false`）" |
- **workflow/tools/tmp/section10-12.md:143** — | 10 | `docs/product-requirements.md` | :142 | "**Dify 未发布**：`toolPublished: false`、`version: "draft"`" |
- **workflow/tools/tmp/section10-12.md:144** — | 11 | `docs/test-reports/stage-c/acceptance-2026-10-30.md` | :14, :44, :48, :123, :250, :342（等 7 处） | "草稿 `GiftWise｜推荐工作流开发草稿` 未发布 \| **已核实**"；"**我未点击发布**"（该断言在测试当时为真，**现在需补一句"23:04 由工作流 Agent 发布"**） |
- **workflow/tools/tmp/section10-12.md:145** — | 12 | `web/HANDOFF-2026-10-30.md` | :159, :161 | "Dify 未发布、不是模型真实输出" |
- **workflow/tools/tmp/section10-12.md:146** — | 13 | `web/README.md` | :16 | "Dify 侧礼赠工作流未发布（草稿只有「用户输入 → 代码执行」两个节点…）" |
- **workflow/tools/tmp/section10-12.md:147** — | 14 | `web/REPORT-WEB-001.md` | :248, :317, :328 | "含「Dify 未发布、不是模型真实输出、没有联通」"；"工作流未发布、`DIFY_PUBLISHED_VERIFIED=0`" |
- **workflow/tools/tmp/section10-12.md:148** — | 15 | `web/server/config.mjs` | :27, :56, :63 | "Dify 侧仍是未发布的草稿"；模拟模式提示语"⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点）" |
- **workflow/tools/tmp/section10-12.md:149** — | 16 | `web/server/dify.mjs` | :11 | "本机无凭证、Dify 侧仍是未发布草稿，**从未实际调用成功过一次**" |
- **workflow/tools/tmp/section10-12.md:157** — | **第 1 页** | 正文 | "B2 Dify：**未发布未建版本**；trace 不可用；N4 ELSE 未触发；无自然 OVER_BUDGET / FORBIDDEN_TAG 证据；Dify 侧呈现阶段未实现" |
- **workflow/tools/tmp/section10-12.md:158** — | **第 4 页** | 正文 | "– **未发布、未创建版本**" |
- **workflow/tools/tmp/section10-12.md:160** — | **第 8 页** | 正文 | "5. 工作流**未发布、未创建版本**（当前是草稿状态）。" |
- **workflow/tools/tmp/section10-12.md:161** — | **第 8 页** | 备注页 | "…工作流**未发布未创建版本**、trace 不可用、N4 ELSE 未触发、无自然 OVER…"（属"明确未完成"十七条之一） |
- **workflow/tools/tmp/section10-12.md:169** — - **GitHub Issue #9 的「明确未完成」清单**：其中"Dify 工作流未发布、未创建版本"一条现已过期。**我无法访问 GitHub**（本会话对 github.com 网络不可达），**需 PM 自行更新该 Issue**。
- **workflow/tools/tmp/section10-12.md:170** — - `.tmp/` 目录（约 28 个文件，含 `browser-report.json`、`gate.json` 等）也含"未发布"字样，属临时产物，建议 PM 决定是否清理，不必逐条改。

### `workflow/tools/tmp/section13.md`（1 处）
- **workflow/tools/tmp/section13.md:96** — - **没有**为版本 #1 命名。

### `workflow/tools/tmp/section8.md`（2 处）
- **workflow/tools/tmp/section8.md:25** — - [ ] **是否有可用的版本列表 API**：`/workflows/draft/versions`→404、`/workflows/versions`→405、`/workflows/publish`→401、`/workflows/draft/publish`→404，均未返回版本列表。**「版本 #1」的证据只来自界面与截图，不是 API**。
- **workflow/tools/tmp/section8.md:35** — 2. 本轮发布改变的是 Dify **应用内部的版本状态**（草稿 → 已发布 + 版本 #1），它并不等于本项目获得了对外服务；本项目**从未部署、没有在线体验地址**（`README.md` 已如此声明，本报告不改变该结论）；

