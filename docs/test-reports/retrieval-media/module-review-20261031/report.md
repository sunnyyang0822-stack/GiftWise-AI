# #62 第一批独立模块复核：交付修复与集成

2026-10-31（北京时间）。本批立即交付可修复问题，配合18:00前形成实际可用流程。**未签发release或最终E2E通过；不等待视觉完善才报告。** 原准备报告及63项BLOCKED记录仍是当时真值，本文件是后续实际执行结果，不覆盖它们。

## 被测对象与实际执行

| 对象 | 固定PR提交 | 范围 |
| --- | --- | --- |
| 后台 #61 | `0346f5364a0fdaeb0e6290b425892b1970f7eb89` | 单独完整副本；任务/价格/证据/场景/安全读取/管线模块 |
| 工作流 #58 | `277b71d0042163a808a39b513edac684fb694747` | 单独副本；夹具和提示词与后台v2契约对照 |
| 前端 #57 | `dd50fefc6ab9cf86a11e23a93a43e9fd7b3c6b53` | 单独副本；真实导出媒体函数，最小DOM测试替身 |
| 种子表 #64 | `a4d639bb757cc99315ca9acc633d45192d20c15a` | 单独副本；20条资料及证据引用内部审计 |

上述PR在读取时均未合入；不是release结果，也没有把四个分支混合组装运行。QA提交基于准备分支 `ecd9dd8`，被测实现各自SHA如上。Windows、Node24.21.0、Python3.12.10；命令起止时间、路径、初始clean状态、逐文件SHA256及结束状态见 `summary.json`。四个副本所有跟踪文件执行前后哈希完全一致，未修改业务/开发断言。最新Issue #59/#60及PR阅读快照见本目录 `sources/`。后台共享契约只读，仍由后台Agent唯一维护。

实际命令：

```text
python tests/acceptance/retrieval_media/run_module_review.py
```

它分别执行以下两个独立入口，传入明确副本路径、SHA与新证据文件：

```text
node tests/acceptance/retrieval_media/review_modules.mjs
python tests/acceptance/retrieval_media/review_seed.py
```

另运行：

```text
node tests/acceptance/retrieval_media/review_readers.mjs
```

精确环境参数由runner及记录中的targets/QA_*变量给出。`summary.json.commands`、`readers-command.json`记录退出码、起止时间；backend/seed/readers 的stdout/stderr及结构化results分别保留。最小DOM第一次缺replaceChildren方法导致测试基础设施失败，`attempt1-readers*`保留；补齐测试替身后复测同SHA，才得到本报告的前端业务文案失败。没有改被测函数或删失败测试。

## 实际结果

| 已执行检查 | PASS | FAIL | 退出码 | 原始证据 |
| --- | ---: | ---: | --- | --- |
| 后台独立模块探针 | 34 | 1 | 1 | `backend-results.json`、`backend.stdout.txt`、`backend.stderr.txt` |
| 种子表逐记录审计 | 20 | 0 | 0 | `seed-results.json`、`seed.stdout.txt`、`seed.stderr.txt` |
| 前端函数与工作流契约检查 | 9 | 2 | 1 | `readers-results.json`、`readers.stdout.txt`、`readers.stderr.txt` |
| 合计已执行独立检查 | **63** | **3** | — | 不等于准备矩阵的63项已完成，分组口径不同 |

本次受控provider/假传输测试无外部检索或图片请求，不是mock真实模型。前端使用最小DOM检查输出/绑定逻辑，不能证明布局、箭头视觉或完整浏览器交互。工作流PASS只证明夹具引用与状态结构，不证明Dify执行。

| 尚未执行范围 | 状态 | 下一位负责人/条件 |
| --- | --- | --- |
| 最终集成HTTP、浏览器E2E与新表单流程 | BLOCKED | PM给锁定SHA；QA随后新副本/独占端口执行，不拼分支 |
| 包装完整构图、不裁切、比例、异形适配及最终图箭头定位 | BLOCKED | PM继续Seedream视觉试验；前端/后台提供最终图片与版本绑定，QA看真实图及窄屏 |
| 三候选真实SKU图片授权与一致性 | BLOCKED | 后台/资料负责人提供使用依据和对应素材；种子表当前0张授权图 |
| 真实Dify/推荐模型 | SKIP | 本轮未调用，等待产品负责人明确授权 |
| 后台真实浏览器搜索/网站验证码/线上隔离复验 | SKIP | 本批只做模块复核，未复用开发Agent的实搜；固定SHA和允许来源确认后另执行 |
| Seedream新增调用、商家在线价格/库存/图片权利复查 | SKIP | PM已做API连通试验但视觉未通过；QA不重复生图；资料审计不冒充商家实时验证 |

