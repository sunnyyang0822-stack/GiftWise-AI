import test from 'node:test';
import assert from 'node:assert/strict';
import { runRecommendation, runPresentation, applyInputParseGates } from '../server/pipeline.mjs';
import { LlmProvider } from '../server/llm/provider.mjs';
import { OpenAiCompatibleTransport } from '../server/llm/transport.mjs';
import { buildRepairMessages } from '../server/llm/prompt.mjs';

// Controlled model/transport fixtures only: no paid calls, image generation or collection.
const candidate = (id, extra = {}) => ({ id, name: `方案${id}`, description: `不同的心意${id}`, estimated_total: '100', currency: 'CNY', estimated_preparation_days: 8, tags: ['other'], reason: '庆祝生日', fact_refs: [], inferences: [], unknowns: ['报价未核实'], fulfillment: 'experience', ...extra });
const three = () => ['c1', 'c2', 'c3'].map(id => candidate(id));
const intake = label => ({ contract_version: 'giftwise-20261031-v2', budget_mode: 'other', budget_amount: '800', budget_range: { min: '750', max: '800' }, currency: 'CNY', recipient_relation: 'friend', closeness: 'unknown', occasion: 'birthday', interests: [], interest_confidence: {}, gift_styles: [], dislikes: '', hard_exclusions: { tags: [], terms: [], unresolved: [] }, additional_context: label });
const output = (items, extra = {}) => ({ ok: true, outputs: { candidates_json: JSON.stringify({ candidates: items }), ...extra } });
function services(items, revise, extra = {}) {
  return {
    requestCandidates: async () => output(items), requestCandidateRevision: revise,
    retrievalEnabled: false, libraryEnabled: false,
    provideRealProducts: async () => ({ catalog: { status: 'unavailable', results: [] } }),
    visualDirectionProvider: { derive: async () => ({ ok: false, notices: [] }) },
    ...extra,
  };
}
const input = label => ({ mode: 'llm', intake: intake(label) });

test('three valid source-free suggestions stay selectable without deadline, observed prices or lexical matching', async () => {
  const out = await runRecommendation({ ...input('scalar budget'), inputParse: { constraints: { budget_band: { min: '750', max: '850', user_amount: '800', contract_range: { min: '750', max: '800' } } }, literal_preferences: ['爱看现场演出，也喜欢安静手作'] } }, services(three(), () => assert.fail('no repair')));
  assert.equal(out.kind, 'report');
  assert.deepEqual(out.report.selectable_candidate_ids, ['c1', 'c2', 'c3']);
  assert.equal(out.run.request.available_days, null);
  assert.equal(out.run.request.budget_amount, '800');
  assert.deepEqual(out.run.request.budget_range, { min: '750', max: '800' });
  assert.equal(out.run.repair_count, 0);
  assert.equal(out.run.validation.input_parse_gates.literal_preferences_enforced, 'model_context');
});

test('complete non-time validation triggers exactly one real repair and preserves passing candidates', async () => {
  const items = three(); items[2].estimated_total = '900';
  let calls = 0;
  const out = await runRecommendation(input('repair budget'), services(items, async args => {
    calls++;
    assert.deepEqual(args.preservedCandidates, items.slice(0, 2));
    assert.ok(args.validation.candidate_results[2].errors.some(e => e.code === 'OVER_BUDGET'));
    assert.equal(JSON.parse(args.requestJson).budget_amount, '800');
    return output([...args.preservedCandidates, candidate('c3', { name: '调整后的礼物', estimated_total: '700' })]);
  }));
  assert.equal(out.kind, 'report'); assert.equal(calls, 1);
  assert.equal(out.run.repair_count, 1); assert.equal(out.run.call_counts.recommend_revision, 1);
  assert.deepEqual(out.run.candidates.slice(0, 2), items.slice(0, 2));
  assert.equal(out.run.initial_validation.all_passed, false);
  assert.equal(out.run.pre_repair_validation.all_passed, false);
  assert.equal(out.run.validation.all_passed, true);
});

test('a missing third candidate is filled while existing valid objects are frozen', async () => {
  const first = three().slice(0, 2);
  const out = await runRecommendation(input('missing third'), services(first, async args => {
    assert.deepEqual(args.preservedCandidates, first);
    assert.ok(args.validation.errors.some(e => e.code === 'INVALID_CANDIDATE_COUNT'));
    return output([...first, candidate('c3')]);
  }));
  assert.equal(out.kind, 'report');
  assert.equal(out.run.selectable_candidate_ids.length, 3);
});

test('malformed candidate entries are repairable without a validation-side crash', async () => {
  const out = await runRecommendation(input('null candidate'), services([candidate('c1'), null, candidate('c3')], async args => {
    assert.deepEqual(args.preservedCandidates.map(c => c.id), ['c1', 'c3']);
    return output(three());
  }));
  assert.equal(out.kind, 'report');
});

