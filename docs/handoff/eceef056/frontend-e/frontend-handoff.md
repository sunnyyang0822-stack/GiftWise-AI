# GiftWise 前端跨设备交接

本材料固定代码 **`eceef056ce80399b83c61f62860a32d0ead16e3d`**，Git tree **`2772f6d022a15ca98d0d8be9ec0f82033445c182`**。材料日期：2026-10-31。没有修改冻结源码、推送分支、启动服务或执行新测试/浏览器/模型/生图/采集。部署路由、服务端环境与素材缓存导入由 B/C/PM 的交接材料负责；本文只说明浏览器依赖和前端合同。

## 静态资源与交付方式

`static-assets-manifest.json` 列出冻结提交中全部 **40 个 `web/public/**` 文件，共 9,544,646 字节 Git 原始内容**。建议完整交付该目录，不单独从截图或旧临时目录拼网站。清单标记出静态入口图可达的 25 项依赖，另有必须随字体保留的 OFL 许可；保留的旧素材并非当前业务所需。清单不复制二进制资源，因为这些原文件已在固定提交中。

- 入口：`index.html`、`app.js`、`js/landing.js` 及其 ES module 依赖；无需前端打包、转译或 npm 安装，`web/package.json` 无前端依赖。浏览器需要现代 ES modules、Fetch、AbortController、URL、WeakMap 等支持。服务端启动条件另见 B 材料。
- 样式：`fonts.css`、`tokens.css`、`styles.css`、`landing.css`、`chat.css`。动画保留 `prefers-reduced-motion` 分支。没有为交接重做 CSS 或视觉验收。
- 当前首页图片：`img/image-1.webp`、`img/image-2.webp`（CSS 背景图）、`img/after-gift-wrapped.png`。它们是自托管首页静态插画，与已取消的推荐卡网络图片不是同一功能。
- 所有 URL 以站点根路径为基准，例如 `/app.js`、`/fonts.css`、`/api/config`。以部署站点的实际 origin 解析，不依赖开发机 IP、盘符或某个固定端口。若使用反向代理或子路径部署，需保持这些根路径的同源映射。
- 浏览器运行资源没有 CDN、外部字体或第三方 JS 依赖。SVG namespace 中的 `http://www.w3.org/2000/svg` 不是网络请求。真实文本检索、模型与图片供应商访问发生在服务端，不是浏览器的第三方运行依赖。

清单 `bytes/sha256` 按 **Git blob 原始字节**计算，另附本次本地 checkout 的 `checkout_bytes/checkout_sha256`。Windows 换行转换可使文本 checkout 哈希不同；二者不能混为同一种校验。没有为匹配哈希重写源文件，也未修改 Git 全局配置。

## 必须保留的中文字体

四个 WOFF2 都由 `fonts.css` 同源加载，`font-display: swap` 保证字体未到时文字仍可读；两个 OFL 文本应随字体交付。

| 文件 | CSS 用途 | 原有 D 静态核验记录 |
| --- | --- | --- |
| `fonts/wenkai-regular.woff2` | GW WenKai，400 | 1,564,964 字节，6915 cmap entries |
| `fonts/wenkai-medium.woff2` | GW WenKai，500–900 声明 | 1,614,368 字节，6915 entries |
| `fonts/longcang.woff2` | GW LongCang，站内常用子集 | 378,140 字节，1112 entries |
| `fonts/longcang-ext.woff2` | 同 family 的中文扩展，按需下载 | 2,565,928 字节，5783 entries |

这是面向站内文字和 GB2312 的子集方案，不是全部 Unicode 汉字覆盖承诺。扩展 face 先声明，带 `U+3000–303F/U+4E00–9FFF/U+FF00–FFEF`；常用 face 后声明。扩展与常用 cmap 无交集，动态文字可触发约 2.56 MB 扩展下载。D 的旧样本中 `丝蝴蝶` 在扩展中；①、→、≈ 会诚实回退 WenKai。四文件在最终提交与 PR95 `1447b4233773e28bfbdd50636eb6af148166536f` 的 Git blob 相同。

表中 cmap 数量来自附带的**历史 D 核验**，不是本次新测。交接期间尝试只读 cmap 库存时，本机 Python 缺 Brotli 解码扩展；没有安装依赖或重跑字体探针，改用已核验且字节相同的历史记录。不能据此宣称最终版新增字体浏览器验收。

## 浏览器实际 API 与超时

`apiFetch` 使用同源 `fetch`：非空 payload 默认 POST JSON，空 payload 默认 GET；`credentials: same-origin`、`cache: no-store`，AbortController 管理请求超时。前端不配置 API Key，不读取或输出 Cookie 值；会话所有权由服务端验证。

