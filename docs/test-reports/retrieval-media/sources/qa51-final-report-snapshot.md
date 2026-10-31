# 最终集成基线独立 QA 报告（2026-10-31）

结论：**当前版本不通过最终用户流程验收**。规则、接入 API、离线工作流的已执行检查有通过证据；正常页面在准备时间处被阻断，另有其他关系/场合输入缺失和 Python/JS 契约分歧。真实 Dify/模型为 SKIP，完整浏览器 E2E 为 BLOCKED。

## 被测版本与独立性

- 业务基线：`3dfb186b74a4afabfef82c7213401fb60587f946`，本轮开始同步的 `origin/release/2026-11-01-submission`，包含 PR #49/#50/#54。
- 独立 worktree：`C:/Users/lenovo/Desktop/giftwise/qa-pinned-1031`；分支 `codex/final-qa-pinned-1031`。主工作区未切分支，已有修改、其他 Agent 产物和旧失败证据未纳入提交。
- Windows、Python 3.12.10、Node 24.21.0、Chrome 156.0.8078.79；本轮执行时间约 2026-10-31 12:26–12:29（Asia/Shanghai），各命令精确时间见证据。
- 专用服务 `http://127.0.0.1:19437`、专用 Chromium CDP `9439`；本轮自起进程，先确认端口空闲；HTTP/浏览器入口核对静态资源与副本一致。实际模式为 **mock**，固定虚构数据；不是实时商品、真实模型或 Dify 验收。进程已停止。
- 已独立读取 AGENTS、test-plan、product-requirements、development-process、交付变更契约、最近 QA 测试迁移报告，以及公开 Issue #1 正文。通过 GitHub 独立读取最新前端 PR #49、工作流 PR #55；#55 尚未合入，不使用它的实现或自测作为本次证据。
- 先运行发布分支原测试；再从 QA PR #51 精确提交 `48904eb99261ed1186481af795f9dd7a4c696a3d` 提取测试资产，执行已获 PM 裁决的迁移版本。业务实现始终为同一个 release SHA，两轮结果分别保留，不能称迁移测试已被 PM 合入。
- `workflow/verify_local.py` 会写本地证据指针并重建生成物（本次生成物仅换行变化）。执行后先归档副作用、内容比对和哈希，再恢复这些本轮写入；受保护目录最终逐字节与运行前一致，见 `evidence/protected-source-check.json`。不提交业务、工作流或部署实现变更。
- 前轮 `qa-final-run` 是从活动工作区复制的探索副本，**排除在本报告外**；其结果不能归属该 SHA。原始输出保留，不拼接为本轮结果。

## 汇总与实际命令

以报告条目计：**PASS 18 / FAIL 7 / SKIP 1 / BLOCKED 1**。其中 25 条为真实执行命令（18 PASS、7 FAIL），另两条分别为真实线上验证 SKIP、最终 E2E 门禁 BLOCKED。命令重复覆盖同一规则，不合并成虚假的业务通过率。

原始 stdout/stderr、退出码、时间和命令索引见 `evidence/command-index.json`。下表证据均相对于本报告目录的 `evidence/`；Python 调用使用本机 Python312 的绝对解释器路径。

| 原发布测试命令 | 实际结果 | 状态 | 原始证据前缀 |
| --- | --- | --- | --- |
| `python tests/acceptance/nov01_revision/run_nov01.py` | 31 项，3 失败：旧错误字段路径 | FAIL | `release-nov01` |
| `python -m unittest discover -s tests -q` | 337 项，0 失败 | PASS | `release-main` |
| `python -m unittest discover -s tests/acceptance/stage_b -q` | 275 项，8 失败：6 预算旧预期、2 旧指纹 | FAIL | `release-stage-b` |
| `python -m unittest discover -s tests/acceptance/stage_c -q` | 39 项，0 失败 | PASS | `release-stage-c` |
| `python -m unittest discover -s tests/acceptance/boundary -q` | 45 项，8 失败：零预算旧预期 | FAIL | `release-boundary` |
| `node web/tests/exclusions.test.mjs` | 111 场景、378 条实际断言 | PASS | `exclusions` |
| `node web/tests/revision-rules.test.mjs` | 6 项 | PASS | `revision-rules` |
| `node web/tests/revision-api.test.mjs` | 1 项 | PASS | `revision-api` |
| `node web/tests/access-layer.test.mjs` | 41 项 | PASS | `access-layer` |

