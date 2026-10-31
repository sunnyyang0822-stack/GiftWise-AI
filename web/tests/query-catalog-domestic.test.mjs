import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, startRun, upsertProduct } from '../server/localdb/db.mjs';
import { openCatalogDb, listProducts, isDomesticProduct, searchProducts } from '../server/catalog/db.mjs';
import { matchCandidates, libraryPreview, scorePair } from '../server/catalog/match.mjs';
import { buildRetrievalPlan, retrievalContext } from '../server/retrieval/query-plan.mjs';
import { provideRealProducts, scrapeKeywordFor } from '../server/catalog/provide.mjs';

const dir = resolve('.tmp/query-catalog-tests');
mkdirSync(dir,{recursive:true});
function fixture(name, entries) {
 const path = resolve(dir,name+'.sqlite');
 rmSync(path,{force:true});
 const db = openDb(path);
 const run_id = startRun(db,{source_site:'test',capability:'fixture',query_params:{}});
 entries.forEach((p,i)=>upsertProduct(db,{external_id:String(i),source_site:'jd',capability:'fixture',title:'天文望远镜',product_url:'https://item.jd.com/'+i+'.html',currency:'CNY',price_amount:'100',run_id,...p}));
 db.close(); return path;
}

test('model receives open literal preferences, custom occasion and multiple needs, never names/time',async()=>{
 let seen;
 const request = {recipient_name:'小明',available_days:1,intake:{additional_context:'小明喜欢冷门的星图和看演出',occasion_custom:'重逢纪念',interests:['music']},inputParse:{literal_preferences:['星图','即兴剧场'],city:'杭州'}};
 const p = await buildRetrievalPlan(request,{planImpl:async context=>{seen=context;return {needs_retrieval:true,decision_reason:'核对具体商品与演出信息',queries:[{keyword:'星图海报',kind:'physical',sources:['jd']},{keyword:'即兴剧场',kind:'ticket',city:'杭州',sources:['damai']}]};}});
 assert.equal(p.queries.length,2);assert.equal(p.limit,null); assert.equal(seen.occasion_custom,'重逢纪念');
 assert.deepEqual(seen.literal_preferences,['星图','即兴剧场']);assert.ok(!JSON.stringify(seen).includes('小明'));assert.ok(!('available_days' in seen));
 assert.equal(p.queries[0].city,null);
});
test('no model or no information never substitutes generic gifts or enum queries',async()=>{
 assert.deepEqual((await buildRetrievalPlan({interests:['music']},{planImpl:async()=>null})).keywords,[]);
 assert.deepEqual((await buildRetrievalPlan({literal_preferences:['喜欢人造卫星模型']},{planImpl:async()=>null})).keywords,[]);
 assert.equal(scrapeKeywordFor({}).keyword,null);
});
test('concert wording never forces a form and timing never changes plan',async()=>{
 const queries=[{keyword:'演唱会周边丝巾',kind:'physical',sources:['taobao']},{keyword:'独立音乐现场',kind:'ticket',sources:['damai']},{keyword:'陶艺',kind:'experience',sources:['amazon','dianping']}];
 const a=await buildRetrievalPlan({available_days:0,needs_retrieval:true},{queries});const b=await buildRetrievalPlan({available_days:30,needs_retrieval:true},{queries});
 assert.deepEqual(a,b);assert.deepEqual(a.queries[2].sources,['dianping']);
});
test('malformed model plan is disclosed without inventing form',async()=>{
 const p=await buildRetrievalPlan({}, {planImpl:async()=>({nonsense:1})});
 assert.equal(p.queries.length,0);assert.equal(p.warnings.length,0);assert.equal(p.audit.decision_status,'missing_decision');
});
test('domestic source and real page domain must both be whitelisted',()=>{
 assert.equal(isDomesticProduct({source_site:'amazon',page_url:'https://amazon.com/x'}),false);
 assert.equal(isDomesticProduct({source_site:'jd',page_url:'https://amazon.com/x'}),false);
 assert.equal(isDomesticProduct({source_site:'jd',page_url:'https://jd.com.attacker.test/x'}),false);
 assert.equal(isDomesticProduct({source_site:'smzdm.com',page_url:'https://www.smzdm.com/x'}),true);
});
test('legacy overseas catalogue cannot bind, preview or enter search',()=>{
 const path=fixture('overseas',[{source_site:'amazon',product_url:'https://amazon.com/x',price_amount:'1'},{source_site:'jd',price_amount:'88'}]);
 const db=openCatalogDb(path);assert.equal(listProducts(db,{limit:null}).length,1);assert.equal(searchProducts(db,{keywords:['天文']}).length,1);db.close();
 const result=matchCandidates([{id:'c',name:'天文望远镜'}],{dbPath:path,budgetAmount:'100'});
 assert.equal(result.results[0].product.source_site,'jd');assert.equal(libraryPreview({dbPath:path}).products.length,1);
});
test('unknown quote can enrich; known price above budget cannot bind; factual metadata preserved',()=>{
 const path=fixture('unknown',[{source_site:'dianping',record_kind:'experience',title:'玻璃吹制体验',product_url:'https://www.dianping.com/shop/abc',price_amount:null,currency:null,raw_excerpt:{price_unit:'每人',city:'杭州',address:'示例路1号'}},{title:'天文望远镜',price_amount:'300'}]);
 const result=matchCandidates([{id:'x',name:'玻璃吹制体验'},{id:'y',name:'天文望远镜'}],{dbPath:path,budgetAmount:'0'});
 assert.equal(result.results[0].status,'matched');assert.equal(result.results[0].product.price_amount,null);assert.equal(result.results[0].product.price_unit,'每人');assert.equal(result.results[0].product.city,'杭州');
 assert.equal(result.results[1].reason_code,'CATALOG_OUT_OF_BUDGET');assert.equal(result.recommendations_available,true);
});
test('predefined theme aliases cannot attach unrelated goods',()=>{
 assert.equal(scorePair('朋友需要陪伴',{title:'仿真宠物玩偶'}).hit,false);
 assert.equal(scorePair('生日礼物',{title:'生日礼物礼盒'}).hit,false);
});
test('all explicit queries reach search and partial failures remain supplemental',async()=>{
 let count=0;
 const value=await provideRealProducts({candidates:[{id:'x',name:'星图海报'},{id:'y',name:'即兴剧场'}],dbPath:resolve(dir,'missing.sqlite'),scrapeEnabled:true,searchPlan:{needs_retrieval:true,queries:[{keyword:'星图海报',kind:'physical',sources:['jd']},{keyword:'即兴剧场',kind:'ticket',sources:['damai']}]},domesticSearch:async plan=>{count=plan.queries.length;return {status:'partial',products:[],coverage:[{source:'jd',pages:2,total:42,status:'complete'},{source:'dianping',pages:0,status:'login_required'}],warnings:['大众点评待登录']};}});
 assert.equal(count,2);assert.equal(value.catalog.coverage.length,2);assert.equal(value.catalog.recommendations_available,true);assert.equal(value.catalog.results.length,2);
});
test('retrieval supplements library gaps and preserves first bindings',async()=>{
 const path=fixture('supplement',[{title:'天文望远镜',price_amount:'10'}]);
 const value=await provideRealProducts({candidates:[{id:'x',name:'天文望远镜'},{id:'y',name:'玻璃吹制体验'}],dbPath:path,scrapeEnabled:true,searchPlan:{needs_retrieval:true,queries:[{keyword:'玻璃吹制体验',kind:'experience',sources:['dianping']}]},domesticSearch:async()=>{
  const db=openDb(path);const run_id=startRun(db,{source_site:'dianping',capability:'fixture',query_params:{}});
  upsertProduct(db,{source_site:'dianping',capability:'fixture',external_id:'experience',title:'玻璃吹制体验',product_url:'https://www.dianping.com/shop/abc',currency:null,run_id});db.close();return {status:'ok',coverage:[]};
 }});
 assert.equal(value.catalog.accounting.library_hits,1);assert.equal(value.catalog.accounting.fallback_hits,1);assert.equal(value.catalog.results[0].product.source_site,'jd');
});
test('search timeout cancels own search without failing model suggestions',async()=>{
 let aborted=false;
 const value=await provideRealProducts({candidates:[{id:'x',name:'卫星模型'}],scrapeEnabled:true,scrapeTimeoutMs:15,searchPlan:{needs_retrieval:true,queries:[{keyword:'卫星模型',sources:['jd']}]},domesticSearch:(_plan,{signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({status:'cancelled'});},{once:true}))});
 assert.equal(aborted,true);assert.equal(value.catalog.recommendations_available,true);
});


