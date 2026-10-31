// Controlled final-model responses, not evidence of live semantic or image-model behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../server/store.mjs';
import { runPresentation } from '../server/pipeline.mjs';
import { checkPresentationForDecision, validateForDecision } from '../server/checker.mjs';
import { strictParse } from '../server/jsonstrict.mjs';
import { buildPresentEnvelope, buildPresentMessages } from '../server/llm/prompt.mjs';
import { buildLocalPresentation } from '../server/llm/presentation.mjs';
import { buildImagePlan } from '../server/media/plan.mjs';

const cases = [
  { label: '纯体验演唱会', name: '一起看一场喜欢的现场演出', context: '只想一起听演唱会，不需要实体礼物或纪念物。', packaging: { color_palette: ['深蓝'], materials: [], steps: [] }, advice: { timing: '先私下确认对方愿意及方便的场次，再一起安排', wording: '想邀请你一起听喜欢的音乐，你愿意再一起选具体演出。', relationship_cautions: ['不把邀请当作对方已答应'] }, physical: false },
  { label: '纯体验未知城市日期', name: '一起尝试手作体验', context: '城市和日期还不确定，先给一个轻松邀请的想法，没有实物交付。', packaging: { color_palette: ['米白'] }, advice: { timing: '等双方方便时再讨论地点和项目', wording: '找个空闲时间一起试试手作，你有兴趣吗？', relationship_cautions: [] }, physical: false },
  { label: '实体礼物', name: '一本旅行相册', context: '有自备相册保护套，希望把礼物包装整洁。', packaging: { color_palette: ['米白'], materials: ['自备相册保护套'], steps: ['整理相册后放入保护套'] }, advice: { timing: '见面时送出', wording: '把这些回忆整理成了一本相册。', relationship_cautions: [] }, physical: true },
  { label: '混合体验实体邀请', name: '手作体验与一张实体邀请函', context: '想邀对方一起做手作，也想用已有纸张做一张实物邀请函。', packaging: { color_palette: ['淡绿'], materials: ['已有纸张', '自备信封'], steps: ['写好邀请话语后放入信封'] }, advice: { timing: '先问意愿，再商量具体体验安排', wording: '如果你愿意，我们找个时间一起去体验一下。', relationship_cautions: [] }, physical: true },
  { label: '演唱会实体纪念卡', name: '演唱会回忆纪念卡', context: '不是安排观演，想用已有纸张做演唱会主题的实体纪念卡。', packaging: { color_palette: ['深蓝'], materials: ['已有硬卡纸', '已有信封'], steps: ['整理回忆做成卡片，再装入信封'] }, advice: { timing: '私下见面时交给对方', wording: '想把那次演唱会的回忆留在这张卡里。', relationship_cautions: [] }, physical: true },
  { label: '实体说明无材料枚举', name: '一本已有护封的书', context: '保留书本已有护封就好，不要额外材料采购。', packaging: { color_palette: ['浅灰'], description: '保留书本已有护封，整齐整理后直接交付即可。' }, advice: { timing: '方便见面时', wording: '这本书想分享给你。', relationship_cautions: [] }, physical: true },
];
const gift = (name, id = 'c1') => ({ id, name, description: name + '的赠送方向', estimated_total: '100', currency: 'CNY', estimated_preparation_days: 2, tags: ['other'], reason: '结合共同兴趣的心意', fact_refs: [], inferences: [], unknowns: ['具体资源待确认'] });
const presentation = scenario => ({ contract_version: 'giftwise-20261031-v2', style: '自然轻松', packaging: scenario.packaging, card_text: '希望和你分享这份心意。', giving_advice: scenario.advice, unknowns: ['具体安排尚待双方确认'], currency: 'CNY', revised_estimated_preparation_days: 2 });
function seed(scenario) {
  const request = { contract_version: 'giftwise-20261031-v2', recipient_relation: '朋友', recipient_relation_id: 'friend', occasion: '生日', budget_amount: '800', currency: 'CNY', available_days: null, facts: [], forbidden_tags: [], forbidden_terms: [], notes: scenario.context, exclusion_context: { raw_text: '不要太隆重', semantic: [{ interpretation: '轻松邀请，不造成回应压力' }] } };
  const candidates = [gift(scenario.name), gift('另一个方案', 'c2'), gift('第三个方案', 'c3')];
  const validation = validateForDecision(JSON.stringify(request), JSON.stringify({ candidates }), strictParse);
  assert.equal(validation.all_passed, true);
  const run = createRun({ owner_scope: 'controlled-' + scenario.label, mode: 'llm', request, request_json: JSON.stringify(request), candidates, validation, status: 'passed', selectable_candidate_ids: ['c1', 'c2', 'c3'], media_generation_authorized: false, repair_count: 0, notices: [] });
  run.product_bindings = new Map(); run.catalog_bindings = new Map(); run.media = { candidates: [], selected: null };
  return run;
}

