import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmProvider } from '../server/llm/provider.mjs';

// All network material below is explicitly injected offline fixture data, never live evidence.
const material = (overrides = {}) => ({
  reference_id: 'ref_a', reference_kind: 'public_reference', purpose: 'web',
  source_platform: 'bing', source_url: 'https://sspai.com/post/grounding-offline',
  observed_at: '2026-10-31T17:28:47.911Z', title: '手工折页保存短文字的方法',
  summary: '将纸张连续折叠，按顺序分栏记录短文字；可拆分页面再组合成册。这是离线教程摘要夹具。',
  image_url: null, image_id: null, image_validation: null,
  price_amount: null, currency: null, ...overrides,
});
const candidates = [
  { id: 'c1', name: '把散步做成声音地图', description: '模型创意：把日常听见的声音串成私人路线。' },
  { id: 'c2', name: '寄往未来的天气档案', description: '模型创意：将某一天的感受与下一次见面相连。' },
  { id: 'c3', name: '两人之间的微型展览', description: '模型创意：用共同记忆安排一个轻量分享时刻。' },
];
const citation = (id = 'c1', reference_id = 'ref_a') => ({ candidate_id: id, reference_id });
const textReply = (references = [citation()]) => ({
  ok: true, finish_reason: 'stop', text: JSON.stringify({ action: 'recommend', candidates, reference_references: references }),
});
const queries = [
  { purpose: 'web', keyword: '折页记录 手写教程', sources: ['bing'], reason: '结合完整需求找文字做法' },
  { purpose: 'inspiration', keyword: 'shared memory creative gift', sources: ['pinterest'], reason: '探索可延伸的案例' },
];
const tools = [{ type: 'function', function: { name: 'opencli_search', description: '离线受控素材查询', parameters: { type: 'object', properties: { purpose: { type: 'string' }, keyword: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } } } } }];
const toolReply = (args = [queries[0]]) => ({
  ok: true, finish_reason: 'tool_calls', text: '',
  tool_calls: args.map((arguments_, i) => ({ id: `offline_material_${i}`, type: 'function', function: { name: 'opencli_search', arguments: JSON.stringify(arguments_) } })),
});
const retrieved = (references = [material()]) => ({ status: references.length ? 'partial' : 'unavailable', references, products: [], contents: [], images: [], recommendations_available: true });
function setup(responses) {
  const calls = [];
  const provider = new LlmProvider({
    live: { synthetic: true, chat: async request => {
      calls.push(structuredClone(request));
      if (calls.length > 4) throw new Error('OFFLINE_GROUNDING_CONTINUATION_NOT_BOUNDED');
      const response = typeof responses === 'function' ? responses(calls.length) : responses[calls.length - 1];
      if (!response) throw new Error('UNEXPECTED_OFFLINE_MODEL_ROUND');
      return structuredClone(response);
    } },
    config: () => ({ baseUrl: 'https://offline-model.invalid/v1', apiKey: 'offline-fixture-key', model: 'offline', maxTokens: 2000, outputRetries: 0 }),
    hasConfig: () => true,
  });
  return { provider, calls };
}
const input = { requestJson: '{}', tools, maxToolRounds: 1 };
const content = call => JSON.stringify(call.messages);

test('无初始素材首轮required；模型自主web/inspiration查询的无图无价文字先进入后续prompt再输出创意', async () => {
  const { provider, calls } = setup([toolReply(queries), textReply()]);
  const executed = [];
  const result = await provider.requestCandidates({ ...input, executeTool: async call => {
    executed.push(call.arguments);
    return retrieved(call.arguments.purpose === 'web' ? [material()] : []);
  } });
  assert.equal(result.ok, true);
  assert.equal(calls[0].tool_choice, 'required');
  assert.deepEqual(executed, queries);
  assert.equal(calls.length, 2);
  const toolMessages = calls[1].messages.filter(message => message.role === 'tool');
  assert.equal(toolMessages.length, 2);
  const seen = JSON.parse(toolMessages[0].content).references[0];
  assert.equal(seen.reference_id, 'ref_a');
  assert.equal(seen.summary, material().summary);
  assert.equal(seen.source_url, material().source_url);
  assert.equal(seen.observed_at, material().observed_at);
  assert.equal(seen.image_url, null);
  assert.equal(seen.price_amount, null);
  assert.deepEqual(JSON.parse(result.outputs.candidates_json).candidates, candidates);
  assert.deepEqual(JSON.parse(result.outputs.reference_references_json), [citation()]);
  assert.equal('reference_references' in JSON.parse(result.outputs.candidates_json), false);
  const system = calls[0].messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  assert.match(system, /事实/);
  assert.match(system, /创意|延伸|组合/);
});

