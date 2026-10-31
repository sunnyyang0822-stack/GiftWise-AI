# 检索与媒体共享契约 v2

状态：接口冻结草案，供 #59/#60 并行实施；不代表真实检索已完成。兼容 giftwise-20261031-v2，不改变严格候选 JSON。后台为唯一写者；字段变更须在 PR 明确通知 PM。

## 响应 sidecar

推荐响应保留已有全部字段，另加以下两个同级字段：

```json
{"retrieval":{"status":"unavailable","evidence_id":null,"products":[],"warnings":["后台浏览器未连接"]},"media":{"status":"unavailable","candidates":[],"selected":null}}
```

retrieval.status = ready / partial / unavailable；evidence_id 为服务端任务证据标识或 null。products 每项固定包含 product_id、name、variant、quantity（正整数）、price_amount（十进制字符串或 null）、currency（CNY）、price_conditions（字符串数组）、price_source（browser_observed / user_provided / seed / unknown）、source_url（HTTPS 或 null）、observed_at（ISO 时间或 null）、image_id（字符串或 null）。另含 price_range（null 或 {min,max} 金额字符串）、shipping_status、stock_status（默认 unknown）、evidence_ref（字符串或 null）。未知价格必须 null，绝不填 0。种子标记“估算·非实时价格”，详情观察价标记“页面观察价·读取时间”。business_data_verification 保持 not_verified。

media.status = pending / ready / failed / unavailable。candidates 每项为 {candidate_id,product_id,image}，image 可为 null；selected 为 null 或 {candidate_id,image,annotations}。
image = {id,url,kind,alt,source_url,attribution}；kind = source_photo / ai_illustration / demo。AI 图必须标“AI效果示意，非商品实拍”；demo 不代表对应商品。source_photo 须核对规格、来源和使用依据；attribution 保存依据，不能把公开可见当转载授权。缺图返回 null，不造地址。
annotations = [{id,text,target:{x,y},label:{x,y}}]；坐标必须有限且在 0–1，text 为纯中文说明并提供文字等价。前端叠加箭头，不内联远程 SVG/HTML。

## 可信绑定与门禁

服务端按运行保存 product_id→规格→价格证据→candidate_id，不接受模型改价。过期、未知或错任务 ID 拒绝；条件未确认、无价格、区间跨预算均不能声称预算已核实。范围按上端点检查，不足三项返回 partial 并解释，不凑商品。搜索摘要不是详情报价。

只接受受限结构化品类、非敏感关键词、数量和预算；禁止任意 shell/eval/URL 执行接口。单 worker 串行、有界队列、超时、取消、任务清理。失败返回 unavailable，可明确降级 seed/unknown，不能伪造 browser_observed。

包装图仅在服务端已保存用户选择且该候选检查通过后请求；按运行及候选幂等。图片失败不阻塞文本，不改变全局一次修订计数。未确定生成 provider 或未授权费用时返回 unavailable，不调用付费服务。包装不报价。

远程媒体仅允许服务端配置的 HTTPS 域名；每次解析和重定向均阻止内网/保留地址，限制重定向数、超时、字节和栅格 MIME；校验实际内容，不执行 SVG/HTML。浏览器桥接仅本机，使用专用配置，不接个人会话、不输出 Cookie/令牌。

## 实施状态

此提交只冻结结构。真实浏览器搜索、商品详情读取、provider、安全下载及业务接线均待实现与独立 QA；不可用夹具结果证明真实检索成功。

## 生成提供者增量（PR #61 明示给 PM）

仅启用真实检索时，生成调用新增 retrieval_json 字符串输入；提供者须返回独立 product_references_json 字符串，值为 [{candidate_id,product_id}]，不修改严格 candidates_json。引用须与每个候选一一对应且商品ID不重复，候选name须等于服务端商品name + " · " + variant；estimated_total须原样匹配证据价格。引用缺失、不匹配或条件未核实均阻止选择。检索不足三种不同商品时不调用生成提供者，返回 RETRIEVAL_INSUFFICIENT。工作流需按此增量适配，未真实联调。

