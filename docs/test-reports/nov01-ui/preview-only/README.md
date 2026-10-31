# 本地完整界面预览（产品负责人最新确认版）

状态：纯前端本地预览已完成；真实业务服务接入和 QA 最终联调未进行。

## 本次改动

- 默认加载 public/js/preview-config.js 和 preview-api.js，本地异步固定响应；app.js 无 fetch 调用。无需旧 /api/config，前端可直接填写。
- 显著标注“界面预览／模拟数据”。PREVIEW_MODE 只控制当前本地预览；真实接入时由联调线替换 apiFetch 适配器并移除标识，当前设置 false 会明确阻塞，不能误连旧服务。
- 三步输入→恰好三个有差异的示例→明确选择合格方案→单礼物账单（包装风格、配色、贺卡、赠送方式）。数字为固定虚构估价，not_verified，不是实际商品报价。
- 不存在 budget_confirmed，也没有预算确认框。当前合法初始区间可直接继续；不确定、空格金额、倒置区间和其他非法金额仍被拦截。
- 第三步：标签“需要避免的”，placeholder“讨厌的东西，过敏，衣服尺码未知”；机器字段 dislikes。
- 独立选填“以前送过什么？”，placeholder“例如：去年送过香水，上次送过一本摄影集”；字段 previous_gifts，上限1000个Unicode码点。不混入 dislikes 或 additional_context，不增加确认。输入通过 textContent/value 呈现，不渲染 HTML。
- 界面“预览状态”选择器展示正常、延长加载、推荐失败/重试、空结果、全部被拦、识别失败和账单失败/重试；预览不消耗模型额度。
- 排除项只使用“不要香水”的固定演示夹具，其余表达先澄清；不存在前端关键词语义识别或真正 AI 成功声明。候选是否可选、估价和规则结果均为明确的本地模拟。

## 载荷与后续契约

- recipient_relation_custom / occasion_custom 与最新接入线 intake 白名单对齐，仅选 other 时附带。此前 _other 只保留为界面内部状态名。
- previous_gifts 目前只交给本地预览适配器，尚未交给任何服务。共享契约需工作流/PM确认后才允许接入。
- dislikes、previous_gifts、additional_context 分别保留；空值为空字符串。placeholder不会提交。浏览器不提交 passed、forbidden_*、修订状态等派生字段。
- 推荐前有原文时先取得本地模拟 analysis_id 并逐条确认。该ID只用于预览模拟快照，不能拿到真实服务使用。

## 真实验证

- node --check web/public/app.js：PASS。
- node web/tests/ui-revision.test.mjs：PASS（原静态输出28 assertions passed）。
- node web/tests/legal-pages.test.mjs：7/7 PASS。
- node web/tests/preview-mode.test.mjs：3/3 PASS，覆盖本地配置与无确认状态、三方案/单礼物账单/失败项禁选、失败重试与空状态。
- GW_BASE=http://127.0.0.1:19002 GW_CDP=http://127.0.0.1:9342 node docs/test-reports/nov01-ui/preview-only/browser-preview.mjs：133/133 PASS，真实专用 Chromium156。
- 1440/390/320 正常完整闭环；390失败/重试、空结果、全拦、识别失败后重新确认、账单失败后重试。
- 可见加载、不自动替选、至少一组事实/推断/未知、预算0元/小数/不确定/非法/倒置、初始合法预算无需操作、空选填载荷、历史独立字段及返回保值、无横向溢出、全流程0次旧业务/API请求均实测。
- git diff --check：PASS。截图与逐项结果在本目录，界面始终显示模拟标识。

## 待 PM / 工作流 / QA 确认

1. previous_gifts 共享字段的正式支持仍未确认，真实服务保持禁用，不将它发给尚未支持的接口。
2. 隐私政策仅按本次授权在输入类别增加“需要避免的内容、送礼历史”；其余 PM 正文保留。“过敏”placeholder可能涉及健康信息，而现有政策要求不要填健康等敏感信息，需 PM 审查二者如何协调；本次不新增授权、安全或删除保证。
3. 识别、推荐、检查和账单均为预览固定模拟，不能证明工作流、独立后端规则或真实模型成功。成本未测。
4. 下一步是同版本服务接入、数据边界核对和 QA 独立完整联调。没有调用 Dify/线上模型、没有合并或部署。
5. PM 政策正文还提到读取会话存储恢复任务；本次纯预览已停止该读取，数据仅在当前页面状态保存。正文未自行扩写，需 PM 在接入方式确定后同步此处说明。
6. 本轮复跑首次因本地19002服务已停止而失败；重启自己的服务后原脚本完整复跑133/133通过，未修改断言以绕过失败。

旧 legal-integration 报告是此前条款接入的时点证据；本报告覆盖此后预算确认逻辑、送礼历史与预览方式的变更。privacy.html 的输入类别已按最新授权更改，不再声称其与原 PM 文件全字节相同。
