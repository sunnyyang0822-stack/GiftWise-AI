// Payload/plan fixtures only; the separate .tmp harness permits one real image call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {SeedreamProvider} from '../server/media/seedream.mjs';
import {buildImagePlan,IMAGE_PLAN_VERSION} from '../server/media/plan.mjs';
import {MediaProvider,emptyMedia} from '../server/media/provider.mjs';
import {MediaTaskStore,fingerprint} from '../server/media/task-store.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64');
const run=()=>({run_id:'fixture-run',owner_scope:'owner-a',selected_candidate_id:'c1',selectable_candidate_ids:['c1'],media_generation_authorized:true,candidates:[{id:'c1',name:'蓝色布面旅行手账',description:'一本保存沿海旅行照片的手账',reason:'安静、松弛的旅行回忆'}],request:{notes:'留白即可',forbidden_tags:[],forbidden_terms:['亮粉色'],exclusion_context:{original:'别太正式',clarifications:[{answer:'像朋友聊天，不写关系承诺'}]}},presentation:{recheck:{passed:true},presentation:{style:'精致但松弛',packaging:{color_palette:['深海蓝','银灰'],materials:['半透明描图纸'],steps:['半开护封露出布面'],description:'保留自然手作感'},card_text:'把每一次旅行留在身边',giving_advice:{wording:'一点小心意'}}},media:{candidates:[]},selections:new Map()});
const output=()=>({bytes:png,extension:'png',type:'image/png',width:1,height:1,actual_model:'controlled-fixture',reference_count:0});
async function store(){const root=fileURLToPath(new URL('../../.tmp/image-finesse-tests/',import.meta.url));await mkdir(root,{recursive:true});return new MediaTaskStore(await mkdtemp(root+'case-'));}

test('Seedream explicitly requests watermark false without changing single-image or AI provider protocol',async()=>{
  let body,calls=0;
  const provider=new SeedreamProvider({apiKey:()=> 'controlled-fixture-key',fetchImpl:async(url,options)=>{
    calls++;body=JSON.parse(options.body);assert.equal(url,'https://api.modelverse.cn/v1/images/generations');
    return new Response(JSON.stringify({model:'doubao-seedream-4-5-251128',data:[{b64_json:png.toString('base64'),size:'1x1'}],usage:{generated_images:1}}));
  }});
  const result=await provider.generate({prompt:'受控包装效果图'});
  assert.equal(body.watermark,false);assert.equal(body.sequential_image_generation,'disabled');
  assert.equal(body.response_format,'b64_json');assert.equal(body.model,'doubao-seedream-4.5');
  assert.equal(calls,1);assert.equal(result.actual_model,'doubao-seedream-4-5-251128');
});

test('new plan combines gift content, selected packaging and mood, with no default annotations or forced form',()=>{
  const r=run(),p=buildImagePlan(r,'c1','a'.repeat(64));
  assert.equal(IMAGE_PLAN_VERSION,'packaging-seedream-v7');assert.deepEqual(p.selected.annotations,[]);
  assert.equal(p.selected.packaging.form,'undetermined');
  for(const text of ['蓝色布面旅行手账','安静、松弛的旅行回忆','精致但松弛','半透明描图纸','半开护封露出布面','别太正式','亮粉色'])assert.ok(p.prompt.includes(text));
  assert.match(p.prompt,/材质真实，光线考究/);assert.match(p.prompt,/不要默认套奶油白/);
  assert.match(p.prompt,/card_text仅供理解语气，不是印刷内容/);assert.match(p.prompt,/不加可见水印/);
  assert.doesNotMatch(p.prompt,/供应商AI水印保留|默认3.?5处|【一致性约束】/);
});

