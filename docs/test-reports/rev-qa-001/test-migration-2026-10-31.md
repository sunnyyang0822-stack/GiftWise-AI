# REV-QA-001 错误路径与发布测试迁移：分阶段回归

**最终状态请先看文末“PR #54 合入后的独立复核”。本文件前半段保留合入前的实际结果；最终五套回归已在新基线上全部通过，不删除或覆盖前半段的失败证据。**

本报告是后端验收报告的后续记录，不改写其旧失败、日志或截图。当前完成了精确路径和预算行为预期迁移；**不能宣称所有门禁通过，工作流 PR #53 尚未合入。**

## 版本与工作边界

- 当前远端集成基线：`ce5fd11af5581a8f10f82dc995ec24bfd1b3e4b1`（PR #50 合入）。
- 本轮精确被测 QA 提交：`e0e7de4`（完整 SHA、运行时间、初始状态见新证据 summary）。该提交包含集成基线和本 PR 的 QA 测试变更；业务源码与该集成 SHA 一致，不能称为 PM 已合并本轮 QA 变更。
- 独立 worktree：`C:/Users/lenovo/Desktop/giftwise-qa-migration`。原主工作区、原 QA worktree 中的未提交修改原样保留，不 reset/stash/覆盖。
- Python：`C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe`，3.12.10；Node 24.21.0；时间 Asia/Shanghai。
- 已重新读取 AGENTS、Issue #1 正文、交付变更契约及前轮后端报告。三条精确字段路径直接依据本轮用户传达的 PM 裁决，不由 QA 自行选择。
- `validator/`、`web/server/`、`web/public/`、`workflow/`、两个开发基线测试文件及前轮 `final-20261031/` 证据的前后 SHA256 完全不变。没有 Dify、模型、部署调用；未执行浏览器。
- PR #51 仍开放，本轮更新同一 PR；不往已合并 PR #50 追加交付，不自行合并。

## 三项精确路径迁移

仅更新 QA 夹具源 `fixtures.py` 及由其生成的 `rules.json`，保留精确 code/path/status 断言。额外强化 `needs_input` 时所有 candidate_results[].passed 必须为 false。

| 原用例 ID | 原路径 | 新路径 | 保持的拒绝结果 |
| --- | --- | --- | --- |
| R-invalid-missing-min | request.budget_range | request.budget_range.min | INVALID_BUDGET_RANGE，needs_input，候选不得通过 |
| R-invalid-missing-max | request.budget_range | request.budget_range.max | INVALID_BUDGET_RANGE，needs_input，候选不得通过 |
| R-invalid-mismatch | request.budget_range | request.budget_amount | BUDGET_RANGE_MISMATCH，needs_input，候选不得通过 |

没有使用模糊前缀、多个可选路径或跳过错误字段的方式放宽测试。31 个原 nov01 用例全部保留。

## Stage B 逐项迁移表

依据：Issue #1 2026-10-31 增量确认、交付变更契约 §1.2/§2，以及本轮 PM 对零预算的决定。生成源和当前 `cases.json` 同步，保留全部 269 个原 ID 及其原输入；历史 ID 中的 reject 字样只为追溯，不改名删例。

| 原 ID | 原始预算 / 候选 | 旧期望 | 新期望 |
| --- | --- | --- | --- |
| money_range_reject_request_0 | 0 / 三个0 | needs_input，LIMIT_EXCEEDED@request.budget_amount | passed；三项 passed=true；无 LIMIT_EXCEEDED/OVER_BUDGET |
| money_range_reject_request_1 | 0.0 / 三个0 | 同上 | 同上 |
| money_range_reject_request_2 | 0.00 / 三个0 | 同上 | 同上 |
| money_range_reject_request_3 | 0.99 / 三个0 | 同上 | 同上；候选没有超过预算，不凭预算变合法就跳过候选检查 |
| money_range_reject_request_4 | 10000.01 / 三个0 | needs_input，LIMIT_EXCEEDED，文案“1 至 10000” | 保持 needs_input、精确 code/path；文案改为“0 至 10000” |
| money_range_reject_request_5 | 10001 / 三个0 | 同上 | 同上 |

