import test from'node:test';import assert from'node:assert/strict';
import{mkdtempSync,readFileSync,readdirSync,writeFileSync}from'node:fs';import{join}from'node:path';
import{runRecommendation}from'../server/pipeline.mjs';import{reset}from'../server/store.mjs';
import{buildMockCandidates}from'../server/mock-model.mjs';import{createRetrievalAudit}from'../server/retrieval/audit-store.mjs';
import{REPO_ROOT}from'../server/localdb/db.mjs';import{taskDirectory}from'../server/collect/task-paths.mjs';
const base=JSON.parse(readFileSync(new URL('../../workflow/examples/intake.json',import.meta.url),'utf8'));
const intake=()=>({...structuredClone(base),budget_amount:'800',deadline_days:null,interests:[],interest_confidence:{},hard_exclusions:{tags:[],terms:[],unresolved:[]}});
const directory=()=>mkdtempSync(join(taskDirectory(join(REPO_ROOT,'.tmp/audit-pipeline')),'case-'));
const services=extra=>({libraryEnabled:false,provideRealProducts:async()=>({catalog:{status:'unavailable',results:[]}}),visualDirectionProvider:{derive:async()=>({ok:false,code:'OFFLINE'})},...extra});
const modelFinal=input=>({ok:true,outputs:{candidates_json:buildMockCandidates(JSON.parse(input.requestJson)).candidates_json}});
const call={name:'opencli_search',arguments:{purpose:'reference',keyword:'离线审计',sources:['bing'],reason:'PRIVATE_REASON'}};
test('工具返回前落盘，final后关联同run；公开report无内部审计，未请求工具也有明确记录',async()=>{
 for(const useTool of [true,false]){reset();const dir=directory(),audit=createRetrievalAudit({directory:dir});
  const outcome=await runRecommendation({intake:intake(),mode:'llm'},services({retrievalAuditStore:audit,retrievalWorker:{submit:async()=>({status:'unavailable',references:[],coverage:[{source:'bing',status:'empty',observed_count:0,complete:false}]})},requestCandidates:async input=>{
   if(useTool){await input.executeTool(call);const saved=JSON.parse(readFileSync(join(dir,readdirSync(dir)[0]),'utf8'));assert.equal(saved.run_id,null);assert.equal(saved.calls_total,1);assert.equal(saved.calls[0].coverage[0].status,'empty');}
   return modelFinal(input);
  }}));
  assert.equal(outcome.kind,'report');const saved=JSON.parse(readFileSync(join(dir,readdirSync(dir)[0]),'utf8'));assert.equal(saved.run_id,outcome.run.run_id);assert.equal(saved.calls_total,useTool?1:0);assert.equal(saved.status,useTool?'completed':'no_tool_calls');assert.equal('retrieval_audit'in outcome.report,false);assert.equal(JSON.stringify(outcome.report).includes('PRIVATE_REASON'),false);
 }
});
test('模型失败保留前序查询与明确失败状态；审计写失败不影响3条合法建议',async()=>{
 reset();const dir=directory(),audit=createRetrievalAudit({directory:dir});
 const failed=await runRecommendation({intake:intake(),mode:'llm'},services({retrievalAuditStore:audit,retrievalWorker:{submit:async()=>({status:'unavailable',coverage:[{source:'bing',status:'SOURCE_FAILED'}]})},requestCandidates:async input=>{await input.executeTool(call);return{ok:false,code:'LLM_TIMEOUT',message:'fixture'};}}));
 assert.equal(failed.kind,'infrastructure_error');const saved=JSON.parse(readFileSync(join(dir,readdirSync(dir)[0]),'utf8'));assert.equal(saved.status,'failed');assert.equal(saved.error_code,'LLM_TIMEOUT');assert.equal(saved.calls_total,1);
 reset();const block=join(directory(),'blocked');writeFileSync(block,'fixture');const broken=createRetrievalAudit({directory:block,onDiagnostic:()=>{}});
 const out=await runRecommendation({intake:intake(),mode:'llm'},services({retrievalAuditStore:broken,requestCandidates:async input=>modelFinal(input)}));assert.equal(out.kind,'report');assert.equal(out.report.selectable_candidate_ids.length,3);assert.equal(out.run.retrieval_audit.persistence.status,'failed');
});

test('补图只在A最终三候选成功边界启动，使用修订后冻结集合；失败不启动',async()=>{
 for(const repairOk of [true,false]){reset();let jobs=0;
  const outcome=await runRecommendation({intake:intake(),mode:'llm'},services({referenceImagesEnabled:true,
   requestCandidates:async input=>{const result=modelFinal(input),batch=JSON.parse(result.outputs.candidates_json);batch.candidates[0].estimated_total='900';result.outputs.candidates_json=JSON.stringify(batch);return result;},
   requestCandidateRevision:async input=>{if(!repairOk)return{ok:false,code:'CONTROLLED_REPAIR_FAILED'};const batch=JSON.parse(input.candidatesJson);batch.candidates[0].estimated_total='120';batch.candidates[0].name='最终修订礼物方向';return{ok:true,outputs:{candidates_json:JSON.stringify(batch)}};},
   requestReferenceImages:async input=>{jobs++;assert.equal(input.candidates.length,3);assert.equal(input.candidates[0].name,'最终修订礼物方向');assert.equal(input.candidates[0].estimated_total,'120');return{ok:true,reference_references:[],model_calls:0};},
  }));
  if(repairOk){assert.equal(outcome.kind,'report');const before=JSON.stringify(outcome.run.candidates);await outcome.run.reference_image_job.promise;assert.equal(jobs,1);assert.equal(JSON.stringify(outcome.run.candidates),before);assert.equal(outcome.run.reference_image_slots.length,3);assert.ok(outcome.run.reference_image_slots.every(s=>s.status==='unavailable'));}
  else{assert.equal(outcome.kind,'recommendation_failed');assert.equal(jobs,0);assert.equal(outcome.run.reference_image_job,undefined);}
 }
});
