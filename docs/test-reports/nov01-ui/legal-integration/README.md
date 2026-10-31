# 前端政策接入与界面后续修改

本线独立 worktree：gw-ui-nov01。原 PR #49 已合并，此批后续另开非空 PR，等待 PM 审查。

## 修改

- 原样复制 PM 工作区的 privacy.html、terms.html、legal.css；三份 SHA256 完全一致，见 source-integrity.txt。没有自行扩写法律承诺。
- 首页导航、Q&A 与页脚提供隐私政策和使用条款入口。共用页脚在填写流程和结果视图仍渲染；页脚链接打开新标签页，保留本页状态。
- 首页说明明确提交由服务端处理，真实 AI 模式会向配置的 Dify/模型服务传递任务信息。没有加入强制勾选或继续使用即同意文案。
- 按产品负责人追加指令：去掉预算额外确认框；用户操作滑块或填写其他金额后继续，金额校验保留。兴趣多列换行、手机两列；去掉互斥术语，功能仍互斥；移除淡入灰化，仅保留轻微位移。
- 此前已确认的欢迎屏、俯视礼盒、Q&A 收尾等修改单独保存为 3ac9617；保留前端成果，不覆盖 PM 首页。

## 实测

- node --check web/public/app.js：PASS。
- node web/tests/ui-revision.test.mjs：PASS（输出 28 assertions passed；旧测试静态检查，不能替代浏览器）。
- node web/tests/legal-pages.test.mjs：7 PASS / 0 FAIL。
- node docs/test-reports/nov01-ui/legal-integration/browser-check.mjs：99 PASS / 0 FAIL（Chromium 156，本地 mock 19002，专用 CDP 9342，1440/390/320）。原始输出 browser-output.txt，明细 legal-browser-results.json。
- git diff --check：PASS。
- 页面与 legal.css HTTP 200。两页 UTF-8、中文无替换字符、无横向溢出；邮箱和运营者正确；目录实际点击、Tab 跳过正文已验证。页面互跳及首页链接目标已核对，两个目标均返回 200。未加载第三方脚本或字体。
- 表单进入第二步与返回保留关系、预算无确认框、兴趣同排多项、流程页脚可见已实际验证。
- 页面截图：legal-privacy-{1440,390}.png、legal-terms-{1440,390}.png；兴趣：interest-grid-{1440,390,320}.png。

## PM 待定与未测

- 本次只接入 PM 已提供的政策正文。第三方实际接收方、处理地区、留存与训练用途仍待核实；不把页面存在当作授权/删除机制/全部合规完成。
- 当前分支服务端仍是旧版，普通 URL 返回旧时间配置；UI 测试明确使用 ui_fixture=nov01。新版真实本地 API 的三候选→选择→账单完整联调为 BLOCKED/未验证，不声称通过。结果页政策入口由同一个无条件渲染页脚提供，尚未在新版账单结果页做独立 E2E。
- 未改 server、规则、workflow 或模型配置；未调用 Dify/任何线上模型；调用成本未测；未合并、未部署。
- 没有发现两份 PM 正文在所核对的当前内存存储代码上存在冲突；仍需 PM/QA 对最终合入版本复核。旧版本/正式托管和第三方处理不在这次浏览器验证范围。
