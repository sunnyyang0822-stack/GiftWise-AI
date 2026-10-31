# #59 / #60 后台交付与剩余阻塞

基线 origin/release/2026-11-01-submission 3890aa5；独立工作树 .worktrees/retrieval-media，分支 codex/retrieval-media，PR #61。此报告为开发自测，不代替独立 QA。

## 当前结果

| 项目 | 状态 | 证据或限制 |
| --- | --- | --- |
| 共享契约 | PASS | docs/design/retrieval-media-contract.md，27670b6 |
| OpenCLI 版本及连接核对 | PASS | 2.0.2，doctor 扩展未连接；源码 runtime.js 有 CDPBridge，commands/browser.js 仍直接使用 BrowserBridge |
| 专用后台浏览器读取 | PASS | Chrome headless 独立 .tmp/retrieval-chrome；回环 127.0.0.1:19359；通过安装包 CDPBridge 读取，无个人配置、无扩展、无个人会话 |
| 公开目录筛选→详情 | PASS | node research/opencli-prototype/probe.mjs；public-demo-browser.jsonl，Books to Scrape 公开抓取练习来源 |
| 真实商品检索及CNY价格 | BLOCKED | 练习站声明随机价格，GBP 51.77 不能转成真实商品报价；未配置经核实的真实来源适配器 |
| 单worker、有界队列、超时、取消、隔离 | PASS | 受控测试；超时后停用worker直到维护者重启，避免未结束provider与新任务并发 |
| 价格检查与模型改价拒绝 | PASS | 受控测试 bindPrice；尚无真实证据商品可绑定，未接入生成模型取价路径 |
| 媒体provider与选后包装门禁 | PASS | 现有选择与呈现检查通过后调用；按run/candidate缓存；未授权服务返回 unavailable |
| sidecar接线 | PASS | 推荐报告与成功呈现返回 retrieval/media；默认检索 unavailable，不创建虚假商品或图片 |
| 远程媒体读取 | PASS | 默认空域名白名单；HTTPS、DNS公有IPv4、固定解析地址、拒绝全部重定向、MIME/签名/字节/超时限制；未接公共下载API |
| 真实商品图片授权/SKU核对 | BLOCKED | 未取得来源及使用依据，全部 image=null |
| 真实包装图 | SKIP | 未确定provider及费用授权，不调用付费服务 |
| 前端、工作流同版联调、独立QA | SKIP | 本线不修改这些文件，待PM协调 |

## 实际命令与结果

- git fetch origin release/2026-11-01-submission：PASS；旧主工作区未改动。
- opencli --help / browser bind --help / browser open --help / doctor：已执行。受限进程中daemon启动失败；允许后台诊断后daemon=true、extensionConnected=false。
- Chrome --headless=new --remote-debugging-address=127.0.0.1 --remote-debugging-port=19359 --user-data-dir=<独立工作树>/.tmp/retrieval-chrome --no-first-run about:blank：已启动；Get-NetTCPConnection确认仅127.0.0.1监听。
- OPENCLI_CDP_ENDPOINT + opencli browser open/extract：FAIL，仍要求扩展；不把旧README环境变量当当前CLI命令可用证明。
- OPENCLI_PACKAGE_ROOT=<已安装OpenCLI包> node research/opencli-prototype/probe.mjs：PASS，公开练习目录读取、按标题筛选链接、打开具体详情并读取UPC与GBP价格。
- node --test web/tests/retrieval-media.test.mjs：9 PASS / 0 FAIL，受控夹具。包含无价、条件价、超预算、ID/改价、串行隔离、超时取消、队列、缺图、重复请求、URL/DNS/重定向/类型/大小/签名。
- node web/tests/access-layer.test.mjs：41 PASS / 0 FAIL。历史测试含旧预算场景，只证明原接入层回归，不作为新版真实模型验收。

## 产品负责人需要做什么

不需要在个人浏览器安装扩展。后台专用浏览器CDP实验已经可行。后台后续仍需实现并验证具有明确CNY规格报价及图片使用依据的真实来源适配器；这属于未完成开发，不能仅因当前没有适配器就称为用户阻塞。产品负责人若已有来源许可，可提供来源范围；否则无需先操作个人浏览器。若目标来源要求登录/验证码，只能在专用后台配置处理，禁止提供个人Cookie或会话。

服务器尚未授权/提供，无部署验证。若需要真实包装图，请另行确认支持参考图的服务、费用范围及凭证配置方式；在此之前保留unavailable。上述依赖不妨碍本PR已实现的安全模块与文本降级。真实商品绑定、生成模型检索计划接入及三候选同版闭环仍未完成，#59/#60不得关闭。

## 后续补证（2026-10-31 13:17 北京时间）

- 新增 ApplePublicProvider，使用固定 Apple 中国详情URL，通过execFile参数数组、shell=false运行OpenCLI CDP只读适配；不传用户关键词或个人资料。
- 真实详情读取 PASS：`node research/opencli-prototype/apple-read.mjs`；apple-public-evidence.jsonl 记录 AirTag 1件装249 CNY、4件装849 CNY和时间。都是页面观察价，不保证结算/库存/物流；两种规格仍是同一种礼物，不能凑三方案。
- 官方目录搜索 FAIL：尝试官方产品入口与分类路径，未找到详情链接/分类404。固定详情成功不能冒充真实搜索成功。
- 默认禁用真实来源；维护者可用研究目录start-browser.ps1启动专用空白浏览器，服务端设置 GIFTWISE_RETRIEVAL=apple-public 和 OPENCLI_PACKAGE_ROOT=<安装目录> 后启用固定详情sidecar。mock永不触发浏览器。无需个人浏览器或插件。端口仅回环；服务器运行环境仍需另行验证。
- 当前真实来源只用于证据sidecar，尚未绑定模型三候选，不可将这些价格解读成候选价格。模型引用映射的bindCandidates纯服务端模块已测试，但完整模型接线未完成。
- 以上补证覆盖前文“无真实CNY详情”的旧状态；完整真实搜索、三候选价格绑定、许可图片和真实包装图仍未完成，Issue保持开启。

## 价格引用接线补充

生成前执行真实检索门禁，固定来源不足三种不同礼物时返回 needs_input / RETRIEVAL_INSUFFICIENT，不调用模型，不凑数。若未来来源足够，则通过retrieval_json传递服务端证据，并验证独立product_references_json，逐项核对候选名称规格、ID和原始金额；缺引用或改价产生PRODUCT_EVIDENCE_MISMATCH并清空可选列表。已在PR共享契约明示增量，需PM通知工作流适配；未调用付费模型验证。HTTP失败响应亦保留sidecar。当前最终本线10测试PASS，接入层41测试PASS。

仍未完成：真实站点通用搜索（固定详情已验证）、至少三种不同合适商品的覆盖、工作流同版适配/真实闭环、合法可用商品图片、真实包装图及独立QA。不会把这些列为已完成，也不把适配器开发缺口推给产品负责人。
