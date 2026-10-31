// Independent cross-module contract probe. All model/search/image inputs are synthetic offline fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
const moduleAt=p=>import(pathToFileURL(join(process.cwd(),p)).href);
const {runRecommendation}=await moduleAt('web/server/pipeline.mjs');
const {LlmProvider,llmProvider}=await moduleAt('web/server/llm/provider.mjs');
const {createMaterialCache}=await moduleAt('web/server/retrieval/material-cache.mjs');
const {createRetrievalAudit}=await moduleAt('web/server/retrieval/audit-store.mjs');
const {mediaProvider}=await moduleAt('web/server/media/provider.mjs');
const {MediaTaskStore}=await moduleAt('web/server/media/task-store.mjs');
const {ImageProviderError}=await moduleAt('web/server/media/seedream.mjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64');
const base='http://127.0.0.1:'+process.env.QA_HTTP_PORT;
function gate(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function bounded(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('TEXT_BLOCKED_ON_IMAGE')),2000))]);}finally{clearTimeout(timer);}}
test('final integrated HTTP: cached text -> real provider parser -> one repair -> selectable -> selected text/pending -> ready or failed, GET read-only and owner/task isolation',async t=>{
 const saved={store:mediaProvider.store,transport:mediaProvider.transport,jobs:mediaProvider.jobs,present:llmProvider.requestPresentation};
 const waits=[];let server;
 t.after(async()=>{for(const w of waits)w.resolve({bytes:png,extension:'png',type:'image/png',width:1,height:1,actual_model:'controlled-fixture',usage:{generated_images:1},reference_count:0,reference_status:'none_provided'});await Promise.allSettled([...mediaProvider.active.values()]);if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}mediaProvider.store=saved.store;mediaProvider.transport=saved.transport;mediaProvider.jobs=saved.jobs;llmProvider.requestPresentation=saved.present;});
 ({server}=await moduleAt('web/server/server.mjs'));if(!server.listening)await once(server,'listening');
 assert.equal(server.address().port,Number(process.env.QA_HTTP_PORT));
 for(const outcome of ['ready','failed']){
  const login=await fetch(base+'/api/config'),cookie=login.headers.get('set-cookie').split(';')[0],owner=cookie.split('=')[1].split('.')[0];
  const outsider=await fetch(base+'/api/config'),foreign=outsider.headers.get('set-cookie').split(';')[0];
  const dir=join(process.env.TEMP,outcome);await mkdir(dir,{recursive:true});
  const cache=createMaterialCache({directory:join(dir,'cache')});
  const material={reference_id:'qa_public_text',reference_kind:'public_reference',source_platform:'web',source_url:'https://sspai.com/post/qa-offline-ecee',title:'离线夹具：轻量共同体验安排',summary:'这是明确标注的离线素材夹具，介绍先询问意愿、共同挑选活动，再把共同回忆整理为简短记录的安排方法。',observed_at:new Date().toISOString(),material_kind:'search_snippet',has_summary:true,is_full_article:false};
  const storedReceipt=cache.put([material]);assert.equal(storedReceipt.status,'stored');assert.equal(storedReceipt.accepted,1);
  const candidates=[1,2,3].map(n=>({id:'c'+n,name:['共同体验安排','已有纸张记忆册','主题散步记录'][n-1],description:'离线合成的独立礼物方向'+n,estimated_total:n===1?'400':'100',currency:'CNY',estimated_preparation_days:2,tags:['other'],reason:'离线创意组合',fact_refs:[],inferences:[],unknowns:['资源未核实，这是夹具']}));
  const fixed=structuredClone(candidates);fixed[0].estimated_total='100';
  const provider=new LlmProvider({hasConfig:()=>true,config:()=>({maxTokens:2000,outputRetries:0}),live:{synthetic:true}}),kinds=[];
  provider.invoke=async input=>{kinds.push(input.kind);assert.match(JSON.stringify(input.messages),/qa_public_text/);return{ok:true,finish_reason:'stop',text:JSON.stringify(input.kind==='recommend'?{candidates,material_reference_ids:['qa_public_text']}:{candidates:fixed}),synthetic:true};};
  const intake=JSON.parse(await readFile(join(process.cwd(),'workflow/examples/intake.json'),'utf8'));
  Object.assign(intake,{contract_version:'giftwise-20261031-v2',recipient_relation:'friend',budget_mode:'other',budget_range:{min:'0',max:'300'},deadline_days:null,interests:[],interest_confidence:{},hard_exclusions:{tags:[],terms:[],unresolved:[]},additional_context:'完全虚构的独立QA '+outcome});delete intake.budget_amount;
  let imageQueries=0,textCalls=0,imageCalls=0;
  const result=await runRecommendation({intake,mode:'llm',ownerScope:owner},{enableImageGeneration:true,libraryEnabled:false,materialCache:cache,retrievalAuditStore:createRetrievalAudit({directory:join(dir,'audit')}),provideRealProducts:async()=>({catalog:{status:'unavailable',results:[]}}),visualDirectionProvider:{derive:async()=>({ok:false,code:'OFFLINE_FIXTURE'})},requestCandidates:input=>provider.requestCandidates(input),requestCandidateRevision:input=>provider.requestCandidateRevision(input),referenceImagesEnabled:true,requestReferenceImages:async()=>{imageQueries++;assert.fail('recommendation image path must remain disconnected');}});
  assert.equal(result.kind,'report');assert.deepEqual(result.report.selectable_candidate_ids,['c1','c2','c3']);assert.equal(result.run.repair_count,1);assert.equal(result.run.call_counts.recommend_revision,1);assert.deepEqual(kinds,['recommend','recommend_revision']);assert.equal(result.run.pre_repair_validation.all_passed,false);assert.equal(result.run.validation.all_passed,true);assert.deepEqual(result.run.candidates.slice(1),candidates.slice(1));assert.equal(result.run.reference_image_job,undefined);assert.equal(imageQueries,0);assert.deepEqual(result.run.retrieval_audit.grounding.reference_ids,['qa_public_text']);assert.equal(result.run.request.available_days,null);
  const wait=gate();waits.push(wait);mediaProvider.store=new MediaTaskStore(join(dir,'media'));mediaProvider.jobs=new WeakMap();mediaProvider.transport={available:()=>true,generate:async()=>{imageCalls++;return wait.promise;}};
  const packaging=outcome==='ready'?{color_palette:['蓝绿']}:{color_palette:['米白'],description:'使用已有信封保护实体邀请函。'};
  llmProvider.requestPresentation=async()=>{textCalls++;return{ok:true,outputs:{presentation_json:JSON.stringify({contract_version:'giftwise-20261031-v2',style:'自然轻松',packaging,card_text:'愿你享受自己的节奏。',giving_advice:{timing:'双方方便时',wording:'有兴趣再一起安排。',relationship_cautions:[]},unknowns:['离线夹具'],currency:'CNY',revised_estimated_preparation_days:2})}};};
  const post=who=>fetch(base+'/api/presentations',{method:'POST',headers:{'content-type':'application/json',cookie:who},body:JSON.stringify({recommendation_run_id:result.run.run_id,selected_candidate_id:'c1'})});
  assert.equal((await post(foreign)).status,404);
  const response=await bounded(post(cookie));assert.equal(response.status,200);const view=await response.json();assert.equal(view.status,'completed');assert.equal(view.media.status,'pending');assert.equal(Boolean(view.sections.find(s=>s.key==='packaging')),outcome!=='ready');assert.ok(view.sections.every(s=>s.items.length));
  const id=view.media.selected.task_id,url=base+'/api/media/tasks/'+id;
  const stored=await readFile(mediaProvider.store.taskPath(id),'utf8');
  for(let n=0;n<2;n++){const r=await fetch(url,{headers:{cookie}});assert.equal(r.status,200);assert.equal((await r.json()).status,'pending');}
  assert.equal(await readFile(mediaProvider.store.taskPath(id),'utf8'),stored);
  assert.equal((await fetch(url,{headers:{cookie:foreign}})).status,404);
  assert.equal((await fetch(base+'/api/media/tasks/'+'f'.repeat(64),{headers:{cookie}})).status,404);
  assert.equal((await fetch(base+'/api/media/assets/'+id,{headers:{cookie}})).status,404);
  assert.equal((await(await post(cookie)).json()).media.selected.task_id,id);assert.equal(imageCalls,1);assert.equal(textCalls,1);
  if(outcome==='ready')wait.resolve({bytes:png,extension:'png',type:'image/png',width:1,height:1,actual_model:'controlled-fixture',usage:{generated_images:1},reference_count:0,reference_status:'none_provided'});else wait.reject(new ImageProviderError('IMAGE_EXECUTION_UNKNOWN',{execution:'unknown'}));
  await mediaProvider.wait(id);
  const final=await(await fetch(url,{headers:{cookie}})).json();assert.equal(final.status,outcome);assert.equal(final.selected.candidate_id,'c1');
  const replay=await(await post(cookie)).json();assert.equal(replay.status,'completed');assert.equal(replay.media.status,outcome);assert.deepEqual(replay.sections,view.sections);assert.equal(imageCalls,1);assert.equal(textCalls,1);assert.equal(result.run.repair_count,1);
  if(outcome==='ready'){const asset=await fetch(base+final.selected.image.url,{headers:{cookie}});assert.equal(asset.status,200);assert.deepEqual(Buffer.from(await asset.arrayBuffer()),png);assert.equal((await fetch(base+final.selected.image.url,{headers:{cookie:foreign}})).status,404);}else assert.equal(final.selected.image,null);
  console.log(JSON.stringify({scenario:outcome,controlled:true,three_selectable:true,repair_count:1,recommendation_image_calls:imageQueries,selected_image_fixture_calls:imageCalls,presentation_fixture_calls:textCalls,pending_get_did_not_write:true,owner_and_unknown_task_rejected:true,packaging_section:outcome!=='ready',external_supplier_calls:0}));
 }
});
