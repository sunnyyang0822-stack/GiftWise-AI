# 排除项 provider 注入协议（离线准备）

依据 PM 变更契约，版本 giftwise-20261031-v2。本文件不是第二套服务端或线上配置；输入输出示例全部虚构，mock 必须显式标记。

接入端调用 recognizeExclusions({dislikes, mode, provider})。provider 的约定由接入端包装：异步 provider({dislikes}) → Promise<string>，返回模型原始严格 JSON 信封字符串，不返回通过状态、约束或服务端 ID。接入端若已有其他函数签名，只在自己的调用边界转换，不让模型改签名或扩权。工作流侧不实现 HTTP 服务、不读取 Key。

示意（仅协议，不执行联网）：

```js
const provider = async ({ dislikes }) => {
  // 接入线负责注入传输；本轮不调用。系统消息使用 exclusions.md 全文。
  const response = await injectedTransport({
    system: exclusionSystemPrompt,
    user: JSON.stringify({ dislikes }),
    automaticRetries: 0
  });
  return response.text; // 不剥围栏、不修补 JSON，不把模型字段当裁决
};
const proposal = await recognizeExclusions({ dislikes, mode: 'dify', provider });
// 纯 checkAiExclusions(raw, dislikes) 必须整包独立校验。
// 返回 needs_confirmation 仍不是推荐许可，须服务端快照和用户完整确认。
```

空 dislikes 跳过 provider，不伪造分析；非空且 provider 未配置报能力缺失，不自动回落 mock。mock 使用 cases.json 明确固定夹具，不能报告 AI 实测。provider 异常/超时/无效信封不自动重试，也不占用或重置业务修订额度；错误/零候选/unmapped 必须 needs_input 澄清，不能当无禁忌。

信封恰好 ai_exclusion_candidates / ai_unmapped_notes；八键条目、枚举、长度、精确 source_span、term 反向锚定见 exclusions.md 和 PM 契约。格式 AI_OUTPUT_INVALID，限额 AI_OUTPUT_LIMIT，依据 AI_OUTPUT_UNANCHORED；整包失败不采用局部条目。先结构→限额→依据；非空原文结果不可靠还要阻止推荐并要求澄清。提示词不是代码校验器，锚定不是语义证明。

接入线在服务端保存有效建议的快照，生成 analysis_id，TTL 10分钟、上限200条；输入变化重分析，完整确认后合并约束再冻结请求。id/唯一性/完整性/归属/有效期和幂等由服务端检查，不接受浏览器自造原文、约束或 passed。确认字段只放推荐事件，不放礼物选择事件。快照不是用户身份认证。公开日志只留模式、计数、错误码、耗时和指纹；不得记录真实原文或密钥。

推荐沿用冻结 request_json 与 c1/c2/c3。呈现输入只来自已选合格候选和可信请求，输出示例见 cases.json；价格从冻结候选读取，不从呈现输出读价格。全任务最多一次业务修订。新版真实语义识别、延迟、token、费用和 Dify 联调均未测；旧线上证据不作为本版证据。
