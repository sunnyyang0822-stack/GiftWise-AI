# REV-QA-001 后端与模块独立验收

本轮结论：**指定后端模块与本地 mock 接口检查有通过证据，但验收门禁尚未全部通过。** 新版规则套件 3 项断言失败、旧基线存在不适用的旧预期/指纹，以及工作流生成物源指纹过期。不能标记新版产品或全链路通过。

最新任务已调整为后端优先。**最终浏览器与端到端：BLOCKED，原因“等待前端交付并锁定集成版本”。** 前端仍在修改，此前浏览器观察只对应 `ce5fd11` 旧集成版本，不能据此断定下一版本前端状态。此报告供 PM 审查，不自行修业务代码或合并。

## 版本、环境与证据边界

- 被测集成 SHA：`ce5fd11af5581a8f10f82dc995ec24bfd1b3e4b1`，含 PR #50 合入。
- 独立副本：`C:/Users/lenovo/Desktop/giftwise-final-qa`；最初为该 SHA 的干净 detached worktree，后创建 QA 分支 `codex/rev-qa-001-backend-ce5fd11`。主工作区未 reset、切换或清理。
- Windows；指定 Python `C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe` 实为 **3.12.10**；PATH 上的 Python 为 3.12.12。权威命令原始结果保留在 `final-20261031/raw-python312/`，没有把两个 Python 运行混成一次。
- Node v24.21.0；历史浏览器 Chrome 156.0.8078.79。专用服务 `127.0.0.1:8798`，`GW_MODE=mock`；早期旧 HTTP 冒烟使用 8797。服务身份先以本副本静态资源字节对照验证，health/config 响应见接口原始轨迹。
- 时间使用北京时间。指定 Python 完整命令批次开始于 **2026-10-31 11:09:14 +08:00**；逐命令起止、退出码、初始工作区状态和业务文件哈希见 `raw-python312/summary.json`。补充模块与快照探针起止见 `backend-raw/summary.json`。
- 读取本版 AGENTS、产品需求、交付变更契约、PM 三稿审查及 nov01 QA 计划。独立 `gh issue view 1 --repo sunnyyang0822-stack/GiftWise-AI --json number,title,body,url` 成功，正文保存在 `final-20261031/issue1-read.json`；本轮不再使用 PM 的读取代替 QA。
- 只使用虚构输入，没有访问 Dify、调用线上模型、部署云服务或检查真实商品。识别器 provider 的测试是依赖注入/固定样例，不是真实 AI。
- `business_hashes_before == business_hashes_after`；`git diff` 的业务目录与两个禁改基线文件均无差异。旧脚本临时适配已还原，仅将历史 adapter diff 保存在证据目录。此次 PR 只新增测试与报告。

## 实际命令与逐套结果

下表证据路径均相对本报告目录。以实际数量为准，参考数字 329 并非本版实际值。PASS/FAIL 是命令结果；失败原因另分类，不把旧预期失配说成业务回退。