| 本轮 QA 测试资产上的命令 | 实际结果 | 状态 | 原始证据前缀 |
| --- | --- | --- | --- |
| `python tests/acceptance/nov01_revision/run_nov01.py` | 31 项 | PASS | `qa-migrated-nov01` |
| `python -m unittest discover -s tests -q` | 337 项 | PASS | `qa-migrated-main` |
| `python -m unittest discover -s tests/acceptance/stage_b -q` | 275 项 | PASS | `qa-migrated-stage-b` |
| `python -m unittest discover -s tests/acceptance/stage_c -q` | 39 项 | PASS | `qa-migrated-stage-c` |
| `python -m unittest discover -s tests/acceptance/boundary -q` | 47 项，原方法保留并增加2项 | PASS | `qa-migrated-boundary` |
| `python tests/acceptance/nov01_revision/prepare_fixtures.py --check` | 31 组夹具一致性；仅资产检查 | PASS | `fixture-check` |
| `node tests/acceptance/nov01_revision/backend-revision.mjs` | 12 项，纯模块/固定 mock | PASS | `backend` |
| `node tests/acceptance/nov01_revision/snapshot-revision.mjs` | 6 项，进程内时钟注入 | PASS | `snapshot` |
| `python workflow/verify_local.py` | 46 个本地探针，model_calls=0 | PASS | `workflow-default` |
| `python workflow/verify_local.py --nov01` | 22 个本地断言，model_calls=0 | PASS | `workflow-nov01` |
| `python tests/acceptance/nov01_revision/review_rebuilt_content.py` | 5 产物内容重建一致、31 组规则语义、4源码/5产物指纹匹配 | PASS | `content-review` |
| `python tests/acceptance/final_qa_1031/test_intake_parity.py` | 18 项：JS 9/9；Python 5/9，4 失败 | FAIL | `intake-parity` |
| `node web/tools/smoke-http.mjs` | 旧账单字段 `.replace` 异常，退出2；不推断未输出断言通过 | FAIL | `http-legacy` |
| `node tests/acceptance/nov01_revision/http-revision.mjs` | 专用端口，46 PASS、0 FAIL | PASS | `http-revision`、`http/http-results.json` |
| `node web/tools/browser-check.mjs` | 找不到旧预算 chip，退出2 | FAIL | `browser-legacy` |
| `GW_REVISION_QA=1 node web/tools/browser-check.mjs` | 真实 Chrome 三视口：27 PASS、9 FAIL、27 BLOCKED，退出1 | FAIL | `browser-revision`、`browser/revision-browser-report.json` |
| 真实 Dify、线上模型生成/修订及真实成本 | 不调用；本地和固定快照不能证明线上能力 | SKIP | 无线上执行证据 |
| 新版完整浏览器 E2E、加载/超时恢复/返回上一步 | 第一页准备时间门禁阻断；等待前端修复并由 PM 锁定集成版本 | BLOCKED | 上述浏览器证据含27条受阻检查 |

首次网络准备端口冲突（WinError10048）见 `network-preflight-attempt1.json`，未连接占用者；换用专用端口后重新执行。它属于环境准备失败，不当作产品缺陷，也不覆盖其记录。

## 产品范围逐项结论

