# 商品参考资料整理报告（Issue #59 / #60）

本批仅做公开资料阅读与人工数据整理。分支 `codex/seed-catalog-59-60`，目标 `release/2026-11-01-submission`；基线 `3890aa57a2c728d3bd94fea00b9117f9d0a8aa93`。不合并、不部署、不接网站，不消耗付费模型或图像额度，没有安装新工具。

## 实际结果

2026-10-31 北京时间13:16:45—13:18:21开始分批查看官方详情，完成时间上界见evidence.json。共20条：宜家10、Apple4、乐高6，均实际打开商品详情，不用搜索摘要充当报价。14条有CNY参考价，6条未知，缺价格比例30%。有价记录为9.99—1099.00元；这是本批记录的最小/最大观察值，**不是任何商品的价格区间**，各条price_range均为空。

图片使用授权未确认20/20（100%），可交付授权商品图0张；图片文件直链、分辨率、白底外观及SKU一致性均未视觉验收。没有下载或复制图片。所有20条的实际运费、地区库存、准备时间和送达时间未核实。10条宜家提取页面显示缺货，地区未选择，保留提示但stock_status仍为unknown。数据可支持参考价/缺价/条件价/缺图开发验证，不能充当可购买商品池或已完成的后台实时检索。

数据文件：[catalog.json](../../../research/seed-catalog/catalog.json)；来源索引：[source-index.md](source-index.md)；必要原始片段：[evidence.json](evidence.json)。evidence_ref的井号后为该文件records[].evidence_id，按ID查找，非HTML锚点。原始片段是工具返回文本的短选段，不是HTML或完整页面。没有保留整段商品文案、账号数据或个人信息。

## 整理方法

先读AGENTS.md、Issue #1/#59/#60、产品需求、开发流程、docs/product-data-research.md及既有docs/research价格报告/证据索引。Issue #1最新正文的增量定位优先于旧PRD；本表只记录礼物销售单位价格，不为包装报价，也不将运费未知改为免费。

通过搜索发现URL后逐一打开品牌官方中国大陆商品详情，以型号/货号、颜色、尺寸/容量、套装数量绑定价格。读取方法是现有web工具的公开页面文本提取，**没有驱动OpenCLI或浏览器，也没有证明服务端浏览器连接成功**。工具有缓存，本次时间只表示查看提取结果；evidence.json保留每页Crawled提示（从today到数月前不等），不把它当可验证的上游时间戳。upstream_fetched_at=null；不承诺这些值是商家在查看时仍有效的报价。

金额没有基于预算调整，没有自行填区间或换汇。价格缺失保留null，不以组件数、月供、最低价或摘要代替。未登录、未加购、未结算，没有核实个人会员资格、优惠叠加或配送地区。所有有价记录仍是非实时参考价，不宣称预算已核实。

标签依据商品用途/外形题材整理，basis注明归类理由。它们不映射到收礼人事实，后续使用须结合已确认/推断兴趣；本批没有任何真实人物案例。玫瑰等表达较强的题材不自动用于追求关系；不假设双向好感。MÅLA为白板用品且有儿童握持设计，不能当专业美术套装或按年龄默认推荐。

## 发现的差异与失败

- SMÖRFISK 706.121.10：主金额为非会员两只装69.99元；单独保存会员两只装39.99元及2026-10-14—2026-11-11有效期。未将39.99元当普通价，也不拆成单只价。
- HomePod详情URL实际返回HomePod mini 2，白色1099元；搜索摘要的旧款999元未采用。型号改变时不能保留旧产品ID。
- VATTENKRASSE本条为350mL喷雾款79.99元，不套用同系列0.9L壶的价格。
- 樱花40725同页头部430块、正文438块矛盾；未择一断言，variant及未核实项保留冲突。
- VIVALLA材质摘要与打开详情存在差异，只按打开详情部分记录，不补齐未知层材。
- FADO不含灯泡；VAPPEBY不含USB-C线/适配器；另购项目未核价。裸件价格不等于完整使用配置费用。
- 乐高6条详情均未返回人民币报价，保持未知；购物袋按钮不是价格或库存证据。
- 迪卡侬 `https://www.decathlon.com.cn/product-detail?dsm_code=106491` 打开只返回导航/页脚，未取得具体身份与规格，未入表；不能以摘要补齐。
- 尝试 `https://www.lego.com/zh-cn/product/bonsai-tree-10281` 返回404，未入表、未推断停产。
- 宜家杯具分类页首次超时，商品仍逐条通过详情核对。GitHub网页读取#59/#60失败，随后用既有gh读取正文成功。网络错误不是登录限制；本轮没有遇到验证码或登录墙，也没有绕过任何限制。