| 执行项 | 命令 | 实际结果 | 状态 | 原始证据 |
| --- | --- | --- | --- | --- |
| 主套件（旧参考 329） | 指定 Python `-m unittest discover -s tests -q` | 实际 337 项，0 失败 | PASS | `final-20261031/raw-python312/old-main.stderr.txt` |
| stage B | 指定 Python `-m unittest discover -s tests/acceptance/stage_b -q` | 275 项，8 次失败 | FAIL | `final-20261031/raw-python312/old-stage-b.stderr.txt` |
| stage C | 指定 Python `-m unittest discover -s tests/acceptance/stage_c -q` | 39 项，1 次失败 | FAIL | `final-20261031/raw-python312/old-stage-c.stderr.txt` |
| boundary | 指定 Python `-m unittest discover -s tests/acceptance/boundary -q` | 45 个测试方法，8 次失败事件（含同方法 subTest） | FAIL | `final-20261031/raw-python312/old-boundary.stderr.txt` |
| 排除项审核 | `node web/tests/exclusions.test.mjs` | 111 场景、378 条断言 | PASS | `final-20261031/raw-python312/exclusions.stdout.txt` |
| 新 JS 规则 | `node web/tests/revision-rules.test.mjs` | 6/6 | PASS | `final-20261031/raw-python312/revision-rules.stdout.txt` |
| 分析确认 API | `node web/tests/revision-api.test.mjs` | 1/1，自起 mock 服务 8796 | PASS | `final-20261031/raw-python312/revision-api.stdout.txt` |
| access-layer | `node web/tests/access-layer.test.mjs` | 41/41 | PASS | `final-20261031/raw-python312/access-layer.stdout.txt` |
| 测试夹具准备 | 指定 Python `tests/acceptance/nov01_revision/prepare_fixtures.py` | 31 组夹具自检；不执行业务 | PASS（仅测试资产） | `final-20261031/raw-python312/prepare-fixtures.stdout.txt` |
| nov01 Python | 指定 Python `tests/acceptance/nov01_revision/run_nov01.py` | 31 项，28 通过、3 失败 | FAIL | `final-20261031/raw-python312/nov01.stderr.txt` |
| QA 后端补充 | `node tests/acceptance/nov01_revision/backend-revision.mjs` | 12/12 | PASS | `final-20261031/backend-raw/backend.stdout.txt`、`backend-results.json` |
| QA 快照边界 | `node tests/acceptance/nov01_revision/snapshot-revision.mjs` | 6/6 | PASS | `final-20261031/backend-raw/snapshot.stdout.txt`、`snapshot-results.json` |
| QA 专用端口接口探针 | 显式 `GW_BASE=http://127.0.0.1:8798` 后 `node tests/acceptance/nov01_revision/http-revision.mjs` | 46/46，本地 mock HTTP；非最终 E2E | PASS | `final-20261031/http-final-selected-pass.txt`、`http-final-selected-pass/http-results.json`、`http-traces.json` |
| 最终 HTTP/浏览器/E2E 门禁 | 前端交付并锁定新的集成 SHA 后执行 | 当前暂缓，不沿用历史 PASS | BLOCKED | 等待前端交付并锁定集成版本 |
| 真实 Dify/线上模型/云/商品数据 | 按用户边界不执行 | 未验证 | SKIP | 本轮无这类运行记录 |

前 12 个命令项（含夹具准备）为 8 PASS、4 FAIL；专用接口探针另 1 PASS。最终三个集成门禁归为 1 个 BLOCKED 行，禁止的外部能力归为 1 个 SKIP 行。断言、测试方法、命令不可跨单位相加成通过率。

## 后端需求逐项结论

