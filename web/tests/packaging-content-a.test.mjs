// Controlled model responses exercise schema, mapping and HTTP. No live model/image calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { checkPresentationForDecision, validateForDecision } from '../server/checker.mjs';
import { strictParse } from '../server/jsonstrict.mjs';
import { packagingSectionItems } from '../server/presentation-packaging.mjs';
import { runPresentation } from '../server/pipeline.mjs';
import { createRun } from '../server/store.mjs';
import { llmProvider } from '../server/llm/provider.mjs';
import { buildPresentEnvelope, buildPresentMessages } from '../server/llm/prompt.mjs';
import { mediaProvider } from '../server/media/provider.mjs';
import { MediaTaskStore } from '../server/media/task-store.mjs';
import { buildImagePlan } from '../server/media/plan.mjs';

const request=()=>({contract_version:'giftwise-20261031-v2',recipient_relation:'朋友',recipient_relation_id:'friend',occasion:'生日',budget_amount:'800',currency:'CNY',available_days:null,facts:[],forbidden_tags:[],forbidden_terms:[],notes:'',exclusion_context:{original:'别太正式',semantic_constraints:[{source_span:'别太正式',interpretation:'自然轻松地表达'}],clarifications:[{answer:'卡片像朋友聊天，不写关系承诺'}]}});
const gift=(id='c1')=>({id,name:`手作相册${id}`,description:`不同内容方向${id}`,estimated_total:'100.00',currency:'CNY',estimated_preparation_days:2,tags:['other'],reason:'日常心意',fact_refs:[],inferences:[],unknowns:[]});
const physical=()=>({color_palette:['米白'],materials:['已有的相册保护套','手写小卡'],steps:['把照片页按共同经历排好','放入保护套，并把小卡夹在封面内']});
const presentation=packaging=>({contract_version:'giftwise-20261031-v2',style:'自然轻松',packaging,card_text:'生日快乐，希望你喜欢这些回忆。',giving_advice:{timing:'对方方便时',wording:'整理了一点我们的回忆',relationship_cautions:[]},unknowns:[],currency:'CNY',revised_estimated_preparation_days:2});
const check=(packaging,r=request(),g=gift())=>checkPresentationForDecision(r,g,presentation(packaging));
function seed(owner='owner-a',zero=false){
  const r=request();if(zero)r.budget_amount='0';const candidates=['c1','c2','c3'].map(gift);if(zero)candidates.forEach(c=>c.estimated_total='0.00');
  const validation=validateForDecision(JSON.stringify(r),JSON.stringify({candidates}),strictParse);assert.equal(validation.all_passed,true);
  const run=createRun({owner_scope:owner,mode:'llm',media_generation_authorized:false,request:r,request_json:JSON.stringify(r),candidates,validation,status:'passed',selectable_candidate_ids:['c1','c2','c3'],repair_count:0,notices:[]});
  run.catalog_bindings=new Map();run.product_bindings=new Map();run.media=mediaProvider.candidates();return run;
}
const present=(run,packaging,capture=()=>{})=>runPresentation({runId:run.run_id,selectedCandidateId:'c1',ownerScope:run.owner_scope},{requestPresentation:async input=>{capture(input);return {ok:true,outputs:{presentation_json:JSON.stringify(presentation(packaging))}};}});

test('model material and step arrays validate and map without dropping or substituting text',()=>{
  const p=physical();assert.equal(check(p).passed,true);
  assert.deepEqual(packagingSectionItems(p),['材料：已有的相册保护套','材料：手写小卡','步骤 1：把照片页按共同经历排好','步骤 2：放入保护套，并把小卡夹在封面内']);
});

test('single string material/step responses are accepted and mapped, not sent through Array.map',()=>{
  const p={color_palette:['米白'],materials:'已有的文件袋',steps:'将相册放入文件袋，附上手写说明。'};
  assert.equal(check(p).passed,true);
  assert.deepEqual(packagingSectionItems(p),['材料：已有的文件袋','步骤 1：将相册放入文件袋，附上手写说明。']);
});

