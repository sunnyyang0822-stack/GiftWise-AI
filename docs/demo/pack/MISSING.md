# MISSING —— 本素材包**没有**拍到的东西，以及谁在哪里补

> 本文件是 `docs/demo/pack` 的诚实边界清单。凡本包没给的东西，一律写在这里，**不画图、不摆拍、不复用别的时段的截图充数**。
> 生成时间：2026-10-31 02:20 +0800｜作者：现场演示素材包线（AI 代理）
> 本包本次运行的硬约束：**0 次 Dify 调用、0 次模型调用、未登录任何 Dify 控制台、未改任何生产代码、未做任何 git 分支操作**。

---

## 一、结论先说：本包能证明什么、不能证明什么

| 类别 | 本包状态 |
| --- | --- |
| D8 本机交付物（镜像 / 校验器 / 测试 / parity / 首屏） | ✅ **有真实截图或真实终端输出**，逐条见 `MANIFEST.md` 与 `terminal/` |
| D2 / D4 / D5 / D9 / D10 本机 Web 界面 | ✅ 真实 Chromium 截图，24 张，全部含常驻吸顶「模拟数据」标识 |
| D1 / D3 / D4(Dify 侧) / D5(Dify 侧) / D6 / D7 | ❌ **一张都没有** —— 必须在 **Dify 网页控制台**里截图，本机代理做不到，原因与补拍步骤见下 |
| 候选级 OVER_BUDGET 拒绝界面 | ❌ 当前 demo 开关**无法触达**该界面，未拍（用呈现侧 OVER_BUDGET + 终端证据替代，不冒充） |

---

## 二、必须在 Dify 控制台补拍的（6 项 + D1b）= **7 张**

**统一前置**：用**有该应用权限的浏览器**打开 Dify 控制台 → 「工作室」→ 应用 `GiftWise | 推荐工作流` → 左侧第一项「**编排**」。
全程只**看**，不点「运行」（补拍画布与历史运行详情**不需要新的模型调用**，因此不产生费用、不污染 token 统计）。
每张图都要**能读到应用名、节点名、字段名**；截完把文件按 `D1-01-...png` 之类命名，追加进本目录 `MANIFEST.md` 的表格里。

### D1 画布全图（11 节点 / 11 条边）
- **缺什么**：一张能把 11 个节点和连线都看清的画布图（`docs/demo-script.md` D1）。
- **为什么本机做不到**：Dify 控制台需要登录会话；本包被明确要求 0 次 Dify 调用、不碰 Dify，代理也没有登录态。
- **在哪儿点**：编排页 → 左下角缩放「−」按到 **55%**（截图里正好一屏装下）→ 确认右上角显示应用名与「已发布」状态。
- **验收标准**：图上可辨认节点 `用户输入`、`N1 输入与确定性适配`、`N2 需求分析与三候选`、`N3 CODE 首次校验`、`N4 控制结果分支`、`N5 一次修订`、`N6 CODE 再校验`、`N7A 未修订报告`、`N7B 修订后报告`、`END A 未修订输出`、`END B 修订后输出`，以及 N4 的 `CASE 1 / CASE 2 / CASE 3 / ELSE` 四条分支标注。
- **注意**：`workflow/evidence/WF-003-2026-10-30/dify-draft-graph.png` 是**草稿态**（图上有「自动保存 20:57:57 · **未发布**」），**不能**当作「已发布版本」的证据；`workflow/evidence/WF-003-2026-10-31-publish-v2/dify-v2-run1-demo.png` 是**已发布态**（「自动保存 00:22:08 · 已发布 1 小时前」），但它已在别的时段归档，本包**没有**把它收进 `shots/`。

### D1b 已发布版本号（v1 / v2）
- **在哪儿点**：编排页右上角「**发布**」左边的版本下拉箭头。
- **验收标准**：图上能看到当前线上版本号与发布时间。
- **已有归档可参考**：`workflow/evidence/WF-003-2026-10-30/dify-published-popover-version1-2305.png`（v1）、`workflow/evidence/WF-003-2026-10-31-publish-v2/dify-v2-publish-success.png`（v2）。**同样属于别时段的归档，需产品负责人核验内容后决定是否直接引用。**

### D3 需求分析与三候选（LLM 节点）的输入输出
- **在哪儿点**：编排页点中 `N2 需求分析与三候选` 节点 → 右侧面板切到「**上次运行 / LAST RUN**」标签。
- **验收标准**：面板里能读到 `状态 成功`、`运行时间`、`总 TOKEN 数`（非 0，证明是真模型输出）、`输入`（`intake_json` / `trusted_repair_count`）与 `输出`（`candidates_json`）。
- **本地可对照的原文**：`workflow/evidence/WF-003-2026-10-30/dify-node-io-case1_normal_three_candidates.md`（节点级输入输出**逐字**记录，含 `model_called` 标记）。

### D4 首次校验（CODE 节点）的输入输出
- **在哪儿点**：点中 `N3 CODE 首次校验` 节点 → 「上次运行」。
- **验收标准**：`总 TOKEN 数 = 0 Tokens`（CODE 节点不调模型）+ 输出里的 `all_passed` / `repairable` / `errors[]`。
- **本地可对照的原文**：同目录 `dify-node-io-case2_over_budget_repair_passes.md`、`case3_forbidden_tag_repair_passes.md`、`case4_broken_json_repair_passes.md`、`case5_persistent_failure.md`。

