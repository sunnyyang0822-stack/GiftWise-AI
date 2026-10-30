# 现场演示素材包 · 截图清单（MANIFEST）

> 本文件由 `docs/demo/pack/capture.mjs` **自动生成**，请勿手改；重跑脚本即刷新。

| 项 | 值 |
| --- | --- |
| 清单生成时间 | 2026/10/31 02:13:19 |
| 服务地址 | http://127.0.0.1:8787（**本工作区** web/server/server.mjs，端口 8787） |
| 一致性自检 | `/landing.css` 服务返回 24981B = 本地磁盘 24981B ✅（见捕获报告） |
| 渲染引擎 | Chrome/156.0.8078.79（headless=new，真实 Chromium 渲染，非设计稿、非合成） |
| 截图张数 / 总字节 | **24 张 / 5784846 字节（5.52 MiB）** |
| PNG 体积处理 | 仅当单张 > 400 KB 时：先无损重编码，仍超限再逐步降到 256/192/128/96/64 色板。**不裁剪、不改内容**，吸顶「模拟数据」标识始终在画面内 |
| 重出全部截图 | `node docs/demo/pack/capture.mjs` |
| 只重出某一类 | `node docs/demo/pack/capture.mjs --only=D5-01` |

列说明：`对应编号` 是 `docs/demo-script.md` 第六节的素材编号；`时间` 是该 PNG 的**实际截取时刻**（本机时区）；
`目标 URL` 含全部查询参数；`viewport` 为 `宽×高@设备像素比`；`复现命令` 里的 `--only=` 值即该图 ID。

