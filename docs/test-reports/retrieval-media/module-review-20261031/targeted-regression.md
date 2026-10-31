# 修复提交针对性回归（2026-10-31）

本文件只记录修复提交，不替换原始 `report.md` 的失败证据。

## 工作流 #58

- 固定提交：`db4ad9435e384d7e3e1897097a8ca7eb5110c453`
- 运行 `review_readers.mjs`：前端旧文案问题仍来自 #57；工作流相关 4 项全部 PASS：状态枚举、三条引用绑定、seed/null 非实时、v2 prompt 对齐。
- 结论：**PASS（针对 RM-003）**。这只证明提示词和离线夹具已对齐，不证明真实 Dify 或模型执行。

## 后台 #61

- 固定提交：`e034aa53a38ea1f41af64a779a18a3e66f310ee8`
- 重新运行 `review_modules.mjs`：34 PASS、1 FAIL；`scene-ready-image-url-validation` 仍 FAIL。`validateScene` 仍接受 `image.url="javascript:QA"` 的 ready 场景。
- 运行该提交自带模块套件：
  - `retrieval-media.test.mjs`：12 PASS
  - `retrieval-media-history.test.mjs`：3 PASS
  - `retrieval-media-http.test.mjs`：1 PASS
  - `retrieval-media-integration.test.mjs`：4 PASS、1 SKIP（真实独立浏览器搜索未执行）
  - `retrieval-media-scene.test.mjs`：6 PASS
  - `retrieval-media-seedream.test.mjs`：7 PASS
  - `retrieval-media-cookie-client.mjs`：无可执行测试输出
- 结论：**FAIL（RM-001 未修复）**。自带套件结果只作为额外独立命令证据，不覆盖 QA 失败探针；没有真实生图、检索或 Dify调用。

## 前端 #57

- 固定提交未变：`dd50fefc6ab9cf86a11e23a93a43e9fd7b3c6c53`
- 修正最小DOM测试环境后重跑 `review_readers.mjs`：媒体绑定、坐标版本、本站 URL、缺图和重复引用检查 PASS；`frontend-ai-vs-demo-label` 仍 FAIL。
- 结论：**FAIL（RM-002 未修复）**。这是函数输出文案检查，不等于浏览器布局或图片视觉已通过。

## 种子表 #64

- 固定提交：`a4d639bb757cc99315ca9acc633d45192d20c15a`
- `review_seed.py`：20 PASS、0 FAIL；14 条非实时参考价、6 条缺价、20 条图片未确认使用授权，0 张可作为授权商品图片。
- 结论：**PASS（文件内部审计）**，不证明实时价格、库存、可转载权利或视觉相符。

## 当前下一步

- RM-001：后台 Agent 修复 `validateScene` 或统一在服务端生成信封前调用安全 URL/托管校验后，QA只重跑该负例和 Seedream 任务拒绝路径。
- RM-002：前端 Agent按 `image.kind`/实际模式显示一致标签；QA在导出函数后再做窄屏/缩放浏览器验证。
- PM提供锁定集成 SHA 后，才执行专用端口 HTTP、普通 URL 浏览器和最终 E2E。真实 Dify仍SKIP；Seedream已获授权但PM视觉实验未通过，QA不重复调用。
