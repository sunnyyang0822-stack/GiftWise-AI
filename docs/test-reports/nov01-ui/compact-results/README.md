# 推荐结果优先展示礼物卡片（产品负责人追加）

- 删除推荐结果上方运行编号、关系场合、预算天数、修订和当前选择大面板。三张礼物卡片是结果区域首个可见内容；卡片内规则通过/失败与可展开依据保留，批次/工作流错误仍在卡片后显示。
- 删除图片放大按钮、弹窗、200%缩放及相关样式。候选和包装图片仍完整等比显示，保留图片失败重试、手机标记点按、可键盘“查看说明”和模拟数据标识。
- 仅改web/public/app.js、js/media-view.js、styles.css及本线报告；不修改后台、共享契约或历史证据。上轮媒体报告中的放大能力为当时版本，本次按用户后续明确要求移除。

真实命令：
```
node --check web/public/app.js
node --check web/public/js/media-view.js
node web/tests/ui-revision.test.mjs
node web/tests/ui-media.test.mjs
node web/tests/preview-mode.test.mjs
node web/tests/legal-pages.test.mjs
node docs/test-reports/nov01-ui/compact-results/browser-compact.mjs
node docs/test-reports/nov01-ui/compact-results/regression/browser-preview.mjs
git diff --check
```

浏览器逐项检查及统计见media-results.json；既有闭环见regression/preview-flow-results.json。覆盖1440/390/320、三卡前置、无信息面板/无放大控件、缺图/加载失败重试、包装失败保留账单、曲线与中文等价说明、独立模拟闭环。历史脚本未删验收项；本次脚本删除的仅用户明确取消的放大功能断言，增加无放大控件及三卡前置断言。正式QA脚本未修改。

真实服务、商品检索和AI图像生成仍未接通。预览URL：http://127.0.0.1:19002/ 。不合并、不部署。
