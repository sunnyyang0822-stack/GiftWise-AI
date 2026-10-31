# API交接：冻结版 eceef056

代码SHA：`eceef056ce80399b83c61f62860a32d0ead16e3d`。Issue #122资料准备，不代表部署、合main或用户走查放行。

标记约定：**【实测=源码核查】**只表示本单实际读取冻结源码，不表示调用接口；**【推算】**为代码推导；**【未测】**为未运行验证。本单不跑测试/HTTP/供应商/浏览器，不读实际.env。配套JSON均为既有虚构fixture派生的静态局部结构，不是成功调用记录。

## 核心路由【实测=源码核查】

| 方法/路径 | 请求 | 响应与关键错误 | 冻结代码 |
|---|---|---|---|
| GET `/api/config` | 无必填；可选`x-giftwise-code-revision`用于版本提示 | 200：mode、llm_configured、services、labels、ranges、limits、client_timeout_ms、intake_parse、attestation。configured不代表已联通 | [server:353][config-route] |
| GET `/healthz` | 无 | 200：status=ok、mode、runs、attestation；200不能证明模型、图像或检索可用 | [server:357][health] |
| POST `/api/intake/parse` | `text`或`natural_language`；当前表单`form`，兼容`intake`别名 | 200：ready/needs_input/empty/degraded/disabled；含intake、intake_validation、parse、llm、reason_code、notices。解析失败可回落表单 | [server:500][parse] |
| POST `/api/intake/validate` | `intake` | 200：ready/needs_input、errors、derived_hint；不返回request_json。非空dislikes仍提示先识别，当前前端直接走analyze→recommend | [server:465][validate] |
| POST `/api/exclusions/analyze` | `intake`；续答增加`continuation:{analysis_id,answer}` | 200但业务status可ready/needs_confirmation/needs_input/error；见下文 | [server:483][analyze] |
| POST `/api/recommendations` | `intake`；可选text/natural_language、`exclusion_confirmation:{analysis_id,confirmed_ids}`；demo为兼容测试参数，生产客户端不发送 | 200 report；400输入/确认失败或RECOMMENDATION_INCOMPLETE；503模型/基础设施失败。report用recommendation_run_id；失败可用run_id | [server:522][recommend] |
| POST `/api/presentations` | `recommendation_run_id`、`selected_candidate_id`；demo为兼容测试参数 | 200 completed文字，media可pending；400选择拒绝；404非owner/失效run；409 presentation_failed；503模型失败 | [server:602][present] |
| GET `/api/runs/{run_id}` | 同一会话的run_id | 200最小快照：状态、选中/可选ID、修订计数、call_counts、retrieval/media；404 RECOMMENDATION_NOT_FOUND | [server:423][run] |
| GET `/api/media/tasks/{task_id}` | 64位小写hex，同owner/run/当前选中候选 | 200媒体对象，status=pending/ready/failed/unavailable；404 MEDIA_NOT_FOUND；只读，不重新生图 | [server:411][media] |
| GET `/api/media/assets/{task_id}` | **使用task_id，不是图片文件hash**；同会话且任务ready | 200图片字节；private,no-store、nosniff/CSP；未就绪/失效/非owner均404 | [server:411][media] |

## 原始intake【实测=源码核查】

仅允许：`recipient_relation, recipient_relation_custom, closeness, occasion, occasion_custom, budget_amount, currency, deadline_days, interests, interest_confidence, gift_styles, hard_exclusions, additional_context, contract_version, budget_mode, budget_range, dislikes, previous_gifts`。[字段白名单与必填项][intake]

- 关系/场合必填，合法ID从config.labels取；other需对应自定义文本，非other不能带旧custom。closeness可未知。
- 新预算契约为`contract_version=giftwise-20261031-v2`、`budget_mode=slider/zero/other`、`budget_range:{min,max}`。若另给budget_amount，其数值必须等于max；未给可由max派生。旧契约需要budget_amount。金额是非负十进制字符串，0合法，上限10000，currency=CNY。区间min≤max；slider两端≤1000且步长50，zero两端必须0。[预算区间校验][budget-range]
- deadline_days可省略/null/不确定；内部available_days可null，不补0/365假期限。时间不参与推荐/呈现可选性。
- 兴趣/风格用合法ID数组；未知用[]，interest_confidence仅confirmed/inferred。语气限制保留原话，不强塞字面禁词。
- hard_exclusions为tags/terms/unresolved；真实必要禁忌仍检查，未澄清限制不能静默丢弃。
- 浏览器不得提交facts、available_days、passed、repair_count、exclusion_context等派生字段。
- 外层JSON对象上限262144字节，超限会destroy连接，不能保证400正文完整；内部intake/request/candidates各32768字节，一般文本1000码点、数组20项、候选3项。[外层读取][body]、[限制常量][limits]

## 澄清与确认【实测=源码核查】

没有独立`/exclusions/clarify`或`/exclusions/confirm`端点：