## 图片依据

每条image.source_url为**商品图片所在官方页面的定位入口**，不是可直接展示的图片文件。未取得图集直链、没有下载或热链图片。project_download_allowed/project_display_allowed=false是本项目当前使用门禁，不是对权利人授权范围作法律结论；download_permission/display_permission=unknown才是授权证据状态。也没有把示意图标为实拍。

已阅读以下权利说明，但未确认GiftWise用途满足许可范围：

- [宜家使用条款](https://www.ikea.cn/cn/zh/customer-service/terms-conditions/)：已打开；未取得逐商品图可转载到GiftWise的授权凭据，待维护者确认。
- [Apple第三方商标与版权指引](https://www.apple.com.cn/legal/intellectual-property/guidelinesfor3rdparties.html)：指引按许可身份和用途区分，不能据此推定本项目已获商品图片授权。
- [乐高公平竞争说明](https://www.lego.com/zh-cn/legal/notices-and-policies/fair-play/)：包含特定非商业信息交流场景的条件，不将其扩展成GiftWise推荐页面、改图或包装生成的普遍授权。

本轮未取得与这些SKU相符、同时有明确授权且经白底高清验收的替代图片。授权通用素材可后续单独整理为demo，必须说明不对应SKU；本次不交付或冒充可用素材。不下载用户截图，不生成收费图片。

## 字段映射建议（交PM/后台单一写者确认）

基线来源为[PR #61](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/61)的docs/design/retrieval-media-contract.md，2026-10-31读取公开分支内容；release基线尚无该文件。这里只提出适配意见，不改变其冻结草案。PR后续提交可能变化。

| 本表字段 | 建议映射/语义 |
| --- | --- |
| product_id/name/variant/quantity | 对应products同名字段；quantity按销售单位计，套装内件数保留variant，不能二次相乘 |
| price_amount/currency/price_range | 对应同名字段；主金额为quantity销售单位合计；null不得转0 |
| price_source | 一律seed，不得映射browser_observed；读取公开提取不等于后台浏览器实测 |
| price_conditions | 同名字符串数组；资格及结算未核实必须传递；conditional_quotes不自动取最低价 |
| source_url/observed_at | 同名字段；必须同时披露非实时和工具缓存边界，不能当商家实时刷新时间 |
| shipping_status/stock_status/evidence_ref | 对应同名字段；保留unknown及证据；stock_observation只是研究补充 |
| image_id | 保持null；授权和规格未核实前media图片为null或unavailable，source_url不充作image.url |
| materials/tags/image/unverified_items | 本地研究扩展，供人工检查；不擅自加到严格候选或冻结产品对象 |
| preparation_days/shipping_amount | 未知为null；不映射成0天、包邮或免费 |
| business_data_verification | 恒not_verified；独立规则通过不代表商品已核实 |

不自动构造三候选，不生成包装内容，不改全局一次业务修订；不足有据商品应由后台按契约返回不足。价格新鲜度、允许标签映射、种子准入及缺价记录如何参与召回，均由PM/后台确认。没有提供实时有效期策略或expires_at来伪造商家承诺。

## 未覆盖与复核

本批偏向家居、饮用器具、数码、音乐和拼搭/艺术/植物题材，没有运动装备、食品、护肤、服饰尺码、体验票务和大范围品牌覆盖。乐高比例较高且全部缺价，不代表市场分布。价格未知的6条可用于失败/不确定状态验证，不是预算通过的正例；14条有价同样需要披露条件及缓存风险。

本任务自查只检查资料结构、金额、ID和证据关联，以及修改范围；**不是独立QA、不是20条商家结算页复核、不是网站回归**。PM/独立测试仍需抽查来源、SKU绑定、条件价隔离和图片门禁。实际命令与结果另见[validation.md](validation.md)。