## #60 完整造景增量（2026-10-31，覆盖旧选后白底描述）

本节由后台唯一写者维护。只扩展sidecar，不改严格候选、预算、选择事件或全局修订次数。推荐商品图以白底/近白底摄影风格为目标，真实性优先；无法核实使用权或SKU则image=null。选后图为完整赠礼造景，不要求白底，主体为所选礼物与适配包装；不得替换型号、颜色、数量或制造比例保证。底图不得烧录批注文字。场景道具不自动成为赠送清单，包装/道具未报价不代表免费。

### 物理证据

product增量physical，selected也保存同一服务端快照。physical固定为dimensions、shape、weight、fragility、materials五项。每项为 `{status,value,unit,sources:[]}`：

- status = known / unknown / conflicting / suggested。unknown的value/unit为null、sources=[]；conflicting的value/unit为null，sources至少两条且说明冲突；不得挑一个值冒充确定值。
- dimensions.value 为 `{length?:number,width?:number,height?:number,diameter?:number}`，至少一项，各值有限且>0；unit=mm/cm/m。shape.value为简短文字，unit=null。weight.value为有限正数，unit=g/kg。fragility.value=fragile/not_fragile，unit=null。materials.value为字符串数组，unit=null。不能仅凭图片判定易碎性/材质安全。
- sources每项 `{kind,source_url,evidence_ref,observed_at,value,unit}`，kind=browser_observed/user_provided/model_suggestion；浏览器来源需详情URL、证据引用及ISO读取时间；用户来源需服务端确认引用，不向外输出私人原话。known只允许实际来源；model_suggestion仅可用于suggested，不能用于礼物实测属性。建议尺寸属于包装建议，不回写礼物实测尺寸。
- 缺失物理信息统一unknown，不补造精确数值。尺寸单位不一致或来源冲突交澄清/显式示意；没有证明时不能承诺装得下或运输安全。

### 选后响应

media新增contract_version=`retrieval-media-v2`（读取方同时接受旧无版本文本响应）。未选择时selected=null；已选且检查通过，即使图像provider不可用也可返回selected元数据，image=null、annotations=[]，不能伪装生成成功：

```json
{"contract_version":"retrieval-media-v2","status":"unavailable","candidates":[],"selected":{"task_id":"服务端生成且同run/candidate稳定","status":"unavailable","candidate_id":"c1","product_id":null,"image":null,"physical":{"dimensions":{"status":"unknown","value":null,"unit":null,"sources":[]},"shape":{"status":"unknown","value":null,"unit":null,"sources":[]},"weight":{"status":"unknown","value":null,"unit":null,"sources":[]},"fragility":{"status":"unknown","value":null,"unit":null,"sources":[]},"materials":{"status":"unknown","value":null,"unit":null,"sources":[]}},"packaging":{"form":"undetermined","description":null,"scale":{"status":"illustrative","note":"尺寸未知，仅示意；不保证容纳或运输安全"}},"scene":{"description":null,"props":[],"props_are_included":false,"text_baked_in":false},"annotations":[],"unknowns":["图像生成服务及费用未授权"]}}
```

packaging.form = gift_bag / paper_wrap / cylinder / bouquet / transparent_display / irregular / combination / undetermined，不统一默认方盒。description描述如何适配已知形状，不能给出无证据的精确包装尺寸。scale.status=evidence_based/illustrative/needs_input；note必填，缺尺寸必须illustrative或needs_input，evidence_based不等于可生产图纸/结构安全证明。scene.description为场景构图、光影背景的纯文本；props为仅作造景的文字数组，props_are_included固定false，text_baked_in固定false。

有图时image新增version（服务端不可变版本/内容指纹），kind固定ai_illustration、alt含“AI包装效果示意”。provider不支持可信参考图时不能声称外观一致。图片url不直接指向未经安全读取的远程内容。