| 要求 | 状态 | 预期与实际、证据 |
| --- | --- | --- |
| 0 元合法 | PASS | `0/0` 预算、三个 `0.00` 估价通过；补充 `zero-free`、nov01 `R02`、HTTP `zero-legal` |
| 0 元有价礼物 | PASS | 三个 `0.01` 候选均 `OVER_BUDGET` 且不可选；`backend-results.json` 中 `zero-paid-fails`、nov01 `R03` |
| 低于 min 仅警告 | PASS | 三个 99.99 对 100–150：errors 空、`BELOW_BUDGET_RANGE`、仍 passed；后端/HTTP 均核对 |
| 三个候选不合计 | PASS | 三个 138 对 100–150 预算逐项通过，不把 414 当预算对象；补充 `three-prices-not-summed` |
| 其他关系/其他场合 | PASS（服务端） | 当前字段 `recipient_relation_custom`、`occasion_custom`；空/纯空格/null/数字/1001 字符/缺失/非 other 携带自定义均拒绝；合法文本冻结进 request。HTTP 轨迹保留每例实际请求和响应 |
| 其他金额 | PASS（服务端） | 字段为 `budget_mode=other`、`budget_range.min/max`，不发明额外自由金额字段。缺端点/空白/倒置/>10000/slider 携带非步长值拒绝，服务端不静默补齐 |
| AI 未确认不得推荐 | PASS（固定 mock 审核/API） | 非空 dislikes 无确认/部分确认/重复 ID/错误 ID 均 needs_input；空 dislikes 不产生分析 ID；未映射内容不放行。378 断言覆盖非法/无锚定/失效 provider 等，不证明真实模型理解 |
| 快照归属与冻结 | PASS（本地） | 修改 intake 复用原 analysis_id 拒绝；不存在/伪造 ID 拒绝。TTL 精确 10 分钟保留，超过 1ms 删除并阻断推荐；200 条边界清理。TTL 用本进程 Date.now 注入，不是自然等候 10 分钟的 HTTP 证据 |
| 重复确认幂等 | PASS（本地 mock） | HTTP 返回同一 run ID；离线两个并发确认返回相同运行且 recommend=1；不代表真实 provider 的并发验证 |
| 预算/时间/关系不被改写 | PASS（服务端模块） | 输入前后 JSON 一致；原始 10 元/5 天/pursuit 在修订后不变；确认结果进入约束后原输入变化不可复用旧快照 |
| 用户选择前不呈现 | PASS（API/模块） | selected ID=null，presentation=0；伪造项、失败项不可选。没有把测试主动选择合格项误说成产品自动选择 |
| 全局最多一次修订 | PASS（mock 模块与 access-layer） | 小预算触发推荐修订后 repair_count=1，再次呈现违规时 presentation_revision=0；旧 access-layer 两种额度路径分别验证。修订是异常兜底，不作为产品主功能 |
| 账单只记选中礼物 | PASS（数据结构） | gift_estimated_total 与冻结候选相等，仅一个 candidate；packaging 只含 color_palette；presentation 无 additional_cost/revised_estimated_total；直接提交这些旧报价字段被 PRESENTATION_INVALID 拒绝 |
| 包装仍检查时间/禁忌 | PASS（模块） | 违规色调/超期分别命中 FORBIDDEN_TERM/PREPARATION_TOO_LONG；“未报价”不能被读为免费 |
| 页面交互、加载、最终账单渲染 | BLOCKED | 等待前端交付并锁定集成版本；API 数据结构通过不代替页面验收 |

## 失败记录与负责人

以下统一环境为 Windows，本地副本 SHA `ce5fd11`，未修改实现。每个问题回归均未执行，等待对应负责人交付及 PM 确认，不通过删测试消除失败。

### REV-QA-001-BUG-001｜高｜工作流生成物过期

- 复现：指定 Python 执行 stage C，定位 `C5-02/test_c5_02_manifest_matches_generated_artifacts`。
- 预期：当前规则/适配/runtime 与 generated manifest 的源码指纹一致。
- 实际：`manifest:sources_sha256` 失配。manifest 仍记录规则旧指纹 `1f389dad…`，当前规则为 `f548f955…`（完整值见 raw 失败输出）。
- 证据：`raw-python312/old-stage-c.stderr.txt`；`workflow/generated/manifest.json` 的源码映射。
- 影响：本地规则通过不能推定 Dify Code 生成物包含新版规则。
- 负责人：工作流 Agent 重建并交付，PM 集成；QA 不改 `workflow/`。回归：等待修复。

### REV-QA-001-BUG-002｜中｜新独立夹具的错误路径与实现不一致

- 最小复现：`run_nov01.py` 的 `R-invalid-missing-min`、`R-invalid-missing-max`、`R-invalid-mismatch`。
- 预期（现有独立夹具）：对应错误码的 path 为 `request.budget_range`。
- 实际：分别为 `request.budget_range.min`、`.max`、`request.budget_amount`；三例均正确 needs_input、未误放行，但精确断言失败。
- 证据：`raw-python312/nov01.stderr.txt`，包含完整期望和实际；夹具源 `tests/acceptance/nov01_revision/fixtures.py`。
- 影响：契约精确路径门禁未统一。PM 变更契约只规定 request.* 分层，不能由 QA 默认为应改实现或应改夹具。
- 负责人：PM 统一精确字段路径，规则/QA 按裁决执行；本轮保留三个失败，不放宽断言。回归：待裁决。

