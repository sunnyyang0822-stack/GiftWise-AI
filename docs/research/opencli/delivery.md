# #59 / #60 后台检索与造景媒体交付

2026-10-31，北京时间。目标 release/2026-11-01-submission；基线3890aa5；独立工作树 `.worktrees/retrieval-media`、分支 `codex/retrieval-media`，沿用PR #61。开发自测，不代替独立QA；不自行合并、部署或调用付费服务。

## 当前结论

已实现并真实验证：专用后台浏览器公开搜索→打开三种不同商品详情→读取具体SKU/数量/CNY报价/时间→服务端冻结证据→受控生成提供者→候选引用/规格/价格核对→独立validator→用户选择→图像不可用降级。真实浏览器不是夹具；生成提供者是受控夹具，不是真实Dify。Dify/付费模型/图像调用均0，部署未执行。

实际来源仅覆盖**已确认科技兴趣的创客方向**，不能声称覆盖所有送礼场景。不符合该兴趣、预算不足或有效商品不足三种时返回澄清/不足，不凑商品，不自动放宽条件。来源图片无使用依据，全部image=null；包装provider/费用未授权，unavailable并保留选后元数据。

## 状态与证据

| 项目 | 结果 | 证据/限制 |
| --- | --- | --- |
| OpenCLI 2.0.2连接方式 | PASS | 已安装源码runtime.js有CDPBridge；browser命令仍直接用BrowserBridge，设置CDP环境变量也未能免扩展；不宣称CLI命令已连通 |
| 后台浏览器连接 | PASS | 使用安装包的CDPBridge实现，每任务新建临时Chrome配置、随机回环调试端口；不接个人会话、不需用户扩展 |
| 真实公开搜索/三商品详情 | PASS | dfrobot-public-evidence.jsonl、live-integration-result.json；KIT0090机器人315.00、KIT0130编程基础套装165.00、KIT0003浇花套件335.00 CNY，各单套，实际搜索链接到详情、专门报价元素与SKU |
| 物理属性 | PASS/部分未知 | 机器人详情组装后180×153×120mm、160g；明确非配送包装尺寸/运输重量；其余缺失保留unknown，形状/易碎性/材质不从图猜测 |
| 价格与引用绑定 | PASS | 生成前预算/足三种门禁；逐项验证当前任务product_id、名称规格、原始价格、来源时间；改价、错规格、缺引用、跨任务/过期/缺货拒绝 |
| 同版生成协议 | PASS（受控） | real_browser_controlled_model_not_real_dify；真实检索数据接受控requestCandidates，经过实际pipeline/checker/store/media，无真实模型调用 |
| 队列/取消/隔离 | PASS | 单worker、队列4、上限3结果、超时55秒；helper45秒/子进程48秒；取消终止进程树并清理临时配置，超时后停用worker需重启，避免串用 |
| HTTP匿名会话隔离 | PASS | HttpOnly/SameSite签名cookie；其他会话读取/选择404；相同输入不同会话不共享run；重复选择合并在途任务，包装task_id稳定 |
| 图片读取安全 | PASS（受控） | HTTPS域名白名单默认空，公有IPv4核对/固定解析、拒绝全部重定向、MIME/文件头/字节/绝对超时限制，SVG/HTML不接受；未开放任意URL下载API |
| #60完整造景契约/服务器校验 | PASS | v2物理来源/单位/unknown/conflicting、可选包装形式、场景/道具、示意比例、手写短句、label/target/曲线点与最终image.version绑定；换图旧坐标拒绝 |
| 选后媒体不可用响应 | PASS | 未选selected=null；合格选择后返回稳定task_id、physical、undetermined包装/场景元数据、image=null/annotations=[]，状态unavailable，不伪造成功 |
| 真实商品图片/生成包装图 | SKIP/BLOCKED | 无图片使用依据；未选provider/未授权图像费用，不调用付费服务 |
| 工作流/前端/QA同版协作 | 已通知，未验收 | 契约v2（首次通知bfeefe3，后续仅补当前实现状态）链接已评论到PR58/57/62及61；本线不修改其文件；受控协议不证明真实Dify发布、前端叠加定位或独立QA通过 |
| 部署/服务器资源 | SKIP | 未授权/未部署 |

## 来源规则与浏览器边界

