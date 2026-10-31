# 工作流修复独立复核（统一 release SHA）

日期：2026-10-31（Asia/Shanghai）。本轮没有把未合入 PR 的结果拼入 release。

## 版本与边界

- 唯一被测统一 SHA：`f080ad51e0f22ca7384ce3a93f75d0dba91d0508`。
- 独立副本：`C:/Users/lenovo/Desktop/giftwise/qa-final-f080`，detached HEAD，初始 clean。
- 该 SHA 已包含后台 PR #61；工作流 PR #58 和前端 PR #57 仍未合入。因此前端浏览器完整流程 **BLOCKED**，未使用两个开放 PR 的结果替代 release。
- Windows、Node 24.21.0、Python 3.12.10；工作流与后台均为离线/受控执行。没有调用 Dify、Seedream 或外部商品来源。

## 实际命令

| 命令 | 实际结果 | 状态 | 原始输出 |
| --- | --- | --- | --- |
| `python workflow/verify_local.py` | 46 本地探针 | PASS（离线） | `workflow-verify-default.txt` |
| `python workflow/verify_local.py --nov01` | 29 本地断言，`model_calls=0`，`cloud_not_verified` | PASS（离线） | `workflow-verify-nov01.txt` |
| `python tests/acceptance/retrieval_media/previous_gifts_release_probe.py` | 5 cases × 2 layers；6 条期望匹配，4 条失败 | FAIL | `previous-gifts-probe.txt`、`previous-gifts-probe.json` |
| `node web/tests/retrieval-media.test.mjs` | 12 PASS | PASS | `backend-retrieval-media.txt` |
| `node web/tests/retrieval-media-seedream.test.mjs` | 7 PASS，受控供应商/失败降级 | PASS（非真实生图） | `backend-seedream.txt` |
| `node web/tests/access-layer.test.mjs` | 41 PASS | PASS | `access-layer.txt` |

附加静态检查：`dify-intake-mapping.txt` 显示 Dify 外部入口为 `intake_json`，generated 节点同时保留内部 `request_json` 作为 N1 输出；没有把外部入口退回旧 `request_json-only`。`previous_gifts` 探针同时调用 `workflow/intake.py` 与 `workflow/generated/intake_node.py`，五种输入的 status 和 request_json 行为完全一致，但二者一致地拒绝了合法字段。

汇总按交付项计：**PASS 5、FAIL 1、SKIP 1、BLOCKED 1**。SKIP 为本轮真实 Dify/Seedream及外部检索；BLOCKED 为前端未进入统一 SHA 的浏览器完整流程。离线探针的 6/4 是 FAIL 项内部断言数，不另算业务通过率。

## Previous gifts 结果

| 输入 | 预期 | 实际 release 行为 | 状态 |
| --- | --- | --- | --- |
| 合法字符串“去年送过一本虚构笔记本” | ready；request_json 原样保留 | `INTAKE_UNKNOWN_FIELD` @ `intake.previous_gifts` | FAIL |
| 空字符串 | 选填，ready；不进入硬禁忌 | 同上 unknown field | FAIL |
| 非字符串 `123` | needs_input | unknown field | PASS（拒绝，但错误原因不是专门类型校验） |
| 1001 字符 | needs_input | unknown field | PASS（拒绝，但错误原因不是专门长度校验） |
| 字段缺失 | ready；不增加 hard_exclusions/dislikes | ready；`request_json` 无 previous_gifts，dislikes仍为原“不要香水” | PASS |

由于合法值和空值都在字段白名单阶段被拒绝，无法验证“原样进入 request_json”或“历史不进入 hard_exclusions/dislikes”的正向路径；这两项保持 **FAIL/未满足**，不是通过。

## 缺陷

### FQA-F080-002：统一 release 工作流仍拒绝 previous_gifts

- 严重程度：高；责任 Agent：工作流 Agent；PM负责合入协调。
- 最小输入：`contract_version=giftwise-20261031-v2`，`recipient_relation=friend`，`occasion=birthday`，预算 `100–200 CNY`，`deadline_days=5`，`dislikes=不要香水`，`previous_gifts=去年送过一本虚构笔记本`，其余为空或正常值。
- 预期：`adapt_intake` 返回 ready；request_json 包含相同 previous_gifts；hard_exclusions/dislikes 不被历史字段改写。
- 实际：Python源和 generated 节点都返回 `needs_input`、`INTAKE_UNKNOWN_FIELD`、`path=intake.previous_gifts`；没有 request_json。
- 复现：`python tests/acceptance/retrieval_media/previous_gifts_release_probe.py`，退出码1。
- 原始输出：[previous-gifts-probe.txt](previous-gifts-probe.txt)、结构化逐层结果 [previous-gifts-probe.json](previous-gifts-probe.json)。
- 影响：previous_gifts 无法从三步表单进入工作流，不能完成最终跨层门禁或一次真实 Dify `intake_json` 调用。
- 回归：未修复；QA未修改 workflow/intake.py、generated/intake_node.py 或契约。

## 其他状态

- **PASS（已实现且在此 SHA 验证）**：后台媒体模块、受控 Seedream 失败降级、access-layer、离线 workflow 探针、Dify 外部变量静态接线为 intake_json、源/生成 intake 行为一致性（但一致地拒绝合法 previous_gifts）。
- **FAIL（已实现但不满足要求）**：合法/空 previous_gifts。
- **SKIP（未执行）**：真实 Dify、真实 Seedream、实时检索/价格/图片授权；不把受控 mock 结果当线上成功。
- **BLOCKED（统一 SHA 缺少前端/工作流修复）**：三步输入返回上一步、partner/pursuit/friend/other、其他关系/场合/金额、390px、完整三候选→选择→包装→中文曲线箭头→账单浏览器流程。前端 PR #57 未合入，工作流 PR #58 未合入，不能拼接它们的独立结果。

下一入口：工作流修复合入后由 PM 提供新的统一 SHA。QA只在新 SHA 重跑本报告的 previous_gifts 五类探针、源/生成一致性、`intake_json` 映射，再执行后台媒体/access-layer和最终浏览器门禁；不重复调用 Dify 或 Seedream。
