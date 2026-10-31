# REV-WEB-001 前端本地开发报告

状态：前端 UI 与本地 mock 夹具已完成，等待新版规则/识别/接入 API 合并后联调。

## 已实现

- 三页三步：关系场合预算时间 → 兴趣风格 → 不喜欢和补充；返回时保留已填数据。
- 预算：0–1000 元双滑块、50 元步长、上下限不可交叉；“其他金额”才开放最多 10000 元的小数输入；0 元和不确定有单独语义。
- 时间：仅接受配置下发的六档和数字天数；本地 UI 夹具 `?ui_fixture=nov01` 提供 1/5/7/30/90/365 供界面走查，未联调时会明确显示夹具提示。
- 不喜欢：独立短文本、长度计数；非空先请求 `/api/exclusions/analyze`，mock 404 时使用固定本地识别夹具；逐条展示原文依据、理由、把握与确认框，未全确认不会请求推荐。
- 加载与错误：识别、推荐和呈现均有中文等待态、重复点击阻止、超时/网络错误恢复入口，页面不显示无依据百分比。
- 账单：按新版 `recheck_summary.gift_estimated_total` 读取礼物合计；包装等只展示风格/色调，明确未计价且不代表免费；缺字段时显示版本问题，不伪造金额。
- 保留模拟数据标识；没有调用 Dify 或线上模型。

## 修改文件

- `web/public/app.js`
- `web/public/index.html`
- `web/public/styles.css`
- `web/tests/ui-revision.test.mjs`

## 实测命令

- `node --check web/public/app.js`：通过。
- `node web/tests/ui-revision.test.mjs`：20 assertions passed。
- `git diff --check`：通过。
- 本地 `GW_PORT=18961 GW_MODE=mock node server/server.mjs` + `GW_CDP=http://127.0.0.1:9337 GW_BASE=http://127.0.0.1:18961 node web/tools/page-probe.mjs`：首帧通过、模拟标识可见、无横向溢出、0 页面异常。
- 专用 Chromium 390px `?ui_fixture=nov01`：六档时间、双滑块、三页切换和不喜欢识别确认界面可见，无横向溢出。
- 原 `browser-check.mjs`：在旧预算档位选择器处停止；脚本仍查找 `100–200 元` 等旧控件。本轮未修改独立 QA 脚本，不能把该结果表述为新版 100 项通过。

## 未完成与依赖

- 当前基线服务端仍返回旧配置，真实新版六档和排除项 API 尚未合入；普通 URL 会诚实提示配置未更新，只有 `?ui_fixture=nov01` 进入本地 UI 夹具。
- 推荐和呈现的后端新版字段尚未联调；旧服务端会按版本不兼容返回错误，未做静默兼容或伪造成功。
- 未访问 Dify、未部署、未测真实模型成本；等待规则/AI/接入线合并后再做本地真实 API 联调和独立 QA 回归。
