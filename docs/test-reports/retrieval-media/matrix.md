# 独立验收矩阵（测试准备，未执行业务）

输入/步骤是QA场景描述；API映射以正式后台契约为准。全部待PM锁定SHA后执行。

| ID | 场景 | 输入或步骤 | 预期 | 主层次 | 待对齐 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | 后台已连接 | {"browser": "connected", "query": "白底笔记本 CNY 200"} | 记录专用浏览器实际检索/详情与时间，不能只看doctor成功 | real_retrieval | 执行前映射契约 | BLOCKED |
| R-02 | 后台未连接 | {"browser": "disconnected"} | 明确unavailable或契约定义失败；不伪造browser_observed，不阻塞已有文本降级 | controlled | 执行前映射契约 | BLOCKED |
| R-03 | 超时 | {"provider": "never_resolves"} | 按交付超时终止/隔离；后续任务不与遗留执行并发；无成功商品 | controlled | A01 | BLOCKED |
| R-04 | 验证码 | {"page": "captcha"} | 停止检索、明确维护者处理；不绕过、不让用户提供个人Cookie | controlled | 执行前映射契约 | BLOCKED |
| R-05 | 访问限制 | {"page": "403/429/登录限制"} | 如实失败/受限；不把空提取当成功、不自动绕过 | controlled | 执行前映射契约 | BLOCKED |
| R-06 | 无插件普通用户 | {"profile": "全新普通浏览器，无扩展"} | 仅网站可完成提交，用户不安装插件，不读取用户浏览器会话 | browser | 执行前映射契约 | BLOCKED |
| R-07 | 不弹搜索窗口 | {"observe": "window.open/新target/网络"} | 只访问业务API；用户无搜索新窗口或直连桥接/调试端口 | browser | 执行前映射契约 | BLOCKED |
| R-08 | 检索词最小披露 | {"fixture": "private_input"} | 捕获worker发出的真实查询，仅必要品类/预算/非敏感偏好；所有私密哨兵及完整原文均不外发 | controlled | 执行前映射契约 | BLOCKED |
| R-09 | 双任务隔离 | {"tasks": ["A-红色笔记本", "B-蓝色水杯"], "sequence": "A慢、B随后、轮询交错"} | A/B商品、证据、图片和状态均不串用；ID不能跨任务引用 | http | A01 | BLOCKED |
| R-10 | 队列满 | {"occupy": "worker+恰好Q个等待，再提交1个"} | 边界前接纳、边界后明确拒绝/排队状态；不静默丢任务 | http | A01 | BLOCKED |
| R-11 | 取消等待任务 | {"cancel": "queued task then release active"} | 取消后不启动provider，状态明确且可查 | http | A01 | BLOCKED |
| R-12 | 取消运行任务 | {"cancel": "running then late callback"} | 不接受迟到结果、不污染新任务；重复取消有明确结果 | http | A01 | BLOCKED |
| R-13 | 拒绝shell和脚本 | {"fixture": "unsafe_search"} | 仅允许结构化受限参数；拒绝shell/eval/script/命令拼接，provider调用数=0 | controlled | 执行前映射契约 | BLOCKED |
| R-14 | 拒绝内网URL | {"fixture": "unsafe_urls"} | 协议/DNS/IP/重定向每跳检查；内网/回环/元数据均拒绝，无探测真实内网 | controlled | 执行前映射契约 | BLOCKED |
| R-15 | 公共下载限制 | {"fixture": "unsafe_media"} | 默认不执行SVG/HTML；拒绝超大、伪MIME、签名错、超时；不向前端暴露Key/调试端口 | controlled | 执行前映射契约 | BLOCKED |
| P-01 | SKU规格数量来源绑定 | {"products": ["p-notebook", "p-cup", "p-book"], "mutations": ["换SKU", "换规格", "数量1改2", "换来源证据"]} | 逐项匹配来源记录；不匹配引用拒绝，不能只看同名商品 | controlled | 执行前映射契约 | BLOCKED |
| P-02 | 普通价 | {"fixture": "ordinary"} | 只用对应规格数量的普通价并显示观察时间/来源；不承诺结算价 | controlled | 执行前映射契约 | BLOCKED |
| P-03 | 会员价 | {"fixture": "member"} | 无会员条件确认不能把会员价当所有用户可购买价；条件明确可见 | controlled | A02 | BLOCKED |
| P-04 | 券价 | {"fixture": "coupon"} | 不自动假定用户有券或券仍有效；条件不明不可标预算已核实 | controlled | A02 | BLOCKED |
| P-05 | 多件价 | {"fixture": "multi"} | 数量和门槛一致；两件总价不能误用作单件价/反之 | controlled | A02 | BLOCKED |
| P-06 | 无价格 | {"fixture": "no_price"} | price_amount=null、未知价；不填0、不标预算已核实通过 | controlled | 执行前映射契约 | BLOCKED |
| P-07 | 区间跨预算 | {"fixture": "cross_range", "budget_max": "200.00"} | 按上端保守筛选/不确定，不取区间低值强行通过 | controlled | 执行前映射契约 | BLOCKED |
| P-08 | 价格过期 | {"fixture": "stale"} | 标过期/重新检索或不确定；不得当当前已核实价 | controlled | A03 | BLOCKED |
| P-09 | 币种不符 | {"fixture": "wrong_currency"} | GBP来源不冒充CNY，不静默换汇，不标预算通过 | controlled | 执行前映射契约 | BLOCKED |
| P-10 | 模型改低引用价 | {"server_price": "200.01", "model_claim": "199.99", "budget_max": "200.00"} | 服务端取冻结价格并拒绝改价；模型不能用低价绕过 | controlled | 执行前映射契约 | BLOCKED |
| P-11 | 有据商品不足三个 | {"evidence_count": [0, 1, 2]} | 明确partial/不足/澄清，保留证据；不复制商品或生成假记录凑3项 | controlled | 执行前映射契约 | BLOCKED |
| P-12 | 恰等上限 | {"fixture": "ordinary", "budget_max": "200.00"} | 同SKU数量普通价200.00符合上限；不能将not_verified改成全面核实 | controlled | 执行前映射契约 | BLOCKED |
| P-13 | 超出一分钱 | {"fixture": "one_cent_over", "budget_max": "200.00"} | 200.01超预算不可选，十进制定点比较无浮点误差 | controlled | 执行前映射契约 | BLOCKED |
| P-14 | seed与用户报价分开 | {"sources": ["seed", "user_provided", "browser_observed", "unknown"]} | 保留各自来源标识；seed是估算非实时，用户报价不是后台实读 | controlled | 执行前映射契约 | BLOCKED |
| P-15 | 事实推断未知分离 | {"relation": "pursuit", "known": "喜欢阅读", "inference": "可能喜欢设计", "unknown": "材质安全未知"} | 不将模型猜测/图片推断写成用户事实；追求对象无双向好感假设 | controlled | 执行前映射契约 | BLOCKED |
| P-16 | 硬排除仍拦截 | {"forbidden": "fragrance", "quoted_product_tag": "fragrance"} | 有价格/图片不豁免硬排除，候选不可选 | controlled | 执行前映射契约 | BLOCKED |
| P-17 | 全局一次修订 | {"repair_count": 1, "presentation_invalid": true} | 不再修订；检索/媒体任务不能重置业务额度或伪装重试绕过 | controlled | 执行前映射契约 | BLOCKED |
| P-18 | 预算账单不相加 | {"selected": "c2", "candidate_prices": ["200.00", "120.00", "80.00"]} | 礼物账单仅c2=120.00，包装不报价；图像服务费用不冒充礼物价格 | controlled | 执行前映射契约 | BLOCKED |
| M-01 | 三候选图正确绑定 | {"bindings": [["c1", "p-notebook", "im1"], ["c2", "p-cup", "im2"], ["c3", "p-book", "im3"]]} | 乱序返回仍按candidate/product/image引用绑定，不按数组位置混配 | browser | 执行前映射契约 | BLOCKED |
| M-02 | 错任务或过期图片引用 | {"reference": ["unknown", "other_task", "expired"]} | 可信服务端拒绝，不显示其他任务图片 | controlled | A03 | BLOCKED |
| M-03 | 来源照片标识 | {"kind": "source_photo"} | SKU/规格、来源、使用依据可追溯；公开可见不自动称有转载授权 | browser | 执行前映射契约 | BLOCKED |
| M-04 | AI图标识 | {"kind": "ai_illustration"} | 明确“AI效果示意，非商品实拍”；不能宣称是SKU实拍 | browser | 执行前映射契约 | BLOCKED |
| M-05 | 开发样例标识 | {"kind": "demo"} | 样例标识可见且不冒充对应商品 | browser | 执行前映射契约 | BLOCKED |
| M-06 | 缺图降级 | {"image": null} | 文字三方案/理由/价格不丢失，缺图状态明确，非假图片地址 | browser | 执行前映射契约 | BLOCKED |
| M-07 | 加载图片失败 | {"image_response": ["404", "超时", "解码失败"]} | 有错误/重试或降级提示，文字与选择仍可用，非生成成功 | browser | 执行前映射契约 | BLOCKED |
| M-08 | 不能图证安全 | {"claims": ["图片证明材质", "图片保证无过敏", "图片证明价格"]} | 保留未知与风险提示，不用图片作为价格/成分/过敏安全证据 | controlled | 执行前映射契约 | BLOCKED |
| M-09 | 未选择不生成 | {"selected": null} | 包装provider调用0；不默认选择第一项 | http | A01 | BLOCKED |
| M-10 | 不合格不可生成 | {"selected": "未通过候选", "client_passed": true} | 服务端可信状态拒绝，包装provider调用0，篡改passed无效 | http | A01 | BLOCKED |
| M-11 | 重复选择幂等 | {"selected": "c2", "requests": "并发两次+重放"} | 仅创建一次生成任务；相同引用/结果可观察，不重复计费 | http | A01 | BLOCKED |
| M-12 | provider未配置 | {"provider": "unconfigured"} | unavailable且保留文字包装/贺卡，不调用付费服务 | controlled | 执行前映射契约 | BLOCKED |
| M-13 | provider失败 | {"provider": ["timeout", "error", "invalid_image"]} | failed/unavailable准确呈现；不改变合格礼物选择或价格 | controlled | 执行前映射契约 | BLOCKED |
| M-14 | 参考图能力 | {"service": "支持或不支持参考图"} | 真实授权后核对选中外观/色彩规格；不支持参考图不能承诺一致 | image_service | 执行前映射契约 | BLOCKED |
| M-15 | 坐标边界合法 | {"fixture": "valid_annotations"} | target/label x/y含0、1合法；有简短中文及文字等价 | controlled | 执行前映射契约 | BLOCKED |
| M-16 | 坐标非法 | {"fixture": "invalid_annotations"} | 负数、>1、NaN/Infinity、字符串/布尔/缺字段均拒绝或明确降级，不崩溃 | controlled | 执行前映射契约 | BLOCKED |
| M-17 | 桌面箭头定位 | {"viewport": "1440x900", "image_fit": "contain"} | 坐标相对实际图片内容区，指向贺卡/色带，留白不造成偏移 | browser | 执行前映射契约 | BLOCKED |
| M-18 | 390窄屏定位 | {"viewport": "390x844", "orientation": "portrait"} | 无横溢出，标签不遮盖关键主体，目标随图片缩放一致 | browser | 执行前映射契约 | BLOCKED |
| M-19 | 缩放定位 | {"zoom": ["100%", "200%"], "resize": "desktop→390"} | 放大/缩小时重新定位且可查看完整包装图；坐标不依赖固定像素 | browser | 执行前映射契约 | BLOCKED |
| M-20 | 中文键盘与等价文字 | {"actions": ["Tab", "Enter", "Escape"], "text": "valid_annotations"} | 焦点可见，放大/关闭可键盘操作；中文可读，alt与完整标注文字可访问 | browser | 执行前映射契约 | BLOCKED |
| F-01 | 取消预算重复确认 | {"budget": "当前合法可见区间", "interact": "不拖动、不额外勾选"} | 无额外预算确认框或budget_confirmed门禁，合法输入可直接下一步；AI排除确认仍保留 | browser | 执行前映射契约 | BLOCKED |
| F-02 | 预算不确定 | {"budget_mode": "不确定"} | 阻止继续并给中文补充提示，不能补默认金额 | browser | 执行前映射契约 | BLOCKED |
| F-03 | 非法预算 | {"values": ["", "-1", "NaN", "Infinity", "true", "01", "10000.01"], "range": "min>max"} | 缺失/格式/倒置/上限错误均阻止继续，不因删除确认而放宽 | browser | 执行前映射契约 | BLOCKED |
| F-04 | 避免项placeholder | {"expected_placeholder": "讨厌的东西，过敏，衣服尺码未知"} | “需要避免的”实际placeholder逐字一致 | browser | 执行前映射契约 | BLOCKED |
| F-05 | 送礼历史选填为空 | {"previous_gifts": ""} | 留空不阻断，不自动生成硬禁忌 | browser | A04 | BLOCKED |
| F-06 | 送礼历史不成硬禁忌 | {"previous_gifts": "去年送过一本虚构笔记本"} | 只作为可选历史/比较信息，不无据写入硬性排除；明确禁忌仍单独确认 | http | A04 | BLOCKED |
| F-07 | 其他关系输入 | {"relation": "other", "custom": ["", "虚构社团伙伴"]} | 显示输入，空值阻止，有效非空保持原文并能继续 | browser | 执行前映射契约 | BLOCKED |
| F-08 | 其他场合输入 | {"occasion": "other", "custom": ["", "虚构搬家答谢"]} | 显示输入，必填及有效提交正常 | browser | 执行前映射契约 | BLOCKED |
| F-09 | 其他金额输入 | {"amounts": [["0", "0"], ["0.99", "200.00"], ["200.01", "200.00"]]} | 显示上下限输入；零/小数合法、倒置拒绝，无额外确认 | browser | 执行前映射契约 | BLOCKED |
| F-10 | 隐私与条款 | {"actions": ["鼠标", "键盘", "返回表单"]} | 入口可用、中文可读、可返回且不丢输入；不跳到假地址 | browser | 执行前映射契约 | BLOCKED |
