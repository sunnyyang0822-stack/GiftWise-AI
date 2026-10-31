import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runRecommendation } from '../server/pipeline.mjs';
import { reset } from '../server/store.mjs';
import { freezeEvidence,bindOptionalCandidateEvidence } from '../server/retrieval/evidence.mjs';

const base=JSON.parse(readFileSync(new URL('../../workflow/examples/intake.json',import.meta.url),'utf8'));
const intake=()=>({...structuredClone(base),budget_amount:'800',deadline_days:null,interests:[],interest_confidence:{},hard_exclusions:{tags:[],terms:[],unresolved:[]}});
const candidates=(amount='120')=>['一起安排陶艺','整理共同回忆','咖啡杯与手写祝福'].map((name,i)=>({id:'c'+(i+1),name,description:`夹具方向${i+1}`,estimated_total:i===0?amount:'80',currency:'CNY',estimated_preparation_days:2,tags:['other'],reason:'按已知关系表达心意',fact_refs:[],inferences:['形式是否适合仍需结合对方偏好'],unknowns:['具体安排与报价未核实'],fulfillment:i===0?'experience':'offline'}));
const result=(list=candidates(),references)=>({ok:true,outputs:{candidates_json:JSON.stringify({candidates:list}),...(references?{product_references_json:JSON.stringify(references)}:{})},model_calls:2});
const noMedia={derive:async()=>({ok:false,code:'TEST_NO_IMAGE'})};
const services=extra=>({retrievalEnabled:true,catalogEnabled:true,catalogScrape:true,catalogDbPath:fileURLToPath(new URL('../../.tmp/no-existing-agent-catalog.sqlite',import.meta.url)),visualDirectionProvider:noMedia,...extra});