| 范围 | 结论及证据适用边界 |
| --- | --- |
| 1 正常输入 | PASS：模块/HTTP mock 三候选；浏览器主线 BLOCKED |
| 2 恋人/追求对象 | PASS：18项跨适配测试中两种关系正常值均通过，机器值独立；真实模型话术 SKIP |
| 3 朋友 | PASS：Python/JS 正常值及确认 API；真实个性化效果 SKIP |
| 4 其他关系 | FAIL：Python custom 字段分歧、浏览器缺输入；JS HTTP 必填/非法组合独立通过 |
| 5 其他场合 | FAIL：同上；JS HTTP 必填/非法组合独立通过 |
| 6 其他金额 | PASS：模块/HTTP 端点/区间/必填；浏览器存在两输入、空值阻断 |
| 7 超预算 | PASS：0元有价礼物和上限超出拒绝；下限仅 warning，来自31项和12项模块证据 |
| 8 明确禁忌 | PASS：代码和固定 AI 信封/HTTP 审核；真实识别语义 SKIP |
| 9 准备时间冲突 | PASS：代码超限/边界；FAIL：正常页面不能显示六档选择 |
| 10 信息不足 | PASS：规则/HTTP 拒绝、未映射或未确认不能推荐 |
| 11 无效 JSON | PASS：旧模块及排除项严格解析；真实模型坏输出恢复 SKIP |
| 12 修订成功 | PASS：离线工作流/固定 mock；真实模型修订 SKIP |
| 13 修订失败 | PASS：离线持续失败/不额外修订保护；真实模型修订 SKIP |
| 14 选择后包装与贺卡 | PASS：HTTP 实际选择合格候选后生成固定呈现；浏览器 BLOCKED |
| 15 前后端完整浏览器流程 | BLOCKED：不能越过第一页或注入本地 UI 夹具冒充闭环 |
| 16 加载、失败、重试、返回 | BLOCKED：相关27条浏览器检查未执行到；不凭静态代码判定 |
| 17 账单/成本显示 | PASS：HTTP 所选一项礼物估价、冻结原价、包装无报价、不相加；浏览器显示 BLOCKED，真实调用成本 SKIP |

AI 识别证据是固定 mock 与独立信封审核，快照 TTL 证据是进程内模拟时钟；都已如实标注。没有实时价格、库存、送达或新版云端验证。历史 stage C 读取旧 Dify 证据不代表本轮访问了 Dify。

## 可复现缺陷

以下环境均为上述固定 SHA；所有失败原输出保留。回归状态：业务缺陷未修复，本轮没有代修实现。

### FQA-001：准备时间字段不兼容，阻断正常送礼主流程

- 严重程度：**阻塞**；模块：前端/配置接入；责任：前端 Agent 主责，接入 Agent 协同，PM 统一字段契约。
- 最小输入/步骤：启动本副本 mock 服务，普通 `/` → 开始挑礼物 → 关系任选、预算确认，查看准备时间；不使用 `?ui_fixture=nov01`。
- 预期：显示六档 1/5/7/30/90/365，可选一档进入下一步。
- 实际：API `ranges.deadline` 有6条且数值在 `value`；页面只读取 `days`/`available_days`，显示“准备时间配置尚未更新为六档”，不能提交。三个视口均失败。
- 复现：`GW_BASE=http://127.0.0.1:19437 GW_CDP=http://127.0.0.1:9439 GW_REVISION_QA=1 node web/tools/browser-check.mjs`（PowerShell 用 `$env:` 设置；完整启动入口 `network.py`）。
- 原始证据：`browser/revision-browser-report.json` 的 `*:six-time-options`；`http/http-traces.json` 首个 config 响应；`browser/shots/revision-narrow390.png` 已人工查看。
- 影响：所有正常用户无法从第一页继续；加载、确认、推荐、选择和账单无法做浏览器闭环。回归：仍 FAIL，修复并集成后从新 SHA 重跑。

### FQA-002：选择其他关系后没有必填补充输入

- 严重程度：**高**；模块：前端；责任：前端 Agent。
- 输入/步骤：第一页关系选“其他”。预期：出现关系补充输入，空值拦截，非空向 `recipient_relation_custom` 提交。
- 实际：三个视口都无关系输入；服务端需要该字段，正常页面无法提供。
- 复现：同 FQA-001 浏览器命令，`*:other-relation-input`。
- 证据：浏览器 JSON 和三张 `revision-*.png`。影响：其他关系无法合法推荐。回归：仍 FAIL。

### FQA-003：选择其他场合后没有必填补充输入

- 严重程度：**高**；模块：前端；责任：前端 Agent。
- 输入/步骤：第一页场合选“其他”。预期：出现补充输入并按当前服务端 `occasion_custom` 契约提交。
- 实际：三个视口均无场合输入；HTTP 有效自定义场合可接受，页面不能填写。
- 复现/证据：同浏览器入口，`*:other-occasion-input`、三张截图。影响：其他场合无法合法推荐。回归：仍 FAIL。

### FQA-004：Python 工作流与 JS 接入对 custom 必填行为分歧

