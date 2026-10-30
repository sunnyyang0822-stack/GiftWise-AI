# 真实 Chromium 浏览器验收原始产物（100 项 / 0 失败）

> **为什么把产物放进仓库**：这份报告原先只落在被 `.gitignore` 排除的 `web/.tmp/browser/`，
> **评委全新 clone 后拿不到任何可验证的浏览器验收证据**。现原样固化一份在仓库内，供独立复核。

| 项 | 值 |
|---|---|
| 检查项总数 | **100**（`total` 字段；等于 `findings` 数组长度） |
| 失败 | **0** |
| 浏览器 | `Chrome/156.0.8078.79`（真实 Chromium，非 jsdom） |
| 被测基址 | `http://127.0.0.1:8787`（本机） |
| 文件 | `browser-report.json`（sha256 `51dd4840e496fcee5044b0c3fdfd1e2cf2bd4a0ab1c4e1a4b0e0e2dbbbd0fafe` 为首 16 位见仓库登记） |

**口径限定（必须与数字一起说）**：这是**本机真实 Chromium** 的验收，覆盖**可用性/渲染/交互**层面的 100 项检查；
它**不**等于"真实用户可用性验证"——后者**仍未做**，是本项目公开承认的残余缺口（与 SC-1 同一缺口）。

**复现方式**：`node web/tools/browser-check.mjs`（需本机 Chromium；结果写 `web/.tmp/browser/browser-report.json`）。