线上/集成范围按上表 **SKIP 3 / BLOCKED 3**；已执行口径 **PASS63/FAIL3**。不能将这些不同层次的通过累加为最终闭环通过。

## 共享接口对照

| 检查面 | 后台v2 | 工作流 #58 / 前端 #57 的实际状态 |
| --- | --- | --- |
| 状态 | retrieval ready/partial/unavailable；media pending/ready/failed/unavailable | 工作流夹具状态枚举与后台一致，导出函数无图selected可用；未验证真实pending轮询 |
| 候选引用 | 独立product_references_json；candidate_id/product_id各一一对应，名称含variant，价格原样取冻结证据 | 工作流夹具三引用和媒体sidecar对应；前端匹配candidate→product→image_id，重复/错image_id降级，独立函数测试PASS |
| 图片版本 | media.contract_version=retrieval-media-v2；image.version与annotations.image_version相等 | 前端validAnnotations拒旧版本和非法坐标；v2无版本不叠加。工作流仍只给未带版本的草稿，并明确未输出ready，不当实际生成成功 |
| 标注 | 0–1有限数、handwritten、curve控制点、最多5条，绑定最终图 | 后台越界/非有限/换图旧坐标均拒绝；前端正常端点/旧版拒绝PASS；工作流包装提示词仍禁止curve并声明无physical字段（RM-003） |
| 价格来源 | seed/browser_observed/user_provided/unknown；无价null，条件不明确不放行 | 前端显示来源/时间/条件；工作流seed/null夹具未伪造实时；20条种子资料保留非实时与条件，无图权利被误称授权 |
| 受限计划 | category/keywords/limit精确schema，实际maker固定检索且预算冻结 | 工作流仍写“精确字段未定义”，需后台/工作流同版对齐；本批不把旧提示词自由文本传入执行器 |

## 已通过内容的证据边界

后台34项通过包含：受限计划/命令注入拒绝；严格金额与0值、等上限及超一分；条件价/缺价/区间上端；冻结证据/规格/跨任务/过期/重复商品/模型降价拒绝；worker串行结果隔离、队列边界、超时停用、取消等待任务、断连/验证码/403受控错误降级；未选/失败候选包装门禁、并发重放稳定任务ID及跨run隔离；未知物理属性、合法坐标/版本/失败状态；URL协议/域名/DNS混合地址/重定向/MIME/签名/体积限制；mock管线同owner幂等与跨owner分离。

这些测试证明代码在给定受控输入上的行为。验证码/403使用抛错provider，未访问真实受限网站；安全下载使用受控DNS与stream传输，不探测内网；包装幂等只证明未配置provider时的元数据任务缓存，**不证明已付费生成任务绝不重复扣费**。检索词隐私完整链路、运行中取消的进程清理与真实并发HTTP隔离未在本批执行，不能因模块隔离PASS就标它们通过。

种子20条各检查身份/规格/正整数数量、十进制价格或null、条件数组、观察日期、详情HTTPS及对应证据ID、seed/not_verified/非实时、图片门禁、运费/库存/准备时间等未知项。14条参考价、6条缺价、20条图片rights_status=unverified，image_id/asset_url均null，项目展示/下载门禁均false。此结果与资料自述一致，但来自QA独立遍历断言。只证明文件内部一致及证据片段关联，不证明片段真实性、当下售价、完整授权或商家结算可用。种子扩展schema尚未直接作为v2冻结产品输入，正式映射由后台负责，QA不添加字段。

## 问题与最小复现

### RM-001：ready场景校验未拦截危险图片URL