- 严重程度：**高**；模块：`workflow/intake.py` 适配/生成物；责任：工作流 Agent，PM 集成；未合入 PR #55 是待复核修复，不能当成已修复。
- 最小输入：测试源 `BASE` 上分别覆盖①`recipient_relation=other,recipient_relation_custom=虚构补充说明`；②`occasion=other,occasion_custom=虚构补充说明`；③/④对应 other 不带 custom。完整虚构 JSON 见 `intake-parity-results.json`。
- 预期：①② ready 且保留显示文字/custom原文；③④ needs_input，不产生可用 request。
- 实际：Python ①② `needs_input/INTAKE_UNKNOWN_FIELD`，③④ `ready`；JS 四项行为正确。18项中这4条 Python 失败，其余14条通过。
- 复现：`python tests/acceptance/final_qa_1031/test_intake_parity.py`，退出1。
- 证据：`intake-parity.stderr.txt`、`intake-parity-results.json`。
- 影响：相同输入跨接入/工作流接受性不一致；不能推定新版 Dify 可接此契约。回归：仍 FAIL；等 #55 正式集成后复验并重建核对，不测未合入分支替代。

### FQA-005：发布分支仍保留旧零元预算和错误路径预期

- 严重程度：**中**（测试资产）；责任：QA/PM 审查并集成 PR #51 的测试迁移。
- 输入/复现：在原发布 SHA 执行表中 release-nov01/stage-b/boundary 三条命令。
- 预期：三项精确路径分别为 `request.budget_range.min`、`.max`、`request.budget_amount`，错误码/needs_input/候选全拒保持；0/0.0/0.00/0.99 合法；有价候选仍超预算、366天仍拒绝；内容审阅后指纹与正式生成物对应。
- 实际：原套件分别3/8/8失败。nov01 三例仍期待区间父路径，stage B/boundary 仍有旧零元拒绝预期及旧指纹。
- 证据：三个 `release-*.stderr.txt`；原输入、旧/新期望的逐例迁移表在 PR #51 历史报告，本轮 `qa-changes.patch` 保存实际 diff。
- 回归：**测试迁移后的31/275/47均 PASS**，精确路径和拒绝语义未放宽；发布原版失败仍保留，不改写成历史 PASS。生成物5内容/31语义/指纹已重新独立验证。

### FQA-006：旧 HTTP 与浏览器脚本仍依赖已移除的 UI/账单格式

- 严重程度：**中**（测试资产）；责任：QA，契约不明处由 PM 确认。
- 复现：表中 `node web/tools/smoke-http.mjs` 和默认 `node web/tools/browser-check.mjs`。
- 输入：旧 HTTP 内置追求对象请求；旧浏览器正常填表步骤。
- 预期：新版账单只断言所选礼物和包装不报价；新版表单使用双滑块，独立脚本能给出可审阅结果。
- 实际：HTTP 读取已移除 `revised_estimated_total.replace` 后中止，退出2；浏览器查找已移除预算 chip“100–200 元”后中止，退出2。
- 证据：`http-legacy.stderr.txt`、`browser-legacy.stderr.txt`；不因异常前无报错就宣称前置断言通过。
- 影响/回归：旧脚本不具备新版全程验收能力。保留原默认入口和失败；新增显式新版 browser-check 分支及新版 HTTP 独立探针后，HTTP46 PASS、浏览器实际9 FAIL，并未掩盖业务缺陷。旧入口本轮仍 FAIL，后续应迁移其预期并继续保留历史日志。

## 交付与下一轮入口

本分支只交付测试源、测试入口和新报告/证据，不修改 `validator/`、`web/server/`、`web/public/` 或 `workflow/` 实现。不调用模型、不部署、不合并 PR。

PR #51 仍开放，本轮更新同一 PR；本地独立 QA 分支合入其历史记录后向原 PR 分支作正常追加提交，不改写旧提交或历史证据。PM 需复核本报告，协调前端修复 FQA-001/002/003、工作流修复 FQA-004，并复核测试预期迁移。

辅助探针本轮新生成的 `backend-results.json`、`snapshot-results.json` 及内容重建记录已归档到 `evidence/auxiliary/`，不占用或覆盖 PR #51 的历史证据路径。旧日志和本轮输出必须按各自 SHA/时间区分。

下一轮入口：PM 提供包含修复的锁定 release SHA；QA 新建固定副本，重跑同套模块、跨层契约、专用端口 HTTP 和普通 URL 的真实浏览器流程，再验证三种加载、失败/重试/返回及最终账单。未满足这些门禁前，**不签发最终 E2E 或比赛演示通过**。线上 Dify 只有经新授权和真实执行证据才能从 SKIP 改判。
