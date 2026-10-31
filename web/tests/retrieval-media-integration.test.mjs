import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LlmProvider} from '../server/llm/provider.mjs';
import {OpenAiCompatibleTransport} from '../server/llm/transport.mjs';
import {buildMockCandidates,buildMockPresentation} from '../server/mock-model.mjs';
import {bindOptionalCandidateEvidence} from '../server/retrieval/evidence.mjs';
import {runRecommendation,runPresentation} from '../server/pipeline.mjs';
import {reset} from '../server/store.mjs';

// All model/tool responses below are controlled fixtures, never real model/platform/image calls.
process.env.GIFTWISE_STYLE_DIRECTION_CHANNEL='rules';
process.env.GW_LOCAL_DB=fileURLToPath(new URL('../../.tmp/issue98-integration/catalog.sqlite',import.meta.url));
process.env.GW_LLM_LEDGER_FILE=fileURLToPath(new URL('../../.tmp/issue98-integration/ledger.jsonl',import.meta.url));
const base=JSON.parse(readFileSync(new URL('../../workflow/examples/intake.json',import.meta.url)));
const intake=()=>({...structuredClone(base),budget_amount:'600',deadline_days:30,interests:['tech_digital'],interest_confidence:{tech_digital:'confirmed'},hard_exclusions:{tags:[],terms:[],unresolved:[]}});
const publicReference=()=>({reference_id:'fixture-reference-1',reference_kind:'public_reference',title:'公开创意记录灵感',source_url:'https://example.test/inspiration',image_id:null,image_kind:'reference_image'});
function controlledServices({useTool=true,references=[publicReference()],citations,mutate,delay=0}={}){
 const counts={searches:0,models:0,http:0};let request;
 const transport=new OpenAiCompatibleTransport({fetchImpl:async(_url,{body})=>{
  counts.http++;const call=JSON.parse(body);const returned=call.messages.some(m=>m.role==='tool');
  if(useTool&&!returned)return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'controlled-public-search',type:'function',function:{name:'opencli_search',arguments:JSON.stringify({purpose:'reference',keyword:'创意记录 灵感 图片',sources:['duckduckgo'],reason:'为当前方案获取公开灵感资料'})}}]}}]})};
  if(returned){const feedback=JSON.parse(call.messages.at(-1).content);assert.equal(feedback.products.length,0);assert.equal(feedback.recommendations_available,true);}
  const candidates=buildMockCandidates(request).candidates;for(const c of candidates){delete c._mock_source;delete c.presentation;}
  mutate?.(candidates);
  const refs=citations??(useTool&&references.length?[{candidate_id:'c1',reference_id:references[0].reference_id}]:undefined);
  return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({candidates,...(refs?{reference_references:refs}:{})})}}]})};
 }});
 const provider=new LlmProvider({live:transport,config:()=>({baseUrl:'https://synthetic-model.example.test/v1',apiKey:'synthetic-key',model:'offline-fixture',timeoutMs:1000,maxRetries:0,maxTokens:2048,outputRetries:0}),hasConfig:()=>true});
 const services={retrievalEnabled:true,libraryEnabled:false,enableImageGeneration:false,
  retrievalWorker:{submit:async plan=>{counts.searches++;assert.equal(plan.queries[0].purpose,'reference');assert.deepEqual(plan.queries[0].sources,['duckduckgo']);if(delay)await new Promise(r=>setTimeout(r,delay));return {status:references.length?'partial':'unavailable',products:[],references,contents:[],images:[],coverage:[{source:'duckduckgo',status:references.length?'controlled_fixture':'empty',observed_count:references.length,pages_completed:1}],enrichment_only:true};}},
  requestCandidates:async input=>{counts.models++;request=JSON.parse(input.requestJson);return provider.requestCandidates(input);},
  provideRealProducts:async()=>({catalog:{status:'unavailable',results:[],accounting:{scrape_calls:0}},scrapes:[]}),
  visualDirectionProvider:{derive:async()=>({ok:false,code:'CONTROLLED_DIRECTION_NOT_REQUESTED',notices:[]})},
 };
 return {services,counts};
}
function report(outcome){assert.equal(outcome.kind,'report',JSON.stringify(outcome.errors));return outcome.report;}

test('受控非电商tool结果→模型final→可选参考引用；保留归属隔离与选后并发幂等',async()=>{
 reset();const {services,counts}=controlledServices();const outcome=await runRecommendation({intake:intake(),mode:'llm',ownerScope:'A'},services);
 const view=report(outcome);assert.deepEqual(view.selectable_candidate_ids,['c1','c2','c3']);assert.equal(counts.searches,1);assert.equal(counts.models,1);assert.equal(counts.http,2);assert.equal(outcome.run.call_counts.recommend,2);
 assert.equal(outcome.run.retrieval_audit.protocol,'model_tool_calls');assert.equal(outcome.run.product_bindings.size,0);assert.equal(outcome.run.reference_bindings.size,1);assert.equal(outcome.run.reference_bindings.get('c1').reference_id,'fixture-reference-1');assert.equal(view.media.selected,null);
 assert.ok(view.media.candidates.every(c=>c.image===null)); // No fixture image bytes: never claim three real pictures passed.
 const wrong=await runPresentation({runId:outcome.run.run_id,selectedCandidateId:'c1',ownerScope:'B'});assert.equal(wrong.kind,'not_found');
 let presentations=0;
 const presentationServices={requestPresentation:async({request,candidate})=>{presentations++;const built=buildMockPresentation(request,candidate);return {ok:true,outputs:{presentation_json:built.presentation_json},generated_by:'controlled_fixture',transport:'synthetic'};}};
 const event={runId:outcome.run.run_id,selectedCandidateId:'c1',ownerScope:'A'};
 const [a,b]=await Promise.all([runPresentation(event,presentationServices),runPresentation(event,presentationServices)]);
 assert.equal(a.kind,'presentation',JSON.stringify(a.errors));assert.equal(b.kind,'presentation');assert.equal(presentations,1);assert.equal(a.view.media.selected.candidate_id,'c1');assert.equal(a.view.media.selected.image,null);assert.equal(a.view.media.selected.task_id,b.view.media.selected.task_id);
 const replay=await runPresentation(event,presentationServices);assert.equal(replay.view.media.selected.task_id,a.view.media.selected.task_id);assert.equal(presentations,1);
});