1. 首次analyze传原intake；ready且无具体候选/问题、confirmation_required=false时直接继续。推荐仍传`exclusion_confirmation:{analysis_id,confirmed_ids:[]}`，这是语义引用，不是假造用户勾选。
2. 具体禁品needs_confirmation，只确认candidates的全部唯一ID；语义解释保留而不成为substring禁词。
3. 真正歧义needs_input时显示`clarification_questions:[{source_span,question}]`；同owner、相同原表单用continuation接续，回答累计，不替换原话。每答≤1000码点、最多10轮。
4. provider/协议失败返回error，保留旧有效analysis_id与问题；客户端保留未送达回答以原ID重试。EXCLUSION_ANALYSIS_STALE表示跨owner、过期或表单变了；EXCLUSION_CONTINUATION_INVALID表示续答不合法。

正常分析另含semantic_constraints、confirmation_required、unmapped_notes、errors、intake_fingerprint；初始intake非法时响应字段可较少。[分析服务][analysis-service]

内部`request.exclusion_context={original,semantic_constraints,clarifications}`仅服务端派生，冻结给推荐与呈现。interpretation/confidence是模型理解；原话和用户修正优先，不回填用户可编辑notes/dislikes。[派生与提示词][context]

## 推荐与指南消费【实测=源码核查】

- report有request/candidates/validation/workflow_errors/selectable_candidate_ids/repair_count/remaining_repairs/notices/call_counts，以及retrieval/media/catalog/delivery/visual_direction/uniqueness/nl_parse等sidecar。只选服务器返回的selectable_candidate_ids。[report][report]
- 当前代码要求完成三个可选候选，否则可返回400 RECOMMENDATION_INCOMPLETE；真实文字资料不足可能RETRIEVAL_NO_MATERIAL。不能把旧愿景或fixture三条写成本版一定成功。[候选完整性][complete]、[资料门槛][grounding]
- 指南含sections、presentation_json、presentation_check、recheck_summary、selected_candidate_id及media。按实际非空sections展示，不按关键词补体验包装章。文字返回不等图，media_wait.waited=false。[选后响应][presentation-view]、[异步媒体][async]
- 推荐页已取消网图，文字素材检索保留，选后AI图仍独立异步。不要启动旧推荐图轮询作为新主链必需条件。[冻结实现][text-only]

## 保留的历史能力索引【实测=源码核查】

| 方法/路径 | 参数与行为 | 代码 |
|---|---|---|
| GET `/api/catalog` | keyword/source/since/only_cny=1/limit（默认50）；返回目录或明确空态，不是新推荐必须有SKU的前提 | [365][catalog] |
| GET `/api/catalog/images/{image_id}` | 32–64位hex、库内允许源图片；200字节或404 CATALOG_IMAGE_NOT_FOUND | [391][catalog-image] |
| GET `/api/reference/images/{image_id}` | 32–64位hex，读取既有核验缓存；200或404 REFERENCE_IMAGE_NOT_FOUND；非新推荐主链 | [383][reference] |
| GET `/api/style-boards/{sha}.{ext}` | 64位hash文件名，读取函数另校验；200或404 STYLE_BOARD_NOT_FOUND；GET不触发生图 | [400][style] |
| GET/HEAD `/`及public静态路径 | 静态200/404/403；未知API非POST方法通常405，未知POST在读取JSON后404。无额外取消/重试生图路由 | [静态入口][static] |

这些历史图片分支没有run/owner授权检查；缓存ID不是私有会话授权。media task/asset的owner规则不能直接套到历史文件路由。[读取分支][reference]

## 错误速查与未测

【实测=源码核查】常见错误：INVALID_JSON/LIMIT_EXCEEDED、INTAKE_UNKNOWN_FIELD/INTAKE_CLARIFICATION_REQUIRED、INVALID_AMOUNT/BUDGET_RANGE_MISMATCH、EXCLUSION_ANALYSIS_STALE/EXCLUSION_PROVIDER_FAILED、AI_OUTPUT_INVALID/AI_OUTPUT_UNANCHORED、LLM_TIMEOUT/LLM_HTTP/LLM_OUTPUT_INVALID/LLM_BUDGET_EXHAUSTED、INVALID_SELECTION/CANDIDATE_NOT_PASSED/PRESENTATION_INVALID/REPAIR_LIMIT_REACHED、MEDIA_NOT_FOUND及媒体对象内IMAGE_*。不是穷举，不能把未知code当成功。[模型错误表][errors]

【未测】本单不实跑API，`api-examples.json`仅为静态结构。独立同版QA见PM待发布`qa-d/`；代码SHA与材料提交SHA分别记录，不能把历史不同SHA结果当本版成功。

[config-route]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L353
[health]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L357
[parse]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L500
[validate]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L465
[analyze]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L483
[recommend]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L522
[present]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L602
[run]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L423
[media]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L411
[intake]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/intake.mjs#L22
[body]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L107
[limits]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/config.mjs#L229
[analysis-service]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/exclusion-service.mjs#L15
[context]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/prompt.mjs#L145
[budget-range]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/checker.mjs#L317
[report]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/store.mjs#L96
[complete]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/pipeline.mjs#L629
[grounding]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/provider.mjs#L317
[presentation-view]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/pipeline.mjs#L672
[async]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/pipeline.mjs#L980
[text-only]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/pipeline.mjs#L632
[catalog]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L365
[catalog-image]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L391
[reference]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L383
[style]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L400
[static]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/server.mjs#L635
[errors]: https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/eceef056ce80399b83c61f62860a32d0ead16e3d/web/server/llm/errors.mjs#L13
