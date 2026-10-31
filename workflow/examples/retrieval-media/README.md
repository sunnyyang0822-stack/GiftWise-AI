# #59/#60 离线接线准备（待后台契约）

## PR61@7204b64商品引用与选后造景（最新，覆盖旧引用待定义说明）

已读后台最新契约原件：生成输入retrieval_json字符串，输出独立product_references_json字符串，解析值仅[{candidate_id,product_id}]，与原candidates_json分开。每个候选一一对应且product_id不重复，候选name必须等于商品name + " · " + variant，estimated_total原样等于price_amount。缺引用/错型号/改价/未核实条件阻止选择；不足三种不同商品返回RETRIEVAL_INSUFFICIENT，不调用生成提供者。cases.json已按精确信封对齐，未另造引用字段。实际name/金额校验由后台执行，本线oracle仅离线检查。

scene-drafts.json是本线离线编辑/验证文件，不是provider共享信封；其description/known_product/unknowns等外层键不提交业务API。annotations提案仅使用后台已有id/text/target/label结构，默认3–5条自然短句。纯底图、手写感字体/细曲箭头由前端叠加，不加字体或曲线参数到共享接口。

造景围绕同一合格选择，礼物与包装主体、光影环境氛围，不统一套方盒。按已知形状/重量/易碎性与尺寸选纸包/礼袋/圆筒/透明或异形包装；没有依据不猜厘米/承重/材质，不改变型号颜色数量及相对大小。道具不是附送商品。尺寸未知明确比例示意或先澄清。

坐标提案有限0–1只是结构合格，不是定位准确。实际图生成后需核对物体位置/遮挡/标注可读性，当前没有真实图片，不可ready交付；夹具selected=null、unavailable。共享契约暂无最终定位复核信封，建议后台/PM明确未确认说明载体，不自造placement_status字段。计划精确键名、图像provider请求和可信尺寸/重量来源字段仍待后台补充。生图服务选型由产品负责人/PM决定，本轮不查选型、不调用服务。

## PR61对齐更新（覆盖下文开工时的未提交状态）

后台契约已在PR61提交`27670b6fe88b0cffacf0a8fafccdd81f7adc8829`，v1冻结草案，尚未合入release。已通过git show读取原件，不复制或修改后台共享文件。下文“未提交”描述仅为开工时记录。

夹具按v1补齐price_conditions数组、price_range、shipping_status、stock_status、evidence_ref；quantity正整数。price_range按max上端点检查，条件未确认、无价或跨预算不能视为预算通过；不足三项明确partial，不向严格validator送两项。检索不可用unavailable，seed/unknown降级不能冒充browser_observed；观察价非结算保证。媒体固定image/annotations字段、未授权provider返回unavailable、按运行/候选幂等、失败不改修订计数。

仍待后台补充：受限计划精确键名/枚举上限、推荐模型引用输出精确信封、图像provider请求参数、过期窗口及稳定错误路径。契约仅描述允许内容而未给JSON键名，本线不发明接口。图片与核心候选保持sidecar分离。本线oracle不代替后台实现；暂无真实检索/模型/图像/前端联调。

基线3890aa5包含PR55；之前输入任务PR58同分支整理，无提示词双写。开工时后台docs/design/retrieval-media-contract.md不在release，也无对应开放PR。cases.json只用#60草案商品/媒体字段，oracle内部参数不是共享API。计划schema、模型引用schema、错误码和provider接口必须由后台单一写者冻结，本线不发明。

## 待后台实现/PM协调

1. 先识别“需要避免的”→用户确认/澄清→冻结请求→受限检索计划。previous_gifts独立软历史，不自动拼dislikes；历史明确不要重复的确认来源绑定、过敏/尺码缺口结构仍待协调，不忽略。预算无额外确认框。
2. 计划只含品类、通用词、预算和非敏感规格，后台白名单验证并转固定worker调用，不接受任意shell/eval/URL。搜索不携带原文、姓名、关系或过敏详情。后台专用浏览器任务隔离，不能用用户会话；本轮不运行OpenCLI。
3. 标准化retrieval.products，记录规格、数量、读取时间、条件与来源。价格未知不填零；条件不明/过期/跨预算不能声称可购。页面观察价非结算保证。后台schema需明确价格区间和有效期政策。
4. 模型只引用本任务product_id和解释；后台验证绑定并从证据注入核心价格/name/规格，改价拒绝，独立validator照常检查。product_id映射暂以#60media sidecar为准，不在核心三候选追加字段；模型引用输出形状待后台契约。
5. 有效有据商品不足三件走不足/澄清前置分支，不送残缺数组给严格三项validator，不伪造商品、不复制凑数。对应状态/错误路径由后台定义。零元心意的非采购来源路径需PM明确，不伪造0元商品。
6. 三图与SKU/product_id对应且有使用依据；优先真实来源图，白底完整清晰摄影为风格，商品可有颜色。AI示意/demo标清，图片不是价格/成分安全证据；无图null，不伪造地址。
7. 服务端确认同任务合格选择后才调用包装图provider，保持同一礼物外观/配色，不增加新礼物或虚构规格。支持参考图及实际一致性待实测；不支持时如实降级。图片失败保留文本/失败状态，不重置修订，不自动付费重试。幂等、任务ID、能力/异常信封待后台契约。
8. 底图不画中文，sidecar.annotations沿用id/text/target/label有限0–1坐标，简短风格/色调/贺卡位置，提供alt及文字等价。固定坐标不是实际视觉定位证据，真实图像后需QA桌面/窄屏/缩放复核。包装不报价，不计预算不等于免费。

## 验证边界

verify.py固定seed/null图片检查ID/改价/未知价/不足/错误归属/坐标结构并实际调用validator；价格绑定是测试oracle，不是后台实际拦截。选前selected=null、图像失败保留文本均是固定状态断言，不能证明真实provider调度。注入字符串未执行不证明模型免疫注入。真实检索、来源权利、图片生成/外观一致、前端联调、token/延迟/成本全部未执行。

提示词文件：retrieval-plan.md、evidence-recommendation.md、packaging-image.md；旧generate/repair/presentation区分估价与证据模式。不改后台共享契约、服务端、前端、validator/intake或generated；PR58此前输入增量保留并单独标出，不把其Python支持视为端到端支持。
