# 冻结版运行依赖与配置核对

代码SHA：`eceef056ce80399b83c61f62860a32d0ead16e3d`，Issue #122。仅文档，不提交/推送、不改业务、不建实例、不部署。`main` PR #111仍草稿。

**【实测=源码核查】只表示读取代码**，不是环境/HTTP成功；【推算】为准备建议；【未测】为待目标环境验证。没有读取实际.env或认证材料。

## 入口与必要依赖

| 项目 | 结论与证据 |
|---|---|
| 【实测=源码核查】整站入口 | 仓库根运行`node web/server/server.mjs`；或web目录`npm start`。web/package.json dependencies/devDependencies均为空，没有必须先跑的前端构建步骤。[package][package] |
| 【实测=源码核查】Node要求 | package engines写>=18，但服务直接import node:sqlite/DatabaseSync，浏览器路径还用global WebSocket。不能用声明>=18证明Node18可启动。[sqlite][sqlite]、[browser][browser] |
| 【推算】运行候选 | 使用支持node:sqlite、fetch、WebSocket的Node24.x作为待核验环境；源码有历史Node24记录，不是本单对Linux新版本的实跑证明。[历史源码记录][node24] |
| 【实测=源码核查】Python | 当前Node主服务校验用JS checker，不启动Python做主请求校验。Python validator/workflow供离线参考/旧链路；Python版本与QA由D另交，不在本单安装或运行。[JS入口][intake] |
| 【实测=源码核查】旧容器不能直接复用 | deploy/Dockerfile基于python:3.12-slim，仅COPY validator/deploy；根.dockerignore排除web/workflow。它不是Node整站镜像。[Dockerfile][docker]、[忽略规则][ignore] |
| 【实测=源码核查】静态资源/提示词 | 必须同时带web/public、web/server、workflow/prompts；提示词由服务读文件，不能只复制单个server.mjs。[提示词读取][prompt]、[静态根][static] |

## 真模式与非秘密env

【实测=源码核查】应用不自动读取env文件，实际读取process.env。`env.example`只作模板，需部署进程管理器或显式加载；Node直接启动不会因旁边存在该文件就采用它。[配置读取][llm]

【实测=源码核查】LLM_BASE_URL、LLM_API_KEY、LLM_MODEL三项缺一，即使GW_MODE=llm也回落mock。部署启动器必须前置拒绝缺项；后续核对有效mode=llm、services.llm.active/configured。health200、配置存在或历史成功都不能替代实际连通验收。[模式矩阵][mode]、[配置响应][config]

【未测：命令草案，未执行】可信环境先注入秘密，禁止set -x；可在仓库根用下面的非空前置检查。它不是冻结服务已经内置的fail-fast，也不是部署放行：

```sh
: "${LLM_BASE_URL:?missing endpoint}"
: "${LLM_API_KEY:?missing text-model secret}"
: "${LLM_MODEL:?missing model id}"
: "${IMAGE_API_KEY:?missing selected-image secret}"
[ "$GW_MODE" = llm ] || exit 1
[ "$GIFTWISE_IMAGE_GENERATION" = 1 ] || exit 1
node web/server/server.mjs
```

以下默认值均为【实测=源码核查】，模板有意改监听地址/开启选后AI时单独注明：