### D5 一次修订与再校验（N4→N5→N6 分支走位）
- **在哪儿点**：点中 `N4 控制结果分支` → 「上次运行」，确认命中的是哪个 CASE；再点 `N5 一次修订` 与 `N6 CODE 再校验` 各看一次。
- **验收标准**：`N5` 的总 TOKEN 数非 0；`N6` 为 0；能看出 `N4` 选中的分支。
- **边界**：`workflow/evidence/.../dify-final-state-*.json` 里记录了「平台 trace / 逐节点观测不可用」的限制，别在 PPT 里声称有完整节点级 trace。

### D6 两条出口（未修订报告 / 修订后报告）
- **在哪儿点**：`N7A 未修订报告` 与 `N7B 修订后报告` → 「上次运行」，各截一张；或直接截 `END A` / `END B`。
- **验收标准**：两张图分别体现「未修订 → `selected_candidate_id` 为 null」与「已修订 → 输出被改写」。

### D7 真实模型调用的 token 汇总
- **缺什么**：`docs/demo-script.md` 要求的 token 总账界面图。
- **在哪儿点**：左侧菜单「**日志与标注**」→ 找到那两条真实运行（`real1_normal_200` / `real2_budget_1_repair`）→ 顶部与每行都有 `TOKENS` 列。
- **要能读到的数字（冻结口径，照抄别算）**：主批次模型调用 **10 次 / 34,127 tokens**；含边界那次累计 **13 次 / 38,326 tokens**。
- **本地可对照的原文**：`workflow/evidence/WF-003-2026-10-30/dify-real-run-summary.json`、`dify-real-postfix-run-summary.json`。
- **⚠ 特别提醒**：同目录下 `dify-run-summary-table.json` / `dify-demo-run-summary.json` 之类是**草稿态 mock / 注入路径**的运行汇总，**不能**当作真实 token 证据。图上必须能看出是**真实运行**，并且与 `dify-real-run-summary.json` / `dify-real-postfix-run-summary.json` 对得上。

---

## 三、本机明明能跑、但界面**不存在**的（用终端证据替代，不冒充截图）

### D9 校验器 API 的 OVER_BUDGET 响应
- `deploy/server.py` 只提供 `GET /healthz` + `POST /validate` 两个 **HTTP JSON** 端点，**没有网页界面**，因此「截一张超预算拒绝的网页图」这件事本身不成立。
- **替代证据（真实、可复现）**：`terminal/D9-over-budget-validate.txt` —— 对**交付镜像起的容器** POST 一个把候选总价改成 250.00 的批次，返回 `status: failed` / `candidate c1: OVER_BUDGET @ candidates[0].estimated_total — 估算总费用超过预算`。
- **现场演示建议**：这一段直接在终端跑（命令就在该文件头部），或用 PPT 放该终端输出的截图 —— 但**不要**说成是 Dify 给的拒绝。

### 候选（推荐阶段）级别的 OVER_BUDGET 拒绝界面
- 现在的演示开关只有 `?demo=presentation_over_budget`，它让**第 1 次呈现复核**失败并触发那唯一一次自动修订，界面上 OVER_BUDGET 出现在「**首次复核发现的问题（已用唯一一次修订）**」框里（= `shots/E4-01-over-budget-full-desktop-1280x900.png`）。
- **候选阶段**（卡片上直接写「未通过，不可选择 + OVER_BUDGET」）目前**没有**可用的 demo 开关能稳定复现（`?demo=partial_fail` 造出来的是 `UNKNOWN_FACT_REF`，不是 OVER_BUDGET）。
- **所以本包不给**：拿 `partial_fail` 的图冒称 OVER_BUDGET。若要这一屏，属于**产品/前端改造**（加一个 `?demo=candidate_over_budget` 开关），不在本素材包线权限内（本线不得改 `web/**`）。

---

## 四、本包要求里**没做**的次要项（非缺失，登记备查）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 窄屏（390）失败态：`model_error` / 超时 / 空态 | 未拍 | 要求清单只点了「失败态」，本包给了 desktop 版（E1/E2/E3）。若要窄屏版，重跑 `node docs/demo/pack/capture.mjs` 后按需加视口即可 |
| `?demo=stress` 破版压力态 | 未拍 | 属回归证据，非演示素材；`web/tools/browser-check.mjs` 会拍，但落在 `.tmp/browser/shots`，不是本包交付物 |
| 四段呈现的窄屏逐段图 | 只给整页 | `shots/D5-06-presentation-full-narrow390.png` 是窄屏整页；逐段窄屏图非要求项 |
| 真机（安卓/iOS 手机）截图 | 未拍 | 本包只有 Chromium 设备模拟（390×844 / 320×640），**不能**声称在真机上验证过 |
| 视频录屏 | 未做 | 文字说明里的「录屏」不在本包范围；本包只出静态图 |

---

## 五、补拍完成后怎么并入本包

1. 按 `D<编号>-<序号>-<描述>-<viewport>.png` 命名，放进 `docs/demo/pack/shots/`。
2. 在 `MANIFEST.md` 表格里**新增一行**（文件 / 对应编号 / 截图时刻 / 目标 URL 或"Dify 控制台" / viewport / 复现命令 / 图上证明了什么）；
   若该图不是在 `http://127.0.0.1:8787` 拍的，**目标 URL 一栏必须写明"Dify 控制台（非本机服务）"**，以免与本地截图混淆。
3. 补拍人、补拍时间、在哪台机器上拍的，写在 `捕获报告` 的「补拍记录」小节里。
4. **不要**把 Dify 控制台截图和本地接口截图混在一张图里，也不要给 Dify 图加任何"已上云/已部署/多副本"的字样。
