// Controlled text/image fixtures. These tests do not claim real model or supplier execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { runPresentation } from '../server/pipeline.mjs';
import { createRun } from '../server/store.mjs';
import { validateForDecision } from '../server/checker.mjs';
import { strictParse } from '../server/jsonstrict.mjs';
import { mediaProvider, MediaProvider } from '../server/media/provider.mjs';
import { MediaTaskStore } from '../server/media/task-store.mjs';
import { ImageProviderError } from '../server/media/seedream.mjs';
import { llmProvider } from '../server/llm/provider.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64');
const imageResult=()=>({bytes:png,extension:'png',type:'image/png',width:1,height:1,actual_model:'controlled-fixture',usage:{generated_images:1},reference_count:0,reference_status:'none_provided'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const presentation=()=>({contract_version:'giftwise-20261031-v2',style:'自然轻松',packaging:{color_palette:['米白']},card_text:'生日快乐，愿你享受自己的节奏。',giving_advice:{timing:'方便时送出',wording:'一点小心意',relationship_cautions:[]},unknowns:[],currency:'CNY',revised_estimated_preparation_days:2});

function makeRun(owner='owner-a') {
  const request={contract_version:'giftwise-20261031-v2',recipient_relation:'朋友',recipient_relation_id:'friend',occasion:'生日',budget_amount:'800',currency:'CNY',available_days:null,facts:[],forbidden_tags:[],forbidden_terms:[],notes:'',exclusion_context:{original:'别太正式',semantic_constraints:[{source_span:'别太正式',interpretation:'表达自然轻松'}],clarifications:[{answer:'贺卡像朋友聊天，不写承诺'}]}};
  const candidates=[1,2,3].map(n=>({id:`c${n}`,name:`笔记本方向${n}`,description:`不同设计${n}`,estimated_total:'100.00',currency:'CNY',estimated_preparation_days:2,tags:['other'],reason:'日常心意',fact_refs:[],inferences:[],unknowns:[]}));
  const checked=validateForDecision(JSON.stringify(request),JSON.stringify({candidates}),strictParse);
  assert.equal(checked.all_passed,true);
  const run=createRun({owner_scope:owner,mode:'llm',media_generation_authorized:true,request,request_json:JSON.stringify(request),candidates,validation:checked,status:'passed',selectable_candidate_ids:['c1','c2','c3'],repair_count:0,notices:[]});
  run.media=mediaProvider.candidates();run.catalog_bindings=new Map();run.product_bindings=new Map();
  return run;
}

async function fixture(t,{available=true}={}) {
  const root=fileURLToPath(new URL('../../.tmp/async-image-tests/',import.meta.url));await mkdir(root,{recursive:true});
  const dir=await mkdtemp(root+'case-');
  const store=new MediaTaskStore(dir),gate=deferred(),calls={images:0,text:0,plans:[]};
  const saved={store:mediaProvider.store,transport:mediaProvider.transport,jobs:mediaProvider.jobs};
  const transport={available:()=>available,generate:async plan=>{calls.images++;calls.plans.push(plan);return gate.promise;}};
  mediaProvider.store=store;mediaProvider.transport=transport;mediaProvider.jobs=new WeakMap();
  const services={requestPresentation:async()=>{calls.text++;return {ok:true,outputs:{presentation_json:JSON.stringify(presentation())}};}};
  t.after(async()=>{gate.resolve(imageResult());await Promise.allSettled([...mediaProvider.active.values()]);Object.assign(mediaProvider,saved);});
  const present=(run,id='c1')=>runPresentation({runId:run.run_id,selectedCandidateId:id,ownerScope:run.owner_scope},services);
  return {store,dir,gate,calls,transport,present,services};
}

async function beforeImage(job){
  let timer;
  try{return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('text waited for unfinished image promise')),2000);})]);}
  finally{clearTimeout(timer);}
}