for (const scenario of cases) test(`final sections reflect model-chosen actual content: ${scenario.label}`, async () => {
  const run = seed(scenario), value = presentation(scenario);
  let calls = 0, received;
  const out = await runPresentation({ runId: run.run_id, selectedCandidateId: 'c1', ownerScope: run.owner_scope }, { requestPresentation: async input => { calls++; received = input; return { ok: true, outputs: { presentation_json: JSON.stringify(value) } }; } });
  assert.equal(out.kind, 'presentation'); assert.equal(out.view.status, 'completed');
  assert.equal(run.repair_count, 0); assert.equal(calls, 1);
  assert.deepEqual(out.view.presentation_json, value);
  assert.deepEqual(JSON.parse(received.requestJson), run.request);
  assert.equal(JSON.parse(received.candidateJson).name, scenario.name);
  const packaging = out.view.sections.find(s => s.key === 'packaging');
  assert.equal(Boolean(packaging), scenario.physical);
  if (!scenario.physical) {
    assert.deepEqual(out.view.sections.map(s => s.key), ['style', 'card', 'giving']);
    assert.ok(out.view.sections.every(s => !/包装|呈现说明/.test(s.title)));
    assert.equal(out.view.sections.length, 3);
  } else {
    assert.match(packaging.title, /包装/);
    if (scenario.packaging.description) assert.ok(packaging.items.includes(scenario.packaging.description));
    for (const text of [...(scenario.packaging.materials ?? []), ...(scenario.packaging.steps ?? [])]) assert.ok(packaging.items.some(item => item.includes(text)));
  }
  const giving = out.view.sections.find(s => s.key === 'giving');
  assert.ok(giving.items.some(item => item.includes(scenario.advice.timing)));
  assert.ok(giving.items.some(item => item.includes(scenario.advice.wording)));
  const plan = buildImagePlan(run, 'c1', 'a'.repeat(64));
  const payload = JSON.parse(plan.prompt.split('\n').at(-1));
  assert.deepEqual(payload.presentation.packaging, scenario.packaging);
  assert.deepEqual(payload.presentation.giving_advice, scenario.advice);
  assert.equal(payload.user_context.notes, scenario.context);
  assert.equal(payload.gift.name, scenario.name);
  assert.match(plan.prompt, /没有实体交付时，以活动内容、邀请方式和空间氛围呈现/);
  assert.match(plan.prompt, /不凭空造出实体礼物、盒子、票券或纪念卡/);
  assert.doesNotMatch(plan.prompt, /选定礼物本体和其实际包装是视觉主角/);
  assert.equal(plan.selected.packaging.form, 'undetermined');
  assert.deepEqual(plan.selected.annotations, []);
  console.log(JSON.stringify({ scenario: scenario.label, controlled: true, sections: out.view.sections, packaging: out.view.presentation_json.packaging, giving_advice: out.view.presentation_json.giving_advice, real_model_calls: 0, real_image_calls: 0 }));
});

test('same final gift name can carry different model-selected packaging content without keyword routing', async () => {
  for (const physical of [false, true]) {
    const description = '已有信封保护实体纪念卡，不添加其他材料。';
    const scenario = { ...(physical ? cases[4] : cases[0]), label: '同名方案' + physical, name: '演唱会心意安排', packaging: { color_palette: ['深蓝'], ...(physical ? { description } : {}) } };
    const run = seed(scenario);
    const out = await runPresentation({ runId: run.run_id, selectedCandidateId: 'c1', ownerScope: run.owner_scope }, { requestPresentation: async () => ({ ok: true, outputs: { presentation_json: JSON.stringify(presentation(scenario)) } }) });
    assert.equal(out.view.status, 'completed');
    assert.equal(out.view.candidate.name, '演唱会心意安排');
    const packaging = out.view.sections.find(s => s.key === 'packaging');
    assert.equal(Boolean(packaging), physical);
    if (physical) { assert.equal(packaging.title, '② 包装说明'); assert.deepEqual(packaging.items, [description]); }
  }
});

test('local v2 fallback omits invented packaging rather than manufacturing a chapter', () => {
  const run = seed(cases[0]);
  const local = buildLocalPresentation(run.request, run.candidates[0]);
  assert.equal(checkPresentationForDecision(run.request, run.candidates[0], local.presentation).passed, true);
  assert.ok(!local.sections.some(s => s.key === 'packaging'));
  assert.deepEqual(local.presentation.packaging, { color_palette: local.presentation.packaging.color_palette });
});

test('optional packaging does not bypass shape, currency, price or explicit exclusion checks', () => {
  const run = seed(cases[0]), base = presentation(cases[0]);
  for (const packaging of [{}, { color_palette: [] }, { color_palette: ['米白'], steps: 3 }, { color_palette: ['米白'], materials: ['纸袋'] }, { color_palette: ['米白'], description: '   ' }, { color_palette: ['米白'], price: '1' }]) {
    assert.equal(checkPresentationForDecision(run.request, run.candidates[0], { ...base, packaging }).passed, false, JSON.stringify(packaging));
  }
  assert.ok(checkPresentationForDecision(run.request, { ...run.candidates[0], estimated_total: '900' }, base).errors.some(e => e.code === 'OVER_BUDGET'));
  assert.ok(checkPresentationForDecision({ ...run.request, forbidden_terms: ['亮粉'] }, run.candidates[0], { ...base, packaging: { color_palette: ['亮粉'] } }).errors.some(e => e.code === 'FORBIDDEN_TERM'));
  assert.ok(checkPresentationForDecision(run.request, run.candidates[0], { ...base, currency: 'USD' }).errors.some(e => e.code === 'UNSUPPORTED_CURRENCY'));
});

test('real presentation prompt delegates need to model, omits pure-experience packaging, and retains existing schema', () => {
  for (const scenario of [cases[0], cases[4]]) {
    const run = seed(scenario);
    const messages = buildPresentMessages(buildPresentEnvelope({ requestJson: run.request_json, candidateJson: JSON.stringify(run.candidates[0]) }));
    assert.match(messages[0].content, /纯体验且没有实体交付时不填写 materials、steps、description/);
    assert.match(messages[0].content, /有用的体验安排和邀请方式自然写在已有 giving_advice/);
    assert.match(messages[0].content, /description-only 不等于体验/);
    assert.match(messages[0].content, /实体邀请函、纪念卡或DIY实物/);
    assert.ok(messages[1].content.includes(scenario.context));
    assert.ok(messages[1].content.includes(scenario.name));
    assert.ok(!('gift_type' in JSON.parse(messages[1].content)));
  }
});