`prepare_migration.py` 不导入业务实现：断言 case ID 集合和数量不变、所有输入不变、变更仅限这6项 expected、三条新精确路径固定、相关测试语法有效。通过后再执行被测规则，不从实际输出反推期望。

Stage B `test_hash_1`（rules.py）及 `test_hash_3`（tests/test_cases.json）的旧钉住值**没有更新**。它们不属于上述行为迁移，需等重建合入及内容复核后处理。

## Boundary 逐项迁移表

所有既有测试方法保留，新增2个方法，45 → 实际47。迁移后的非法预算使用10000.01，继续检验请求错误优先级与多个错误不被吞掉，不能把这些保护断言删除。

| 类 / 方法 | 旧输入与期望 | 新输入与期望 | 产品决定依据 |
| --- | --- | --- | --- |
| RequestBudgetRange.test_zero_and_zero_decimals_are_rejected | 0/0.0/0.00 配150/120/80候选；请求预算 LIMIT_EXCEEDED、needs_input | 输入不变；预算范围不报错，三个候选各报 OVER_BUDGET、passed=false，整体 failed | 预算合法不代表礼物免费或整次通过；保留历史方法名并加说明 |
| RequestErrorDominates.test_request_range_error_and_candidate_error_together | 预算0，c1=99999；要求请求错误优先 | 预算改10000.01，c1仍99999；保持 LIMIT_EXCEEDED@request.budget_amount、needs_input、all_passed=false | 继续使用真正非法的请求预算检验原保护目的 |
| ErrorComposition.test_two_range_errors_are_both_reported | 预算0、天数366；两个 LIMIT_EXCEEDED | 预算10000.01、天数366；两个精确路径各自 LIMIT_EXCEEDED | 0合法后不能仍当预算越界；两项越界均不得放行 |
| ErrorComposition.test_range_and_type_errors_coexist | 预算0、天数-1；范围+类型错误 | 预算10000.01、天数-1；保持相同码/路径与needs_input | 同上，保留组合判别力 |
| ErrorComposition.test_range_and_currency_errors_coexist | 预算0、USD；范围+币种错误 | 预算10000.01、USD；保持相同码/路径与needs_input | 同上，保留组合判别力 |
| ErrorComposition.test_three_distinct_errors_all_reported | 预算0、天数-1、USD；三类错误 | 预算10000.01、天数-1、USD；三类错误集合不变 | 同上，不能因预算策略变更删掉多错上报断言 |
| 新增 test_zero_and_fractional_budget_with_affordable_candidates_pass | 无 | 四种合法预算0/0.0/0.00/0.99，各配三项等于预算的候选：passed、无错误、三项可选 | 合法零值和小数必须有独立正例，不只验证“不报范围码” |
| 新增 test_zero_budget_does_not_bypass_invalid_days | 无 | 预算0、三项估价0、天数366：needs_input；仅天数越界，候选不能通过 | 预算合法不能绕过天数规则 |

nov01 原例继续覆盖 `R03-zero-paid`、`R09-below-min-selectable`、`R10-over-max`、`R-zero-plus-366-still-reject`。JS revision-rules 继续复核新版呈现拒绝 additional_cost 等报价字段、准备时间和禁忌；冻结礼物价格保护依据本轮未改的实现和原12项后端独立探针，本轮不把旧结果伪装为重新执行。

## 内容与指纹的处理次序

已先审阅并归档 `git diff e4ba08f ce5fd11 -- validator/rules.py tests/test_cases.json`：规则新增区间结构/端点/模式、标量一致性、低于下限 warning，预算范围从[1,10000]变为[0,10000]；开发 cases 的低值预算预期与范围文案随决定变化。这是可解释的真实内容变更，不是单纯换行或仅哈希差异。