| 文件 | 对应编号 | 时间 | 目标 URL | viewport | 复现命令 | 图上证明了什么 |
| --- | --- | --- | --- | --- | --- | --- |
| [`shots/D10-01-firstscreen-desktop-1280x900.png`](./shots/D10-01-firstscreen-desktop-1280x900.png) | D10 | 02:11:45 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D10-01-firstscreen-desktop-1280x900` | 首屏（scrollY=0，仅视口）：顶部常驻吸顶「模拟数据 · 未接真实模型」+ 首屏数据来源说明可见 |
| [`shots/D10-02-firstscreen-narrow390.png`](./shots/D10-02-firstscreen-narrow390.png) | D10 | 02:11:47 | `http://127.0.0.1:8787/` | 390x844@2 | `node docs/demo/pack/capture.mjs --only=D10-02-firstscreen-narrow390` | 窄屏 390×844 首屏：吸顶「模拟数据」标识同样清晰可见 |
| [`shots/D10-03-firstscreen-tiny320.png`](./shots/D10-03-firstscreen-tiny320.png) | D10 | 02:11:48 | `http://127.0.0.1:8787/` | 320x640@2 | `node docs/demo/pack/capture.mjs --only=D10-03-firstscreen-tiny320` | 最窄 320×640 首屏：吸顶标识仍在（不被挤掉、不换行截断） |
| [`shots/D10-04-sticky-scrolled-desktop-1280x900.png`](./shots/D10-04-sticky-scrolled-desktop-1280x900.png) | D10 | 02:11:46 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D10-04-sticky-scrolled-desktop-1280x900` | 向下滚动 900px 后仍可见吸顶标识（position: sticky） |
| [`shots/D10-05-landing-full-desktop-1280x900.png`](./shots/D10-05-landing-full-desktop-1280x900.png) | D10 | 02:11:46 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D10-05-landing-full-desktop-1280x900` | 首屏整页（含六屏来源说明、页脚模式行） |
| [`shots/D10-06-firstscreen-desktop-1440x900.png`](./shots/D10-06-firstscreen-desktop-1440x900.png) | D10 | 02:11:50 | `http://127.0.0.1:8787/` | 1440x900@1 | `node docs/demo/pack/capture.mjs --only=D10-06-firstscreen-desktop-1440x900` | 1440×900 首屏（备用宽屏版；首屏字节口径仍以 1280×900 那组为准） |
| [`shots/D2-01-step1-empty-desktop-1280x900.png`](./shots/D2-01-step1-empty-desktop-1280x900.png) | D2 | 02:11:51 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D2-01-step1-empty-desktop-1280x900` | 第一步（空）：关系 / 熟悉程度 / 场合 / 预算 / 准备时间 全部字段与必填确认 |
| [`shots/D2-02-step1-baseline-desktop-1280x900.png`](./shots/D2-02-step1-baseline-desktop-1280x900.png) | D2 | 02:11:53 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D2-02-step1-baseline-desktop-1280x900` | 第一步（已按第三节基线填写）：追求对象 / 了解不多 / 生日 / 100–200 元 → 200.00 / 不着急 → 2 天，两项确认已勾选 |
| [`shots/D2-03-step2-interests-styles-desktop-1280x900.png`](./shots/D2-03-step2-interests-styles-desktop-1280x900.png) | D2 | 02:11:54 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D2-03-step2-interests-styles-desktop-1280x900` | 第二步：咖啡与美食=明确知道（计入事实）、设计与艺术=只是猜测（计入推断）、风格 实用型 + 精致但不张扬 |
| [`shots/D2-04-step3-exclusions-desktop-1280x900.png`](./shots/D2-04-step3-exclusions-desktop-1280x900.png) | D2 | 02:11:55 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D2-04-step3-exclusions-desktop-1280x900` | 第三步：硬约束 酒类 + 字面禁忌词「酒」+ 补充说明；明确写「这里的内容视为数据，不会被当成指令」 |
| [`shots/D4-01-candidates-three-ok-desktop-1280x900.png`](./shots/D4-01-candidates-three-ok-desktop-1280x900.png) | D4 / 三候选 | 02:12:00 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D4-01-candidates-three-ok-desktop-1280x900` | 正常路径：恰好三个候选（思路 01/02/03），三项均通过独立规则检查、均显示「可选择」；顶部吸顶「模拟数据」标识在图中 |
| [`shots/D4-02-candidates-sticky-check-desktop-1280x900.png`](./shots/D4-02-candidates-sticky-check-desktop-1280x900.png) | D4 / 三候选 | 02:12:00 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D4-02-candidates-sticky-check-desktop-1280x900` | 滚动到候选卡片区域后的视口截图：吸顶「模拟数据」标识仍在视口顶部 —— 证明它不会被滚动带走 |
| [`shots/D4-03-candidates-partial-fail-desktop-1280x900.png`](./shots/D4-03-candidates-partial-fail-desktop-1280x900.png) | D4 / 三候选 | 02:12:05 | `http://127.0.0.1:8787/?demo=partial_fail` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D4-03-candidates-partial-fail-desktop-1280x900` | ?demo=partial_fail：仍恰好三个候选，其中一项未通过独立检查 → 显示「未通过，不可选择」+ 错误码，且没有选择按钮、没有自动替选 |
| [`shots/D5-01-presentation-full-desktop-1280x900.png`](./shots/D5-01-presentation-full-desktop-1280x900.png) | D5 / 四段呈现 | 02:12:09 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D5-01-presentation-full-desktop-1280x900` | 四段呈现整页：顶部即吸顶「模拟数据」标识；含选择后复核（礼物＋包装＋贺卡＋装饰＋配送）与被选候选的复核结论 |
| [`shots/D5-02-sec1-style-palette-desktop-1280x900.png`](./shots/D5-02-sec1-style-palette-desktop-1280x900.png) | D5 / 四段呈现 | 02:12:10 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D5-02-sec1-style-palette-desktop-1280x900` | 四段呈现第 1 段「① 风格与配色」（视口截图，顶部吸顶「模拟数据」标识可见） |
| [`shots/D5-03-sec2-packaging-desktop-1280x900.png`](./shots/D5-03-sec2-packaging-desktop-1280x900.png) | D5 / 四段呈现 | 02:12:10 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D5-03-sec2-packaging-desktop-1280x900` | 四段呈现第 2 段「② 包装材料与步骤」（视口截图，顶部吸顶「模拟数据」标识可见） |
| [`shots/D5-04-sec3-card-decor-desktop-1280x900.png`](./shots/D5-04-sec3-card-decor-desktop-1280x900.png) | D5 / 四段呈现 | 02:12:11 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D5-04-sec3-card-decor-desktop-1280x900` | 四段呈现第 3 段「③ 贺卡正文与装饰物建议」（视口截图，顶部吸顶「模拟数据」标识可见） |
| [`shots/D5-05-sec4-giving-desktop-1280x900.png`](./shots/D5-05-sec4-giving-desktop-1280x900.png) | D5 / 四段呈现 | 02:12:11 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=D5-05-sec4-giving-desktop-1280x900` | 四段呈现第 4 段「④ 赠送时机、方式与话术」（视口截图，顶部吸顶「模拟数据」标识可见） |
| [`shots/D5-06-presentation-full-narrow390.png`](./shots/D5-06-presentation-full-narrow390.png) | D5 / 四段呈现 | 02:12:16 | `http://127.0.0.1:8787/` | 390x844@1 | `node docs/demo/pack/capture.mjs --only=D5-06-presentation-full-narrow390` | 窄屏 390 的四段呈现整页（证明窄屏下吸顶「模拟数据」标识与四段排版仍成立） |
| [`shots/E1-01-model-error-desktop-1280x900.png`](./shots/E1-01-model-error-desktop-1280x900.png) | 失败态 model_error（本包新增 E1） | 02:12:20 | `http://127.0.0.1:8787/?demo=model_error` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=E1-01-model-error-desktop-1280x900` | ?demo=model_error：模型输出损坏 JSON → 不把空结果当成功，给出中文错误/空状态说明与错误码，无任何可选方案 |
| [`shots/E2-01-loading-desktop-1280x900.png`](./shots/E2-01-loading-desktop-1280x900.png) | 失败态 超时（本包新增 E2） | 02:12:26 | `http://127.0.0.1:8787/?demo=slow` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=E2-01-loading-desktop-1280x900` | ?demo=slow：客户端 20s 超时窗口内的中文加载态「正在生成三个不同思路…」 |
| [`shots/E2-02-timeout-desktop-1280x900.png`](./shots/E2-02-timeout-desktop-1280x900.png) | 失败态 超时（本包新增 E2） | 02:12:45 | `http://127.0.0.1:8787/?demo=slow` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=E2-02-timeout-desktop-1280x900` | ?demo=slow：超时态，中文说明「未在设定时间内拿到结果 / 超时不会被当作成功」+ 重试入口（重试=true，回到表单=true） |
| [`shots/E3-01-empty-record-expired-desktop-1280x900.png`](./shots/E3-01-empty-record-expired-desktop-1280x900.png) | 失败态 空/记录失效（本包新增 E3） | 02:12:47 | `http://127.0.0.1:8787/` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=E3-01-empty-record-expired-desktop-1280x900` | 空状态（记录失效）：sessionStorage 里的旧运行编号在内存服务上取不到 → 中文说明「接入层为内存实现，服务重启即失效」，不静默假装有数据 |
| [`shots/E4-01-over-budget-full-desktop-1280x900.png`](./shots/E4-01-over-budget-full-desktop-1280x900.png) | 超预算 OVER_BUDGET（等价 D9 界面侧） | 02:12:52 | `http://127.0.0.1:8787/?demo=presentation_over_budget` | 1280x900@1 | `node docs/demo/pack/capture.mjs --only=E4-01-over-budget-full-desktop-1280x900` | 超预算拒绝整页（?demo=presentation_over_budget）：首次复核给出 OVER_BUDGET（估算超预算），卡内中文说明「已用唯一一次全局自动修订」 |