| 前端使用路径 | 用途/数据要点 | 实际客户端上限 |
| --- | --- | --- |
| `GET /api/config` | labels/limits、解析能力与解析超时配置 | 15,000 ms，`track:false` |
| `POST /api/intake/parse` | `{text, form}`；把虚构或用户原话解析为既有 intake | 取 `intake_parse.client_timeout_ms`；无有效值回退 60,000 ms；冻结服务端默认也是 60,000 ms |
| `POST /api/exclusions/analyze` | `{intake, continuation?}`；返回识别/自然澄清与确认信息 | 默认 120,000 ms |
| `POST /api/intake/validate` | `{intake}`；必要的表单预检查分支 | 默认 120,000 ms |
| `POST /api/recommendations` | intake 及确认数据，服务端返回三个有依据的候选 | 默认 120,000 ms |
| `POST /api/presentations` | `{recommendation_run_id, selected_candidate_id, demo}`，仅用户选择后 | 默认 120,000 ms |
| `GET /api/media/tasks/<task_id>` | 读取既有选后图片任务；`track:false` | 每读 10,000 ms |
| `GET /api/media/assets/<id>` | ready 后 `<img>` 读取本站图片字节 | 浏览器图片加载；没有额外 JS 的 10 秒 fetch 超时，失败按钮只重读同 URL |

通用请求上限来自 `app.js` 的 120 秒常量，**不会自动采用** config 顶层的旧 `client_timeout_ms=150000`；解析接口单独读取解析配置。不要依据过时注释改写实际口径。以上不是服务端供应商超时或生产性能承诺。

正式入口**不调用** `/api/runs/...` 进行推荐网图轮询，也不在推荐卡请求 `/api/reference/images/...`。仓库保留的 `recommendation-media.js` 不再从应用入口导入，不能因为文件仍在就启用已取消功能。

## 默认模式与推荐页合同

`PREVIEW_MODE` 默认 false；只有显式 `?preview=1` 或 `?preview=true` 才进入本地模拟适配器。预览结果不代表真实模型、真实资料或图片服务。正式交付链接不应附预览开关。

推荐页读取 `candidates`、`selectable_candidate_ids` 和 `validation.candidate_results`，仅展示 ID 在可选集合且对应 `passed === true` 的交集，并保留服务端顺序。成功主线应有三个真实可选思路；若响应不足三个，前端不补假卡、不改 passed、也不把失败候选强行变成三个。

- 文字字段包括 name/description/reason、参考估价、facts 引用、推断和未知项。WHY 根据 `request.facts` 与 `candidate.fact_refs` 映射事实，显示 reason/inferences/unknowns；用户文本通过 textContent 渲染。
- 真实文字/案例/事实检索由服务端先进入模型创意流程。前端保留响应的 references 数据，不把来源数据伪造为图片、SKU 或报价；当前 WHY 不臆造全局 references 与候选的一对一链接关系。
- 最终推荐卡没有网络配图、图片框、图片加载文案、图刷新或图片骨架；文字骨架与选择按钮保留。即使旧响应仍带 ready/pending/错误图片数据，也不重新启用网图。
- 时间只作参考，期限可缺失/不确定；不得补 0/365 假值。预算、结构、必要字段等非时间约束继续以服务端决策为准。三份估价不相加成为账单。

## 选后 AI 图必须继续工作

用户点选合格候选后，`selectCandidate` 提交原有 `/api/presentations`。忙碌保护防止重复并发选择；同一 run/candidate 的重复 POST 仍需要服务端幂等复用。没有因为取消推荐网图而关闭后续生图，也不会因渲染/状态刷新再次生成。

文字响应到达即显示指南。只有真实媒体 `pending`、候选一致且 task_id 为 64 位小写十六进制时，才排程选后任务 GET。间隔为 1/2/4/8/8/8/8/8/8/8 秒，计划等待合计 **63 秒**；这不是包含 GET 耗时的严格墙钟总上限。每读最多 10 秒。ready/failed/unavailable 停自动读；读取受阻或预算用尽保留实际状态与简短提示，不伪造失败或成功。

ready 只替换图片区域，正文、贺卡、摘要、按钮 DOM 不整页重建。手动“刷新图片状态”只读 GET；图片加载失败的重试只重读同一张已生成图片。离开、切换候选、requestVersion/epoch 改变后旧响应失效；任务 ID、候选 ID、状态必须一致，所有权与资产归属由服务端保障。等待期间不显示技术计数或任务 ID。