test('visual brief omits administrative provenance but preserves explicit aesthetic values and user text request',()=>{
  const r=run();r.request.notes='希望图里的卡片只写“生日快乐”';
  r.visual_direction={palette:{primary:{zh:'深海蓝',hex:'#123456',based_on:{field:'AUDIT_PROVENANCE_MARKER'}}},materials:[{zh:'亚麻',based_on:'AUDIT_PROVENANCE_MARKER'}],visual_tone:{zh:'静谧的海边回忆'},keywords:[{text:'松弛'}],tradeoffs:[{decision:'ADMIN_TRADEOFF_MARKER'}]};
  const p=buildImagePlan(r,'c1','a'.repeat(64));
  assert.ok(p.prompt.includes('深海蓝'));assert.ok(p.prompt.includes('静谧的海边回忆'));
  assert.ok(p.prompt.includes(r.request.notes));assert.match(p.prompt,/仅当用户原话明确要求文字入图/);
  assert.doesNotMatch(p.prompt,/AUDIT_PROVENANCE_MARKER|ADMIN_TRADEOFF_MARKER|取舍记录|不得另起一套审美/);
  assert.equal(p.visual_direction,r.visual_direction);
});

for(const status of ['pending','ready','failed'])test(`old plan ${status} task is reused without generation, overwrite or plan upgrade`,async()=>{
  const s=await store(),r=run(),id='b'.repeat(64),p=buildImagePlan(r,'c1',id);let calls=0;
  const media={...emptyMedia(),status,selected:{...p.selected,status,plan_version:'packaging-seedream-v5'}};
  let asset;
  if(status==='ready'){
    const sha=await s.saveAsset(png,'png');asset={sha256:sha,extension:'png',type:'image/png'};
    media.selected.image={id:sha,url:'/api/media/assets/'+id,version:sha,kind:'ai_illustration',alt:'AI包装效果示意'};
  }
  await s.create({task_id:id,run_id:r.run_id,candidate_id:'c1',owner_hash:fingerprint(r.owner_scope),plan_version:'packaging-seedream-v5',media,asset});
  r.media=media;r.selections.set('c1',{media});
  const before=await readFile(s.taskPath(id),'utf8');
  const provider=new MediaProvider({store:s,transport:{available:()=>true,generate:async()=>{calls++;return output();}}});
  const reused=await provider.packaging(r,'c1');assert.equal(reused.selected.task_id,id);assert.equal(reused.selected.plan_version,'packaging-seedream-v5');
  assert.equal(calls,0);assert.equal(await readFile(s.taskPath(id),'utf8'),before);
  if(asset)assert.deepEqual(await s.readAsset(await provider.task(r,id)),png);
  await assert.rejects(provider.packaging({...r,owner_scope:'foreign'},'c1'),/MEDIA_TASK_NOT_FOUND/);assert.equal(calls,0);
});

test('missing known old task does not trigger a new paid generation',async()=>{
  const r=run();r.media={...emptyMedia(),status:'pending',selected:{task_id:'b'.repeat(64),candidate_id:'c1'}};let calls=0;
  const p=new MediaProvider({store:await store(),transport:{available:()=>true,generate:async()=>{calls++;return output();}}});
  await assert.rejects(p.packaging(r,'c1'));assert.equal(calls,0);
});

test('new generation still preserves AI illustration kind, attribution and owner-bound async task',async()=>{
  const r=run(),s=await store();let release,calls=0;const gate=new Promise(resolve=>release=resolve);
  const p=new MediaProvider({store:s,transport:{available:()=>true,generate:async()=>{calls++;await gate;return output();}}});
  const pending=await p.packaging(r,'c1');assert.equal(pending.status,'pending');release();const record=await p.wait(pending.selected.task_id);
  assert.equal(record.media.status,'ready');assert.equal(record.media.selected.image.kind,'ai_illustration');
  assert.match(record.media.selected.image.attribution,/AI生成/);assert.match(record.media.selected.image.alt,/AI包装效果示意/);
  assert.equal(calls,1);await assert.rejects(p.task({...r,owner_scope:'other'},record.task_id));
});