test('no physical packaging and zero budget retain effective model explanation without forcing materials',async()=>{
  const run=seed('zero-owner',true),p={color_palette:['米白'],materials:[],steps:[]};
  const advice={timing:'对方方便时私下分享电子相册',wording:'整理了一点我们的回忆，想和你一起看看。',relationship_cautions:[]};
  const out=await runPresentation({runId:run.run_id,selectedCandidateId:'c1',ownerScope:run.owner_scope},{requestPresentation:async()=>({ok:true,outputs:{presentation_json:JSON.stringify({...presentation(p),giving_advice:advice})}})});assert.equal(out.view.status,'completed');
  assert.equal(out.view.sections.some(s=>s.key==='packaging'),false);
  assert.ok(out.view.sections.find(s=>s.key==='giving').items.some(text=>text.includes(advice.timing)));
  assert.deepEqual(out.view.presentation_json.packaging,p);assert.equal(out.view.candidate.estimated_total,'0.00');
  assert.equal(out.view.presentation_json.additional_cost,undefined);assert.equal(out.view.presentation_json.revised_estimated_total,undefined);
});

test('missing optional packaging is omitted, while supplied incomplete or invalid content still fails',async()=>{
  for(const p of [{color_palette:['米白']},{color_palette:['米白'],materials:[],steps:[]}]){
    const run=seed();const out=await present(run,p);
    assert.equal(out.view.status,'completed');assert.equal(out.view.sections.some(s=>s.key==='packaging'),false);
    assert.deepEqual(out.view.sections.map(s=>s.key),['style','card','giving']);
    assert.equal(run.repair_count,0);
  }
  for(const p of [{color_palette:['米白'],materials:['纸袋']},{color_palette:['米白'],description:'   '}]){
    assert.equal(check(p).passed,false);
    const run=seed();const out=await present(run,p);assert.equal(out.kind,'presentation_failed');
    assert.ok(out.view.presentation_check.errors.some(e=>e.code==='PRESENTATION_INVALID'&&e.path.startsWith('presentation.packaging')));
    assert.deepEqual(run.selectable_candidate_ids,['c1','c2','c3']);assert.equal(run.repair_count,0);
    assert.ok(!out.view.sections.length);assert.equal(run.media.selected,null);
  }
});

test('malformed instruction items and packaging price aliases remain errors',()=>{
  for(const p of [
    {...physical(),materials:[{name:'纸袋',price:'20'}]},
    {...physical(),steps:7},
    {...physical(),steps:['']},
    {...physical(),description:[]},
    {...physical(),cost:'20.00'},
    {...physical(),material_tags:['other']},
  ])assert.equal(check(p).passed,false,JSON.stringify(p));
  const bad=checkPresentationForDecision(request(),gift(),{...presentation(physical()),additional_cost:'20.00'});
  assert.ok(bad.errors.some(e=>e.code==='PRESENTATION_INVALID'));
});

test('new material/description text keeps forbidden-term and frozen-gift budget checks',()=>{
  const r={...request(),forbidden_terms:['金色']};
  for(const p of [{...physical(),materials:['金色袋子']},{color_palette:['米白'],description:'用金色文字说明'}])assert.ok(check(p,r).errors.some(e=>e.code==='FORBIDDEN_TERM'));
  assert.ok(check(physical(),request(),{...gift(),estimated_total:'801.00'}).errors.some(e=>e.code==='OVER_BUDGET'));
});

test('pipeline carries real response content to sections and frozen semantic context to presentation provider',async()=>{
  const run=seed();let input;const p=physical();const out=await present(run,p,value=>input=value);
  assert.equal(out.view.status,'completed');assert.deepEqual(out.view.sections.find(s=>s.key==='packaging').items,packagingSectionItems(p));
  assert.deepEqual(JSON.parse(input.requestJson).exclusion_context,run.request.exclusion_context);
  assert.equal(out.view.presentation_json.card_text,presentation(p).card_text);
});

