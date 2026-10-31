# 统一 release SHA 最终验收（阶段性）

## 被测版本

- 唯一统一 SHA：`f080ad51e0f22ca7384ce3a93f75d0dba91d0508`
- 分支：`origin/release/2026-11-01-submission`
- 独立副本：`C:/Users/lenovo/Desktop/giftwise/qa-final-f080`，detached HEAD，工作区初始 clean。
- 已合入：后台 PR #61；未合入：工作流 PR #58、前端 PR #57。没有将未合入提交结果拼入本报告。
- Windows、Node `v24.21.0`、Python `3.12.10`；模式 `GW_MODE=mock`。未调用 Dify、Seedream真实接口、商家在线来源或部署服务。
- 原始输出、命令退出码见本目录；完整工作区与提交状态在执行时记录于外层命令环境。测试未修改业务实现、共享契约、workflow-spec 或开发断言。

## 实际命令与结果

| 命令 | 结果 | 状态 | 证据 |
| --- | --- | --- | --- |
| `node web/tests/retrieval-media.test.mjs` | 12 PASS | PASS | `retrieval-media.txt` |
| `node web/tests/retrieval-media-rm001.test.mjs` | 通过 | PASS | `retrieval-media-rm001.txt` |
| `node web/tests/retrieval-media-history.test.mjs` | 3 PASS | PASS | `retrieval-media-history.txt` |
| `node web/tests/retrieval-media-http.test.mjs` | 1 PASS | PASS | `retrieval-media-http.txt` |
| `node web/tests/retrieval-media-integration.test.mjs` | 4 PASS、1 SKIP（真实独立浏览器搜索） | PASS + SKIP | `retrieval-media-integration.txt` |
| `node web/tests/retrieval-media-scene.test.mjs` | 6 PASS | PASS | `retrieval-media-scene.txt` |
| `node web/tests/retrieval-media-seedream.test.mjs` | 7 PASS（受控供应商/失败降级） | PASS（非真实调用） | `retrieval-media-seedream.txt` |
| `node web/tests/access-layer.test.mjs` | 41 PASS | PASS | `access-layer.txt` |
| `python workflow/verify_local.py --nov01` | 29 local assertions，model_calls=0，cloud_not_verified | PASS（离线） | `workflow-verify-nov01.txt` |
| `node web/tests/ui-revision.test.mjs` | 20 assertions | PASS（模块，不是浏览器） | `ui-revision.txt` |
| Python `adapt_intake` with `previous_gifts` | `INTAKE_UNKNOWN_FIELD` at `intake.previous_gifts` | FAIL | `previous-gifts-intake.txt` |

命令分组：**PASS 10、FAIL 1、SKIP 1、BLOCKED 1**。SKIP 是真实独立浏览器检索子项；BLOCKED 是完整浏览器/E2E及未合入前端/工作流的集成门禁，不将其计为通过。

## 覆盖结论

### 已验证（限定于统一 SHA）

- 后台受限计划、URL/脚本拒绝、任务隔离、队列、超时/取消、价格证据绑定、条件价/缺价、超预算边界、候选选择门禁、媒体幂等、物理证据和坐标校验均由已合入后台测试覆盖。
- `previous_gifts` 的后台历史模块测试通过，说明接入层部分已支持历史；但工作流 Python intake 仍拒绝同字段，不能称跨层已通过。
- Seedream 失败、超时、未授权、重复任务等均为受控传输测试，不是真实图片生成。
- access-layer 41 项及本地 UI 20 assertions 通过；UI结果不等同浏览器流程。

### FAIL

**FQA-F080-001：统一 release 的 workflow `intake_json` 不接受 `previous_gifts`。**

- 责任：工作流 Agent；PM负责协调与集成。
- 最小输入：合法 `giftwise-20261031-v2` 请求，`recipient_relation=friend`、预算区间 `100–200 CNY`、`dislikes=不要香水`、`previous_gifts=去年送过一本虚构笔记本`，其余字段为已冻结正常值。
- 预期：`adapt_intake` 返回 `ready`，历史作为独立软上下文传递，不变成硬禁忌。
- 实际：`needs_input`，`INTAKE_UNKNOWN_FIELD`，路径 `intake.previous_gifts`。
- 复现：在统一副本运行生成 `previous-gifts-intake.txt` 的 Python 命令；退出码1。
- 影响：三步表单即使能提交 previous_gifts，也无法进入工作流推荐；不能完成用户要求的历史输入与 Dify `intake_json` 映射验收。
- 原始输出：`docs/test-reports/retrieval-media/final-f080/previous-gifts-intake.txt`。
- 回归：未修复；不修改工作流代码。

### BLOCKED

- 三步输入、返回上一步、partner/pursuit/friend/other、其他关系/场合/金额、隐私/条款、390px窄屏、三候选图片到选择后包装图的完整浏览器流程：**BLOCKED**。前端 PR #57 未合入统一 SHA，不能拿其独立副本截图或模块结果拼接。
- Dify真实 `intake_json` 一次调用：**BLOCKED/SKIP**。当前 release 的离线映射已失败；产品负责人尚未在本轮明确一次真实调用的执行时机，且前端/工作流未同版合入。拿离线通过或失败都不能替代真实Dify结果。
- 最终包装图完整构图、不裁切、礼物比例、异形适配、中文曲线箭头：**BLOCKED**。Seedream受控失败降级通过，真实视觉仍未验收；不重复调用生图。

### SKIP

- 真实独立后台浏览器商品搜索、真实价格/库存/来源权利：SKIP；本轮只运行统一 SHA 的受控模块，未连接外部来源。
- 真实 Seedream API 与真实 Dify：SKIP；没有把 mock/受控provider结果写成真实成功。

## 下一位负责人

工作流 Agent 修复 `previous_gifts` intake 白名单与 `intake_json` 传递后，PM 合入工作流和前端 PR，给出新的统一 SHA。QA 只在该 SHA 重跑：RM-001/002/003、previous_gifts、Dify映射、后台/工作流v2/前端预览/HTTP，然后执行普通URL的桌面与390px浏览器完整流程。所有失败输出保留，不修改测试让其通过。
