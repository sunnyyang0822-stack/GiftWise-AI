import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, checkPresentation, withTimeAdvisories, deliveryDeadline, resolvePurchaseWindow } from '../server/checker.mjs';
import { strictParse } from '../server/jsonstrict.mjs';
import { runRecommendation, runPresentation } from '../server/pipeline.mjs';
import { buildMockRevision } from '../server/mock-model.mjs';
import { defaultProvider } from '../server/visual/provider.mjs';

// Injected regression fixtures: these are never evidence of real model/image execution.
const request = (extra = {}) => ({ contract_version:'giftwise-20261031-v2', recipient_relation:'恋人', occasion:'生日', budget_amount:'800', currency:'CNY', available_days:1, facts:[], forbidden_tags:[], forbidden_terms:[], notes:'', ...extra });
const candidate = (id, prep = 8, extra = {}) => ({ id, name:`礼物${id}`, description:`不同方向${id}`, estimated_total:'780.00', currency:'CNY', estimated_preparation_days:prep, tags:['other'], reason:'生日心意', fact_refs:[], inferences:[], unknowns:['库存未知'], fulfillment:'online', ...extra });
const batch = (first = candidate('c1')) => ({candidates:[first,candidate('c2'),candidate('c3')]});
const rawCheck = (r, b) => validate(JSON.stringify(r),JSON.stringify(b),strictParse);
const presentation = (days = 3) => ({contract_version:'giftwise-20261031-v2',style:'朴素',packaging:{color_palette:['米白']},card_text:'生日快乐',giving_advice:{timing:'方便时送出',wording:'一点心意',relationship_cautions:[]},unknowns:['库存未知'],currency:'CNY',revised_estimated_preparation_days:days});

test('time policy preserves untouched raw failures and allows three overdue candidates', () => {
  const raw = rawCheck(request(),batch());
  const saved = structuredClone(raw);
  const effective = withTimeAdvisories(raw);
  assert.deepEqual(raw,saved);
  assert.equal(raw.all_passed,false);
  assert.deepEqual(effective.raw_validation,saved);
  assert.equal(effective.all_passed,true);
  assert.equal(effective.status,'passed');
  assert.ok(effective.candidate_results.every(r=>r.passed && !r.errors.length && r.warnings.some(w=>w.code==='PREPARATION_TOO_LONG')));
});

for (const prep of [-1, '2', true, 1.5, null, undefined]) {
  test(`invalid preparation stays hard: ${String(prep)}`, () => {
    const first = candidate('c1',prep);
    if (prep === undefined) delete first.estimated_preparation_days;
    const result = withTimeAdvisories(rawCheck(request(),batch(first)));
    assert.equal(result.candidate_results[0].passed,false);
    assert.ok(result.candidate_results[0].errors.some(e=>['INVALID_TYPE','MISSING_FIELD'].includes(e.code)));
  });
}

test('budget, exclusions, invalid request and batch shape remain hard', () => {
  for (const [r,b,code] of [
    [request(),batch(candidate('c1',8,{estimated_total:'801.00'})),'OVER_BUDGET'],
    [request({forbidden_tags:['food']}),batch(candidate('c1',8,{tags:['food']})),'FORBIDDEN_TAG'],
    [request({available_days:-1}),batch(),'INVALID_TYPE'],
    [request(),{candidates:[candidate('c1')]},'INVALID_CANDIDATE_COUNT'],
    [request(),batch(candidate('c1',8,{currency:'USD'})),'CURRENCY_MISMATCH'],
  ]) {
    const out=withTimeAdvisories(rawCheck(r,b));
    assert.equal(out.all_passed,false);
    assert.ok([...out.errors,...out.candidate_results.flatMap(x=>x.errors)].some(e=>e.code===code),code);
  }
});

for (const available of [1,5,7,30]) {
  test(`unknown online shipping is 3~5 days regardless of deadline ${available}`, () => {
    const out=deliveryDeadline({prep_days:8,available_days:available});
    assert.deepEqual(out.errors,[]);
    assert.equal(out.purchase_window.min,3);
    assert.equal(out.purchase_window.max,5);
    assert.equal(out.tier_inclusive,false);
    assert.equal(out.shipping_days_source,'default_estimate');
    assert.equal(out.total_days,13);
    assert.match(out.warnings.find(w=>w.code==='SHIPPING_TIME_UNKNOWN').message,/3~5/);
  });
}

test('observed full and partial logistics remain distinguishable', () => {
  const known=resolvePurchaseWindow({ships_within_days:2,shipping_days:4});
  assert.equal(known.source,'page_observed');
  assert.equal(known.days,6);
  const partial=resolvePurchaseWindow({ships_within_days:9});
  assert.equal(partial.source,'default_estimate');
  assert.equal(partial.detail.observed,9);
  assert.equal(partial.min,12);
  assert.equal(partial.max,14);
  const shippingOnly=deliveryDeadline({prep_days:1,available_days:2,shipping_days:4});
  assert.equal(shippingOnly.total_days,null);
  assert.match(shippingOnly.warnings[0].message,/发货时间未知/);
  const sale=deliveryDeadline({prep_days:1,available_days:1,is_preorder:true});
  assert.deepEqual(sale.errors,[]);
  assert.equal(sale.effective_presale_days,null);
  assert.ok(sale.warnings.some(w=>w.code==='PRESALE_TIME_UNKNOWN'));
});

for (const fulfillment of ['offline','experience']) test(`${fulfillment} overtime is advisory without shipping`,()=>{
  const out=deliveryDeadline({fulfillment,prep_days:8,available_days:1});
  assert.deepEqual(out.errors,[]);
  assert.equal(out.effective_shipping_days,null);
  assert.equal(out.total_days,8);
  assert.ok(out.warnings.some(w=>w.code==='PREPARATION_TOO_LONG'));
});

