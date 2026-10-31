import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpencliToolSession } from '../server/retrieval/agent-tool.mjs';
import { startReferenceImages } from '../server/retrieval/reference-images.mjs';
import { LlmProvider } from '../server/llm/provider.mjs';

// Controlled offline metadata only: no image GET, model, browser or fixture presented as live evidence.
const candidates = ['c1', 'c2', 'c3'].map(id => ({ id, name: `离线方案${id}`, description: `已确认文字${id}` }));
const records = () => candidates.map((candidate, i) => {
  const image_url = `https://tse${i + 1}-mm.cn.bing.net/th/id/collision-${i + 1}`;
  return {
    reference_id: `ref_${candidate.id}`, reference_kind: 'public_reference', purpose: 'reference',
    source_url: `https://www.zhihu.com/question/${i + 100}`, source_platform: 'bing', source_site: 'www.zhihu.com',
    title: candidate.name, summary: `原始完整资料${candidate.id}`, observed_at: '2026-10-31T17:28:47.911Z',
    image_kind: 'reference_image', image_id: String(i + 1).repeat(32), image_url,
    image_validation: { ok: true, mime: 'image/gif', width: 100, height: 100, sha256: String(i + 1).repeat(64), final_url: image_url },
    image_provenance: { kind: 'search_thumbnail', source_url: `https://www.zhihu.com/question/${i + 100}`, same_sku_verified: false },
  };
});
const binding = record => ({
  candidate_id: 'c1', reference_id: record.reference_id,
  image: { id: record.image_id, url: `/api/reference/images/${record.image_id}`, kind: 'reference_image', alt: '原始已验证参考图', source_url: record.source_url, price_observed_at: record.observed_at },
});
function makeRun(initial = [], initialBindings = []) {
  return {
    run_id: 'offline-reference-collision-98', created_at: new Date().toISOString(), owner_scope: 'offline-collision-owner',
    candidates: structuredClone(candidates), retrieval: { status: 'partial', products: [], references: structuredClone(initial) },
    media: { status: 'unavailable', selected: { task_id: 'separate-selection-task', status: 'pending' }, candidates: structuredClone(initialBindings) },
    selectable_candidate_ids: ['c1', 'c2', 'c3'], call_counts: {},
  };
}
const call = id => ({ id, name: 'opencli_search', arguments: { purpose: 'reference', keyword: '离线碰撞检索', sources: ['bing'], reason: 'offline regression' } });
const result = references => ({ status: 'partial', products: [], references, coverage: [{ source: 'bing', status: 'ok', complete: true }] });
const citations = ids => ids.map(id => ({ candidate_id: id, reference_id: `ref_${id}` }));
const failed = record => ({ ...structuredClone(record), title: '后续失败资料不得覆盖原文', image_url: 'https://tse4-mm.cn.bing.net/th/id/later-failed', image_id: null, image_validation: { ok: false, error_code: 'IMAGE_CORS_OR_NETWORK_FAILED' }, observed_at: '2026-10-31T18:00:00.000Z' });
const preservedText = run => {
  assert.deepEqual(run.candidates, candidates);
  assert.deepEqual(run.selectable_candidate_ids, ['c1', 'c2', 'c3']);
  assert.deepEqual(run.media.selected, { task_id: 'separate-selection-task', status: 'pending' });
};

test('D碰撞：已ready的c1整条证据与完整绑定不被同ID新GET失败替换，补齐另外两图', async () => {
  const good = records(), originalBinding = binding(good[0]);
  const run = makeRun([good[0]], [originalBinding]);
  const session = createOpencliToolSession({ search: async () => result([failed(good[0]), good[1], good[2]]) });
  const job = startReferenceImages(run, { session, requestJson: '{}', requestImages: async input => {
    assert.deepEqual(input.missingCandidateIds, ['c2', 'c3']);
    await input.executeTool(call('d-exact-collision'));
    return { ok: true, model_calls: 0, reference_references: citations(['c2', 'c3']) };
  } });
  assert.deepEqual(run.reference_image_slots.map(slot => slot.status), ['ready', 'pending', 'pending']);
  await job.promise;
  assert.deepEqual(run.reference_image_slots.map(slot => slot.status), ['ready', 'ready', 'ready']);
  assert.deepEqual(run.retrieval.references.find(record => record.reference_id === 'ref_c1'), good[0]);
  assert.deepEqual(run.reference_image_slots[0], { ...originalBinding, status: 'ready' });
  assert.equal(job.status, 'ready');
  preservedText(run);
});

test('同job多轮工具先成功后同ID失败，模型最终引用原ID仍能保留有效整条图证据', async () => {
  const good = records(), run = makeRun();
  let round = 0;
  const session = createOpencliToolSession({ search: async () => result(++round === 1 ? [good[0]] : [failed(good[0]), good[1], good[2]]) });
  const job = startReferenceImages(run, { session, requestJson: '{}', requestImages: async input => {
    await input.executeTool(call('round-good'));
    await input.executeTool(call('round-later-failure'));
    return { ok: true, model_calls: 0, reference_references: citations(['c1', 'c2', 'c3']) };
  } });
  await job.promise;
  assert.equal(round, 2);
  assert.deepEqual(session.retrieval.references.find(record => record.reference_id === 'ref_c1'), good[0]);
  assert.deepEqual(run.retrieval.references.find(record => record.reference_id === 'ref_c1'), good[0]);
  assert.deepEqual(run.reference_image_slots.map(slot => slot.status), ['ready', 'ready', 'ready']);
  assert.equal(job.status, 'ready');
  preservedText(run);
});