- 严重程度：高（图像provider接入前需补齐的服务端边界）；责任：后台Agent。
- 被测模块/环境：#61@0346f53 的 `web/server/media/scene.mjs`，离线纯函数。
- 输入：`review_modules.mjs` 的合法scene()，只覆盖 `image.url='javascript:QA'`。
- 预期：provider输出经过服务端形状/来源校验时拒绝非法协议，不能作为ready信封通过。
- 实际：`validateScene`原样返回status=ready，没有抛错，断言“Missing expected exception”。
- 复现：设置QA_BACKEND_ROOT为固定#61副本及QA_RESULTS新路径，运行`node tests/acceptance/retrieval_media/review_modules.mjs`；失败ID `scene-ready-image-url-validation`。
- 证据：`backend-results.json`与`backend.stderr.txt`；被测scene源码快照在sources。
- 影响边界：safe-read独立函数会拒绝该URL，前端也拒绝脚本URL；当前MediaProvider只返回null图，所以**没有证明可执行XSS或公网利用**。但未来真实provider信封验收缺少URL/本地安全托管保证，需后台明确统一入口，不能只靠前端兜底。
- 回归：未修，FAIL；QA不代修实现。

### RM-002：包装图来源文案固定称“非AI生成结果”

- 严重程度：中；责任：前端Agent。
- 被测：#57@dd50fef 的 `packagingMedia`导出函数；最小DOM，不是浏览器截图。
- 输入：`media.contract_version=retrieval-media-v2,status=ready,selected.candidate_id=c1`且匹配selected_candidate_id；image具有version=v2、kind=ai_illustration、alt=AI包装效果示意、本站URL。
- 预期：按信封标识AI图；“摄影开发夹具/非AI生成”仅用于实际开发预览，不写死在正式信封渲染。
- 实际：输出同时包含“AI包装效果示意”和“当前为授权摄影开发夹具，非AI生成结果”。
- 复现：设置QA_FRONTEND_ROOT/QA_WORKFLOW_ROOT/QA_RESULTS及对应SHA，运行`node tests/acceptance/retrieval_media/review_readers.mjs`；ID `frontend-ai-vs-demo-label`。
- 证据：`readers.stderr.txt`包含真实函数输出文本；输入与断言见测试源/JSON。影响：接真实图后标签相互矛盾，不能签发图像真实性标识通过。
- 回归：补齐QA DOM方法后的重跑仍FAIL；第一次基础设施失败未当产品缺陷，原输出保留。

### RM-003：工作流包装与检索提示词落后于后台v2契约

- 严重程度：高（跨线接线阻塞）；责任：工作流Agent，后台单一写者说明v2增量，PM集成。
- 被测：#58@277b71d 的packaging-image/retrieval-plan提示词，与#61@0346f53只读契约比较。
- 输入：后台v2已定义physical、image.version、annotation.image_version/text_style/curve和计划category/keywords/limit。
- 预期：工作流同版消费这些字段；仍可把无真实图片的坐标标为草稿，但不能宣称字段不存在或禁止契约字段。
- 实际：包装词仍写“当前共享product没有专门尺寸/重量/易碎性字段”“不加font/curve/placement_status等字段”；检索词仍说精确计划字段未定义。scene-drafts明确只是草稿，没有伪造ready，此部分不制造业务失败。
- 复现：同readers命令，ID `workflow-v2-prompt-alignment`；sources中的前后版本片段可直接审阅。
- 证据：readers-results、提示词与后台契约快照。影响：真实工作流不能据此认定已支持最终图版本/物理证据/曲线信封，需同版补齐；没有执行真实Dify，因此不宣称真实模型已失败。
- 回归：仍FAIL，待工作流新提交后针对性复核。

## 下一小批与负责人

现在请后台修RM-001、前端修RM-002、工作流对齐RM-003；均在各自原PR更新提交并给出范围。QA取得修复提交后只对对应负例做回归，保留本轮原始失败，不等全部视觉完善。PM提供固定集成SHA后，QA执行同副本专用端口HTTP与浏览器主线，检查预算无需确认、其他输入、AI确认、选择、文本/媒体账单及失败恢复。

包装真实视觉等待PM试验的最终图；后续必须验证完整包装不裁切、礼物比例、小/大/细长圆形/异形/易碎物适配、尺寸未知/单位冲突、道具不误认赠品、最终图片版本与坐标绑定、选前0调用及并发选择真实provider幂等。Seedream API单张成功只是PM提供的连通情况，视觉仍未通过；QA未重复调用、不扩大付费授权。

本批没有新增产品功能、不修改业务、不覆盖历史证据、不调用Dify/真实检索/Seedream、不部署或采购。**下一位：各修复负责人和PM集成；QA等待新的明确SHA开展针对性回归和最终闭环。**
