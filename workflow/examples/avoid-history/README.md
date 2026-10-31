# 需要避免的与送礼历史：离线增量和PM协调单

本轮用户决定覆盖旧版预算额外确认。基础版本giftwise-20261031-v2不变；共享字段变更待PM冻结，不能以本线Python实现推定其他端已支持。

| 界面 | 机器输入 | Python冻结请求 | 边界 |
| --- | --- | --- | --- |
| 需要避免的 | dislikes:string | dislikes，空白归空 | 保留提议→同页确认/澄清→服务端冻结；不是预算确认 |
| 以前送过什么？ | previous_gifts:string | 同名独立上下文 | 选填；默认空；空白归空；非字符串INVALID_TYPE；超过1000码点LIMIT_EXCEEDED，路径intake.previous_gifts |

合法历史原样保留（含首尾非空白内容），不提取或补造时间/价格/反应，不放facts、不自动生成禁忌、不拼入dislikes。旧版未提供字段时保持旧请求形状，消费者get默认空；v2冻结请求提供空值。合法预算无需复选框；缺失、未知和非法仍需澄清。

## 本线实现与未实现

仅实现Python基础字段适配、提示词、虚构夹具和离线测试。基础adapt_intake的ready只表示格式/基础字段有效，不代表完成识别确认或获准推荐。现有纯validator不能理解原文语义，不负责判断历史是否“不要再送”或过敏是否覆盖全面。禁止将ready或候选代码通过冒充这些风险已处理。

现有信封只支持tag/term，source_span只锚定dislikes。无法表达的过敏风险、尺码缺口、模糊“没有首饰”必须由识别器给ai_unmapped_notes，现有确认门禁阻止推荐。离线固定信封只能测结构和阻塞，不证明真实识别器会产出正确说明。普通“送过杯子”是软历史；历史明确“不要再送杯子”必须经过独立的来源绑定确认，不能自动丢到notes、拼入dislikes或生成词约束后声称已拦截。当前此入口尚未实现，是接入BLOCKED项。

## 最小共享契约建议（待PM指定负责人，不在本线实施）

1. docs/intake-contract.md、API契约：纳入previous_gifts类型/默认/长度/原样保留，以及dislikes新文案；明确基本适配ready不等于ready-to-recommend。
2. web/server/intake.mjs：白名单、校验、冻结previous_gifts，与Python一致；dislikes空白归空；保留输入原始快照保证修改历史后analysis_id失效。web/server/pipeline.mjs及API快照/指纹必须含新字段，分别向推荐/呈现provider传递。不得静默剔除历史中的明确禁忌。
3. 排除checker/provider：沿用现有标签，无法表达的风险先unmapped阻塞，不新增过敏标签/错误码。若要从历史识别明确排除，建议提案增加source_field=dislikes|previous_gifts并按原字段锚定；属于信封变更，需PM批准、checker和同页确认同步，不能本线先实施。
4. 信息缺口建议独立confirmed_gaps上下文（如clothing_size_unknown），与forbidden_tags/terms分离，用户明确确认避开依赖精确尺码方向后才能推荐；字段/白名单/来源锚定/错误策略由PM冻结。当前不生成该机器字段，不新增size标签，继续澄清阻塞。
5. 前端只做独立预览：两项标签及placeholder、预算去额外确认；之后接入新服务端才验收。未授权连接旧前端。previous_gifts不当作收礼人已确认偏好。

语义模型测试、过敏原/材质真实识别、尺码推断、服务端新门禁、JS/Python新字段对等、前端联调全部未执行/待同步。绝不能仅凭词匹配承诺全面风险识别。
