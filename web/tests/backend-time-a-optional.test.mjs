import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, validateForDecision, validateRequestOnly, requestIsValid, checkPresentationForDecision } from '../server/checker.mjs';
import { PURCHASE_WINDOW_CONFIG } from '../server/config.mjs';
import { strictParse } from '../server/jsonstrict.mjs';
import { buildRecommendEnvelope, buildRecommendMessages } from '../server/llm/prompt.mjs';
import { buildMockCandidates } from '../server/mock-model.mjs';

const req = () => ({contract_version:'giftwise-20261031-v2',recipient_relation:'恋人',occasion:'生日',budget_amount:'800',currency:'CNY',available_days:null,facts:[],forbidden_tags:[],forbidden_terms:[],notes:''});
const gift = (id, extra={}) => ({id,name:`方案${id}`,description:`不同方向${id}`,estimated_total:'780.00',currency:'CNY',estimated_preparation_days:8,tags:['other'],reason:'生日心意',fact_refs:[],inferences:[],unknowns:[],...extra});
const batch = (first=gift('c1')) => ({candidates:[first,gift('c2'),gift('c3')]});
const p = () => ({contract_version:'giftwise-20261031-v2',style:'简洁',packaging:{color_palette:['米白']},card_text:'生日快乐',giving_advice:{timing:'方便时送出',wording:'一点心意',relationship_cautions:[]},unknowns:[],currency:'CNY',revised_estimated_preparation_days:8});
const check = (r,b) => validateForDecision(JSON.stringify(r),JSON.stringify(b),strictParse);

for (const absent of [true,false]) test(`optional time ${absent?'missing':'null'} runs full validation and retains strict raw failure`,()=>{
  const r=req();if(absent)delete r.available_days;
  const original=JSON.stringify(r);
  const raw=validate(original,JSON.stringify(batch()),strictParse);
  const out=check(r,batch());
  assert.equal(raw.status,'needs_input');
  assert.deepEqual(out.raw_validation,raw);
  assert.equal(out.all_passed,true);
  assert.ok(out.candidate_results.every(c=>c.passed));
  assert.equal(JSON.stringify(r),original);
  assert.ok(requestIsValid(validateRequestOnly(original,strictParse)));
});

for (const [label,extra,code] of [
  ['budget',{estimated_total:'801.00'},'OVER_BUDGET'],
  ['currency',{currency:'USD'},'CURRENCY_MISMATCH'],
  ['tag',{tags:['food']},'FORBIDDEN_TAG'],
  ['text',{description:'禁词'},'FORBIDDEN_TERM'],
  ['fact',{fact_refs:['invented']},'UNKNOWN_FACT_REF'],
  ['amount',{estimated_total:'bad'},'INVALID_AMOUNT'],
  ['field',{name:''},'INVALID_TYPE'],
]) test(`null time does not skip candidate ${label} checks`,()=>{
  const r={...req(),forbidden_tags:['food'],forbidden_terms:['禁词']};
  const out=check(r,batch(gift('c1',extra)));
  assert.equal(out.all_passed,false);
  assert.ok(out.candidate_results[0].errors.some(e=>e.code===code),JSON.stringify(out));
});

test('null time retains missing fields, batch count and duplicate ID errors',()=>{
  const missing=gift('c1');delete missing.estimated_total;
  assert.ok(check(req(),batch(missing)).candidate_results[0].errors.some(e=>e.code==='MISSING_FIELD'));
  for(const [b,code] of [[{candidates:[gift('c1')]},'INVALID_CANDIDATE_COUNT'],[{candidates:[gift('c1'),gift('c1'),gift('c3')]},'DUPLICATE_ID']]){
    const out=check(req(),b);assert.equal(out.all_passed,false);assert.ok(out.errors.some(e=>e.code===code));
  }
});