### REV-QA-001-BUG-003｜中｜历史测试基线未完成版本迁移

- 复现：原样运行 stage B 和 boundary。
- 预期（历史夹具）：0/0.99 等预算按旧 [1,10000] 拒绝；固定旧源码指纹/中文范围解释。
- 实际：新版依据已确认的 [0,10000] 正确接受低值；历史文字与指纹断言仍失败。stage B 8 次失败，其中 6 个金额范围/文案、2 个指纹；boundary 8 次失败事件均仍要求零预算的请求侧 LIMIT_EXCEEDED。
- 证据：`raw-python312/old-stage-b.stderr.txt`、`old-boundary.stderr.txt`，未删/改历史测试。
- 影响：不能宣称四套旧基线全绿；这些零值失配不代表新版业务错误。需区分历史基线保持与新版发布门禁，不简单重钉 SHA 掩盖差异。
- 负责人：PM/规则/QA 协调版本化预期与门禁，保留历史。回归：等待裁决。

## 历史 UI 观察与测试启动问题（不计本轮最终浏览器验收）

所有下述记录均发生在任务收敛之前，同一 `ce5fd11` 副本。当前统一 BLOCKED，原因“等待前端交付并锁定集成版本”。

- 旧 browser-check 按旧预算 chip 操作退出 2；首次适配又点击已选预算模式而关闭控件，是 QA 操作失误。相关 `browser-check*.txt` 原样保留，不将其当业务缺陷。
- 独立浏览器观察 desktop/390/320 共 27 PASS、9 FAIL、27 BLOCKED：每个视口分别看到时间配置不兼容、其他关系和其他场合输入缺失；截图及实际配置在 `browser-final/`。时间接口下发 value，前端读取 days/available_days；三项失败是该 SHA 的已复现历史观察，责任为前端/接入联调，前端新交付后须重验。**不计为当前前端最终结果。**
- 旧 HTTP 59 项脚本初跑在旧账单字段退出 2；临时适配后 3 条失败涉及旧六档数量预期、旧账单字段，以及重复推荐幂等后的运行状态交叉影响。脚本已还原，失败文件与适配历史记录保留，不称为三项已确认业务缺陷。
- QA 新接口探针首次因自身 import 相对路径错误未启动；修正后误选不合格 c1 导致 5 项连带失败。实际服务返回 CANDIDATE_NOT_PASSED，属正确拒绝。随后测试显式选择真实通过的 c2，46 项全部通过。`http-final.txt`、`http-final-rerun.txt`、`http-final/` 与 `http-final-selected-pass/` 均保留，避免混淆。
- 早期 Python 3.12.12 的控制台中文有编码损坏；权威补跑使用用户指定 Python 3.12.10，设置 PYTHONIOENCODING=utf-8，stdout/stderr 分开按字节保存。旧文件不覆盖。

## 后续入口与 PR 边界

本次只把新增 QA 测试、报告及原始证据作为新后续 PR 交 PM，不往已合并的 #50 追加，不自行合并。

1. PM 处理错误路径与旧基线迁移口径；工作流 Agent 交付生成物同步版本。
2. 前端完成交付，PM 集成并给出锁定 SHA。
3. QA 从该 SHA 的独立副本、专用端口重新执行后端/HTTP/浏览器/E2E，记录新的实际证据。不可把本报告 `ce5fd11` 的后端 PASS 拼接到另一分支的 UI 结果声称一次全链路通过。
4. 真实 Dify、模型、云和商品数据保持 SKIP，除非收到后续明确授权。

**本报告不签发新版产品或演示最终通过。** 产品主链路是帮助用户判断送什么、为什么适合、如何比较并自主选择；后端规则与失败兜底通过不能替代该主链路的实际用户体验验收。
