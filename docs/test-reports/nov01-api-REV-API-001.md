# REV-API-001 本地报告

实现：接入排除项分析 API、服务端随机快照、确认闸门、推荐幂等复用和新版呈现 mock 输出。

依据：docs/design/交付变更契约-2026-10-31.md；REV-AI-001 与 REV-VAL-001 提交内容已带入本线基线。

实际验证：
- node web/tests/exclusions.test.mjs：111 场景，378 条断言通过。
- node web/tests/revision-rules.test.mjs：6 项通过。
- node web/tests/revision-api.test.mjs：1 项通过。
- git diff --check：通过。
- 本地 HTTP：分析、未确认阻塞、确认推荐、重复推荐复用、v2 呈现通过。

限制：真实 Dify 未配置、未调用；旧 access-layer.test.mjs 有 1 项仍按旧呈现费用字段断言，失败是旧基线与新版账单契约冲突；未做浏览器/部署验收。快照为进程内存，重启丢失。

交给 QA：web/tests/revision-api.test.mjs；web/server/exclusion-store.mjs；web/server/server.mjs；web/server/pipeline.mjs。