test('text returns with persisted pending while image Promise is unresolved; same selection is idempotent',async t=>{
  const f=await fixture(t),run=makeRun();
  const [a,b]=await beforeImage(Promise.all([f.present(run),f.present(run)]));
  assert.equal(a.kind,'presentation');assert.equal(a.view.status,'completed');assert.equal(a.view.sections.length,4);
  assert.equal(a.view.media.status,'pending');assert.equal(a.view.media.selected.status,'pending');
  assert.match(a.view.media.selected.task_id,/^[a-f0-9]{64}$/);assert.equal(a.view.media.selected.image,null);
  assert.equal(a.view.media_wait.waited,false);assert.equal(a.view.media_wait.timeout_ms,0);
  assert.equal(a.view.media.selected.task_id,b.view.media.selected.task_id);assert.equal(f.calls.images,1);assert.equal(f.calls.text,1);
  const task=await mediaProvider.task(run,a.view.media.selected.task_id);assert.equal(task.media.status,'pending');
  const replay=await beforeImage(f.present(run));assert.equal(replay.idempotent,true);assert.equal(f.calls.images,1);
  f.gate.resolve(imageResult());await mediaProvider.wait(task.task_id);
  const ready=await f.present(run);assert.equal(ready.view.media.status,'ready');assert.equal(f.calls.images,1);assert.equal(f.calls.text,1);
  assert.equal(ready.view.presentation_json.card_text,a.view.presentation_json.card_text);
});

test('supplier failure retains completed text and selected candidate; repeated POST/GET never regenerates',async t=>{
  const f=await fixture(t),run=makeRun();const out=await beforeImage(f.present(run));const id=out.view.media.selected.task_id;
  f.gate.reject(new ImageProviderError('IMAGE_EXECUTION_UNKNOWN',{execution:'unknown'}));await mediaProvider.wait(id);
  const failed=(await mediaProvider.task(run,id)).media;assert.equal(failed.status,'failed');assert.equal(failed.selected.image,null);
  const replay=await f.present(run);assert.equal(replay.view.status,'completed');assert.equal(replay.view.media.status,'failed');
  assert.equal(replay.view.sections.length,4);assert.equal(run.selected_candidate_id,'c1');
  await mediaProvider.task(run,id);await mediaProvider.task(run,id);assert.equal(f.calls.images,1);assert.equal(f.calls.text,1);
});

test('missing image configuration is unavailable immediately, with no fake pending or supplier call',async t=>{
  const f=await fixture(t,{available:false}),run=makeRun();const out=await beforeImage(f.present(run));
  assert.equal(out.view.status,'completed');assert.equal(out.view.media.status,'unavailable');assert.equal(out.view.media.selected.status,'unavailable');
  assert.equal(f.calls.images,0);assert.equal((await f.present(run)).view.media.selected.task_id,out.view.media.selected.task_id);
});

test('switching back restores selected task binding and reuses image instead of starting another',async t=>{
  const f=await fixture(t),run=makeRun();const first=await beforeImage(f.present(run));const second=await beforeImage(f.present(run,'c2'));
  assert.notEqual(first.view.media.selected.task_id,second.view.media.selected.task_id);assert.equal(f.calls.images,2);
  const back=await f.present(run);assert.equal(run.selected_candidate_id,'c1');assert.equal(back.view.media.selected.task_id,first.view.media.selected.task_id);
  await mediaProvider.task(run,first.view.media.selected.task_id);assert.equal(f.calls.images,2);assert.equal(f.calls.text,2);
});

test('owner/run/candidate isolation also protects reused provider tasks',async t=>{
  const f=await fixture(t),run=makeRun();const out=await beforeImage(f.present(run));const id=out.view.media.selected.task_id;
  await assert.rejects(mediaProvider.task({...run,owner_scope:'other'},id),/MEDIA_TASK_NOT_FOUND/);
  await assert.rejects(mediaProvider.task({...run,run_id:'different'},id),/MEDIA_TASK_NOT_FOUND/);
  await assert.rejects(mediaProvider.task({...run,selected_candidate_id:'c2'},id),/MEDIA_TASK_NOT_FOUND/);
  const other=new MediaProvider({store:f.store,transport:f.transport});
  await assert.rejects(other.packaging({...run,owner_scope:'other'},'c1'),/MEDIA_TASK_NOT_FOUND/);assert.equal(f.calls.images,1);
});

