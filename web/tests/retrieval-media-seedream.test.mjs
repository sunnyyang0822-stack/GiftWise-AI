import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {MediaProvider} from '../server/media/provider.mjs';
import {mintReferenceGrant} from '../server/media/plan.mjs';
import {MediaTaskStore} from '../server/media/task-store.mjs';
import {SeedreamProvider,ImageProviderError} from '../server/media/seedream.mjs';
const png=()=>{const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(32,16);bytes.writeUInt32BE(24,20);return bytes;};
const run=()=>({run_id:'fixture-run',owner_scope:'owner-A',mode:'dify',media_generation_authorized:true,selected_candidate_id:'c1',selectable_candidate_ids:['c1'],candidates:[{id:'c1',name:'虚构笔记本'}],request:{forbidden_terms:[]},presentation:{presentation:{packaging:{color_palette:['米色']}},recheck:{passed:true}},media:{candidates:[]}});
async function withStore(fn){const root=new URL('../../.tmp/',import.meta.url);await mkdir(root,{recursive:true});const dir=await mkdtemp(join((await import('node:url')).fileURLToPath(root),'giftwise-media-test-'));try{return await fn(new MediaTaskStore(dir),dir);}finally{await rm(dir,{recursive:true,force:true});}}
const response=()=>new Response(JSON.stringify({model:'doubao-seedream-4-5-251128',data:[{b64_json:png().toString('base64'),size:'32x24'}],usage:{generated_images:1,output_tokens:3,total_tokens:3}}),{headers:{'content-type':'application/json'}});
const provider=overrides=>new SeedreamProvider({apiKey:()=> 'fixture-key-not-secret',fetchImpl:async()=>response(),...overrides});
// Server-side authorized fixture, scoped to this synthetic selected product only.
const reference=(extra={},permission={})=>({product_id:'p',variant:'蓝色',url:'https://example.com/i.png',kind:'source_photo',usable_as_generation_reference:true,...extra,
  permission:{...mintReferenceGrant(run(),'c1'),status:'approved',scope:'selected_product',product_id:'p',variant:'蓝色',usage_basis:'controlled fixture only',evidence_ref:'permission-fixture',...permission}});

test('平台请求字段、images为安全读取后的data URL，不使用image参数',async()=>{
  let body;
  const product={product_id:'p',variant:'蓝色'};
  const p=provider({referenceHosts:['example.com'],imageReader:async()=>({bytes:png(),type:'image/png'}),fetchImpl:async(url,opts)=>{assert.equal(url,'https://api.modelverse.cn/v1/images/generations');assert.equal(opts.redirect,'error');body=JSON.parse(opts.body);return response();}});
  const result=await p.generate({prompt:'受控测试',product,references:[reference()]});
  assert.ok(body.images[0].startsWith('data:image/png;base64,'));
  assert.equal(body.image,undefined);assert.equal(body.size,'2K');assert.equal(body.watermark,false);assert.equal(body.stream,false);assert.equal(body.response_format,'b64_json');assert.equal(body.sequential_image_generation,'disabled');
  assert.equal(result.actual_model,'doubao-seedream-4-5-251128');assert.equal(result.width,32);assert.equal(result.usage.generated_images,1);
});

test('无参考图许可、非来源图、错SKU、错误凭据和危险URL均不调用供应商',async()=>{
  let calls=0;
  const p=provider({fetchImpl:async()=>{calls++;return response();}});
  const cases=[
    [{...reference(),permission:null},'IMAGE_REFERENCE_NOT_AUTHORIZED'],
    [reference({kind:'page_capture'}),'IMAGE_REFERENCE_NOT_USABLE'],
    [reference({usable_as_generation_reference:false}),'IMAGE_REFERENCE_NOT_USABLE'],
    [reference({product_id:'other'}),'IMAGE_REFERENCE_NOT_AUTHORIZED'],
    [reference({}, {scope:'all_products'}),'IMAGE_REFERENCE_NOT_AUTHORIZED'],
    [reference({}, {variant:'红色'}),'IMAGE_REFERENCE_NOT_AUTHORIZED'],
    [reference({}, {grant_id:''}),'IMAGE_REFERENCE_NOT_AUTHORIZED'],
    [reference({}, {granted_at:'invalid'}),'IMAGE_REFERENCE_NOT_AUTHORIZED'],
    [reference({url:'https://127.0.0.1/i.png'}),'IMAGE_REFERENCE_BLOCKED'],
  ];
  for(const [ref,code] of cases) await assert.rejects(p.generate({prompt:'fixture',product:{product_id:'p',variant:'蓝色'},references:[ref]}),error=>error.code===code&&error.execution==='not_submitted');
  assert.equal(calls,0);
});