test('null time retains invalid request budget/currency and malformed nonnull time',()=>{
  for(const r of [{...req(),budget_amount:'bad'},{...req(),currency:'USD'},{...req(),available_days:'7'},{...req(),available_days:-1},{...req(),available_days:366}]){
    const out=check(r,batch());assert.equal(out.all_passed,false);assert.equal(out.status,'needs_input');
  }
});

test('null time presentation validates selected gift budget, exclusions, fields and currency',()=>{
  assert.equal(checkPresentationForDecision(req(),gift('c1'),p()).passed,true);
  const budget=checkPresentationForDecision(req(),gift('c1',{estimated_total:'900.00'}),p());
  assert.ok(budget.errors.some(e=>e.code==='OVER_BUDGET'));
  const text=checkPresentationForDecision({...req(),forbidden_terms:['米白']},gift('c1'),p());
  assert.ok(text.errors.some(e=>e.code==='FORBIDDEN_TERM'));
  const malformed=p();delete malformed.card_text;
  assert.equal(checkPresentationForDecision(req(),gift('c1'),malformed).passed,false);
  assert.equal(checkPresentationForDecision(req(),gift('c1'),{...p(),currency:'USD'}).passed,false);
});

test('legacy null-time presentation also checks request, selected gift and full cost',()=>{
  const r=req();delete r.contract_version;
  const legacy={packaging:{materials:['纸袋'],steps:['装入'],color_palette:['米白']},card_text:'生日快乐',giving_advice:{timing:'方便时',wording:'一点心意'},unknowns:[],additional_cost:'0.00',revised_estimated_total:'780.00',currency:'CNY',revised_estimated_preparation_days:8};
  assert.equal(checkPresentationForDecision(r,gift('c1'),legacy).passed,true);
  assert.ok(checkPresentationForDecision({...r,forbidden_tags:['food']},gift('c1',{tags:['food']}),legacy).errors.some(e=>e.code==='FORBIDDEN_TAG'));
  assert.ok(checkPresentationForDecision(r,gift('c1'),{...legacy,additional_cost:'50.00',revised_estimated_total:'830.00'}).errors.some(e=>e.code==='OVER_BUDGET'));
  assert.equal(checkPresentationForDecision({...r,budget_amount:'bad'},gift('c1'),legacy).passed,false);
});

test('recommendation envelopes omit deadlines and bands while preserving budget and preferences',()=>{
  const r={...req(),available_days:1};
  const envelope=buildRecommendEnvelope({requestJson:JSON.stringify(r),intakeJson:JSON.stringify({deadline_days:1,budget_amount:'800',interests:['music_movies']}),inputParse:{days_band:{min:0,max:2},budget_band:{min:'750',max:'800'},literal_preferences:['喜欢现场音乐']}});
  assert.ok(!Object.hasOwn(JSON.parse(envelope.request_json),'available_days'));
  assert.ok(!Object.hasOwn(JSON.parse(envelope.intake_json),'deadline_days'));
  assert.ok(!Object.hasOwn(envelope.input_constraints,'days_band'));
  assert.equal(JSON.parse(envelope.request_json).budget_amount,'800');
  assert.deepEqual(envelope.input_constraints.literal_preferences,['喜欢现场音乐']);
  assert.match(buildRecommendMessages(envelope)[0].content,/不得使用送礼时间筛选、排序或淘汰礼物/);
  assert.match(buildRecommendMessages(envelope)[0].content,/不输出赶不上、来不及等时间风险警告/);
  assert.doesNotMatch(PURCHASE_WINDOW_CONFIG.not_a_guarantee,/由你|赶不上|赶得上/);
  assert.equal(r.available_days,1);
});

test('changing or omitting deadline leaves model decision context and mock ranking identical',()=>{
  const contexts=[null,1,365].map(available_days=>{
    const r={...req(),available_days};
    return {envelope:buildRecommendEnvelope({requestJson:JSON.stringify(r)}),mock:buildMockCandidates(r).candidates};
  });
  assert.deepEqual(contexts[0],contexts[1]);
  assert.deepEqual(contexts[1],contexts[2]);
});
