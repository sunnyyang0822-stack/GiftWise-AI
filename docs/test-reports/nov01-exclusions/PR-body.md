实现独立的排除项来源与结构审核，模型候选不能直接成为禁忌约束。非空原文的零识别、未映射、无效或无依据输出整包阻塞；成功只进入 needs_confirmation，不代表语义正确或规则通过。

依据：Issue #1 最新正文、交付变更契约 §3、三份设计稿 PM 审查。此线从集成分支 5b462ba 在独立 worktree 实时开发，非历史快照。

文件范围：新增 web/server/exclusion-checker.mjs、web/server/exclusion-provider.mjs、web/tests/exclusions.test.mjs、web/tests/fixtures/exclusions/mock.mjs 及 docs/test-reports/nov01-exclusions/ 两份本线报告；不改接入、规则、前端、Dify 或共享契约。

实际验证：
- node web/tests/exclusions.test.mjs：111 场景、378 条实际断言通过。
- node web/tests/access-layer.test.mjs：40/40，通过仅代表既有接入层回归。
- git diff --check、git diff --cached --check：通过；逐文件差异/敏感信息检查完成。
- 提交后 HEAD 与 origin/release/2026-11-01-submission tree 比对、git show HEAD:<归属文件> 独立回读与 PR changedFiles 实数另在交付回复报告。

provider 使用 async ({dislikes}) => 原始 JSON 字符串注入。dify 缺配置报 EXCLUSION_PROVIDER_NOT_CONFIGURED，失败不重试、不回退 mock；空白原文返回 ok:true/ai_json:null 与显式 EXCLUSION_RECOGNITION_SKIPPED，调用次数 0。mock 仅匹配标注的完整虚构夹具。接入方必须先处理跳过/失败，再对字符串运行纯校验。

限制/未测：原文锚定不是语义证明；没有线上模型、Dify、新版端到端、浏览器、成本或部署验证。why/备注采取保守纯文本策略，所有展示字段仍需界面安全渲染。未实现超时/取消，由接入方负责。未运行全量产物门禁，未改既有残差或历史证据。

QA 路径：docs/test-reports/nov01-exclusions/REV-AI-001.md；web/tests/exclusions.test.mjs。待 QA 独立验收、PM 审查与接入 Agent 接线；本 PR 不合并、不部署。