test('模型无工具调用直接最终推荐；不因缺商品/城市/价格/图片盲抓',async()=>{
 reset();let searches=0;
 const out=await runRecommendation({intake:intake(),mode:'llm'},services({retrievalWorker:{submit:async()=>{searches++;throw Error('must not run');}},requestCandidates:async input=>{assert.equal(input.tools[0].function.name,'opencli_search');return result();}}));
 assert.equal(out.kind,'report');assert.equal(searches,0);assert.deepEqual(out.report.selectable_candidate_ids,['c1','c2','c3']);
 assert.equal(out.run.retrieval_audit.tool_calls.length,0);assert.equal(out.report.retrieval.status,'skipped');
});
test('模型实际执行受控工具回调再给最终建议；未知价格/单条结果与失效引用不阻断',async()=>{
 reset();let received;
 const out=await runRecommendation({intake:intake(),mode:'llm',inputParse:{literal_preferences:['黑白陶瓷'],city:'上海'}},services({
  retrievalWorker:{submit:async plan=>{received=plan;return {status:'partial',products:[{product_id:'fixture-only',title:'夹具杯子',name:'夹具杯子',variant:'',price_amount:null,currency:null,source_url:'https://item.jd.com/123.html'}],coverage:[{source:'jd',status:'partial'}],warnings:['internal-only']} }},
  requestCandidates:async input=>{assert.deepEqual(input.inputParse.literal_preferences,['黑白陶瓷']);const response=await input.executeTool({id:'call_fixture',name:'opencli_search',arguments:{purpose:'purchase',keyword:'黑白陶瓷杯',sources:['jd'],reason:'internal decision fixture'}});assert.equal(response.products.length,1);return result(candidates(),[{candidate_id:'c1',product_id:'missing'}]);},
 }));
 assert.equal(out.kind,'report');assert.equal(received.queries[0].keyword,'黑白陶瓷杯');assert.deepEqual(received.queries[0].sources,['jd']);
 assert.deepEqual(out.report.selectable_candidate_ids,['c1','c2','c3']);assert.equal(out.run.product_bindings.size,0);
 assert.equal(out.run.retrieval_audit.tool_calls.length,1);assert.equal(out.run.retrieval_audit.rejected_references.length,1);
 assert.deepEqual(out.report.retrieval.warnings,[]);assert.equal(JSON.stringify(out.report).includes('internal decision fixture'),false);
});
test('已知预算越界仍使该候选失败，不将未知价误判为违规',async()=>{
 reset();const out=await runRecommendation({intake:intake(),mode:'llm'},services({requestCandidates:async()=>result(candidates('801'))}));
 assert.equal(out.kind,'report');assert.equal(out.report.validation.candidate_results[0].passed,false);
 assert.ok(out.report.validation.candidate_results[0].errors.some(e=>e.code==='OVER_BUDGET'));assert.equal(out.report.selectable_candidate_ids.includes('c2'),true);
});
test('概念单只杯不得被目录相似标题误绑成四杯套装图',async()=>{
 reset();const out=await runRecommendation({intake:intake(),mode:'llm'},services({requestCandidates:async()=>result(),provideRealProducts:async({candidates:requested})=>{
  assert.equal(requested.length,0);return{catalog:{results:[{candidate_id:'c1',status:'matched',product:{product_id:'wrong-four-cups',image_id:'wrong-photo',image_validation:{ok:true},image_urls:['https://img10.360buyimg.com/fixture.jpg']}}]}};
 }}));
 assert.equal(out.run.catalog_bindings.size,0);assert.equal(out.report.media.candidates.length,0);assert.equal(out.report.retrieval.products.length,0);
});
test('模型明确选择同规格商品后，验证来源图以唯一槽位与相同product/image标识返回',async()=>{
 reset();const product={product_id:'fixture-explicit-product',name:'夹具单只杯',title:'夹具单只杯',variant:'黑白单只',price_amount:'120',currency:'CNY',price_source:'seed',price_conditions:[],image_id:'a'.repeat(32),image_validation:{ok:true},image_url:'https://img10.360buyimg.com/fixture.jpg',source_url:'https://item.jd.com/123.html'};
 const items=candidates();items[0].name=product.name+' · '+product.variant;
 const out=await runRecommendation({intake:intake(),mode:'llm'},services({retrievalWorker:{submit:async()=>({status:'partial',products:[product]})},requestCandidates:async input=>{await input.executeTool({id:'fixture_call',name:'opencli_search',arguments:{purpose:'purchase',keyword:'夹具杯',sources:['jd'],reason:'fixture'}});return result(items,[{candidate_id:'c1',product_id:product.product_id}]);}}));
 assert.equal(out.report.media.candidates.length,1);const slot=out.report.media.candidates[0];assert.equal(slot.product_id,product.product_id);assert.equal(slot.image.id,product.image_id);assert.equal(slot.image.kind,'source_photo');assert.equal(out.report.retrieval.products[0].image_id,slot.image.id);
});
test('来源图绑定容许同名分隔符及独立估价，促销观察价不被伪装为普通结算价',()=>{
 const p={product_id:'observed',name:'官方杯碟套装 双杯双碟礼盒款',variant:'',price_amount:'218',price_conditions:['首单到手价'],price_source:'seed'};
 const c={id:'c1',name:'官方杯碟套装 · 双杯双碟礼盒款',estimated_total:'258.00'};
 const bound=bindOptionalCandidateEvidence({products:[p]},[c],[{candidate_id:'c1',product_id:p.product_id}],'500');
 assert.equal(bound.bindings.size,1);assert.equal(bound.bindings.get('c1').price_amount,'218');assert.equal(bound.bindings.get('c1').price_binding_status,'model_estimate_separate_from_observation');
 assert.deepEqual(bound.knownOverBudget,[]);assert.equal(bindOptionalCandidateEvidence({products:[p]},[{...c,name:'另一规格单只杯'}],[{candidate_id:'c1',product_id:p.product_id}],'500').bindings.size,0);
});