内容 diff 见新证据 `reviewed-business-changes.patch`。随后才计算当前观察指纹供对照，**没有写入 pinned_hashes.json，也没有修改 manifest 或生成物**。运行摘要明确 `pin_update_performed=false`。

PR #53（工作流重建）当前 OPEN，尚不能拿未合入分支替代正式集成；生成物旧指纹失败仍保留。后续必须先确认其合入 SHA、逐项核对生成物实际内容与源码（不只看 hash），再据已确认的内容更新 QA pinned 指纹并重跑五条命令。当前阶段的预回归不能当成这一步已经完成。

## 本轮实际运行与证据

权威预回归目录：`migration-20261031/112845-580703/`。`summary.json` 记录完整 QA SHA、release SHA、初始工作区、逐命令北京时间起止、退出码、受保护文件哈希；每条 stdout/stderr 按原始字节分开保存。此前 `112758-942264/` 为有未提交迁移 diff 的准备性预跑，保留，不与权威运行混成一次。

| 项目 | 实际结果 | 状态 | 原始证据（相对权威目录） |
| --- | --- | --- | --- |
| prepare_migration.py | 269原ID/输入保留；三条精确路径及语法检查 | PASS（仅资产自检） | prepare-migration.stdout.txt |
| prepare_fixtures.py --check | 31组导出与源一致 | PASS（仅资产自检） | prepare-fixtures.stdout.txt |
| nov01_revision/run_nov01.py | 31项，0失败 | PASS | nov01.stderr.txt |
| 主 tests 套件 | 337项，0失败 | PASS | main.stderr.txt |
| stage_b | 275项，2失败；269个业务夹具均通过，2个旧指纹断言失败 | FAIL | stage-b.stderr.txt |
| stage_c | 39项，1失败；C5-02生成物源码指纹过期 | FAIL | stage-c.stderr.txt |
| boundary | 47项，0失败 | PASS | boundary.stderr.txt |
| node web/tests/revision-rules.test.mjs | 6项，0失败 | PASS | revision-rules.stdout.txt |

按命令组：**PASS 6（含2个纯夹具检查）、FAIL 2**。没有新业务失败；未删除测试、隐藏失败或重钉指纹。原始失败复现仍为运行 stage_b 的 test_hash_1/test_hash_3，以及 stage_c 的 C5-02。

| 未执行范围 | 状态 | 原因 / 负责人 |
| --- | --- | --- |
| 工作流重建合入后的指纹复核和五套最终回归 | BLOCKED | 等待工作流 Agent PR #53 合入；PM 复核，QA 随后在确定集成 SHA 上执行 |
| 前端、最终HTTP、浏览器、最终E2E | BLOCKED | 等待前端交付并锁定集成版本；前端 Agent/PM |
| Dify、线上模型、部署 | SKIP | 用户明确禁止；本轮无此类调用 |

## 缺陷回归与本轮结论

- 前轮 BUG-002：PM 精确路径裁决已落实，31项nov01通过。只更新三条期望，三种错误仍 needs_input 且所有候选不可放行。
- 前轮 BUG-003：预算行为及文案迁移完成，stage B 6个行为失败与boundary旧零值失败已消除；指纹部分仍未完成，不能把整套stage B标为PASS。
- 前轮 BUG-001：生成物过期尚未在正式集成基线上回归，责任工作流 Agent/PM。保留原失败。

**本次只交付模块测试迁移及预回归；不签发全链路通过。** 工作流重建合入后，使用新的确定集成 SHA 重跑 nov01、主tests、stage B、stage C、boundary；前端及最终浏览器/E2E仍由独立前端集成门禁控制，不拼接不同分支的通过结果。

## PR #54 合入后的独立复核（本轮最终结果）

收尾 fetch 确认 PR #53 已 CLOSED 且未合并，正式重建改由 **PR #54** 合入，release 为 `3dfb186b74a4afabfef82c7213401fb60587f946`。QA 在同一独立 worktree 合并这一已正式发布的集成提交，没有自行合并 GitHub PR，也没有手改 `workflow/`。