| 变量 | 实际默认/用途 | 证据 |
|---|---|---|
| GW_HOST、GW_PORT、PORT | 127.0.0.1:8787；GW_PORT优先PORT；跨容器监听由部署侧决定 | [config:261][bind] |
| GW_MODE | 未设按三项LLM是否齐全选择llm/mock；dify仅显式历史对照 | [config:158][mode] |
| LLM_BASE_URL/API_KEY/MODEL | 三项必须服务端配置；秘密不进入GitHub材料 | [config:98][llm] |
| LLM_TIMEOUT_MS | 默认120000，仅每次HTTP尝试 | [config:105][model-config] |
| LLM_MAX_RETRIES | 未设2，transport硬钳≤3次重试；空串转0，不等于未设 | [config:123][model-config] |
| LLM_OUTPUT_RETRIES | 默认1、钳≤1；与业务修订不同 | [config:141][model-config] |
| LLM_MAX_TOKENS / LLM_PARSE_MAX_TOKENS | 16384 / 8192；模型输出预算，不是秘密，也不是费用实测 | [config:132][model-config] |
| LLM_TEMPERATURE | 默认0.4 | [config:139][model-config] |
| LLM_CALL_BUDGET | 未设null；不要设空串来表示无限，Number空串为0会阻止真实调用 | [config:143][model-config]、[额度检查][budget] |
| GIFTWISE_INTAKE_PARSE | 默认启用，0/off/false/no关闭并回落 | [config:415][parse-config] |
| GIFTWISE_IMAGE_GENERATION / IMAGE_API_KEY | 前者默认关闭、仅=1开启；后者非空才available。还需真实模式run授权、合法选中与呈现通过 | [config:319][image]、[媒体门禁][image-gate] |
| Seedream配置 | endpoint/model/size/watermark为源码常量：api.modelverse.cn/v1/images/generations、doubao-seedream-4.5、2K、false；无IMAGE_BASE_URL/IMAGE_MODEL等env覆盖 | [provider][seedream] |
| GIFTWISE_RETRIEVAL | 默认domestic；普通公开文字路径不强依赖OpenCLI CLI/浏览器 | [config:448][retrieval] |
| GW_LOCAL_DB / GIFTWISE_CATALOG_DB | 前者优先；需显式项目内独立路径覆盖Windows遗留默认，不指原共享库 | [config:373][db] |
| GW_LLM_LEDGER_FILE | 可显式项目内账本路径；不要用真实账本reset开关做启动步骤 | [ledger][ledger] |
| GIFTWISE_STYLE_DIRECTION_CHANNEL | 有LLM默认llm_text，否则rules；image为额外历史风格板通道，不是选后AI开关的同义词 | [config:327][style] |
| GIFTWISE_PRESENTATION_WAIT_MS | config仍读取，当前pipeline不引用；不控制选后等图 | [config:352][wait]、[实际返回][async] |
| OPENCLI_PACKAGE_ROOT / GW_OPENCLI_MAIN | 点评/对应浏览器能力有需要时配置，非当前普通文字检索必需 | [外部包定位][browser] |
| GW_CHROME_PATH / GW_DOMESTIC_PROFILE / GW_DOMESTIC_HEADLESS | 点评等专用浏览器路径；profile必须项目内；仅headless=1启用无头。目标登录/兼容未测 | [Chrome定位][chrome]、[provider][domestic] |

## 网络及可迁移性

【实测=源码核查】模型工具虽然名为opencli_search，web/内容灵感实际走固定cn.bing.com/search HTTP摘要/标题。无浏览器认证、无任意全文GET，不要求商品价格或图片；不能把普通HTTP主路径写成必须安装OpenCLI CLI。[工具入口][tool]、[文本实现][http]

【实测=源码核查】点评仍可能走专用Chrome/CDP并加载包含`clis/dianping/search.js`的OpenCLI外部包；外部包依赖由该实际安装决定，web/package.json不自动安装它。浏览器profile/临时目录被限制在当前工作树，不搬个人会话。[点评分支][domestic]、[包/浏览器][browser]、[路径约束][paths]

【实测=源码核查】图像安全读取固定使用dns.google DoH，并限制参考图片源；选后AI还需访问固定供应商地址。网络是否可达独立于enabled/configured。不得为资料核对主动发图/采集。[图像DNS][dns]、[图像供应商][seedream]

【实测=源码核查】冻结代码仍有Windows遗留默认库路径、Windows Chrome搜索路径、USERPROFILE回退及taskkill.exe清理。即使Chrome候选列表有/usr/bin/google-chrome，也不证明Linux浏览器全流程兼容。[库默认][db]、[Chrome][chrome]、[包回退][browser]

【推算】Node+HTTP文字路径可少依赖浏览器，但点评/旧CLI与媒体文件挂载仍需独立准备；本单不修冻结硬编码。C负责完整路径、持久化、资料包与历史脱敏证据，避免与其重复编排。

【未测】目标Node/Python/OpenCLI/Chrome版本、Linux实际启动、供应商/搜索/DoH连通、TLS/代理、P95、容量、费用、恢复/回滚、实例资源均未验证。D同版QA由PM待发布qa-d承接，本单不重做。没有创建镜像/实例/域名，也没有SSH/SCP或其他部署执行。

[package]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/package.json#L8
[sqlite]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/catalog/db.mjs#L16
[node24]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/localdb/db.mjs#L2
[intake]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/intake.mjs#L19
[docker]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/deploy/Dockerfile#L1
[ignore]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/.dockerignore#L19
[prompt]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/prompt.mjs#L53
[static]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L83
[llm]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L98
[mode]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L158
[config]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L247
[bind]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L261
[model-config]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L105
[budget]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/provider.mjs#L183
[parse-config]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L415
[image]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L319
[image-gate]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/provider.mjs#L87
[seedream]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/seedream.mjs#L5
[retrieval]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L448
[db]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L371
[ledger]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/ledger.mjs#L49
[style]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L327
[wait]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L352
[async]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/pipeline.mjs#L980
[tool]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/retrieval/agent-tool.mjs#L8
[http]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/collect/public-text-http.mjs#L59
[domestic]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/retrieval/domestic-provider.mjs#L126
[browser]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/collect/domestic-browser.mjs#L8
[chrome]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/collect/chrome.mjs#L22
[paths]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/collect/task-paths.mjs#L12
[dns]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/safe-read.mjs#L26