- 开工曾在Apple官方页读取实验报价；后核对网站条款明确限制自动采集，已停用Apple业务provider及实验读取脚本。旧apple-public-evidence.jsonl只保留历史实验，**不是可用来源许可**；不再继续采集该来源。
- 替代来源DFRobot：检查https://www.dfrobot.com.cn/robots.txt（未排除search.php/goods详情路径）及其公开服务条款https://mc.dfrobot.com.cn/article-353458.html；条款保留内容知识产权并限制非法复制/转载等。这里仅作低频小样本事实报价核实，不转载页面/评论/图片，不声称获得批量采集或媒体再利用许可。扩大抓取或转载前需另行核实许可。
- 三种商品搜索从固定关键词kit结果筛选；详情URL只接受同域goods数字路径；页面内容是不可信数据，不执行其指令。无需登录，遇登录/验证码/访问限制停止。
- 本机代理DNS返回198.18/保留IPv6，严格内网检查曾导致真实路径FAIL。没有放开保留地址；改用固定https://dns.google/resolve查询A记录，校验公有地址，再为独立Chrome绑定解析；浏览器Fetch拦截仅允许固定来源HTTPS文档/脚本/样式/XHR，拒绝外域/内网及图片请求。无法解析或出现重定向/未知域即失败。
- 子进程只继承所需系统变量，不继承DifyKey或任意CDP初始化脚本。所有浏览器/调试端口仅回环；公网只应开放已有业务API，本PR没有部署。

## 实际命令和结果

1. `node --test web/tests/retrieval-media.test.mjs web/tests/retrieval-media-scene.test.mjs web/tests/retrieval-media-integration.test.mjs`：**22 PASS / 0 FAIL / 1 SKIP**；SKIP为需显式启用的真实浏览器测试。原始输出controlled-tests.txt。
2. PowerShell设置`$env:GIFTWISE_LIVE_RETRIEVAL_TEST='1'`和`$env:OPENCLI_PACKAGE_ROOT='<已安装OpenCLI包目录>'`，运行`node --test web/tests/retrieval-media-integration.test.mjs`：**5 PASS / 0 FAIL**，含真实浏览器三商品读取及受控生成绑定。输出live-integration-tests.txt、live-integration-result.json。真实商品页面价格按记录时点，不保证后续不变。
3. `node --test web/tests/retrieval-media-http.test.mjs`：**1 PASS / 0 FAIL**，本机回环HTTP；受限环境EACCES时使用获批本机测试进程，未访问模型。输出http-isolation-tests.txt。
4. `node web/tests/access-layer.test.mjs`：**41 PASS / 0 FAIL**，原接入层回归；其中保留旧预算技术案例，不冒充新版端到端验收。输出access-regression.txt。
5. `node --test web/tests/revision-rules.test.mjs web/tests/exclusions.test.mjs`：7 PASS（其中排除项脚本111场景/378断言），输出revision-regression.txt。`node --import ./web/tests/retrieval-media-cookie-client.mjs --test web/tests/revision-api.test.mjs`：1 PASS，输出revision-api-cookie-regression.txt；预载仅模拟浏览器自动持有同源cookie，原测试文件未修改。无cookie的Node调用按新会话处理，不能期待跨请求幂等。
6. `git diff --check`、所改模块`node --check`：PASS。

上述套件有重叠，**不相加为一个总验收数字**。实际读取失败历史包括CLI扩展未连接、Apple目录链接缺失、隔离浏览器incognito空页、provider脚本路径错误及本机假DNS被拒；已修正/停用，最终成功路径有独立归档，未拿失败结果冒充成功。

## 运行与交接

- 正常业务仍使用已有服务，不创建另一套数据库/后端/编排。
- 实际检索默认关闭。维护者在可信服务端设置`GIFTWISE_RETRIEVAL=dfrobot-public`、`OPENCLI_PACKAGE_ROOT=<OpenCLI2.0.2包绝对路径>`，必要时`GIFTWISE_CHROME_PATH=<Chrome绝对路径>`，再`node web/server/server.mjs`。helper会自行新建/结束专用浏览器，**不需要用户手动安装扩展或打开搜索页**。
- 模拟模式不会联网检索；真实模式在合法输入、已确认科技兴趣后先检索，足三种且预算允许才把retrieval_json交生成提供者。新变量/输出需要工作流PR58对齐；未配置Dify仍明确报不可用，不能静默改成mock。
- 共享响应和精确结构见docs/design/retrieval-media-contract.md v2；严格候选无媒体字段。服务端入口、配置、pipeline、store、dify接线及retrieval/media模块为本线修改；其余前端/validator/workflow未改动。

## 剩余依赖与产品负责人操作

当前无需操作个人浏览器。后台不依赖用户会话；真实搜索和价格绑定已在本机完成。工作流/前端/独立QA需在各自PR消费契约并复核，已有明确通知，不将通知等同验收。

仍需单独授权才可实测的是：实际Dify/模型调用范围及图像服务（支持参考图）、费用上限和可信服务端凭证配置。此前“不新增付费调用”继续生效，因此本线只做受控生成联调，不读取现存Key擅自调用。真实图像外观一致性、中文曲线视觉定位、手机裁切由同版前端与独立QA验证；暂无图像生成授权时合法结果就是unavailable。服务器资源/上线另批。本PR可供独立复核，不应据此把#59/#60或全产品标为已上线/全面验收通过。