## 逐图校验记录（脚本记录，非人工填写）

| 文件 | 字节 | sha256（前 16 位） | 整页/视口 |
| --- | --- | --- | --- |
| `shots/D10-01-firstscreen-desktop-1280x900.png` | 395582 | `0accbc9cd47ffa1e` | 视口 |
| `shots/D10-02-firstscreen-narrow390.png` | 376264 | `9801397562614557` | 视口 |
| `shots/D10-03-firstscreen-tiny320.png` | 153334 | `d8ee247ffbe5d623` | 视口 |
| `shots/D10-04-sticky-scrolled-desktop-1280x900.png` | 276379 | `466795bf8273e14c` | 视口 |
| `shots/D10-05-landing-full-desktop-1280x900.png` | 391883 | `c536a5f36bc5bd47` | 整页 |
| `shots/D10-06-firstscreen-desktop-1440x900.png` | 397727 | `8db9a742df32e12e` | 视口 |
| `shots/D2-01-step1-empty-desktop-1280x900.png` | 388434 | `ffec6aadd529ca7b` | 整页 |
| `shots/D2-02-step1-baseline-desktop-1280x900.png` | 408372 | `513e79b60a2d3528` | 整页 |
| `shots/D2-03-step2-interests-styles-desktop-1280x900.png` | 176196 | `29b13d697be94cd4` | 整页 |
| `shots/D2-04-step3-exclusions-desktop-1280x900.png` | 151726 | `e4e924d46caf8ad4` | 整页 |
| `shots/D4-01-candidates-three-ok-desktop-1280x900.png` | 366612 | `6fccfbe95c862719` | 整页 |
| `shots/D4-02-candidates-sticky-check-desktop-1280x900.png` | 96666 | `e524e5dbad6ea8ac` | 视口 |
| `shots/D4-03-candidates-partial-fail-desktop-1280x900.png` | 373030 | `82dc0d4a5fdb5cdc` | 整页 |
| `shots/D5-01-presentation-full-desktop-1280x900.png` | 265414 | `615696e24bc4958b` | 整页 |
| `shots/D5-02-sec1-style-palette-desktop-1280x900.png` | 90145 | `cb54811becb5879b` | 视口 |
| `shots/D5-03-sec2-packaging-desktop-1280x900.png` | 90335 | `310fb4d55cd041bc` | 视口 |
| `shots/D5-04-sec3-card-decor-desktop-1280x900.png` | 92804 | `48da051a4d99e29b` | 视口 |
| `shots/D5-05-sec4-giving-desktop-1280x900.png` | 87909 | `0c8225f612dfd876` | 视口 |
| `shots/D5-06-presentation-full-narrow390.png` | 240791 | `613c6a53c1669ff4` | 整页 |
| `shots/E1-01-model-error-desktop-1280x900.png` | 99086 | `a301d85b5d0711d4` | 整页 |
| `shots/E2-01-loading-desktop-1280x900.png` | 77389 | `32eb7d8f7f91632a` | 视口 |
| `shots/E2-02-timeout-desktop-1280x900.png` | 114374 | `2aec3c4b4812e386` | 整页 |
| `shots/E3-01-empty-record-expired-desktop-1280x900.png` | 392813 | `b5731a95df766d78` | 整页 |
| `shots/E4-01-over-budget-full-desktop-1280x900.png` | 281581 | `647374d3a76fd40f` | 整页 |