annotations每项保留id/text/target/label，新增image_version、text_style（handwritten）、curve（null或{control_points:[{x,y}]}，1点二次曲线/2点三次曲线）。label即文字锚点，target即实际画面目标点，全部坐标相对于最终底图归一化，有限且0–1；文字默认3–5处，最多5处，每条最多30码点、纯文本。无合适许可字体时优先中文清晰；字体自托管由前端负责。每条image_version必须等于image.version；image=null时annotations必须空。换图须丢弃全部旧坐标并重新校准，禁止直接复用。前端完整显示图片、维持原始宽高比，窄屏可缩放/点按或重排文字，不能裁掉异形包装；重排文字锚点不改变目标点，文字等价取annotations.text和scene/packaging描述。

pending/failed/unavailable均保留明确状态；任务按run对象与candidate幂等，失败不触发付费重试、不影响已有文本和业务修订计数。provider输出需经服务器形状、来源、版本与坐标校验；有图不代表包装可执行或运输安全。

### 同版协作门禁

PM/工作流 #58：消费physical与unknowns，提出适配包装形式/场景/短句，不能把模型尺寸变成实测；按本节输出夹具意见，不修改本文件。
前端 #57：支持selected非空但image=null、版本绑定、完整造景图及曲线叠加；保留AI标识与来源、文字等价、授权字体。
QA #62：独立覆盖尺寸未知/单位冲突、细长/圆形/不规则/大件/易碎、图物不符、道具误认、禁忌、窄屏裁切及换图旧坐标。后台受控测试不证明真实生成或前端定位通过。

## 受限检索计划与会话归属（精确schema）

内部计划固定 `{category,keywords,limit}`，拒绝其他键；category=books/stationery/home/maker，keywords为0–3个、每个1–30码点的字母/汉字/数字/空格字符串；limit为1–3整数。来源适配器只实现maker；其他类别返回unavailable。首版服务端仅在tech_digital为confirmed时规划maker，固定公开检索词kit，不把用户/模型自由文字、关系、原始备注或过敏详情外发。预算取冻结request，不放进可改写计划；不足三个不同且无条件、已知且不超预算商品时前置澄清，不消耗模型或业务修订。未实现类别不假称可用。

配置GIFTWISE_RETRIEVAL=dfrobot-public、OPENCLI_PACKAGE_ROOT指向已安装2.0.2目录。每个任务启动专用临时Chrome配置/随机回环CDP端口并清理，不连接维护者浏览器。固定HTTPS来源www.dfrobot.com.cn，详情URL必须来自实际搜索结果且符合goods数字路径，回到实际详情后读取h1/SKU/默认单套/专门价格元素；不使用搜索摘要填价。以固定公共DNS HTTPS解析并核实公有IPv4后绑定浏览器解析，网络拦截拒绝外域/内网目标及图片下载；不读取Cookie/密钥。图片使用依据缺失返回null。来源规则核查与运行限制见本线交付报告，不将robots放行等同于转载许可。

来源物理sources可附context纯文本（≤200码点），说明组装后尺寸/包装尺寸等测量对象；组装尺寸不能当成寄送包装尺寸。任务证据有效期随运行快照10分钟，生成引用校验拒绝过期/未来异常时间；process重启明确失效。HttpOnly/SameSite会话签名cookie用于隔离匿名任务，不是账号认证；相同输入不同会话不共享run。模型/浏览器不得指定owner。断开请求取消等待检索；超时/取消后worker停用需服务端重启，防未退出任务串用。服务器端口不开放任意浏览器接口。

同版生成输入retrieval_json、输出product_references_json精确协议已在上节给定；工作流当前PR58仍旧v1占位，后台不修改工作流文件，需按v2契约更新。受控提供者测试仅证明服务器同版协议，不证明真实Dify版本支持新增变量。真实图像服务仍未配置/授权，返回unavailable及选后元数据，不调用收费服务。
