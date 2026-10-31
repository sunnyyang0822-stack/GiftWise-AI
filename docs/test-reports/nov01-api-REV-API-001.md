# REV-API-001 本地报告

实现：接入排除项分析 API、服务端随机快照、确认闸门、推荐幂等复用和新版呈现 mock 输出；补充 `other` 关系/场合自定义文本校验，并恢复 REV-AI-001/REV-VAL-001 测试与证据文件。

依据：docs/design/交付变更契约-2026-10-31.md；REV-AI-001 与 REV-VAL-001 提交内容已带入本线基线。

实际验证：
- node web/tests/exclusions.test.mjs：111 场景，378 条断言通过。
- node web/tests/revision-rules.test.mjs：6 项通过。
- node web/tests/revision-api.test.mjs：1 项通过。
- node web/tests/access-layer.test.mjs：41 项通过。
- git diff --check：通过。
- 自定义关系/场合缺失、空白、非 `other`、超长均拒绝；合法文本进入冻结 request。
- 本地 HTTP：分析、未确认阻塞、确认推荐、重复推荐复用、v2 呈现通过。

限制：真实 Dify 未配置、未调用；未做浏览器/部署验收。快照为进程内存，重启丢失。

交给 QA：web/tests/revision-api.test.mjs；web/server/exclusion-store.mjs；web/server/server.mjs；web/server/pipeline.mjs。
