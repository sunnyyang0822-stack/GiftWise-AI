// Pure offline browser/parser fixtures. No network, browser process, model or real merchants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync}from'node:fs';
import {join}from'node:path';
import{searchDianping}from'../server/collect/dianping.mjs';
import{REPO_ROOT}from'../server/localdb/db.mjs';
import{taskDirectory}from'../server/collect/task-paths.mjs';
import{createSourceAvailabilityState,createSourceAvailabilityTracker}from'../server/retrieval/source-availability.mjs';
import{createOpencliToolSession}from'../server/retrieval/agent-tool.mjs';
import{runDomesticSearch}from'../server/retrieval/domestic-provider.mjs';

const root=mkdtempSync(join(taskDirectory(join(REPO_ROOT,'.tmp/dianping-access-tests')),'case-'));
mkdirSync(join(root,'clis/dianping'),{recursive:true});
writeFileSync(join(root,'package.json'),JSON.stringify({version:'offline-fixture'}));
for(const[name,content]of Object.entries({'search.js':'export function extractSearchRows(){}','shop.js':'export function extractShopFields(){}','cityResolver.js':'export async function resolveCityIdAsync(){return 1;}'}))writeFileSync(join(root,'clis/dianping',name),content);
const first='https://www.dianping.com/shop/fixture1',second='https://www.dianping.com/shop/fixture2';
function fixture({text='请完成安全验证',stage='detail',rawOk=false,throwCode=null}={}){
 const nav=[];let current;
 const page={goto:async url=>{current=url;nav.push(url);},wait:async()=>{},close:async()=>{},evaluate:async script=>{
  if(current.includes('/search/')){
   const blocked=stage==='search'&&current.includes('page2');
   if(script.includes('extractSearchRows'))return{ok:!blocked||rawOk,rows:blocked?[]:[{name:'离线商户一',url:first},{name:'离线商户二',url:second}]};
   return{url:current,rows:[],next_url:stage==='search'&&!blocked?'https://www.dianping.com/search/keyword/1/page2':null,total_text:'2',text:blocked?text:''};
  }
  if(throwCode)throw Object.assign(Error('offline fixture'),{code:throwCode});
  return script.includes('extractShopFields')?{ok:rawOk}:{url:current,text,packages:[]};
 }};return{page,nav};
}
const run=page=>searchDianping(page,{keyword:'离线测试',city:'上海',packageRoot:root,maxPages:2});
for(const[text,status,rawOk]of[['请完成安全验证','ACCESS_RESTRICTED',false],['请先登录','AUTH_REQUIRED',false],['访问受限','ACCESS_RESTRICTED',true]])test(`详情${status}立即停止，保留合法搜索观察且不声明完整（raw.ok=${rawOk}）`,async()=>{
 const f=fixture({text,rawOk}),result=await run(f.page);
 assert.deepEqual(f.nav.filter(u=>u.includes('/shop/')),[first]);assert.equal(result.records.length,2);assert.ok(result.records.every(r=>r.page_kind==='search'));
 assert.equal(result.status,status);assert.equal(result.coverage.status,status);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.blocked_stage,'detail');
 const tracker=createSourceAvailabilityTracker({processState:createSourceAvailabilityState()});const state=tracker.observe({source:'dianping',coverage:result.coverage});
 assert.equal(state.allow_request,false);assert.equal(state.status,status==='AUTH_REQUIRED'?'login_required':'paused');
});
test('后续搜索页受限后不访问已收集商户详情，异常码同样停止',async()=>{
 const search=fixture({stage:'search'}),result=await run(search.page);
 assert.equal(search.nav.length,2);assert.equal(result.records.length,2);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.status,'ACCESS_RESTRICTED');assert.equal(result.coverage.blocked_stage,'search');
 for(const code of ['ACCESS_RESTRICTED','AUTH_REQUIRED']){const f=fixture({throwCode:code}),r=await run(f.page);assert.deepEqual(f.nav.filter(u=>u.includes('/shop/')),[first]);assert.equal(r.coverage.status,code);assert.equal(r.coverage.complete,false);}
});
test('provider登录限制穿透结构化状态，同批及后续同来源查询不再导航',async()=>{
 const f=fixture({text:'扫码登录'});let starts=0,searches=0;
 const options={packageRoot:root,pageFactory:async()=>{starts++;return f.page;},dianpingSearch:async(page,args)=>{searches++;return searchDianping(page,args);}};
 const q={purpose:'purchase',keyword:'离线体验',sources:['dianping'],city:'上海'};
 const result=await runDomesticSearch({needs_retrieval:true,queries:[q,q]},options);
 assert.equal(result.status,'partial');assert.equal(result.products.length,2);assert.equal(result.recommendations_available,true);assert.equal(result.coverage[0].status,'AUTH_REQUIRED');assert.equal(result.source_availability.find(s=>s.source==='dianping').allow_request,false);
 const again=await runDomesticSearch({needs_retrieval:true,queries:[q]},options);assert.equal(again.products.length,0);assert.equal(starts,1);assert.equal(searches,1);assert.deepEqual(f.nav.filter(u=>u.includes('/shop/')),[first]);
});
test('工具返回受限状态和已合法取得的部分数据；本次与新会话停止同源重试，其他公开灵感仍可用',async()=>{
 const f=fixture();let calls=0;
 const search=async plan=>{calls++;if(plan.queries[0].sources[0]==='bing')return{status:'partial',products:[],references:[],coverage:[{source:'bing',status:'ok',complete:false}]};const r=await run(f.page);return{status:'partial',products:r.records.map((p,i)=>({...p,product_id:'offline-'+i})),coverage:[r.coverage]};};
 const session=createOpencliToolSession({search}),args={purpose:'purchase',keyword:'离线体验',sources:['dianping'],reason:'offline regression'};
 const invoke=(s,id)=>s.executeTool({id,name:'opencli_search',arguments:args});
 const initial=await invoke(session,'offline1');assert.equal(initial.products.length,2);assert.equal(initial.coverage[0].status,'ACCESS_RESTRICTED');assert.equal(initial.recommendations_available,true);assert.equal(initial.source_availability.find(s=>s.source==='dianping').allow_request,false);
 await invoke(session,'offline2');await invoke(createOpencliToolSession({search}),'offline3');assert.equal(calls,1);
 const fallback=await session.executeTool({id:'offline4',name:'opencli_search',arguments:{purpose:'reference',keyword:'离线造型灵感',sources:['bing'],reason:'offline fallback'}});
 assert.equal(fallback.recommendations_available,true);assert.equal(calls,2);assert.equal(session.retrieval.products.length,2);assert.deepEqual(f.nav.filter(u=>u.includes('/shop/')),[first]);
});