### 先内容，后指纹

1. 先审查旧/新实际内容差异，归档 `rebuilt-content/business-content-diff.patch` 和 `generated-content-diff.patch`。
2. 使用当前生成器，仅在临时目录复制四份正式源码进行重建；5个生成物在既有 LF 归一化口径下逐字节比较，全部一致。没有在仓库重跑生成器写回 workflow。
3. 直接载入正式 `generated/code_node.py`，执行31个QA独立用例，核对 status、all_passed、精确 code/path、候选阻断和warning；全部通过。未使用工作流 Agent 自测代替该验证。
4. 内容和语义通过之后，核对4份源码和5份产物的实际指纹与manifest；匹配。细节见 `migration-20261031/rebuilt-content/review.json`。
5. 此后才更新 `tests/acceptance/stage_b/pinned_hashes.json` 的当前发布指纹：两项确有内容变化的文件为 `validator/rules.py`、`tests/test_cases.json`，另两项不变。`previous_release_baseline` 完整保留上一发布基线元数据，`superseded_review/superseded_sha256` 保留2026-10-29原评审链。没有覆盖历史评审或原先失败日志。

指纹检查不是仅替换数字修绿：上述内容重建和31项生成规则行为独立成立，且随后完整重跑 stage C 的生成物比对和入口行为测试。

### 固定版本上的完整回归

- 正式业务集成 SHA：`3dfb186b74a4afabfef82c7213401fb60587f946`。
- **精确被测 QA 提交**：`a14031626395765c99dd5ba472f584cdc50fab8c`（集成新业务基线，加本PR的迁移测试与已审阅指纹）。
- 业务/生成物与上述 release 的 `git diff --name-only` 为空；没有混用其他分支的实现。
- 证据目录：`migration-20261031/113215-608897/`，运行起止时间与全部命令/退出码见 `summary.json`。原始 stdout/stderr 每条分别保存。

| 项目 | 实际数量 | 状态 | 退出码 |
| --- | --- | --- | --- |
| prepare_migration.py | 269个原ID/输入不变，三条精确路径、6份源语法自检 | PASS（夹具） | 0 |
| prepare_fixtures.py --check | 31组 | PASS（夹具） | 0 |
| nov01_revision/run_nov01.py | 31项 | PASS | 0 |
| 主 tests 套件 | 337项 | PASS | 0 |
| stage_b | 275项，含269业务夹具和完整指纹检查 | PASS | 0 |
| stage_c | 39项，无跳过 | PASS | 0 |
| boundary | 47项，含新增2个方法 | PASS | 0 |
| node web/tests/revision-rules.test.mjs | 6项 | PASS | 0 |

本轮最终按命令分组：**PASS 8（其中2个为纯资产检查），FAIL 0**；上述五套用户指定测试是同一被测QA提交、同一正式集成来源上的结果。没有沿用旧的329或预计数量。

- 前轮BUG-002：三项精确路径分歧已按PM裁决解决；没有放宽断言或放行候选。
- 前轮BUG-003：行为预期迁移和经内容复核后的发布指纹迁移已完成，stage B/boundary 当前均通过。
- 前轮BUG-001：正式合入重建后，QA独立内容/语义/指纹和stage C全部通过。
- 新业务失败：本轮最终回归未发现。合入前2个旧指纹失败和1个生成物失败仍在各自旧SHA证据中保留，不改写为历史通过。

### 最终范围

| 范围 | 状态 | 原因 |
| --- | --- | --- |
| 本轮模块及测试迁移 | PASS | 以上实际执行证据支持 |
| 前端/浏览器/最终HTTP及E2E | BLOCKED | 等待前端交付并锁定集成版本 |
| Dify/线上模型/部署 | SKIP | 本轮未授权且明确禁止，不执行 |

更新开放的 PR #51，等待PM复核，不自行合并。**本轮模块和迁移通过不构成新版用户全链路或最终演示验收通过。**
