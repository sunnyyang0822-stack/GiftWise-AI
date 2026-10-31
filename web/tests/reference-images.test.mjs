import test from'node:test';import assert from'node:assert/strict';
import{startReferenceImages}from'../server/retrieval/reference-images.mjs';
import{createOpencliToolSession}from'../server/retrieval/agent-tool.mjs';
import{LlmProvider}from'../server/llm/provider.mjs';
import{OpenAiCompatibleTransport}from'../server/llm/transport.mjs';
const candidates=['陶艺体验','咖啡角布置','手写旅行册'].map((name,i)=>({id:'c'+(i+1),name,description:'离线候选'+i}));
const refs=()=>candidates.map((c,i)=>({reference_id:'ref_'+c.id,title:c.name,reference_kind:'public_reference',source_url:'https://www.bilibili.com/video/BVfixture'+i+'/',image_kind:'reference_image',image_id:String(i+1).repeat(32),image_validation:{ok:true,width:100,height:100,sha256:String(i+1).repeat(64)}}));
const makeRun=()=>({run_id:'gw-offline-images',created_at:new Date().toISOString(),owner_scope:'offline-owner',candidates:structuredClone(candidates),retrieval:{products:[],references:[]},media:{status:'unavailable',candidates:[],selected:null},selectable_candidate_ids:['c1','c2','c3'],call_counts:{}});
const citations=()=>candidates.map(c=>({candidate_id:c.id,reference_id:'ref_'+c.id}));
const searchCall={name:'opencli_search',arguments:{purpose:'reference',keyword:'离线图片',sources:['bing'],reason:'offline'}};

test('文字/候选先可读，单任务补齐3个唯一真实引用；不改候选/可选性/选后图',async()=>{
 const run=makeRun(),snapshot=JSON.stringify(run.candidates);let release,calls=0;
 const gate=new Promise(r=>release=r),session=createOpencliToolSession({search:async()=>({status:'partial',references:refs()})});
 const options={session,requestJson:'{}',requestImages:async input=>{calls++;assert.deepEqual(input.missingCandidateIds,['c1','c2','c3']);await gate;await input.executeTool(searchCall);return{ok:true,model_calls:2,reference_references:citations()};}};
 const job=startReferenceImages(run,options);assert.ok(run.reference_image_slots.every(s=>s.status==='pending'));assert.equal(startReferenceImages(run,options),job);
 run.media.selected={status:'pending',task_id:'separate-ai-task'};release();await job.promise;
 assert.equal(calls,1);assert.equal(job.status,'ready');assert.ok(run.reference_image_slots.every(s=>s.status==='ready'&&s.image.kind==='reference_image'));assert.equal(new Set(run.reference_image_slots.map(s=>s.image.id)).size,3);assert.equal(JSON.stringify(run.candidates),snapshot);assert.deepEqual(run.selectable_candidate_ids,['c1','c2','c3']);assert.equal(run.media.selected.task_id,'separate-ai-task');assert.equal(run.call_counts.reference_images,2);
});
test('已有3张有效相关图不调用模型；重复原图/歧义引用不凑三图',async()=>{
 const run=makeRun(),r=refs();run.retrieval.references=r;
 run.media.candidates=r.map((ref,i)=>({candidate_id:candidates[i].id,reference_id:ref.reference_id,image:{kind:'reference_image',id:ref.image_id,url:`/api/reference/images/${ref.image_id}`}}));
 await startReferenceImages(run,{session:{},requestImages:()=>{throw Error('must not call');}}).promise;assert.equal(run.reference_image_job.status,'ready');
 const duplicate=makeRun(),records=refs();records[1].image_validation.sha256=records[0].image_validation.sha256;
 const session=createOpencliToolSession({search:async()=>({status:'partial',references:records})});
 const job=startReferenceImages(duplicate,{session,requestJson:'{}',requestImages:async input=>{await input.executeTool(searchCall);return{ok:true,reference_references:[...citations(),{candidate_id:'c3',reference_id:'ref_c1'}]};}});await job.promise;
 assert.equal(job.status,'unavailable');assert.equal(duplicate.reference_image_slots.filter(s=>s.status==='ready').length,1);assert.ok(duplicate.reference_image_slots.filter(s=>s.status!=='ready').every(s=>s.status==='unavailable'&&s.image===null));assert.deepEqual(duplicate.selectable_candidate_ids,['c1','c2','c3']);
});
test('短窗超时/取消/过期都终止pending，不再导航；错误不能把候选不可选',async()=>{
 for(const mode of ['timeout','cancel','expired']){
  const run=makeRun(),controller=new AbortController();if(mode==='expired')run.created_at=new Date(Date.now()-600001).toISOString();
  const session=createOpencliToolSession({search:async()=>{throw Error('not called');}});
  let calls=0;const job=startReferenceImages(run,{session,requestJson:'{}',signal:controller.signal,timeoutMs:10,isCurrent:()=>mode!=='expired',requestImages:async()=>{calls++;return new Promise(()=>{});}});
  if(mode==='cancel')controller.abort();
  await Promise.race([job.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('job did not settle')),300))]);
  assert.notEqual(job.status,'pending');if(mode!=='expired')assert.ok(run.reference_image_slots.every(s=>s.status==='unavailable'));assert.deepEqual(run.selectable_candidate_ids,['c1','c2','c3']);if(mode==='expired')assert.equal(calls,0);
 }
});
test('候选冻结后被替换时旧job不回写新候选，补搜最多6次，未知来源无导航',async()=>{
 const run=makeRun();let searches=0;
 const session=createOpencliToolSession({search:async()=>{searches++;return{status:'partial',references:[]};}});
 const job=startReferenceImages(run,{session,requestJson:'{}',requestImages:async input=>{
  assert.equal((await input.executeTool({...searchCall,arguments:{purpose:'purchase',sources:['dianping']}})).error_code,'REFERENCE_SOURCE_ONLY');
  for(let i=0;i<9;i++)await input.executeTool(searchCall);
  run.candidates=[{id:'new-candidate',name:'new'}];return{ok:true,reference_references:citations()};
 }});await job.promise;assert.ok(searches<=6);assert.equal(run.candidates[0].id,'new-candidate');assert.equal(job.status,'unavailable');
});
test('图片补搜使用实际assistant/tool协议，最终只采引用、不接候选改写',async()=>{
 const messages=[],cfg={baseUrl:'https://fixture.test/v1',apiKey:'fixture-only',model:'fixture',timeoutMs:1000,maxRetries:0,maxTokens:4000};
 const sequence=[{choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'offline-call',type:'function',function:{name:'opencli_search',arguments:JSON.stringify(searchCall.arguments)}}]}}]},{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({reference_references:citations(),candidates:[{id:'evil-rewrite'}]})}}]}];
 const live=new OpenAiCompatibleTransport({fetchImpl:async(_url,options)=>{messages.push(JSON.parse(options.body));return{ok:true,status:200,json:async()=>sequence.shift()};}});
 const provider=new LlmProvider({live,config:()=>cfg,hasConfig:()=>true}),session=createOpencliToolSession({search:async()=>({status:'partial',references:refs()})});
 const result=await provider.requestReferenceImages({requestJson:'{}',candidates,references:[],missingCandidateIds:candidates.map(c=>c.id),tools:session.tools,executeTool:session.executeTool});
 assert.equal(result.ok,true);assert.equal(result.model_calls,2);assert.deepEqual(result.reference_references,citations());assert.equal('candidates'in result,false);assert.equal(messages[1].messages.at(-1).role,'tool');assert.equal(JSON.parse(messages[1].messages.at(-1).content).references.length,3);
});