const unsafeChanges = [
  ['商店source', { source_url: 'https://item.jd.com/10179988291541.html' }],
  ['商店图片CDN', { image_url: 'https://img10.360buyimg.com/store.jpg' }],
  ['非白名单图片', { image_url: 'https://untrusted.example/image.jpg' }],
  ['不安全最终图片跳转', { final_url: 'https://img10.360buyimg.com/redirected.jpg' }],
];
function unsafe(record, change) {
  const copy = { ...structuredClone(record), ...change };
  delete copy.final_url;
  if (change.final_url) copy.image_validation.final_url = change.final_url;
  return copy;
}

test('保留策略不能认可初始伪ok的商店来源/非许可图片；后续合法同ID必须可替换', async t => {
  for (const [label, change] of unsafeChanges) await t.test(label, async () => {
    const good = records(), poison = unsafe(good[0], change), run = makeRun([poison], [binding(poison)]);
    const session = createOpencliToolSession({ search: async () => result(good) });
    const job = startReferenceImages(run, { session, requestJson: '{}', requestImages: async input => {
      await input.executeTool(call(`replace-invalid-${label}`));
      return { ok: true, model_calls: 0, reference_references: citations(['c1', 'c2', 'c3']) };
    } });
    const initial = run.reference_image_slots[0].status;
    await job.promise;
    assert.equal(initial, 'pending', '伪ok不得在检索前成为ready');
    assert.deepEqual(run.retrieval.references.find(record => record.reference_id === 'ref_c1'), good[0]);
    assert.deepEqual(run.reference_image_slots.map(slot => slot.status), ['ready', 'ready', 'ready']);
    preservedText(run);
  });
});

test('后续同ID伪ok的商店来源或非许可图片不能污染最早合法完整证据', async t => {
  for (const [label, change] of unsafeChanges) await t.test(label, async () => {
    const good = records(), run = makeRun([good[0]], [binding(good[0])]);
    const session = createOpencliToolSession({ search: async () => result([unsafe(good[0], change), good[1], good[2]]) });
    const job = startReferenceImages(run, { session, requestJson: '{}', requestImages: async input => {
      await input.executeTool(call(`reject-poison-${label}`));
      return { ok: true, model_calls: 0, reference_references: citations(['c2', 'c3']) };
    } });
    await job.promise;
    assert.deepEqual(run.retrieval.references.find(record => record.reference_id === 'ref_c1'), good[0]);
    assert.deepEqual(run.reference_image_slots.map(slot => slot.status), ['ready', 'ready', 'ready']);
    preservedText(run);
  });
});

test('工具回调对象返回后被修改，不能事后污染session与job持有的已验证证据', async () => {
  const returned = records(), original = structuredClone(returned[0]), run = makeRun();
  const session = createOpencliToolSession({ search: async () => result(returned) });
  const job = startReferenceImages(run, { session, requestJson: '{}', requestImages: async input => {
    await input.executeTool(call('mutable-result'));
    returned[0].source_url = 'https://item.jd.com/10179988291541.html';
    returned[0].image_validation.ok = false;
    returned[0].image_validation.final_url = 'https://img10.360buyimg.com/changed.jpg';
    returned[0].image_provenance.kind = 'mutated';
    return { ok: true, model_calls: 0, reference_references: citations(['c1', 'c2', 'c3']) };
  } });
  await job.promise;
  assert.deepEqual(session.retrieval.references.find(record => record.reference_id === 'ref_c1'), original);
  assert.deepEqual(run.retrieval.references.find(record => record.reference_id === 'ref_c1'), original);
  assert.deepEqual(run.reference_image_slots.map(slot => slot.status), ['ready', 'ready', 'ready']);
  preservedText(run);
});

test('同ID后续失败不能移除格式修复清单里的已验证引用，不新增检索', async () => {
  const good = records(), session = createOpencliToolSession({search: async () => result(++searches === 1 ? good : [failed(good[0])])});
  let searches = 0, invocations = 0;
  const provider = new LlmProvider({hasConfig: () => true});
  provider.invoke = async input => {
    const round = ++invocations;
    if(round <= 2) return {ok: true, tool_calls: [{id: `offline-${round}`, type: 'function', function: {name: 'opencli_search', arguments: JSON.stringify(call('unused').arguments)}}]};
    if(round === 3) return {ok: true, text: 'invalid json', finish_reason: 'stop'};
    assert.equal(input.kind, 'reference_images_format');
    assert.equal(input.tool_choice, 'none');
    const manifest = JSON.parse(input.messages.at(-1).content).allowed_references;
    assert.deepEqual(manifest, good.map(({reference_id,title,source_url}) => ({reference_id,title,source_url})));
    return {ok: true, text: JSON.stringify({reference_references: citations(['c1','c2','c3'])}), finish_reason: 'stop'};
  };
  const output = await provider.requestReferenceImages({requestJson: '{}', candidates, references: [], missingCandidateIds: ['c1','c2','c3'], tools: session.tools, executeTool: session.executeTool});
  assert.equal(output.ok, true);
  assert.equal(output.format_repair_used, true);
  assert.equal(invocations, 4);
  assert.equal(searches, 2);
});
