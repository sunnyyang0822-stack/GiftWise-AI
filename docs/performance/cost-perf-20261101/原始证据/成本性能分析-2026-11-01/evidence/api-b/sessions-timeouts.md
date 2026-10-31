# 会话、幂等与超时

代码SHA：`eceef056ce80399b83c61f62860a32d0ead16e3d`。Issue #122，只读源码交接。

**【实测=源码核查】不等于运行成功**；【推算】为实现推导；【未测】为目标部署/外部行为未验证。本单不跑任何测试、HTTP或供应商。没有Cookie、签名或认证材料值。

## 会话与重启

【实测=源码核查】Cookie名`gw_task_session`，进程启动生成随机HMAC secret；签名合法复用owner，否则创建新owner。标志为Path=/、HttpOnly、SameSite=Strict；只有`req.socket.encrypted`为真才加Secure。没有显式Max-Age/Expires/Domain，不是“Cookie十分钟过期”。[owner实现][owner]

【推算】TLS在反代终止、Node接HTTP时，单设X-Forwarded-Proto不会让此代码加Secure。不同Node进程的secret与内存记录不共享；不能宣称已支持任意多副本或跨实例恢复。前端用同源API，未实现通用CORS/OPTIONS支持。[前端fetch][fetch]、[方法限制][methods]

| 对象 | 【实测=源码核查】绑定/期限 | 源码 |
|---|---|---|
| analysis | owner+完整原intake指纹；createdAt起10分钟，最多200。续答成功新ID，错误保留旧ID/问题；非滑动期限 | [分析存储][analysis-store]、[接续校验][analysis] |
| run | owner；created_at起10分钟，最多200。读取不续期；非owner/失效GET返回404 | [run存储][run-store]、[读取][run-read] |
| 选后图片任务 | owner hash+run+当前selected_candidate_id；task与asset读取先找有效run | [媒体路由][media-route]、[任务绑定][media-provider] |
| 历史reference/catalog/style-board | 按已验证缓存ID/文件名读，不是同样的run/owner授权 | [历史图片][legacy] |

【实测=源码核查】analysis、run、推荐键、selections与并发状态都在内存。重启丢失这些记录与Cookie签名secret。媒体文件store可保留JSON/图片，但旧pending由新executor读取会变为failed、execution=unknown、IMAGE_EXECUTION_UNKNOWN，不自动重新付费生成。[文件记录][task-store]

【推算】只挂媒体卷不能恢复旧owner/run；即使图片文件还在，旧会话仍可能404。粘性路由也不能解决进程重启。完整恢复/迁移由C资料及部署侧方案另定，本版不冒称已实现。

## 幂等、修订与取消

【实测=源码核查】推荐并发键/缓存键包含owner、intake、analysis、inputParse、确认引用、mode/demo；新理解/续答不同分析状态不会当旧run。选后有presentation_jobs与selections缓存，同run/候选重复选择复用；图片按run/候选/plan版本及文件独占创建去重。轮询GET不创建新图。[推荐键][dedupe]、[选后任务][select-dedupe]、[图片去重][image-dedupe]

【实测=源码核查】全局一次自动业务修订跨推荐和呈现共享，repair_count由服务器持有。它不同于文本HTTP传输重试、模型输出格式重试或工具轮次；“一次业务修订”不等于“一次模型调用/只付一次文本费用”。[业务上限][repair]、[格式重试][format-retry]

【实测=源码核查】前端取消会abort当前controller并增加请求版本。推荐响应未写完即断开时server触发signal，推荐模型/工具可接收；独立parse、排除分析、呈现的模型调用没有同样贯穿的请求取消参数。不能承诺关闭页面就终止全部供应商执行。[前端取消][cancel]、[推荐取消][server-cancel]、[provider阶段][provider]

【实测=源码核查】指南离开时停止前端状态读取，不取消后台AI图。图像超时/断连可为execution=unknown；失败不能证明供应商没执行或没计费。无通用cancel/delete/免费重新生图路由。[轮询停止][poll]、[媒体执行][media-exec]

## 每阶段超时，不能合成虚假SLA