test('未知或歧义公开引用只拒绑对应图片，不拒绝整批三方案',async()=>{
 for(const citations of [[{candidate_id:'c1',reference_id:'other-run-reference'}],[{candidate_id:'c1',reference_id:'fixture-reference-1'},{candidate_id:'c1',reference_id:'second-reference'}]]){
  reset();const {services}=controlledServices({citations});const outcome=await runRecommendation({intake:intake(),mode:'llm'},services);
  assert.deepEqual(report(outcome).selectable_candidate_ids,['c1','c2','c3']);assert.equal(outcome.run.reference_bindings.size,0);assert.equal(outcome.run.product_bindings.size,0);
  assert.ok(outcome.run.retrieval_audit.rejected_references.some(r=>['UNKNOWN_REFERENCE','AMBIGUOUS_REFERENCE'].includes(r.code)));
 }
});

test('无资料仍经tool后final；无工具直接final不要求兴趣或三条SKU，会话互相隔离',async()=>{
 reset();const unknown={...intake(),interests:[],interest_confidence:{}};
 const empty=controlledServices({references:[]});const a=await runRecommendation({intake:unknown,mode:'llm',ownerScope:'empty-A'},empty.services);
 assert.deepEqual(report(a).selectable_candidate_ids,['c1','c2','c3']);assert.equal(empty.counts.searches,1);assert.equal(empty.counts.http,2);assert.equal(a.run.product_bindings.size,0);
 const direct=controlledServices({useTool:false});const b=await runRecommendation({intake:unknown,mode:'llm',ownerScope:'direct-B'},direct.services);
 assert.deepEqual(report(b).selectable_candidate_ids,['c1','c2','c3']);assert.equal(direct.counts.searches,0);assert.equal(direct.counts.http,1);assert.equal(b.report.retrieval.status,'skipped');assert.notEqual(a.run.run_id,b.run.run_id);
 assert.equal((await runPresentation({runId:a.run.run_id,selectedCandidateId:'c1',ownerScope:'direct-B'})).kind,'not_found');
});

test('已知预算越界必须修订或整批失败；历史规格不符或跨任务ID只拒绝来源绑定',async()=>{
 reset();const over=controlledServices({useTool:false,mutate:candidates=>{candidates[0].estimated_total='601.00';}});
 over.services.requestCandidateRevision=async()=>({ok:false,code:'CONTROLLED_REPAIR_UNAVAILABLE'});
 const outcome=await runRecommendation({intake:intake(),mode:'llm'},over.services);assert.equal(outcome.kind,'recommendation_failed');assert.equal(outcome.errors[0].code,'RECOMMENDATION_INCOMPLETE');assert.deepEqual(outcome.run.selectable_candidate_ids,[]);assert.ok(outcome.run.validation.candidate_results[0].errors.some(e=>e.code==='OVER_BUDGET'));assert.ok(outcome.run.validation.candidate_results.slice(1).every(r=>r.passed));assert.equal(outcome.run.repair_count,1);
 // Pure legacy-evidence fixtures test non-time binding constraints; no commerce adapter is called.
 const historical={product_id:'legacy-one-item',name:'历史杯具',variant:'四只装',price_amount:'50',price_conditions:[],price_source:'seed',observed_at:null};
 const candidate={id:'c1',name:'另一件物品',description:'独立方案',estimated_total:'50'};
 const mismatch=bindOptionalCandidateEvidence({products:[historical]},[candidate],[{candidate_id:'c1',product_id:historical.product_id}],'600');assert.equal(mismatch.bindings.size,0);assert.equal(mismatch.rejected[0].code,'PRODUCT_SPEC_MISMATCH');
 const foreign=bindOptionalCandidateEvidence({products:[historical]},[candidate],[{candidate_id:'c1',product_id:'other-run'}],'600');assert.equal(foreign.bindings.size,0);assert.equal(foreign.rejected[0].code,'UNKNOWN_PRODUCT');
 const knownOverBudget=bindOptionalCandidateEvidence({products:[{...historical,price_amount:'601.00',observed_at:new Date().toISOString()}]},[{...candidate,name:'历史杯具 · 四只装'}],[{candidate_id:'c1',product_id:historical.product_id}],'600');assert.deepEqual(knownOverBudget.knownOverBudget,['c1']);
});

test('并发重复推荐只执行一次受控公开检索与完整模型回路',async()=>{
 reset();const {services,counts}=controlledServices({delay:5});const input={intake:intake(),mode:'llm',ownerScope:'repeat'};
 const [a,b]=await Promise.all([runRecommendation(input,services),runRecommendation(input,services)]);
 assert.deepEqual(report(a).selectable_candidate_ids,['c1','c2','c3']);assert.equal(a.run.run_id,b.run.run_id);assert.equal(counts.searches,1);assert.equal(counts.models,1);assert.equal(counts.http,2);
});