test('duplicate IDs preserve only unambiguous candidates and repair the batch once', async () => {
  const items = [candidate('c1'), candidate('c1', { name: '重复编号' }), candidate('c3')];
  const out = await runRecommendation(input('duplicate IDs'), services(items, async args => {
    assert.deepEqual(args.preservedCandidates, [items[2]]);
    return output([candidate('c1'), candidate('c2'), items[2]]);
  }));
  assert.equal(out.kind, 'report');
});

test('full post-repair validation rejects an unchanged third failure and caches failure without paid repeats', async () => {
  const items = three(); items[2].estimated_total = '900';
  let generated = 0, revised = 0, direction = 0, catalog = 0;
  const svc = services(items, async () => { revised++; return output(items); }, {
    requestCandidates: async () => { generated++; return output(items); },
    provideRealProducts: async () => { catalog++; assert.fail('no catalog on incomplete batch'); },
    visualDirectionProvider: { derive: async () => { direction++; assert.fail('no direction on incomplete batch'); } },
  });
  const first = await runRecommendation(input('still invalid'), svc);
  assert.equal(first.kind, 'recommendation_failed'); assert.ok(!first.report);
  assert.deepEqual(first.run.selectable_candidate_ids, []);
  assert.equal(first.run.validation.candidate_results.filter(r => r.passed).length, 2);
  assert.equal(first.run.repair_count, 1);
  const replay = await runRecommendation(input('still invalid'), svc);
  assert.equal(replay.kind, 'recommendation_failed'); assert.equal(replay.idempotent, true);
  assert.equal(replay.run_id, first.run_id); assert.deepEqual([generated, revised, direction, catalog], [1, 1, 0, 0]);
  const selection = await runPresentation({ runId: first.run_id, selectedCandidateId: 'c1' });
  assert.notEqual(selection.kind, 'presentation');
});

for (const failure of ['timeout', 'changed-passed', 'new-violation']) test(`one repair cannot publish ${failure}`, async () => {
  const items = three(); items[2].estimated_total = '900';
  const out = await runRecommendation(input(failure), services(items, async () => {
    if (failure === 'timeout') throw new Error('controlled timeout');
    const next = three();
    if (failure === 'changed-passed') next[0].description = '偷偷改动通过项';
    if (failure === 'new-violation') next[2].currency = 'USD';
    return output(next);
  }));
  assert.equal(out.kind, 'recommendation_failed'); assert.equal(out.run.repair_count, 1);
  assert.deepEqual(out.run.selectable_candidate_ids, []);
  if (failure === 'changed-passed') assert.ok(out.run.workflow_errors.some(e => e.code === 'PASSED_CANDIDATE_CHANGED'));
});

test('explicit user range lower bound is checked before repair; derived scalar band remains soft', async () => {
  const band = { min: '550', max: '850', user_min: '600', user_max: '800', user_amount: '800', contract_range: { min: '600', max: '800' } };
  let called = 0;
  const out = await runRecommendation({ ...input('explicit range'), inputParse: { constraints: { budget_band: band } } }, services(three(), async args => {
    called++;
    assert.deepEqual(args.preservedCandidates, []);
    assert.ok(args.validation.candidate_results.every(r => r.errors.some(e => e.code === 'PRICE_OUT_OF_BAND')));
    return output(three().map(c => ({ ...c, estimated_total: '650' })));
  }));
  assert.equal(out.kind, 'report'); assert.equal(called, 1);
  const validation = { candidate_results: [{ id: 'c1', passed: true, errors: [] }] };
  applyInputParseGates({ inputParse: { constraints: { budget_band: band } }, validation, candidates: [candidate('c1', { estimated_total: '810' })] });
  assert.equal(validation.candidate_results[0].passed, false);
});

test('fulfillment gate is included in pre-repair diagnostics rather than appended after repair', async () => {
  const items = three(); items[2].fulfillment = 'made-up';
  const out = await runRecommendation(input('fulfillment repair'), services(items, async args => {
    assert.equal(args.validation.candidate_results[2].passed, false);
    assert.ok(args.validation.candidate_results[2].errors.length);
    return output(three());
  }));
  assert.equal(out.kind, 'report'); assert.equal(out.run.repair_count, 1);
});

test('original source bindings on passed candidates are kept and failed candidates do not inherit stale images', async () => {
  const items = three(); items[2].estimated_total = '900';
  const references = [1, 3].map(n => ({ reference_id: 'ref' + n, reference_kind: 'public_reference', source_url: `https://www.bilibili.com/video/${n}`, title: '真实参考记录' + n }));
  const refs = [{ candidate_id: 'c1', reference_id: 'ref1' }, { candidate_id: 'c3', reference_id: 'ref3' }];
  const out = await runRecommendation(input('reference repair'), services(items, async () => output(three()), {
    retrievalEnabled: true, planRetrieval: async () => ({ needs_retrieval: true, queries: [] }),
    retrievalWorker: { submit: async () => ({ status: 'partial', products: [], references, coverage: [], warnings: [] }) },
    requestCandidates: async () => output(items, { reference_references_json: JSON.stringify(refs) }),
  }));
  assert.equal(out.kind, 'report');
  assert.equal(out.run.reference_bindings.get('c1').reference_id, 'ref1');
  assert.equal(out.run.reference_bindings.has('c3'), false);
});