| 阶段 | 【实测=源码核查】实际值与类别 | 源码 |
|---|---|---|
| 前端普通API | 120000ms，实际单次fetch abort；推荐、呈现、排除分析缺省使用 | [app常量][front-time] |
| 前端配置读取 | 15000ms，实际配置fetch | [配置超时][front-config] |
| 前端intake解析 | 采用config.intake_parse.client_timeout_ms=60000；fallback也为60000 | [解析客户端][parse-time] |
| server公布client_timeout_ms | 150000ms是建议客户端值，**不是Node/反代/业务请求总deadline**；本版app普通fetch仍120000 | [server建议][server-time] |
| 文本模型 | LLM_TIMEOUT_MS未设120000，每次HTTP尝试单独计时；默认2次重试，transport硬钳≤3次重试 | [配置][model-time]、[循环/计时器][transport] |
| 输出格式/工具 | 格式重试缺省1、钳≤1；截断/推理耗尽不自动格式重试。recommend maxToolRounds缺省2、钳≤4，可多次模型请求 | [provider][provider] |
| 推荐style润色 | 有LLM凭据时默认llm_text，可额外一次模型调用，maxTokens4096；不产生另一个总SLA | [style配置][style] |
| 检索worker | 生产配置90000ms/job执行，队列等待另计；不是类构造默认15000。队列上限4，公开HTTP lane最多3并发 | [生产配置][retrieval]、[worker][worker] |
| 公开文字HTTP | 单搜索默认8000ms、上限15000；生产分支传min(timeout,8000)。2MiB、摘要/标题而非全文 | [HTTP实现][text-http] |
| 点评浏览器 | 连接/页面操作常用20000ms，并受外层检索控制；远端登录与兼容未测 | [浏览器][browser] |
| 选后文字 | 仅等任务建立，media_wait.waited=false、timeout_ms=0；不等待AI图 | [异步返回][presentation] |
| GIFTWISE_PRESENTATION_WAIT_MS | config仍读、默认30000，但当前pipeline不引用；不能照旧注释说选后等待30秒 | [遗留配置][old-wait]、[实际返回][presentation] |
| Seedream | 构造默认60000ms，仅生成HTTP；之前可读≤2张参考图，每张5000ms。无自动重复提交 | [图像provider][seedream] |
| 图像安全DNS | 固定dns.google DoH，单次4000ms；图像读取有另一个边界，不能保证可达 | [安全读取][dns] |
| 前端媒体读取 | 每次GET10000ms；自动延迟1/2/4/8/8/8/8/8/8/8秒，用尽可仍是真实pending、允许手动读取 | [轮询常量][poll] |
| Dify历史对照 | DIFY_TIMEOUT_MS默认60000，只在显式dify模式使用 | [历史配置][dify] |

【推算】默认文本3次尝试的名义预算为3×120秒+250/500ms退避≈360.75秒；格式重试、工具多轮、排队、style等还可能增加时长。这不是精确硬上限或端到端SLA。前端120秒可能先断，建议150秒也不覆盖全部组合。[退避][transport]

【未测】冻结代码没有统一150秒业务deadline，Node本身/反代默认参数、目标供应商P95、断连传播、吞吐和费用需部署侧后验。本单不顺手统一超时或改代码。同版QA原始输出由PM发布到qa-d，历史不同SHA记录另列。

[owner]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L76
[fetch]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/public/app.js#L478
[methods]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L448
[analysis-store]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/exclusion-store.mjs#L3
[analysis]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/exclusion-service.mjs#L20
[run-store]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/store.mjs#L15
[run-read]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L423
[media-route]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L411
[media-provider]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/provider.mjs#L128
[legacy]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L383
[task-store]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/task-store.mjs#L14
[dedupe]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/pipeline.mjs#L171
[select-dedupe]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/pipeline.mjs#L711
[image-dedupe]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/provider.mjs#L71
[repair]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L226
[format-retry]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/provider.mjs#L422
[cancel]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/public/app.js#L138
[server-cancel]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L526
[provider]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/provider.mjs#L280
[media-exec]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/provider.mjs#L108
[front-time]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/public/app.js#L121
[front-config]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/public/app.js#L123
[parse-time]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/public/js/parse-intake.js#L36
[server-time]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L277
[model-time]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L105
[transport]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/transport.mjs#L118
[style]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L327
[retrieval]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L448
[worker]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/retrieval/worker.mjs#L12
[text-http]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/collect/public-text-http.mjs#L59
[browser]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/collect/domestic-browser.mjs#L33
[presentation]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/pipeline.mjs#L980
[old-wait]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L352
[seedream]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/seedream.mjs#L89
[dns]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/media/safe-read.mjs#L26
[poll]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/public/js/results-view.js#L13
[dify]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L215