test('image plan preserves selected presentation and exclusion original/clarifications without invented references',async t=>{
  const f=await fixture(t),run=makeRun();await beforeImage(f.present(run));const plan=f.calls.plans[0];
  assert.match(plan.prompt,/别太正式/);assert.match(plan.prompt,/贺卡像朋友聊天，不写承诺/);
  assert.match(plan.prompt,/自然轻松/);assert.match(plan.prompt,/生日快乐，愿你享受自己的节奏/);
  assert.match(plan.prompt,/用户后续修正优先/);assert.equal(plan.references.length,0);assert.equal(plan.product,null);
  assert.equal(run.request.exclusion_context.original,'别太正式');
});

test('reading interrupted task derives honest failure without mutating its stored record',async t=>{
  const f=await fixture(t);const id='a'.repeat(64);
  await f.store.create({task_id:id,media:{status:'pending',selected:{status:'pending',unknowns:[]}}});
  const before=await readFile(f.store.taskPath(id),'utf8');const restarted=new MediaTaskStore(f.dir);
  assert.equal((await restarted.read(id)).media.selected.error_code,'IMAGE_EXECUTION_UNKNOWN');
  assert.equal(await readFile(f.store.taskPath(id),'utf8'),before);assert.equal(f.calls.images,0);
});

test('HTTP text returns pending; owner polling reaches ready and reads bytes, foreign session gets 404',async t=>{
  const f=await fixture(t);const original=llmProvider.requestPresentation;llmProvider.requestPresentation=f.services.requestPresentation;
  const {server}=await import('../server/server.mjs');if(!server.listening)await once(server,'listening');
  t.after(async()=>{llmProvider.requestPresentation=original;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:8904';
  const login=await fetch(base+'/api/config');const cookie=login.headers.get('set-cookie').split(';')[0];const owner=cookie.split('=')[1].split('.')[0];
  const run=makeRun(owner);
  const post=()=>fetch(base+'/api/presentations',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({recommendation_run_id:run.run_id,selected_candidate_id:'c1'})});
  const response=await beforeImage(post());assert.equal(response.status,200);const text=await response.json();
  assert.equal(text.status,'completed');assert.equal(text.media.status,'pending');assert.equal(text.sections.length,4);
  const id=text.media.selected.task_id;const task='/api/media/tasks/'+id;const asset='/api/media/assets/'+id;
  assert.equal((await fetch(base+task,{headers:{cookie}})).status,200);
  assert.equal((await fetch(base+asset,{headers:{cookie}})).status,404);
  const outsider=await fetch(base+'/api/config');const otherCookie=outsider.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+task,{headers:{cookie:otherCookie}})).status,404);
  assert.equal((await runPresentation({runId:run.run_id,selectedCandidateId:'c1',ownerScope:'different'})).kind,'not_found');
  assert.equal((await (await post()).json()).media.selected.task_id,id);assert.equal(f.calls.images,1);
  f.gate.resolve(imageResult());await mediaProvider.wait(id);
  const ready=await (await fetch(base+task,{headers:{cookie}})).json();assert.equal(ready.status,'ready');assert.equal(ready.selected.candidate_id,'c1');
  const picture=await fetch(base+ready.selected.image.url,{headers:{cookie}});assert.equal(picture.status,200);assert.deepEqual(Buffer.from(await picture.arrayBuffer()),png);
  assert.equal((await fetch(base+asset,{headers:{cookie:otherCookie}})).status,404);assert.equal(f.calls.images,1);assert.equal(f.calls.text,1);
});