test('presentation time policy preserves raw candidate and presentation time failures', () => {
  const raw=checkPresentation(request(),candidate('c1',2),presentation(3));
  assert.equal(raw.passed,false);
  const effective=withTimeAdvisories(raw);
  assert.equal(effective.passed,true);
  assert.equal(effective.raw_validation.passed,false);
  assert.ok(effective.warnings.some(w=>w.path==='presentation.revised_estimated_preparation_days'));
});

const intake = (deadline = 7) => ({contract_version:'giftwise-20261031-v2',budget_mode:'other',budget_range:{min:'0',max:'800'},currency:'CNY',deadline_days:deadline,recipient_relation:'partner',closeness:'unknown',occasion:'birthday',interests:[],interest_confidence:{},gift_styles:[],dislikes:'',hard_exclusions:{tags:[],terms:[],unresolved:[]},additional_context:''});
const services = (items, capture = ()=>{}) => ({
  requestCandidates:async()=>({ok:true,outputs:{candidates_json:JSON.stringify({candidates:items})}}),
  libraryEnabled:false,catalogScrape:false,
  provideRealProducts:async({candidates})=>{capture(candidates);return {catalog:{status:'unavailable',results:[]}};},
  visualDirectionProvider:defaultProvider({channel:'rules'}),
});

test('pipeline keeps three overdue candidates eligible for catalog binding and selection',async()=>{
  let offered;
  const out=await runRecommendation({mode:'llm',intake:{...intake(1),additional_context:'catalog binding regression'},inputParse:{constraints:{days_band:{user_days:1,band_days:1}}}},services(batch().candidates,items=>offered=items));
  assert.equal(offered.length,3);
  assert.equal(out.run.initial_validation.all_passed,false);
  assert.equal(out.run.initial_validation.candidate_results[0].warnings.length,0);
  assert.equal(out.run.validation.raw_validation.all_passed,false);
  assert.deepEqual(out.report.selectable_candidate_ids,['c1','c2','c3']);
  assert.equal(out.run.repair_count,0);
  assert.ok(Object.values(out.run.delivery.per_candidate).every(d=>d.errors.length===0));
  assert.ok(out.report.validation.candidate_results[0].warnings.some(w=>w.code==='DELIVERY_BEYOND_DAYS_TOLERANCE'));
});

test('aligned presentation removes obsolete model overtime warning but retains raw evidence',async()=>{
  const out=await runRecommendation({mode:'llm',intake:{...intake(2),additional_context:'alignment removes stale warning'}},services(batch(candidate('c1',2)).candidates));
  const result=await runPresentation({runId:out.run.run_id,selectedCandidateId:'c1'},{requestPresentation:async()=>({ok:true,outputs:{presentation_json:JSON.stringify(presentation(3))}})});
  assert.equal(result.view.status,'completed');
  const check=result.view.presentation_check;
  assert.ok(check.raw_validation.errors.some(e=>e.code==='PREPARATION_TOO_LONG'));
  assert.ok(!check.warnings.some(w=>w.code==='PREPARATION_TOO_LONG'));
  assert.equal(result.view.presentation_json.revised_estimated_preparation_days,2);
});

test('pipeline aligns valid presentation 3 days to selected 2 days without spending repair',async()=>{
  const out=await runRecommendation({mode:'llm',intake:{...intake(1),additional_context:'preparation alignment regression'}},services(batch(candidate('c1',2)).candidates));
  const result=await runPresentation({runId:out.run.run_id,selectedCandidateId:'c1'},{requestPresentation:async()=>({ok:true,outputs:{presentation_json:JSON.stringify(presentation(3))}})});
  assert.equal(result.view.status,'completed');
  assert.equal(result.view.candidate.estimated_preparation_days,2);
  assert.equal(result.view.presentation_json.revised_estimated_preparation_days,2);
  assert.equal(result.view.recheck_summary.revised_estimated_preparation_days,2);
  assert.equal(result.view.shipping.total_days,7);
  assert.equal(result.view.repair_count,0);
  assert.ok(result.view.presentation_check.warnings.some(w=>w.code==='PREPARATION_ESTIMATE_ALIGNED'));
  assert.equal(result.view.presentation_check.raw_validation.passed,false);
});

test('pipeline does not hide invalid/missing presentation days while aligning',async()=>{
  for (const value of ['3',-1,undefined,2.5]) {
    const out=await runRecommendation({mode:'llm',intake:{...intake(),additional_context:`invalid preparation ${String(value)}`}},services(batch(candidate('c1',2)).candidates));
    const p=presentation(value);
    if (value===undefined) delete p.revised_estimated_preparation_days;
    const result=await runPresentation({runId:out.run.run_id,selectedCandidateId:'c1'},{requestPresentation:async()=>({ok:true,outputs:{presentation_json:JSON.stringify(p)}})});
    assert.equal(result.view.status,'presentation_failed');
    assert.ok(result.view.presentation_check.errors.some(e=>e.path==='presentation.revised_estimated_preparation_days'));
  }
});

test('non-time mock repair does not invent shorter preparation or express availability',()=>{
  const b=batch(candidate('c1',8,{estimated_total:'900.00'}));
  const effective=withTimeAdvisories(rawCheck(request(),b));
  const revised=buildMockRevision(request(),b.candidates,effective);
  assert.equal(revised.candidates[0].estimated_preparation_days,8);
  assert.doesNotMatch(revised.candidates[0].name,/现货速购/);
});