test('repair cannot silently change a passed candidate reference binding', async () => {
  const items = three(); items[2].estimated_total = '900';
  const out = await runRecommendation(input('changed reference'), services(items, async () => output(three(), { reference_references_json: JSON.stringify([{ candidate_id: 'c1', reference_id: 'different' }]) })));
  assert.equal(out.kind, 'recommendation_failed');
  assert.ok(out.run.workflow_errors.some(e => e.code === 'PASSED_BINDING_CHANGED'));
});

for (const replace of [false, true]) test(`observed over-budget item requires an actual changed suggestion: replacement=${replace}`, async () => {
  const items = three();
  const product = { product_id: 'observed-expensive', name: items[2].name, variant: '固定款', price_amount: '900', price_conditions: [], currency: 'CNY', price_source: 'browser_observed', source_site: 'jd', source_url: 'https://item.jd.com/1.html', observed_at: new Date().toISOString() };
  const out = await runRecommendation(input('observed price ' + replace), services(items, async args => {
    assert.ok(args.validation.candidate_results[2].errors.some(e => e.code === 'OVER_BUDGET'));
    const next = three();
    if (replace) next[2].name = '改为另一种手作安排';
    return output(next); // No new source binding: never relabel the old price/photo.
  }, {
    retrievalEnabled: true, planRetrieval: async () => ({ needs_retrieval: true, queries: [] }),
    retrievalWorker: { submit: async () => ({ status: 'partial', products: [product], references: [], coverage: [], warnings: [] }) },
    requestCandidates: async () => output(items, { product_references_json: JSON.stringify([{ candidate_id: 'c3', product_id: product.product_id }]) }),
  }));
  assert.equal(out.kind, replace ? 'report' : 'recommendation_failed');
  assert.equal(out.run.product_bindings.has('c3'), false);
});

test('repair prompt carries actual full effective diagnostics and user semantics, with no time gate', () => {
  const messages = buildRepairMessages({ requestJson: JSON.stringify({ budget_amount: '800', available_days: 1, exclusion_context: { raw_text: '不要太隆重' } }), intakeJson: JSON.stringify({ deadline_days: 1 }), inputParse: { constraints: { budget_band: { user_amount: '800' } }, literal_preferences: ['演出与安静手作'] }, candidatesJson: JSON.stringify({ candidates: three() }), validation: { all_passed: false, candidate_results: [], raw_validation: { errors: [{ code: 'PREPARATION_TOO_LONG' }] } }, preservedCandidates: [], productReferences: [], referenceReferences: [] });
  const envelope = JSON.parse(messages[1].content);
  assert.equal(envelope.action, 'recommend_revision');
  assert.ok(!('available_days' in JSON.parse(envelope.request_json)));
  assert.ok(!('deadline_days' in JSON.parse(envelope.intake_json)));
  assert.ok(!('raw_validation' in envelope.validation_json));
  assert.deepEqual(envelope.input_constraints.budget_band, { user_amount: '800' });
  assert.match(messages[0].content, /只修改失败或补齐缺失候选/);
  assert.match(messages[1].content, /不要太隆重/);
});

test('real provider revision uses one synthetic transport call and no tool or output retries', async () => {
  for (const content of [JSON.stringify({ candidates: three(), reference_references: [{ candidate_id: 'c3', reference_id: 'ref3' }] }), 'broken']) {
    const bodies = [];
    const live = new OpenAiCompatibleTransport({ fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) };
    } });
    const provider = new LlmProvider({ live, hasConfig: () => true, config: () => ({ baseUrl: 'https://model.example.test/v1', apiKey: 'synthetic-key', model: 'test', maxTokens: 2000, outputRetries: 1, maxRetries: 0 }) });
    const revise = provider.requestCandidateRevision; // Production passes a bare bound method.
    const out = await revise({ requestJson: '{}', candidatesJson: '{}', validation: {}, preservedCandidates: [] });
    assert.equal(bodies.length, 1); assert.equal(out.model_calls, 1);
    assert.ok(!bodies[0].tools);
    if (content === 'broken') assert.equal(out.ok, false);
    else {
      assert.equal(out.ok, true);
      assert.ok(!('reference_references' in JSON.parse(out.outputs.candidates_json)));
      assert.equal(JSON.parse(out.outputs.reference_references_json)[0].reference_id, 'ref3');
    }
  }
});
