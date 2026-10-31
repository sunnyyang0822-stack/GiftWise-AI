# #59/#60 第一批模块独立复核（准备记录保留）

为18:00前集成立即交付可修复问题，不等待视觉完善。**本PR不是新版最终验收通过。**

本批固定对象：后台#61 `0346f5364a0fdaeb0e6290b425892b1970f7eb89`；工作流#58 `277b71d0042163a808a39b513edac684fb694747`；前端#57 `dd50fefc6ab9cf86a11e23a93a43e9fd7b3c6b53`；种子表#64 `a4d639bb757cc99315ca9acc633d45192d20c15a`。各自独立副本，未合并，不冒充release或最终集成版本。

实际结果：

- 后台纯模块/受控provider：34 PASS / 1 FAIL。
- 种子记录独立审计：20 PASS / 0 FAIL；14条参考价、6条缺价、0张授权商品图。未重新核实商家线上价或授权。
- 前端导出函数（最小DOM，非浏览器）与工作流契约对照：9 PASS / 2 FAIL。
- 共63 PASS / 3 FAIL；未执行范围3 SKIP / 3 BLOCKED，分别列明；不是准备矩阵63项全部已跑。

修复负责人及入口：

1. **后台 RM-001**：validateScene接受`image.url=javascript:QA`的ready信封；URL下载与前端虽拒绝，provider输出仍缺服务端统一校验。仅证明纯函数缺口，未证明公网漏洞。最小复现`review_modules.mjs`的`scene-ready-image-url-validation`。
2. **前端 RM-002**：AI图片信封仍无条件显示“摄影开发夹具，非AI生成结果”。复现`review_readers.mjs`的`frontend-ai-vs-demo-label`。
3. **工作流 RM-003**：包装提示词仍声明无physical并禁止curve，检索词仍说精确schema未定义，未对齐后台v2。复现`workflow-v2-prompt-alignment`。

报告：`docs/test-reports/retrieval-media/module-review-20261031/report.md`。同目录保存实际输入/预期/结果、退出码、stdout/stderr、来源快照与被测文件前后哈希。第一次DOM替身缺方法的失败原样保留，补齐QA替身后重跑仍复现前端文案问题。四份副本业务/开发文件均未改。

下一位：后台/前端/工作流在各自原PR提交小批修复；QA按新提交针对回归。最终HTTP/浏览器E2E等PM锁定集成SHA；真实包装视觉由PM继续试验，本次未重复生图，不能签发包装图通过。Dify未获明确调用授权，未调用；没有部署/采购。

此前准备材料仍在：`preparation.md`、`matrix.md`、独立虚构夹具与入口设计。仅更新用户授权的两个新目录，不改业务/历史断言/报告，不自行合并。

修复回归（提交 `74d9966`）：工作流 #58 新提交 `db4ad94` 的4项v2对齐检查 PASS；后台 #61 新提交 `e034aa5` 的原有模块套件 12+3+1+4(另1 SKIP)+6+7 通过，但 QA 的危险图片 URL 负例仍 FAIL；前端 #57 仍 FAIL AI/开发夹具文案；种子表 #64 20项审计 PASS。详见 `module-review-20261031/targeted-regression.md`。最终HTTP/浏览器仍等PM锁定集成SHA。
