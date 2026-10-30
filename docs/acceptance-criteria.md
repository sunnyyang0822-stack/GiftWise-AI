# 验收标准

- 文档状态：**阶段 2 已冻结（2026-10-30，北京时间）**
- 本次修订：2026-10-30，Issue [#11 PRD-001](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/11)「阶段 2 收尾——低负担输入与可观测性验收项收编，四份文档定稿」
- 收编来源：Issue [#3 WEB-WF-001](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/3)（低负担输入 P0 验收清单 → 本文件 §4）、Issue [#5 ARCH-001](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/5) 交付物 4（可观测性字段权威 → 本文件 §5）
- 需求基线：`docs/requirements-analysis.md`（阶段 1 冻结件，SC-1…SC-9）；定位唯一权威：Issue #1。本文件不新增、不改写定位。
- 缺口登记：G-1…G-4 已在本次修订中**全部处理完毕**（§9）。

## 0. 阅读约定（先读本节）

### 0.1 每条验收标准必须且只能给出下列四种核查方式之一

| 标记 | 含义 | 硬性要求 |
| --- | --- | --- |
| 【命令】 | 可复跑的命令 | 必须写完整命令与判据；命令失败即该项不通过 |
| 【证据】 | 已归档的原始输出或指定文件 | 必须给路径（必要时给行号）与产生日期 |
| 【Issue】 | 跨线取证 | 必须给 Issue 链接与取证归属；未取证前结论只能是「未实测」 |
| 【不可核查】 | 当前不存在可执行判据 | 必须写**原因**与**解除条件**；不得写成「待验证」「基本没问题」等含糊结论 |

**不允许出现「看起来能验、但无法定论」的条目。** 若一条验收标准的一部分可核查、另一部分不可，结论必须写作 **已实测·部分**，并在该行内**指名**不可核查的是哪一部分、给出对应的 A 类编号；**不得只写「部分通过」或「基本验证」而不指名余下部分**。整条都没有判据的，必须直接标 **【不可核查】** 并进入 §6。

### 0.2 结论词（全文只用这五个）

| 结论 | 含义 |
| --- | --- |
| **已实测·通过** | 有【命令】或【证据】，且实测结果为通过 |
| **已实测·部分** | 实测只覆盖条目的一部分；未覆盖部分已单独列出并给出核查方式或标注不可核查 |
| **未实测** | 判据已存在，但尚未执行（例如需云资源、真实浏览器、真实商品数据源） |
| **不可核查** | 当前不存在可执行判据；已登记原因与解除条件 |
| **不成立** | 实测结果为失败。当前**无**此类条目；一旦出现必须保留原文并登记 |

### 0.3 适用边界（贯穿全文，引用本文档时不得省略）

- **云部署从未发生**：`publish-to-uhost.ps1` 从未上传，未推镜像仓库，无编排／多副本／弹性伸缩／资源调度。
- **Dify 工作流已发布并创建版本**（v1 于 2026-10-30 23:04 +08:00；**v2 已重发布**并同步规则源码）。⚠️ `toolPublished` 与 `version: "draft"` **不得作为发布状态的证据**——工作流线已自证该指标只表示"是否作为工具供其他应用调用"，发布后仍为 `false`。真实模型调用**累计 13 次 / 38,326 tokens**（`workflow/evidence/WF-003-2026-10-30.md` §4）。
- **`web/` 运行在 mock 模式**：其四段呈现（风格配色→包装→贺卡→赠送）是**模拟数据**；Dify 侧该呈现阶段**未实现**。
- **价格、库存、送达"未核实"**：`business_data_verification` 恒为 `not_verified`；无真实商品数据源。费用与准备时间只能是估算。
- **前端已完成浏览器级走查（2026-10-31 集成后）**：`node web/tools/browser-check.mjs` **100 项 / 0 失败**（自有端口），`page-probe` 无横向溢出、`pageExceptions 0`；首屏 desktop **486,540 B**、390/320 **367,274 B**（**2026-10-31 02:02:51 CSS 加固后 +449 B；486,091 / 366,825 是 02:02 冻结口径**）（`landing.css` **24,981 B**、内联 base64 **0 处**）。⚠️ 但 parity 仍是**样例级等价**、不是全域等价；**没有真实用户可用性测量**（故 SC-1 仍为 **B**）。
- **因此**：除明确标注来源的条目外，本文「已实测」结论的适用范围是**规则层 + `web/` 接入层（mock）+ Dify 草稿单链路**，**不等于**「用户可用的端到端产品」。

## 1. 证据基线（截至 **2026-10-31 01:00** 的真实数字；凡标注时点者为历史值，不改写）

| 证据 | 数字 | 命令 / 文件 |
| --- | --- | --- |
| 单元测试 | **329 / 329 通过**（请求侧范围校验新增 7 项，原 322） | `python -m unittest discover -s tests -q` |
| 阶段 C 独立验收（QA-001，自建执行器） | **39 / 39 通过** | `python -m unittest discover -s tests/acceptance/stage_c -q` |
| 独立验收套件四条**互不包含**、合计 **688 项** | **329 ＋ 275 ＋ 39 ＋ 45 ＝ 688**（`-s tests` / `-s tests/acceptance/stage_b` / `stage_c` / `boundary`；2026-10-31 本机复跑四条全绿）。⚠️ `discover -s tests` **只覆盖第一条**（`tests/acceptance/**` 无 `__init__.py`），故「329 项通过」**≠**「全仓通过」 | 口径出处 `docs/test-plan.md:214` 起；本次复跑 |
| 本地离线探针（无模型） | **46 通过 / 0 失败 / 0 模型调用** | `python tests/acceptance/stage_c/run_verify_local_nopipe.py`（沙箱内取同一 46 项结论的等价跑法；受限环境直接跑 `workflow/verify_local.py` 会在**全部探针执行完之后**因末尾 `git` 子进程无法建管道而崩，见该脚本头部说明） |
| JS↔Python 语义比对 | **74 组样例 / 0 处语义差异（样例级等价）**（intake 27 / 候选批次 26 / **请求侧越界与格式 17** / 损坏样例 4）；越界网格 15 组（`{0,1,10000,10000.01,10001}` × `{0,365,366}`）＋ 格式优先 2 组**已覆盖且一致**（原记 55 组、且「样例集不含数值越界」——**该说法已不成立**）。另 **1 组仅错误顺序**不同（错误码/路径/文案/请求完全一致，Python 侧集合迭代顺序随哈希种子变化）。**网格之外**独立登记 1 项：`days=10**20` → Python `needs_input/LIMIT_EXCEEDED` vs JS `error/INVALID_JSON`，**两侧都拒绝**——该值**不在** 74 组网格内（网格天数只到 365/366），**不是**「74 组里有 1 项分歧」 | `node web/tools/gen-parity-fixtures.mjs` → `python web/tools/parity-reference.py` → `node web/tools/parity-check.mjs`（退出码 0；2026-10-31 本机复跑）；归档：`docs/pm-reviews/web-verification-2026-10-30/3-js-python-parity.txt` |
| 接入层 HTTP 冒烟 | **59 项检查 / 0 失败** | 先 `node web/server/server.mjs`，再 `node web/tools/smoke-http.mjs`；归档：`docs/pm-reviews/web-verification-2026-10-30/4-http-smoke.txt`（逐项 1–59 行） |
| 接入层单元测试 | **40 通过 / 0 失败** | `node web/tests/access-layer.test.mjs` |
| 容器化 | **已重建并复核（2026-10-31 01:13:59）**：`giftwise-validator:submission-20261101` = `latest` = `d9a4a35763ee`。重建前 `latest` 三处过时（内嵌 `rules.py` 与本机不一致、无 I-2 修复、不含可观测入口）**均已修**：`/healthz` 规则哈希 `1f389dad…` 与本机一致、半开正文 10.02 s 返 408 并关闭、40 并发日志 0 粘连。检查项 **14 项**（D-0…D-13；原记 9/9）；交付镜像体积 **177,918,474 字节＝169.676 MiB**（`docker images` 的 178 MB 是十进制；构建时基线为 177,582,258 字节＝169.36 MiB）；冷构建 **3,662 ms**（重建版；10-30 基线 1.720 s） | `deploy/evidence/docker-2026-10-30.md`（表格 D-0…D-13 共 14 行 ✅）、`deploy/evidence/image-audit-2026-10-31.md`、`deploy/evidence/image-rebuild-n1n4-2026-10-31.md` |
| 真实模型调用 | **累计 13 次 / 38,326 tokens**（主批次 10 次 / 34,127 ＋ 演示真跑 1 次 / 1,487 ＋ v2 复跑 2 次 / 2,712；DeepSeek） | `workflow/evidence/WF-003-2026-10-30.md` §4.1／§4.5 |
| 平台级追踪 | **不可用**（`not_collected`） | `docs/test-reports/stage-c/acceptance-2026-10-30.md` §1.3（QA 独立复跑）、`docs/architecture/observability.md` §1 |

**取证环境**：Python 3.12.12、Node v24.21.0、Docker 29.9.2（linux / overlayfs）。汇总结论见 `docs/pm-reviews/flow-status-14-stages-2026-10-30.md`；规则与契约的版本指纹见 `workflow/generated/manifest.json` 的 `sources_sha256` / `artifacts_sha256`。

## 2. P0 功能验收

> 行内「:n」指 `docs/pm-reviews/web-verification-2026-10-30/4-http-smoke.txt` 的对应行号；「access-layer」指 `web/tests/access-layer.test.mjs` 的用例。

| 编号 | 验收条目 | 核查方式 | 当前结论 |
| --- | --- | --- | --- |
| AC-P0-01 | 输入包含关系、熟悉程度、场合、预算、准备时间、兴趣／风格、禁忌和补充说明 | 【命令】`node web/server/server.mjs` + `node web/tools/smoke-http.mjs` :1–:6；【命令】`node web/tests/access-layer.test.mjs`（枚举用例） | 已实测·通过（配置接口与契约层）。**界面渲染未验证**，见 A-04 |
| AC-P0-02 | 预算支持预设区间、自定义金额，并在提交前确认明确上限 | 【命令】`node web/tools/smoke-http.mjs` :6、:15；【命令】`node web/tests/access-layer.test.mjs`「预算缺失或写成区间时不静默补默认值」 | 已实测·部分：区间快捷项与「不静默取值」的拒绝路径已通过；**「提交前确认上限」的界面交互不可核查**，见 A-04 |
| AC-P0-03 | 时间支持区间选择，并在提交前确认最终可用天数 | 【命令】`node web/tools/smoke-http.mjs` :6；【命令】`node web/tests/access-layer.test.mjs`「天数允许 0，但拒绝浮点、布尔与缺失；不静默填 7 天」 | 已实测·部分（同 AC-P0-02：契约层通过，界面确认交互见 A-04） |
| AC-P0-04 | 首版只接受 CNY；不得静默换汇或补默认值 | 【命令】`node web/tools/smoke-http.mjs` :7、:16；【证据】`4-http-smoke.txt:16` | 已实测·通过 |
| AC-P0-05 | 恋人和追求对象是两个独立关系值（`partner`／`pursuit`）、独立提示和独立输出文案 | 【命令】`node web/tools/smoke-http.mjs` :4、:22、:53、:54；【命令】`node web/tests/access-layer.test.mjs`「追求对象不被静默映射」「契约开关关闭时明确拒绝」；【命令】`python tests/acceptance/stage_c/run_verify_local_nopipe.py`（`relations == partner/pursuit/friend`） | 已实测·通过（接入层与工作流适配层各自独立验证） |
| AC-P0-06 | **同事完全移出产品场景**：不出现在界面、导航、演示脚本和验收案例中（仅技术回归夹具保留） | 【命令】`node web/tools/smoke-http.mjs` :3；【命令】`node web/tests/access-layer.test.mjs`「同事只作为技术回归机器值存在，产品界面不出现」；【命令】`python tests/acceptance/stage_c/run_verify_local_nopipe.py`（colleague 技术回归分支） | 已实测·通过（产品面不出现；机器值 `colleague` 仅技术回归） |
| AC-P0-07 | 每个兴趣可单独标记可信度（`confirmed`/`inferred`）；界面「未知」状态不生成用户事实，提交为 `interests: []` | 【命令】`node web/tools/smoke-http.mjs` :5、:23、:24、:55；【命令】`node web/tests/access-layer.test.mjs`「`interest_confidence` 只接受 confirmed/inferred；unknown 被拒」「置信度多余键被拒」 | 已实测·通过（契约层）；界面互斥行为不可核查，见 A-05 |
| AC-P0-08 | 无兴趣时输出低压力、实用、可替代或可自主选择的方向，避免强烈浪漫、尺寸敏感、气味敏感和明显个性化物品 | 【命令】`node web/tools/smoke-http.mjs` :55、:56 | 已实测·部分：mock 链路通过；**真实模型在「空兴趣」输入下的表现未实测**（WF-003 的 6 次真实运行未覆盖空兴趣用例） |
| AC-P0-09 | 阶段一输出恰好三个不同方案，区分事实、推断、未知 | 【命令】`node web/tools/smoke-http.mjs` :18、:19、:23、:24；【证据】`workflow/evidence/WF-003-2026-10-30.md` §4.5（真实 DeepSeek 生成三候选，含真实违规与真实修订） | 已实测·通过（mock 与 Dify 草稿真实模型两条链路各有证据） |
| AC-P0-10 | 每个方案显示全量估算费用、币种、准备时间、理由和检查结果 | 【命令】`node web/tools/smoke-http.mjs` :25 | 已实测·通过（字段齐备；数字本身是估算，见 §0.3） |
| AC-P0-11 | 规则检查独立于模型；失败项不可选 | 【命令】`node web/tools/smoke-http.mjs` :50、:51；【命令】`python -m unittest discover -s tests -q`（329 项，含规则层 19 个错误码）；【证据】`workflow/evidence/WF-003-2026-10-30.md` §4（模型自然违规被 `FORBIDDEN_TERM` 拒绝，代码未放行） | 已实测·通过 |
| AC-P0-12 | 自动业务修订跨两个阶段总计最多一次，并在修订后重新检查 | 【命令】`node web/tools/smoke-http.mjs` :41、:43、:44、:47；【命令】`node web/tests/access-layer.test.mjs`「推荐：预算过小时先自动修订一次，仍失败则无可选方案且不二次修订」；【证据】WF-003 §4.5（真实修订 R1 成功／R2 持续失败不重试） | 已实测·通过 |
| AC-P0-13 | 用户未选择前，不调用包装／贺卡／赠送设计阶段 | 【命令】`node web/tools/smoke-http.mjs` :20、:27（`selected_candidate_id` 为 null、呈现阶段零调用） | 已实测·通过 |
| AC-P0-14 | 选择后严格按「风格配色→包装→贺卡及花等装饰→赠送时机和话术」呈现 | 【命令】`node web/tools/smoke-http.mjs` :32、:33、:34；【命令】access-layer「呈现：严格按四段顺序」 | 已实测·部分：**`web/` mock 链路**通过；**Dify 侧该阶段未实现** |
| AC-P0-15 | 呈现阶段复核礼物、包装、贺卡、装饰和配送的总费用、准备时间及禁忌 | 【命令】`node web/tools/smoke-http.mjs` :36–:39 | 已实测·部分（同 AC-P0-14，仅 `web/` mock 链路） |
| AC-P0-16 | 无法通过时显示中文失败原因，不伪装为完成 | 【命令】`node web/tools/smoke-http.mjs` :44、:45、:52、:57 | 已实测·通过 |
| AC-P0-17 | 前端不能通过篡改 `passed`、候选内容或修订次数获得选择权限 | 【命令】`node web/tools/smoke-http.mjs` :13、:14、:29、:30；【命令】access-layer「浏览器提交派生字段被拒绝，不进入请求」「可信状态：修订计数只由服务端持有，浏览器无法改写」 | 已实测·通过 |

## 3. 场景验收

| 编号 | 验收条目 | 核查方式 | 当前结论 |
| --- | --- | --- | --- |
| AC-S-01 | 恋人生日：文案可亲密但不承诺对方反应 | 【命令】`node web/tools/smoke-http.mjs` :53、:54；【命令】access-layer「呈现：追求对象与恋人的贺卡与话术完全不同」 | 已实测·部分（`web/` mock 链路；真实模型的恋人文案未单独专项取证） |
| AC-S-02 | 追求对象节日：文案低压力，不默认双方已恋爱或互有好感 | 【命令】`node web/tools/smoke-http.mjs` :35、:54；【证据】`workflow/evidence/WF-003-2026-10-30.md` §4.5 case1（真实模型，追求对象） | 已实测·通过 |
| AC-S-03 | 朋友感谢：未知兴趣时仍能给出低风险方向 | 【命令】`node web/tools/smoke-http.mjs` :55、:56 | 已实测·通过（mock 链路） |
| AC-S-04 | 明确禁忌：类别和字面禁忌都被拦截 | 【命令】`node web/tools/smoke-http.mjs` :38；【命令】`python -m unittest discover -s tests -q`（`FORBIDDEN_TAG`／`FORBIDDEN_TERM` 用例）；【证据】WF-003 §4.5（真实模型自然触发 `FORBIDDEN_TERM`） | 已实测·部分：字面禁忌有**真实模型**证据；**类别禁忌（`FORBIDDEN_TAG`）的真实自然触发未取得**（WF-003 §8 未核实清单） |
| AC-S-05 | 超预算：边界金额通过，超过一分钱失败 | 【命令】`python -m unittest discover -s tests -q`；【命令】access-layer「校验边界：等于预算通过，超一分钱失败；等于天数通过，超一天失败」 | 已实测·通过（边界值）。**真实模型自然产生 `OVER_BUDGET` 的链路未取得**（真实运行首次错误都是 `FORBIDDEN_TERM`，见 WF-003 §8） |
| AC-S-06 | 准备时间边界：等于可用天数通过，超过一天失败 | 【命令】access-layer「校验边界：…等于天数通过，超一天失败」 | 已实测·通过 |
| AC-S-07 | 无兴趣：不凭职业、性别或年龄编造事实 | 【命令】`node web/tools/smoke-http.mjs` :55、:56；【命令】access-layer「只有 confirmed 兴趣进入事实；inferred 单独存放；未知不生成事实」 | 已实测·通过（接入层与规则层） |
| AC-S-08 | 未选择：不提前生成任何详细包装方案 | 【命令】`node web/tools/smoke-http.mjs` :27；【证据】`docs/architecture/observability.md` §3.1（`selected_candidate_id` 在推荐阶段必须为 null） | 已实测·通过 |
| AC-S-09 | 选择失败项、旧版本或伪造候选：拒绝并说明原因 | 【命令】`node web/tools/smoke-http.mjs` :29、:30、:51（伪造 ID／空选择／失败项各有一条）；**「旧版本／陈旧推荐」子项见 A-03（不可核查）** | 已实测·部分 |
| AC-S-10 | 模型 JSON 损坏、Code 失败或超时：显示暂不可用，不标为通过 | 【命令】`node web/tools/smoke-http.mjs` :52、:57；【证据】`docs/architecture.md` §6.1 第 2 条（`case4 损坏 JSON` 已在真实 Dify 跑通"进入一次修订"） | 已实测·通过 |

## 4. G-1 低负担输入验收（本次收编，来源 Issue #3）

> 本节把 Issue #3「验收清单」与 P0 范围中的低负担输入要求**逐条落成可判定条目**。界面行为类条目在 `web/` 中已有实现，且仓库**已有 DOM／浏览器自动化**（`web/tools/browser-check.mjs`，CDP 真实 Chromium，2026-10-31 实测 **100 项 / 0 失败**，覆盖 desktop/390/320 与「暂时不知道」互斥置灰），因此只能标「不可核查」并写明解除条件，不得用「已实现」冒充「已验证」。

| 编号 | 验收条目 | 核查方式 | 当前结论 |
| --- | --- | --- | --- |
| AC-I-01 | 关系、场合、兴趣、风格等选择项采用单选／多选，且枚举与冻结契约一致（关系 8 项、兴趣 12 项、风格 7 项、禁忌 6 类、熟悉程度 5 项、场合 6 项） | 【命令】`node web/tools/smoke-http.mjs` :2、:5、:6；【命令】access-layer「产品面关系枚举是冻结 8 项，且不含同事」「兴趣 12 项、风格 7 项、禁忌 6 类、熟悉程度 5 项、场合 6 项」 | 已实测·通过（枚举与配置层） |
| AC-I-02 | 取消选择后提交的载荷与「从未选择」等价（不残留未知标签、不静默映射） | 【命令】`node web/tools/smoke-http.mjs` :13、:14、:15；【命令】access-layer「严格 JSON：重复键、NaN、尾随内容、根节点非对象都被拒」 | 已实测·通过（载荷层）。界面「取消勾选」的手感不可核查，见 A-04 |
| AC-I-03 | 可跳过的题目跳过时不产生虚假事实：跳过＝未知＝`interests: []`、`interest_confidence: {}`，不按性别／年龄／关系／职业推断兴趣 | 【命令】`node web/tools/smoke-http.mjs` :55、:56；【命令】access-layer「`interest_confidence` 只接受 confirmed/inferred；unknown 被拒」 | 已实测·通过（跳过在契约层的后果） |
| AC-I-04 | 未知项与同组具体项互斥（「暂时不知道／不确定」不得与具体项同时成立） | 【命令】`node web/tools/smoke-http.mjs` :55；【命令】access-layer「未知兴趣提交为空数组且不生成事实」+「`interest_confidence` 多余键被拒」 | 已实测·通过（**契约层互斥只能表现为空数组，不存在第三态机器值**）。界面互斥控件行为不可核查，见 A-05 |
| AC-I-05 | 无需长文本、注册或真实姓名即可完成输入 | 【命令】`grep -rniE "注册\|密码\|邮箱\|手机号\|password\|signup" web/public/ \| wc -l` → 期望 `0`；【命令】`grep -rn "真实姓名" web/public/ \| wc -l` → 期望 `0`；【命令】access-layer「浏览器提交派生字段（facts / repair_count / passed）被拒绝」 | 已实测·通过（未实测到任何注册／凭据／真名字段；`web/public/app.js` 中唯一的 `textarea` 是**可选**补充说明，标题为「补充说明（可选，可不填）」） |
| AC-I-06 | 中文加载、空状态、错误、缺信息与无效响应均可理解，且机器错误码保持原文不翻译 | 【命令】`node web/tools/smoke-http.mjs` :13–:17、:31、:44、:52、:57；【命令】access-layer（各拒绝路径均断言中文原因） | 已实测·通过（断言的判据是中文文案 + 稳定机器码，如 `INTAKE_UNKNOWN_FIELD`／`CANDIDATE_NOT_PASSED`） |
| AC-I-07 | 模拟模式必须显著标识；浏览器与仓库不含真实凭证 | 【命令】`node web/tools/smoke-http.mjs` :8、:10、:12、:28；【命令】`grep -rn "sk-" web/server web/public \| wc -l` → 期望 `0`；【证据】`docs/pm-reviews/web-parity-pm-verification-2026-10-30.md` §1 | 已实测·通过 |
| AC-I-08 | 预算、币种、最终天数必须明确展示；模糊选项不得隐式变成 7 天或任意期限 | 【命令】`node web/tools/smoke-http.mjs` :6、:7、:15、:16；【命令】access-layer「预算缺失或写成区间时不静默补默认值」「天数允许 0，但拒绝浮点、布尔与缺失；不静默填 7 天」 | 已实测·通过（契约层）；界面展示不可核查，见 A-04 |
| AC-I-09 | `confirmed`／`inferred`／`unknown` 三态不混淆，只有已确认兴趣进入事实 | 【命令】`node web/tools/smoke-http.mjs` :23、:24、:55；【命令】access-layer「只有 confirmed 兴趣进入事实；inferred 单独存放；未知不生成事实」 | 已实测·通过 |
| AC-I-10 | 硬约束（禁忌类别与字面词）在返回上一步、适配、生成与修订之后仍然保留并被代码检查 | 【命令】`node web/tools/smoke-http.mjs` :38；【命令】access-layer「校验：禁忌类别与字面词都被拦截」；【证据】WF-003 §4.5（真实模型输出被禁忌规则拒绝） | 已实测·部分：字面词全链路有证据；类别禁忌的真实自然触发未取得（同 AC-S-04） |
| AC-I-11 | 基础窄屏可操作（触控目标、无横向滚动），不等到视觉精修 | 【命令】`node web/tools/browser-check.mjs`（desktop/390/320 三视口「无横向溢出」＋「无 44px 以下触控目标」） | 已实测·通过（真实 Chromium；A-06 现只保留键盘项） |
| AC-I-12 | 基础键盘可操作（Tab 可达、控件有可访问名称） | **【不可核查】** 见 A-06 | 不可核查 |
| AC-I-13 | 步骤进度与「返回上一步／第二步」可用，且返回后已填状态不丢失 | **【不可核查】** 见 A-04 | 不可核查 |

## 5. G-2 可观测性验收（本次收编，字段语义权威：`docs/architecture/observability.md`）

> 本文件**只登记验收条目与核查方式**，不重新定义字段。字段含义一律以 `docs/architecture/observability.md` 为准；采集实现归属阶段 14 的 CLOUD-001（Issue [#10](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/10)），方案见 `deploy/observability-collection.md`。

| 编号 | 验收条目 | 核查方式 | 当前结论 |
| --- | --- | --- | --- |
| AC-O-01 | 一次送礼任务有唯一运行 ID（`recommendation_run_id`，服务端生成、浏览器不可自定义），并贯穿推荐→选择 | 【命令】`node web/tools/smoke-http.mjs` :58（`GET /api/runs/:id` 返回可信状态）；【证据】`web/server/store.mjs` 的 `createRun` 记录（`run_id`／`created_at`／`mode`）；【证据】`docs/architecture/observability.md` §2 | 已实测·部分：**进程内**已通过；跨进程／重启持久化不可核查，见 A-01 |
| AC-O-02 | 必须区分「首检候选」与「修订后候选」两个版本，且修订计数由服务端持有 | 【命令】`node web/tools/smoke-http.mjs` :21、:41、:42；【命令】access-layer「可信状态：修订计数只由服务端持有，浏览器无法改写」；【证据】`observability.md` §2 | 已实测·部分：版本区分与计数已通过；候选 `sha256` 落盘不可核查，见 A-02 |
| AC-O-03 | 校验输出必须同时暴露批次级 `errors[]` 与逐候选 `candidate_results[].passed`（只读顶层 `errors` 会把失败误判为无错误） | 【证据】`deploy/evidence/raw/docker-2026-10-30/d4-validate.txt`；【证据】`observability.md` §3.2「易错点（已实测确认）」；【命令】`python -m unittest discover -s tests -q` | 已实测·通过 |
| AC-O-04 | 全局修订计数（`repair_count`／`remaining_repairs`）必须可核验，且失败不得"换额度" | 【命令】`node web/tools/smoke-http.mjs` :21、:43、:44、:46、:47；【证据】`observability.md` §3.1 | 已实测·通过 |
| AC-O-05 | 错误码必须分层记录（`INTAKE_*`／规则 **19** 码／包装 3 码／`DIFY_*`／HTTP 码），不得混为一码 | 【命令】`python -m unittest discover -s tests -q`、`node web/tests/access-layer.test.mjs`；【证据】`observability.md` §3.6；【证据】容器错误路径 `deploy/evidence/docker-2026-10-30.md` D-5 | 已实测·通过（分层与稳定性）。`STALE_RECOMMENDATION`／`UNTRUSTED_RECOMMENDATION` 两码**全仓 0 命中**，见 A-03 |
| AC-O-06 | 调用记录必须分阶段计数（`recommend`／`recommend_revision`／`presentation`／`presentation_revision`），且**选择前呈现调用数必须为 0** | 【命令】`node web/tools/smoke-http.mjs` :27；【证据】`web/server/store.mjs` 运行记录中的 `call_counts` 四个计数位；【证据】`observability.md` §3.4 | 已实测·通过（字段齐备且断言成立） |
| AC-O-07 | 每次结论必须绑定规则版本指纹（`rules_source_sha256`、`sources_sha256`、`artifacts_sha256`） | 【证据】`deploy/evidence/raw/docker-2026-10-30/d3-healthz.txt`；【命令】`python tests/acceptance/stage_c/run_verify_local_nopipe.py`（输出 `sources_sha256`／`artifacts_sha256`）；【证据】`workflow/generated/manifest.json` | 已实测·通过（容器内哈希与本机一致，D-3/D-4） |
| AC-O-08 | 真实模型的调用次数与 token 必须有服务端依据，不得用"一至两次"的粗口径 | 【证据】`workflow/evidence/WF-003-2026-10-30.md` §4.1／§4.5（10 次调用 / 34,127 tokens，取自 `workflow_finished.total_tokens`） | 已实测·通过（有原始运行归档） |
| AC-O-09 | 运行记录**不得**包含密钥、令牌或用户原文 | 【命令】`node web/tools/smoke-http.mjs` :59；【命令】`grep -rn "sk-" web/server web/public \| wc -l` → 期望 `0`；【证据】`deploy/server.py` 的 `log_message`（只记录方法与路径，不记录请求体） | 已实测·通过 |
| AC-O-10 | 成本字段必须区分「已实测／未知」；缺费率时写 `not_measured`，**不得填 0 或估算为实测** | 【证据】`docs/architecture/cost-performance-metrics.md` §0 三条原则、§3.2、§4（未知项禁止填默认值） | 已实测·通过（口径合规）。**真实费率与单任务成本仍未取得**，见 §11 OPEN-5 |
| AC-O-11 | 运行记录必须落盘持久化（JSONL），进程重启后可回查 | **【不可核查】** 见 A-01 | 不可核查 |
| AC-O-12 | Dify 平台级调用轨迹（`trace-runs`）可作为证据 | **【不可核查】** 见 A-07 | 不可核查 |

## 6. A 类：不可核查条目汇总（原因与解除条件）

> 本节是本文档的**诚实清单**。这些条目**没有**可执行判据，不得在答辩、PPT、README 或口头汇报中被表述为「已实现」「已验证」。

| 编号 | 条目 | 不可核查的原因 | 解除条件（要什么才能定论） |
| --- | --- | --- | --- |
| A-01 | 运行记录落盘持久化、进程重启后回查（含 AC-O-01／AC-O-11） | **未实现**：`deploy/server.py` 无结构化日志（仅 `log_message` 打印方法/路径）；`deploy/evidence/runtime/` 目录不存在；`deploy/observability-collection.md` 自述「纯设计，未实现任何采集代码」；`observability.md` §4.1 明确「不落盘是已知缺口」 | 阶段 14 由 CLOUD-001（Issue #10）实现 L1 JSONL 落盘，并提供样本文件路径 + 可复跑命令 |
| A-02 | 候选版本 `sha256` 落盘（`request_json` 哈希、`initial_candidates_json`/`candidates_json` 哈希） | **计划字段未实现落盘**：`observability.md` §2 标注 `request_json` 哈希为「计划字段，未实现落盘」；现有证据只能看到"首检／修订后"两个值随响应返回 | 落盘实现后，提供含哈希的运行记录原文 |
| A-03 | 选择「旧版本／陈旧推荐」被拒（`STALE_RECOMMENDATION`、`UNTRUSTED_RECOMMENDATION`） | **代码 0 命中**：两个错误码在 `validator/`、`workflow/`、`web/` 中均无实现点（`docs/architecture.md` §6.3 已声明为"设计预留"）。另 5 个预留码（`INVALID_SELECTION`、`CANDIDATE_NOT_PASSED`、`PRESENTATION_INVALID`、`TOTAL_MISMATCH`、`REPAIR_LIMIT_REACHED`）已在 `web/server/checker.mjs`、`web/server/pipeline.mjs` 实现，其中 `CANDIDATE_NOT_PASSED`、`REPAIR_LIMIT_REACHED` 有冒烟证据（:51、:43），**不在此列** | 实现陈旧判定（推荐版本指纹比对）后，提供拒绝用例与原始响应 |
| A-04 | 步骤进度、「返回上一步／第二步」、返回后状态不丢失、提交前预算/天数的界面确认（含 AC-P0-02、AC-P0-03、AC-I-02、AC-I-08、AC-I-13） | **仅剩两点无判据**（`web/tools/browser-check.mjs` 为零依赖 CDP 脚本、**已入库**，已覆盖三步推进、被拦后停在第一步、提交前预算/天数拦住、390/320 窄屏；仍未覆盖「返回上一步后已填内容不丢失」与键盘 Tab 走查）。旧表述「仓库内不存在 DOM 级测试脚本」已作废：`web/package.json` 无 DOM／浏览器自动化依赖；`docs/pm-reviews/web-parity-pm-verification-2026-10-30.md` §4.4 明确「没有浏览器层面的验证」；仓库内不存在 DOM 级测试脚本（`.tmp/` 下的临时脚本未被 git 跟踪，不作为交付物） | 真实浏览器走查记录（步骤/截图/录屏，含"返回后重填"与"提交前确认"两个动作），或引入自动化脚本并纳入交付物与 CI |
| A-05 | 界面「未知」与具体项的互斥控件行为（AC-P0-07、AC-I-04 的界面部分） | 已实测·通过：`browser-check` finding 13/38/63「「暂时不知道」与 12 项兴趣互斥（全部置灰）」在 desktop/390/320 三视口全部 PASS（界面控件行为**已有**判据） | 同 A-04，并对"选中未知后再选具体项"的动作给出实际观测 |
| A-06 | 窄屏与键盘可操作性（AC-I-11、AC-I-12） | **实现存在但未渲染验证**：`web/public/styles.css` 有响应式断点与 `prefers-reduced-motion` 降级，`web/public/app.js` 有 `aria-label`／`aria-pressed`／`aria-current` 属性；但 `web/REPORT-WEB-001.md` 自述「窄屏基础可操作：**已实现，未渲染验证**」，并记录「无浏览器自动化工具：前端渲染与窄屏可操作无法自证」 | 375px 等窄屏的真实渲染证据 + 键盘 Tab 全程走查记录（截图/录屏），或自动化无障碍/视口测试 |
| A-07 | Dify 平台级调用轨迹（AC-O-12） | **平台能力不可用（已实测）**：该租户 `trace-runs` 返回 `not_collected`；出处 `docs/test-reports/stage-c/acceptance-2026-10-30.md` §1.3（QA 独立复跑）与 `observability.md` §1 | 租户开启追踪后重跑并归档；否则**永久以 §1 的替代路径（SSE 节点级事件 + 版本哈希）作为轨迹证据**，不再把平台追踪列为验收项 |
| A-08 | 「约 60 秒完成初始输入」（D-5 决定：维持待测目标） | **无真实用户测量**：Issue #3 要求记录试用方法与真实耗时；当前没有任何真实用户计时数据，也没有可用性测量方法落地 | 按明确方法（样本量、计时起止、设备与网络条件）做真实用户计时并归档原始数据 |
| A-09 | 人工介入机制（AC-E-06） | **产品侧未实现**：`docs/architecture.md` §6.1 第 6 条自述「机制已在契约中冻结（`workflow-spec.md` §选择与呈现），**产品侧未实现**」，`web/` 与工作流均无受控操作员路径 | 实现受控操作员路径（从真实运行记录带入原始数据并在可信执行端重检，且明确标注为演示步骤）后，提供可复跑证据 |

## 7. G-3 / G-4 交叉引用登记（成文归属 ARCH-001，本文件不重复定义）

### 7.1 G-3 异常处理说明（评分规则 1.2 要求"独立成节"）

成文位置：`docs/architecture.md` **§6「异常处理说明（评分规则 1.2 明确要求，独立成节）」**（§6.1 六项逐条对照、§6.2 设计原则、§6.3 未实现分支），配图 `docs/architecture/rendered/failure-recovery.svg`。验收只引用该节，不在本文件重写。

| 编号 | 六项要求 | 核查方式 | 当前结论 |
| --- | --- | --- | --- |
| AC-E-01 | 工具调用失败 | 【证据】`docs/architecture.md` §6.1 第 1 条；【命令】access-layer「推荐：真实 Dify 未配置时明确报错，不回退成模拟并标成真实」 | 已实测·部分：`web/` 的拒绝路径已通过；**`web/server/dify.mjs` 从未成功调用过一次**，该分支在真实链路未被触发 |
| AC-E-02 | 模型输出异常 | 【命令】`node web/tools/smoke-http.mjs` :52；【证据】`docs/architecture.md` §6.1 第 2 条（`case4 损坏 JSON` 在真实 Dify 跑通"进入一次修订"） | 已实测·通过 |
| AC-E-03 | 超时 | 【命令】`node web/tools/smoke-http.mjs` :57；【证据】`docs/architecture.md` §6.1 第 3 条 | 已实测·部分：前端超时状态通过；服务端 `DIFY_TIMEOUT` 分支与 45s 故障注入**未实测**（该节自述） |
| AC-E-04 | 重试策略 | 【命令】`node web/tools/smoke-http.mjs` :41、:43、:46、:47；【证据】WF-003 §4.5（真实修订 R1 成功、R2 持续失败不自动重试） | 已实测·通过 |
| AC-E-05 | 状态恢复 | 【命令】`node web/tools/smoke-http.mjs` :31（无记录 404）、:58；【证据】`docs/architecture.md` §6.1 第 5 条 | 已实测·部分：内存态与过期行为可解释；**持久化恢复未实现**（E3），见 A-01 |
| AC-E-06 | 人工介入机制 | **【不可核查】** 见 A-09 | 不可核查 |

### 7.2 G-4 成本／性能指标清单（赛道 B 占 10 分）

成文位置：`docs/architecture/cost-performance-metrics.md`（§1 已实测、§2 测量方法、§3 待测清单、§4 未知项、§7 原始数据提交模板）。

| 编号 | 验收条目 | 核查方式 | 当前结论 |
| --- | --- | --- | --- |
| AC-C-01 | 存在"需测量指标"清单，且每条标注 `已实测／待测／阻塞／未知` 与测量条件 | 【证据】`cost-performance-metrics.md` §0、§1（6 项已实测带条件与复现命令） | 已实测·通过（清单与条件齐备） |
| AC-C-02 | 缺数据的项**不得填 0 或默认值**（费率、token 成本、并发容量、资源消耗等） | 【证据】`cost-performance-metrics.md` §3.2（成本状态为 `not_measured`／`unknown`）、§4（10 项未知，明示禁止填默认值） | 已实测·通过（口径合规） |
| AC-C-03 | 端到端业务延迟、分段延迟、模型首 token 延迟 | 【证据】`cost-performance-metrics.md` §3.1（状态：阻塞／待测） | 未实测（阻塞：需真实模型端到端链路与接入层分段计时） |
| AC-C-04 | 单任务模型成本（token × 费率） | 【证据】`cost-performance-metrics.md` §3.2、§4 | 未实测（供应商费率未取得，见 §11 OPEN-5） |
| AC-C-05 | 并发与资源消耗（内存／CPU／镜像大小／冷启动） | 【证据】容器基线：`deploy/evidence/docker-2026-10-30.md` D-7（镜像 169.36 MiB、启动到健康 0.750–0.939 s（10-30 基线）｜交付镜像 **0.668 s**（均值）、14.45–17.08 MiB RSS；**该基线取自已被取代的镜像，重建后须重测**）；并发与压测：`cost-performance-metrics.md` §3.5（未做） | 已实测·部分：单次资源基线已取；并发容量未测 |

## 8. 证据要求（提交任何验收结论时必须同时给出）

```text
[条件]
  Git SHA / 分支：            （工作区还有未提交改动时必须写明）
  规则版本指纹：              rules_source_sha256=<...>；artifacts_sha256=<...>
  环境：                      Python / Node / Docker / Dify 版本与模式（mock 或真实模型）
  是否含模型调用 / token：     0 次也要写 0；含模型必须给供应商与模型名
[命令与结果]
  实际执行的命令（可复跑）：
  预期与实际结果：            逐项写，不得只给汇总
  错误代码 / 阶段 / 修订次数 / 调用次数 / 耗时：
[限制]
  该证据能证明什么、不能证明什么：
```

**禁止**把设计、模拟数据、本地探针或一次未复核的运行，写成线上通过或端到端通过。**云部署**、**真实浏览器渲染**、**价格、库存、物流**与**60 秒目标**，**一律保持"待验证／未核实"**。（Dify 发布状态已于 2026-10-30 23:04 实测并归档，**不再是待验证项**。）

## 9. 缺口登记（G-1…G-4，本次全部处理完毕）

| 编号 | 原缺口 | 本次处置 | 状态 |
| --- | --- | --- | --- |
| G-1 | 低负担输入 P0 验收项（跳过、返回、状态不丢失、未知项互斥、窄屏与键盘可操作、中文错误）只在 Issue #3 | **已收编**为 §4 AC-I-01…AC-I-13：其中 **10 项可核查**（9 项已实测·通过、1 项已实测·部分），**3 项界面/无障碍行为明确标为不可核查**并给出解除条件（§6 A-04／A-05／A-06） | 关闭（不可核查子项已明示，不再含糊） |
| G-2 | 可观测性验收未列入验收标准；赛道 B 要求"可观测性证据" | **已收编**为 §5 AC-O-01…AC-O-12，字段语义引用 `docs/architecture/observability.md`（不重新定义）；2 项标为**不可核查**（A-01 落盘、A-07 平台追踪） | 关闭（取证待阶段 14，CLOUD-001 #10） |
| G-3 | 评分规则 1.2 要求独立的「异常处理说明」，此前弱覆盖 | **已由 ARCH-001 成文**：`docs/architecture.md` §6 独立成节、六项逐条；本文件只在 §7.1 登记交叉引用与验收判据 | 关闭（交叉引用已建立） |
| G-4 | 无成本／性能指标清单（赛道 B 占 10 分） | **已由 ARCH-001 成文**：`docs/architecture/cost-performance-metrics.md`（含测量方法、待测清单、未知项）；本文件在 §7.2 登记验收判据 | 关闭（实测待阶段 12/14） |

## 10. 赛道 B 对应关系（证据列已按当前真实状态更新）

| 评分维度 | 本产品证据 | 真实性口径 |
| --- | --- | --- |
| 场景价值与痛点 | 青年送礼决策、关系压力、预算／时间／禁忌冲突；三方案与独立检查带来 Agent 增量 | 用户痛点为**定位假设**，无真实用户研究 |
| 云原生架构与选型 | 架构图与 ADR-001…004；确定性规则留在 Code 节点；容器化**已实测（14 项；交付镜像已于 2026-10-31 重建并复核）**；K8S 明确不做 | **云部署从未发生**；容器只绑定 `127.0.0.1`，未推 registry |
| Agent 链路 | 三步结构化输入→三候选→检查→一次修订→选择→四段呈现→复核；Dify 草稿内**真实模型**已产出三候选、真实违规、真实修订与真实持续失败 | 链路在 `web/` 是 **mock**；Dify 呈现阶段**未实现**；Dify **已发布并创建版本（v1；v2 重发布中）** |
| 工程完成度与 Demo | 独立验收套件**四条互不包含、合计 688**（329＋275＋39＋45）/ 46 探针 / **74 组** parity（**样例级**；越界与格式 17 组已覆盖，另 1 组仅错误顺序不同；**网格之外** 1 项 `days=10**20` 分类口径、两侧都拒绝）/ 59 项 HTTP 冒烟 / 容器 **14 项（已重建复核）** / 40 接入层测试 | **前端已在真实 Chromium 完成浏览器级走查（100 项 / 0 失败，2026-10-31）；键盘 Tab 与真实用户可用性未验证**；parity 为样例级等价；无真实端到端 Demo |
| 成本与性能 | 见 §7.2 与 `cost-performance-metrics.md`：6 项已实测（无模型链路），成本与并行为**未知/阻塞** | 缺数据一律 `not_measured`／`unknown`，不得填 0 |
| 可观测性 | 见 §5：运行 ID、修订计数、校验输出、错误码分层、调用计数、版本指纹均有可核查证据 | 平台追踪 `not_collected`；**落盘持久化未实现** |

## 11. 未决项现状登记（OPEN-5…OPEN-8，本次如实登记）

> 本表只登记**当前真实状态**，不改动 `docs/requirements-analysis.md`（阶段 1 冻结件）。该冻结件的 OPEN-5／OPEN-8 表述已过时，同步需产品负责人同意（见文末说明）。

| 编号 | 现状（2026-10-30） | 依据 | 对验收的影响 |
| --- | --- | --- | --- |
| **OPEN-5** | 模型**授权已满足**：产品负责人授权并在 Dify 自行配置 DeepSeek API Key（`custom_configuration.status = active`、4 个模型 `active`），已完成 **累计 13 次真实调用 / 38,326 tokens**。**仍未满足**：供应商单位费率与单任务成本未取得 | `workflow/evidence/WF-003-2026-10-30.md` §4.1、§4.2、§4.5 | 真实生成／修订类条目可取证（AC-P0-09/12、AC-S-02/04）；成本类（AC-C-04）仍**未实测** |
| **OPEN-6** | 无真实商品数据源 → 价格、库存、送达**一律「未核实」**；`business_data_verification` 恒为 `not_verified` | `docs/architecture/observability.md` §3.1；`docs/architecture.md` §9；`docs/product-data-research.md` | 所有费用与准备时间只能读作**估算**；不得出现"实价／有货／准时送达"的表述 |
| **OPEN-7** | `deploy/` 归属**已由 CLOUD-001（Issue [#10](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/10)）认领**；容器化已实测（**14 项**；交付镜像已于 2026-10-31 重建并复核）；预发与云部署仍未执行 | Issue #10 正文「现状（已核实）」「交付物 1–5」；`deploy/evidence/docker-2026-10-30.md`；`deploy/preprod-plan.md` | 无归属缺口已关闭；云部署类验收（阶段 12）仍**未执行** |
| **OPEN-8** | 三个临时提交（`8e8bc27`、`b2ea08a`、`89d6624`）**已复核接受**：其产物被各线作为证据基线复用，并已随已推送的发布分支携带 | `deploy/evidence/README.md`「本轮证据对应的版本」（git HEAD `89d6624`）、`deploy/README.md`（`artifact_manifest.py` → git HEAD `89d6624`）、`docs/competition/材料清单与自查.md`（「本地 HEAD」行）、`tests/acceptance/stage_c/fixtures/PROVENANCE.md`（「来源提交」行）——四处均以 `89d6624` 为基准；`release/2026-11-01-submission` 提交 `959aa6a` 已推送 | 阶段 2/3 文档的验收状态**可以作为基线**。**该残留已消解**：`origin/main == main == 37493f9`（领先 0 个提交），origin 上另有 8 条 `line/*` 快照分支 |

## 12. 边界与非目标（引用本文档时不得省略）

- **云未部署**：无云主机、无 EIP、无镜像仓库推送、无编排与弹性伸缩；`publish-to-uhost.ps1` 从未上传。
- **Dify 已发布并创建版本**（v1 于 2026-10-30 23:04 +08:00；**v2 已重发布**）；平台级 `trace-runs` 仍为 `not_collected`。
- **`web/` 为 mock**：四段呈现为模拟数据，须显著标注；不得表述为"已与真实模型端到端联调通过"。
- **价格库存未核实**：不承诺对方一定喜欢；不提供实时价格、库存或送达承诺。
- **同事**不作为产品主场景与验收案例，仅作技术回归；第三优先级关系（职场上司、亲戚家人、同学、老师/导师、客户/合作伙伴）**MVP 不单独覆盖，登记为 P1**（D-6／D-7），不在本文件 P0 验收范围内。
- **「约 60 秒」为待测目标**，未列入验收项（见 A-08）。

---

**冻结说明**：本文件为阶段 2 定稿（2026-10-30）。冻结后如需改动，必须回到 Issue #11 或新建任务单，并同步 `docs/product-requirements.md`、`docs/user-stories.md`、`docs/product-flow.md` 三份同批文档。`docs/requirements-analysis.md`（阶段 1 冻结件）**不在本次修订范围**，其 OPEN-5／OPEN-8 表述的同步须先经产品负责人同意。

---

## 13. 更新记录（2026-10-31 01:0x 由 PM 统一刷新）

本轮依**独立声明审计**与**独立架构一致性审计**的实测结论刷新，共 16 处；所有替换均以"当场跑出的命令或可复核文件行号"为依据。主要变更：

1. **Dify 由「未发布」改为「已发布并创建版本」**（v1 于 2026-10-30 23:04 +08:00；**v2 已重发布**），并明确 `toolPublished: false` / `version: "draft"` **不能作为发布状态证据**。
2. **单元测试 322 → 329**；规则层错误码 **18 → 19**。
3. **真实模型调用改为双口径**：主批次 10 次 / 34,127；**累计 13 次 / 38,326**。
4. **parity 加「样例级」限定**，并登记残差（原写「样例集不含越界值、越界输入两侧目前不一致（修复中）」——**已于 2026-10-31 修复并扩样**：74 组、越界与格式 17 组已覆盖且一致，仅余 `days=10**20` 错误码口径差异，两侧都拒绝）。
5. **容器化整段标注「待重建后复核」**：当时 `latest` 三处过时（内嵌规则哈希不符、无 I-2 修复、不含可观测入口）；项数按部署线自纠记为 14 项。**该「待重建」状态已于 2026-10-31 01:13:59 解除**（见 §13.1）。
6. **OPEN-8 残留消解**：`origin/main == main`，领先 0 个提交。

**历史记录不改写**：`docs/pm-reviews/**`、`docs/test-reports/**`、`workflow/evidence/**` 中的数字为当时真值，一律保留原文，仅在本文件第 1 节标注时点。

### 13.1 追加刷新（2026-10-31，数字口径统一扫描线）

本轮由**全仓数字口径统一扫描**追加 4 处，依据均为当场跑出的命令或可复核文件行号：

| # | 项 | 旧文（本文件原记） | 现文 | 依据 |
| --- | --- | --- | --- | --- |
| 1 | JS↔Python parity | **原记 55 组**（2026-10-30 时点；本列即旧文，**非现行口径**），且「样例集不含数值越界、越界输入两侧不一致（修复中）」 | **74 组 / 0 处语义差异**（intake 27 / 候选批次 26 / 请求侧越界与格式 17 / 损坏样例 4）；越界网格已覆盖；另 **1 组仅错误顺序**不同。**网格之外**独立登记 1 项 `days=10**20` 分类口径不同（**两侧都拒绝**），**不计入** 74 组 | `node web/tools/parity-check.mjs`（本机复跑） |
| 2 | 独立验收套件 | 只写 `39`（阶段 C） | **四条互不包含：329 ＋ 275 ＋ 39 ＋ 45 ＝ 688**；`discover -s tests` **只覆盖第一条** | 本机复跑四条（2026-10-31）；口径出处 `docs/test-plan.md:214` 起 |
| 3 | 交付镜像 | 「当前 `latest` 待重建 / 已过时」 | **已重建并复核**：`submission-20261101` = `latest` = `d9a4a35763ee`（2026-10-31 01:13:59）；规则哈希 `1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500` **本机 = 交付镜像 `/healthz`** | `deploy/evidence/image-audit-2026-10-31.md`；`sha256sum validator/rules.py`（本机复跑） |
| 4 | 容器检查项 / 冷构建 / 内存 / 镜像体积 | 原记 `9/9`、冷构建 `2.2 s`、内存 `14.41–17.86 MiB` | **14 项**（D-0…D-13）；启动 **0.750–0.939 s（10-30 基线）｜交付镜像 **0.668 s**（均值）**；内存 **14.45–17.08 MiB**。**冷构建有两个合法值**：2026-10-30 基线 **1.720 s**、2026-10-31 重建版 **3,662 ms**。**镜像体积**：构建时基线 177,582,258 字节＝**169.36 MiB**、交付镜像（重建后）177,918,474 字节＝**169.676 MiB** | `deploy/evidence/docker-2026-10-30.md` D-0…D-13 与修订表（`raw/d9-coldbuild.txt` = `REAL_SECONDS=1.720`）、`deploy/evidence/image-rebuild-n1n4-2026-10-31.md:16,17`（177,918,474 B / 3,662 ms；`raw/image-rebuild-n1n4/build-timing.txt`） |

> ⚠️ **未纳入本轮改动（避免误改）**：`p95 1.322 ms` 是**延迟**不是测试数；`/validate` **9/9 组逐字节一致**是**容器探针组数**，与容器检查项数（14 项）**不是同一口径**。二者均**非过期值**。

## §11.0 本轮新增的两条诚实局限（2026-10-31 独立核验发现，**未修**）

1. **共享标签源未写「关系优先级／追求不假定双向好感」条款**：`workflow/labels.py:3-7` 没有这两句，
   而 JS 镜像 `web/server/labels.mjs:15` 已写全（`grep -n "好感\|优先级" workflow/labels.py` → 0 命中）。
   三处（`product-requirements.md:23-26`、`product-flow.md:124`、`labels.py`）**不矛盾但不同步**。
   **决定不改**：本轮不动代码，如实记录。答辩如被问「代码里怎么保证」，答：产品约束写在 PRD 与流程，
   代码层由 `workflow/intake.py:117-118` 的注释与「低压力默认值」落实。
2. **`occasion:"unknown"` 在两条实现里行为不同，且不在 74 组 parity 网格内**：
   Python 侧 `needs_input` + **1 码**（`INTAKE_CLARIFICATION_REQUIRED`）；JS 侧 `needs_input` + **3 码**
   （`INTAKE_UNKNOWN_LABEL` + `INTAKE_CLARIFICATION_REQUIRED` + `INVALID_TYPE`）。
   `web/tools/gen-parity-fixtures.mjs` 的网格里只有 `birthday`，**该值未被 parity 覆盖**。
   另：本文件写「场合 6 项」（JS 产品面），`docs/intake-contract.md:17` 写「枚举共 7 个键」。
   **建议**：补一组 `occasion=unknown` 的 parity 样例（本轮未做）。这是**已知的覆盖缺口**，不是已知缺陷。