test('合法凭据一次消费，重复使用不再次读图或提交供应商',async()=>{
  let calls=0,reads=0;
  const p=provider({imageReader:async()=>{reads++;return {bytes:png()};},fetchImpl:async()=>{calls++;return response();}});
  const ref=reference();
  const input={prompt:'fixture',product:{product_id:'p',variant:'蓝色'},references:[ref]};
  await p.generate(input);
  await assert.rejects(p.generate(input),error=>error.code==='IMAGE_REFERENCE_CREDENTIAL_REUSED');
  assert.equal(calls,1);assert.equal(reads,1);
});

test('超时为执行未知且无自动重试、返回错误不泄露原文',async()=>{let calls=0;const p=provider({timeoutMs:5,fetchImpl:async(url,opts)=>{calls++;return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('sensitive vendor text'))));}});await assert.rejects(p.generate({prompt:'fixture'}),e=>e.code==='IMAGE_EXECUTION_UNKNOWN'&&e.execution==='unknown'&&!e.message.includes('sensitive'));assert.equal(calls,1);});
test('供应商异常、多图、错误base64及尺寸不符均拒绝',async()=>{for(const payload of [{error:{message:'secret'}},{data:[{},{}]},{data:[{b64_json:'<html>'}]},{model:'doubao-seedream-4-5-251128',data:[{b64_json:png().toString('base64'),size:'99x99'}],usage:{generated_images:1}}])await assert.rejects(provider({fetchImpl:async()=>new Response(JSON.stringify(payload))}).generate({prompt:'fixture'}));});
test('未选/不合格/模拟运行/呈现未通过均不能计费',async()=>withStore(async store=>{let calls=0;const transport={available:()=>true,generate:async()=>{calls++;throw Error();}};const p=new MediaProvider({store,transport});for(const change of [r=>r.selected_candidate_id=null,r=>r.selectable_candidate_ids=[]]){const r=run();change(r);await assert.rejects(p.packaging(r,'c1'));}const r=run();r.media_generation_authorized=false;assert.equal((await p.packaging(r,'c1')).status,'unavailable');const failed=run();failed.presentation.recheck.passed=false;await assert.rejects(p.packaging(failed,'c1'));assert.equal(calls,0);}));
test('pending→ready持久化、并发/新provider复用、资产指纹及归属',async()=>withStore(async(store,dir)=>{let calls=0;let release;const gate=new Promise(r=>release=r);const transport={available:()=>true,generate:async plan=>{calls++;assert.ok(plan.prompt.includes('说明文字'));await gate;return {...await provider().generate({prompt:'fixture'})};}};const p=new MediaProvider({store,transport});const r=run();const [a,b]=await Promise.all([p.packaging(r,'c1'),p.packaging(r,'c1')]);assert.equal(a.status,'pending');assert.equal(a.selected.task_id,b.selected.task_id);release();const ready=await p.wait(a.selected.task_id);assert.equal(ready.media.status,'ready');assert.equal(ready.media.selected.image.version,ready.asset.sha256);assert.equal(ready.media.selected.annotations.length,0);assert.equal(ready.media.selected.generation.cost_status,'not_measured');assert.deepEqual(await store.readAsset(ready),png());const q=new MediaProvider({store:new MediaTaskStore(dir),transport});const cached=await q.packaging(r,'c1');assert.equal(cached.status,'ready');assert.equal(calls,1);await assert.rejects(q.task({...r,owner_scope:'owner-B'},a.selected.task_id));}));
test('超时/失败重复请求不计费；重启的pending转执行未知',async()=>withStore(async(store,dir)=>{let calls=0;const transport={available:()=>true,generate:async()=>{calls++;throw new ImageProviderError('IMAGE_EXECUTION_UNKNOWN',{execution:'unknown'});}};const p=new MediaProvider({store,transport});const r=run();const pending=await p.packaging(r,'c1');await p.wait(pending.selected.task_id);const failed=await p.packaging(r,'c1');assert.equal(failed.status,'failed');const again=await new MediaProvider({store:new MediaTaskStore(dir),transport}).packaging(r,'c1');assert.equal(again.selected.execution,'unknown');assert.equal(calls,1);
const id='a'.repeat(64);await store.create({task_id:id,media:{status:'pending',selected:{status:'pending',unknowns:[]}}});const restarted=await new MediaTaskStore(dir).read(id);assert.equal(restarted.media.selected.error_code,'IMAGE_EXECUTION_UNKNOWN');}));