test('一条批次真实素材可支持三个不同创意，不要求逐候选链接/同款/词匹配', async () => {
  const { provider, calls } = setup([textReply([citation()])]);
  let newSearches = 0;
  const result = await provider.requestCandidates({ ...input, retrieval: retrieved(), executeTool: async () => { newSearches++; return retrieved(); } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(newSearches, 0);
  assert.notEqual(calls[0].tool_choice, 'required');
  assert.ok(content(calls[0]).includes(material().summary));
  assert.ok(content(calls[0]).includes(material().observed_at));
  assert.deepEqual(JSON.parse(result.outputs.candidates_json).candidates, candidates);
  assert.deepEqual(JSON.parse(result.outputs.reference_references_json), [citation()]);
});

test('多个候选复用同一真实reference_id不因图片唯一性规则失败', async () => {
  const citations = candidates.map(candidate => citation(candidate.id));
  const { provider } = setup([textReply(citations)]);
  const result = await provider.requestCandidates({ ...input, retrieval: retrieved(), executeTool: async () => { throw new Error('CACHE_MUST_AVOID_NEW_TOOL'); } });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.outputs.reference_references_json), citations);
});

test('已知合法文本缓存允许显式groundingRequired且无工具直接输出，不依赖图/报价', async () => {
  const { provider, calls } = setup([textReply()]);
  const result = await provider.requestCandidates({ requestJson: '{}', groundingRequired: true, retrieval: retrieved(), tools: [], maxToolRounds: 1 });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(content(calls[0]).includes(material().source_url));
  assert.equal(result.tool_audit.length, 0);
});

test('工具无可用素材时不能把最终自由建议标有据，最多一次有限continuation后NO_MATERIAL', async () => {
  const { provider, calls } = setup(round => round === 1 ? toolReply() : textReply());
  let searches = 0;
  const result = await provider.requestCandidates({ ...input, executeTool: async () => { searches++; return retrieved([]); } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RETRIEVAL_NO_MATERIAL');
  assert.equal(searches, 1);
  assert.ok(calls.length <= 3);
});

test('存在真实资料但持续引用伪refid不等于确认依据，有限修正后BASIS_UNCONFIRMED', async () => {
  const { provider, calls } = setup(round => round === 1 ? toolReply() : textReply([citation('c1', 'invented_ref')]));
  const result = await provider.requestCandidates({ ...input, executeTool: async () => retrieved() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RETRIEVAL_BASIS_UNCONFIRMED');
  assert.ok(calls.length <= 3);
});

test('有素材却未引用时只补一次确认；同ref贯穿上下文，修正引用后成功且不再搜索', async () => {
  const { provider, calls } = setup([toolReply(), textReply([]), textReply()]);
  let searches = 0;
  const result = await provider.requestCandidates({ ...input, executeTool: async () => { searches++; return retrieved(); } });
  assert.equal(result.ok, true);
  assert.equal(searches, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].tool_choice, 'none');
  assert.ok(content(calls[2]).includes(material().summary));
  assert.ok(content(calls[2]).includes('ref_a'));
  assert.deepEqual(JSON.parse(result.outputs.reference_references_json), [citation()]);
});

test('伪造source/缺观察时间/纯图标题或空摘要不能被refid sidecar洗成文本依据', async t => {
  for (const [name, overrides] of [
    ['虚构来源域', { source_url: 'https://fabricated.example/article' }],
    ['商店来源', { source_url: 'https://item.jd.com/10179988291541.html' }],
    ['非HTTPS', { source_url: 'http://sspai.com/post/grounding-offline' }],
    ['缺观察时间', { observed_at: null }],
    ['非法观察时间', { observed_at: 'not-a-date' }],
    ['非公开参考身份', { reference_kind: 'product' }],
    ['缺标题', { title: '' }],
    ['纯图标题无正文', { summary: '', image_url: 'https://tse1-mm.cn.bing.net/th/id/fixture', image_id: 'a'.repeat(32), image_validation: { ok: true, width: 100, height: 100 } }],
    ['空白摘要', { summary: '  \n  ' }],
  ]) await t.test(name, async () => {
    const { provider, calls } = setup(() => textReply());
    const result = await provider.requestCandidates({ requestJson: '{}', groundingRequired: true, tools: [], retrieval: retrieved([material(overrides)]), maxToolRounds: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'RETRIEVAL_NO_MATERIAL');
    assert.ok(calls.length <= 2);
  });
});
