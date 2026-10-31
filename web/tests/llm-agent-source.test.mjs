import test from 'node:test';
import assert from 'node:assert/strict';
import {LlmProvider} from '../server/llm/provider.mjs';
import {OpenAiCompatibleTransport} from '../server/llm/transport.mjs';
import {bindOptionalCandidateEvidence} from '../server/retrieval/evidence.mjs';
const cfg={baseUrl:'https://model.example.test/v1',apiKey:'synthetic-secret',model:'synthetic',timeoutMs:1000,maxRetries:0,maxTokens:2000,outputRetries:0};
const tools=[{type:'function',function:{name:'opencli_search',parameters:{type:'object',properties:{keyword:{type:'string'}},additionalProperties:false}}}];
const exclusion={raw_text:'不要把感谢说成暧昧，也别用太隆重的方式',semantic:[{interpretation:'保持朋友边界，避免暗示恋爱关系',confidence:'inferred'}],clarifications:[{question:'简单实用可以吗？',answer:'可以，别让对方觉得欠我人情。'}]};
const request={recipient_relation_id:'friend',budget_amount:'150',currency:'CNY',exclusion_context:exclusion};
const candidates=[{id:'A',name:'单只咖啡杯',estimated_total:'50'},{id:'B',name:'一起整理已有旅行照片',estimated_total:'0'},{id:'C',name:'手写一张感谢卡',estimated_total:'5'}];
const toolCall=()=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'search_1',type:'function',function:{name:'opencli_search',arguments:'{"keyword":"单只咖啡杯"}'}}]}}]});
const final=(list=candidates,refs)=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({action:'recommend',candidates:list,...(refs===undefined?{}:{product_references:refs})})}}]});
function synthetic(sequence){
 const messages=[];
 const live=new OpenAiCompatibleTransport({fetchImpl:async(_url,options)=>{messages.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>sequence.shift()};}});
 return {messages,provider:new LlmProvider({live,config:()=>cfg,hasConfig:()=>true})};
}
const base={requestJson:JSON.stringify(request),tools};
test('same full exclusion context survives tool messages and empty results still yield model final suggestions',async()=>{
 const {provider,messages}=synthetic([toolCall(),final()]);let executed=0;
 const result=await provider.requestCandidates({...base,executeTool:async()=>{executed++;return {status:'unavailable',products:[],contents:[],images:[],coverage:[{source:'jd',status:'empty_or_selector_changed',observed_count:0}],recommendations_available:true};}});
 assert.equal(result.ok,true);assert.equal(executed,1);assert.equal(result.model_calls,2);assert.equal(result.synthetic,true);
 assert.deepEqual(messages[1].messages.slice(0,messages[0].messages.length),messages[0].messages);
 for(const call of messages){const serialized=JSON.stringify(call.messages);for(const value of [exclusion.raw_text,exclusion.semantic[0].interpretation,exclusion.clarifications[0].answer])assert.ok(serialized.includes(value));}
 assert.equal(messages[1].messages.at(-1).role,'tool');assert.equal(JSON.parse(messages[1].messages.at(-1).content).products.length,0);
 assert.deepEqual(JSON.parse(result.outputs.candidates_json).candidates,candidates);
});
test('identical context allows model to choose tools or no tools without routing rules',async()=>{
 let calls=0;
 for(const sequence of [[final()],[toolCall(),final()]]){
  const {provider}=synthetic(sequence);
  const result=await provider.requestCandidates({...base,executeTool:async()=>{calls++;return {status:'unavailable',products:[]};}});
  assert.equal(result.ok,true);
 }
 assert.equal(calls,1);
});
test('final sidecar is isolated and exact product specifications govern optional source-image bindings',async()=>{
 const product={product_id:'four-cups',name:'陶瓷杯',variant:'四只装',quantity:4,price_amount:'50',currency:'CNY',price_conditions:[],price_source:'browser_observed',source_site:'jd',source_url:'https://item.jd.com/1.html',observed_at:new Date().toISOString(),image_id:'real-four-cups'};
 const refs=[{candidate_id:'A',product_id:product.product_id},{candidate_id:'B',product_id:'inspiration-photo'}];
 const {provider,messages}=synthetic([toolCall(),final(candidates,refs)]);
 let finalized=false;
 const promise=provider.requestCandidates({...base,executeTool:async()=>{assert.equal(finalized,false);return {status:'partial',products:[product],contents:[{title:'杯具灵感',source_url:'https://example.test/article'}],images:[{image_id:'inspiration-photo',url:'https://example.test/content.jpg',purpose:'inspiration'}]};}}).then(result=>{finalized=true;return result;});
 const result=await promise;
 assert.equal(messages.length,2);assert.equal(finalized,true);assert.equal(result.ok,true);
 assert.ok(!('product_references' in JSON.parse(result.outputs.candidates_json)));
 const sidecar=JSON.parse(result.outputs.product_references_json);assert.deepEqual(sidecar,refs);
 const rejected=bindOptionalCandidateEvidence({products:[product]},candidates,sidecar,'150');
 assert.equal(rejected.bindings.size,0);assert.deepEqual(rejected.rejected.map(r=>r.code),['PRODUCT_SPEC_MISMATCH','UNKNOWN_PRODUCT']);
 const adopted=[{...candidates[0],name:'陶瓷杯 · 四只装'}];
 const bound=bindOptionalCandidateEvidence({products:[product]},adopted,[refs[0]],'150');
 assert.equal(bound.bindings.get('A').image_id,'real-four-cups');
});
test('large results preserve bounded evidence, collection totals and truncation metadata for final model reasoning',async()=>{
 const records=Array.from({length:400},(_,i)=>({product_id:'p'+i,name:'天文望远镜'+i,variant:'标准',description:'资料'.repeat(1500),price_amount:'50',source_url:'https://item.jd.com/'+i+'.html'}));
 const {provider,messages}=synthetic([toolCall(),final()]);
 const result=await provider.requestCandidates({...base,executeTool:async()=>({status:'partial',products:records,contents:[{title:'天文资料',text:'正文'.repeat(3000)}],images:[],coverage:[{source:'jd',reported_total:400,pages_completed:20}],recommendations_available:true})});
 assert.equal(result.ok,true);
 const tool=messages[1].messages.at(-1);assert.ok(tool.content.length<=256000);
 const data=JSON.parse(tool.content);assert.ok(data.products.length>0);assert.ok(data.products.length<400);assert.equal(data.products[0].product_id,'p0');assert.equal(data.coverage[0].pages_completed,20);
 assert.equal(data.tool_result_meta.truncated,true);assert.equal(data.tool_result_meta.collections.products.total,400);assert.equal(data.tool_result_meta.collections.products.returned,data.products.length);
 assert.ok(!tool.content.includes('TOOL_RESULT_TOO_LARGE'));assert.equal(result.tool_audit[0].result.tool_result_meta.truncated,true);
});
