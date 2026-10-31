# GiftWise 人工商品参考表

服务 Issue [#59](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/59)、[#60](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/60)。本目录仅含人工整理的研究数据，尚未接入网站或后台。

- 数据：[catalog.json](catalog.json)，20个具体销售单位，金额为CNY十进制字符串；未知为null。
- 来源与方法：[调研说明](../../docs/research/seed-catalog/README.md)、[逐条索引](../../docs/research/seed-catalog/source-index.md)。
- 不代表实时售价、库存、送达或可购买性，统一 `price_source=seed`、`non_realtime=true`、`business_data_verification=not_verified`。
- 14条有参考价，6条价格未知；20条图片授权均待核实，没有可下载或展示的商品图。不要自动加载图片来源页面作为图片。
- 主价格以quantity个销售单位合计，内装件数在variant中；两只装不能当单只价。会员条件价单列conditional_quotes，不覆盖主金额。
- product_id永久绑定来源型号、规格与销售单位；不能复用给不同型号、规格或数量。Apple两条未取得商家SKU，尤其AirTag须重新核对代际，详情换代后停用旧ID。
- observed_at/fetched_at记录本次开始查看工具页面提取的时间，**不是商家原始刷新时间**。工具可能返回缓存；上游刷新时间未知。证据中保留缓存提示，不重置为实时核价。
- 所有库存、运费、准备天数均保持unknown/null；部分宜家详情出现缺货提示，另存stock_observation。不能据此证明任何地区可买。
- 图片只记录官方来源页面URL；asset_url/image_id均为空，授权待核实，不下载、不热链、不生成包装参考图。
- 标签是整理者按商品功能/题材归类，不是收礼人偏好事实；不按关系、性别、年龄断言喜欢。恋人/追求对象/朋友均须结合用户已知兴趣与表达分寸。
- 材料仅按详情部分信息记录；配方、过敏原未知，不推断安全。配件另购价格未核实，不能把裸件参考价视为完整可用配置总价。

字段与后台PR #61的对应建议见调研说明；由PM/后台单一写者确认，本表不修改共享契约。不得把本JSON整个对象直接塞入严格候选JSON。