test('image plan receives actual model instructions/explanation together with semantic context',async()=>{
  const run=seed(),p={...physical(),description:'这本相册保留自然手作感，不增加花哨装饰。'};await present(run,p);
  const plan=buildImagePlan(run,'c1','a'.repeat(64));
  for(const text of [...p.materials,...p.steps,p.description,'别太正式','卡片像朋友聊天，不写关系承诺'])assert.ok(plan.prompt.includes(text));
  assert.equal(plan.references.length,0);assert.match(plan.prompt,/无需实体包装/);
});

test('prompt requests model-chosen physical instructions, omits pure-experience packaging and forbids costs',()=>{
  const messages=buildPresentMessages(buildPresentEnvelope({requestJson:JSON.stringify(request()),candidateJson:JSON.stringify(gift())}));
  const system=messages[0].content;assert.match(system,/确有实体包装时输出 materials、steps 非空字符串数组/);
  assert.match(system,/description/);assert.doesNotMatch(system,/packaging 不输出 materials\/steps/);
  assert.match(system,/不为填章节强迫购买/);assert.match(system,/不输出 material_tags、材料价格/);
  assert.match(system,/纯体验且没有实体交付时不填写 materials、steps、description/);
  assert.match(system,/用户后续修正优先/);
});

test('text instructions return before unfinished background image without changing selected candidate',async t=>{
  const root=fileURLToPath(new URL('../../.tmp/packaging-image-tests/',import.meta.url));await mkdir(root,{recursive:true});
  const dir=await mkdtemp(root+'case-');const saved={transport:mediaProvider.transport,store:mediaProvider.store,jobs:mediaProvider.jobs};
  let release,calls=0,plan;const gate=new Promise(resolve=>release=resolve);
  mediaProvider.store=new MediaTaskStore(dir);mediaProvider.jobs=new WeakMap();mediaProvider.transport={available:()=>true,generate:async value=>{calls++;plan=value;await gate;throw Object.assign(new Error('controlled fixture'),{execution:'unknown'});}};
  t.after(async()=>{release();await Promise.allSettled([...mediaProvider.active.values()]);Object.assign(mediaProvider,saved);});
  const run=seed();run.media_generation_authorized=true;let timer;
  try{
    const out=await Promise.race([present(run,physical()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('text waited for image')),2000);})]);
    assert.equal(out.view.status,'completed');assert.equal(out.view.media.status,'pending');assert.equal(out.view.media_wait.waited,false);
    assert.ok(out.view.sections.find(s=>s.key==='packaging').items.length);assert.equal(run.selected_candidate_id,'c1');assert.equal(calls,1);
    assert.ok(plan.prompt.includes(physical().steps[0]));
  }finally{clearTimeout(timer);}
});

test('HTTP sections contain model materials/steps and description in the frontend existing items field',async t=>{
  const old=llmProvider.requestPresentation;const p={...physical(),description:'按已有相册大小使用保护套。'};
  llmProvider.requestPresentation=async()=>({ok:true,outputs:{presentation_json:JSON.stringify(presentation(p))}});
  const {server}=await import('../server/server.mjs');if(!server.listening)await once(server,'listening');
  t.after(async()=>{llmProvider.requestPresentation=old;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:8904';const config=await fetch(base+'/api/config');const cookie=config.headers.get('set-cookie').split(';')[0];
  const owner=cookie.split('=')[1].split('.')[0];const run=seed(owner);
  const response=await fetch(base+'/api/presentations',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({recommendation_run_id:run.run_id,selected_candidate_id:'c1'})});
  assert.equal(response.status,200);const body=await response.json();
  assert.deepEqual(body.sections.find(s=>s.key==='packaging').items,packagingSectionItems(p));
  assert.deepEqual(body.presentation_json.packaging,p);assert.equal(body.status,'completed');assert.equal(body.media_wait.waited,false);
});
