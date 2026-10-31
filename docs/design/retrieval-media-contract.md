# 检索与媒体共享契约 v1

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
