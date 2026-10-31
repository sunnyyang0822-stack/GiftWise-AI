// Local HTTP + decoded fixture bytes only, no external sources/model/image generation.
import test from'node:test';import assert from'node:assert/strict';
import{once}from'node:events';import{createHash}from'node:crypto';
process.env.GW_PORT='8906';process.env.GW_MODE='mock';process.env.GIFTWISE_IMAGE_GENERATION='0';
const{server}=await import('../server/server.mjs');if(!server.listening)await once(server,'listening');
const{createRun}=await import('../server/store.mjs');
const{createOpencliToolSession}=await import('../server/retrieval/agent-tool.mjs');
const{startReferenceImages}=await import('../server/retrieval/reference-images.mjs');
const{validateSourceImage}=await import('../server/collect/domestic-detail.mjs');
const{cacheSourceImage}=await import('../server/catalog/source-image-cache.mjs');
const base='http://127.0.0.1:8906';
test('鉴权GET只读补3图，不重写候选/不重启job；原图200字节一致、跨owner与未知run拒绝',async()=>{try{
 const a=await fetch(base+'/api/config'),cookie=a.headers.get('set-cookie').split(';')[0],owner=cookie.split('=')[1].split('.')[0];
 const other=(await fetch(base+'/api/config')).headers.get('set-cookie').split(';')[0];
 const candidates=['离线陶艺','离线咖啡','离线旅行册'].map((name,i)=>({id:'c'+(i+1),name}));
 const run=createRun({owner_scope:owner,candidates,status:'passed',validation:{all_passed:true},selectable_candidate_ids:candidates.map(c=>c.id)});
 run.retrieval={products:[],references:[]};run.media={status:'unavailable',candidates:[],selected:null};run.retrieval_audit={reason:'private audit must not leak'};
 const records=[];
 for(let i=0;i<3;i++){
  const bytes=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');bytes[13]=50+i;
  const image_id=createHash('sha256').update(bytes).digest('hex').slice(0,32);
  const validation=await validateSourceImage('https://tse1.mm.bing.net/fixture.gif',{role:'reference',includeBytes:true,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/gif'}})});assert.equal(validation.ok,true);cacheSourceImage(image_id,validation);
  const{bytes:unused,...metadata}=validation;records.push({reference_id:'ref-http-'+i,reference_kind:'public_reference',title:candidates[i].name,source_url:'https://www.bilibili.com/video/BVfixture'+i+'/',observed_at:new Date().toISOString(),image_kind:'reference_image',image_id,image_validation:metadata,fixtureBytes:bytes});
 }
 let release,models=0,queries=0;const gate=new Promise(r=>release=r),session=createOpencliToolSession({search:async()=>{queries++;return{status:'partial',references:records.map(({fixtureBytes,...r})=>r)};}});
 const job=startReferenceImages(run,{session,requestJson:'{}',requestImages:async input=>{models++;await gate;await input.executeTool({name:'opencli_search',arguments:{purpose:'reference',keyword:'离线素材',sources:['bing']}});return{ok:true,reference_references:records.map((r,i)=>({candidate_id:candidates[i].id,reference_id:r.reference_id}))};}});
 const get=()=>fetch(base+'/api/runs/'+run.run_id,{headers:{cookie}});
 for(let i=0;i<3;i++){const response=await get(),p=await response.json();assert.equal(response.status,200);assert.equal(p.recommendation_run_id,run.run_id);assert.ok(p.media.candidates.every(s=>s.status==='pending'));assert.equal('retrieval_audit'in p,false);assert.equal('owner_scope'in p,false);}
 assert.equal(models,1);assert.equal(queries,0);release();await job.promise;
 const final=await(await get()).json();assert.equal(final.media.candidates.length,3);assert.ok(final.media.candidates.every(s=>s.status==='ready'));assert.deepEqual(final.selectable_candidate_ids,['c1','c2','c3']);assert.equal(final.retrieval.references.length,3);assert.equal(JSON.stringify(final).includes('private audit'),false);
 for(let i=0;i<3;i++){const response=await fetch(base+final.media.candidates[i].image.url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/gif');assert.deepEqual(Buffer.from(await response.arrayBuffer()),records[i].fixtureBytes);}
 assert.equal((await fetch(base+'/api/runs/'+run.run_id,{headers:{cookie:other}})).status,404);assert.equal((await fetch(base+'/api/runs/unknown',{headers:{cookie}})).status,404);assert.equal(models,1);assert.equal(queries,1);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