现有 `source_photo`、`reference_image`、`ai_illustration` 共享渲染能力仍保留；最终选后图类型由后端数据决定，AI 图可见标为“AI 效果示意”，其他类型不冒充 AI 或同款实拍。图片 URL 必须通过本站根相对路径校验，不能浏览器直连外部源或 data/script URL。

下例仅为已有受控 fixture 的缩小形状，标识符都是虚构占位，**不是可提交的真实请求或认证材料**：

```json
{
  "status": "completed",
  "recommendation_run_id": "fixture-run",
  "selected_candidate_id": "c1",
  "sections": [
    {"key": "giving_advice", "title": "赠送方式", "items": ["双方方便时自然递出。"]}
  ],
  "media": {
    "contract_version": "retrieval-media-v2",
    "status": "pending",
    "selected": {
      "candidate_id": "c1",
      "task_id": "<64位十六进制任务ID占位>",
      "status": "pending",
      "image": null,
      "annotations": []
    }
  }
}
```

## 纯体验、实体与混合章节

前端只显示实际非空文本 `sections[{key,title,items}]`，按后端标题语义和顺序排版，不按关键词、gift_type 或 packaging key 猜类型，不补空步骤或默认包装指引。纯体验由后端省略 packaging，邀请/安排内容进入实际赠送建议；没有替代包装占位。实体/混合的真实材料步骤保留，实体合理 description-only 可按后端“包装说明”显示。空贺卡不生成空卡，摘要“赠送建议”只列实际非空章节。没有固定三步数量。

## 证据、脱敏与适用边界

`evidence-index.json` 对每份副本记录原始项目相对 locator、原始/发布字节数和 SHA256、脱敏类别/次数、实际受测版本与适用范围。原文件未改写。存在脱敏的副本不能称为原封不动；脚本中的绝对路径替换后只作审计材料，不直接执行。受控测试源码在冻结仓库内，不能从脱敏脚本自动发起新的真实验证。

| 证据组 | 实际来源 | 可证明/不能证明 |
| --- | --- | --- |
| PR115 新 10 DOM | base 008415e0 + 当时未提交工作树，随后形成 dd51324a | 实际 sections 与受控选后生命周期；不是当时运行在 dd513 或最终 ecee 的全套测试 |
| PR120 新 19 DOM | base 008415e0 + 未提交工作树，随后形成 6d162dfd | **按名称选取**两文件中的 19 项，不是两文件全量；无网图与受控选后 AI 兼容 |
| selected-preservation | 120 工作树与 008 的源码归一 CRLF 对照 | 保留函数/静态文件对照；最终叠加 115 后的标题与章节更改不由该旧比较覆盖 |
| 历史 PR102/95 D 审核、Edge v3/字体小记录 | 102@1db4949、95@1447b42，原 probe 可能未内嵌执行 SHA | 历史局部证据；不是 ecee 新浏览器验收，不证明全部现代浏览器、移动端或未来动态文本 |
| 历史 A83 小摘要 | 与 PR83 交付头 26df1432 关联，原摘要未嵌入执行 SHA；一次真实 AI 图、文字受控 | 原 JPEG 660,375 字节、2304×1728，hash 3412964d8df46b5d019c2e1737ed16a4df7bd6a589a475c7d1225ec1db1a7663；不是最终 v7 审美实测 |

历史 102 最新 v3 的 1440 布局：媒体高 569、文档高 1915；390 布局：媒体高 354、文档高 2506，pending→ready 一致。旧 PR 正文中的 1934/2516 不再采用。最终 styles.css 与 102 字节相同，但 115 已改变标签/空章呈现、120 已取消选前图；历史页面全文和旧空步行为不可套用为最终合同。历史截图/大图/浏览器 profile、已取消 106 推荐三图材料、已取消 118 性能材料均未收录。

**PR120 最终 `git diff --check` 为 exit 1**：新测试文件第 127 行末尾空行，D 判为非阻断；开发工作区检查当时没有覆盖未跟踪的新文件，不能宣称最终 diffcheck 通过。原更正回执附在 evidence/pr120。保留已审 SHA，没有为纯空行改码、重测或新建 review。

发布副本已最小化机器绝对路径、PATH、文件 URL、本地测试 origin、操作标识符及历史对话正文字段；用 `[REDACTED:类别]` 标明。历史受控字体注入短句不含个人数据，保留用于解释字体覆盖。没有收集个人浏览器、Key/Cookie/Authorization/session 值。新最终版本的同版必要 QA 由 D 另交；本交接不替代它，也没有宣称最终全量或完整在线生图已通过。