test('same DIY or concert context can receive either model decision without keyword routing',async()=>{
 for (const literal of ['DIY音乐盒','想一起看演唱会']) {
  const request={literal_preferences:[literal]};
  const skip=await buildRetrievalPlan(request,{planImpl:async()=>({needs_retrieval:false,decision_reason:'已有安排，无需新增外部信息',queries:[{keyword:literal,sources:['jd']}]})});
  const search=await buildRetrievalPlan(request,{planImpl:async()=>({needs_retrieval:true,decision_reason:'需要核实本次购买信息',queries:[{keyword:literal,sources:['taobao']}]})});
  assert.equal(skip.needs_retrieval,false);assert.deepEqual(skip.queries,[]);
  assert.equal(search.needs_retrieval,true);assert.deepEqual(search.queries[0].sources,['taobao']);
 }
});
test('false decision never searches and true decision calls only specified sources once',async()=>{
 let calls=0;let searched;
 const common={candidates:[{id:'x',name:'音乐盒材料'}],scrapeEnabled:true,domesticSearch:async plan=>{calls++;searched=plan;return {status:'unavailable',coverage:[],warnings:[]};}};
 const no=await provideRealProducts({...common,searchPlan:{needs_retrieval:false,decision_reason:'使用已有材料',queries:[{keyword:'音乐盒材料',sources:['jd']}]}});
 assert.equal(calls,0);assert.equal(no.catalog.recommendations_available,true);
 await provideRealProducts({...common,searchPlan:{needs_retrieval:true,decision_reason:'需要补充材料',queries:[{keyword:'音乐盒材料',sources:['taobao']}]}});
 assert.equal(calls,1);assert.deepEqual(searched.queries[0].sources,['taobao']);
});
test('missing sources, overseas-only sources, unavailable model and model errors all skip external search',async()=>{
 for (const decision of [{needs_retrieval:true,queries:[{keyword:'星图'}]},{needs_retrieval:true,queries:[{keyword:'星图',sources:['amazon']}]},null]) {
  const p=await buildRetrievalPlan({literal_preferences:['星图']},{planImpl:async()=>decision});
  assert.equal(p.needs_retrieval,false);assert.deepEqual(p.queries,[]);assert.deepEqual(p.warnings,[]);
 }
 const failed=await buildRetrievalPlan({literal_preferences:['星图']},{planImpl:async()=>{throw new Error('secret upstream body');}});
 assert.equal(failed.audit.decision_status,'model_error');assert.equal(failed.needs_retrieval,false);assert.deepEqual(failed.warnings,[]);
 assert.ok(!JSON.stringify(failed).includes('secret'));
});
