import test from 'node:test';import assert from 'node:assert/strict';
import{runDomesticSearch}from'../server/retrieval/domestic-provider.mjs';
import{createOpencliToolSession}from'../server/retrieval/agent-tool.mjs';
import{LlmProvider}from'../server/llm/provider.mjs';
const html='<ol id="b_results"><li class="b_algo"><h2><a href="https://sspai.com/post/offline-fold">折页记录做法</a></h2><div class="b_caption"><p>离线摘要：把纸张折叠后分栏记录短文字，可按主题重新组合；不是在线证据。</p></div></li></ol>';
test('default text adapter reaches model material without browser, image validation or OpenCLI dependency',async()=>{
 let gets=0;const r=await runDomesticSearch({needs_retrieval:true,queries:[{purpose:'inspiration',keyword:'受控文字资料',sources:['web']}]},{pageFactory:()=>assert.fail('no browser'),packageRoot:'missing-opencli',queryFetchImpl:async(url,options)=>{gets++;assert.equal(new URL(url).pathname,'/search');assert.equal(options.redirect,'manual');return new Response(html,{headers:{'content-type':'text/html'}});}});
 assert.equal(gets,1);assert.equal(r.references.length,1);assert.match(r.references[0].summary,/纸张/);assert.equal(r.references[0].image_url,null);assert.deepEqual(r.images,[]);assert.equal(r.opencli_version,null);assert.equal(r.coverage[0].source,'web');
});
test('legacy reference image request is rejected before any executor or browser work',async()=>{
 let searches=0;const session=createOpencliToolSession({search:async()=>{searches++;throw Error('must not search');}});
 assert.deepEqual(session.tools[0].function.parameters.properties.purpose.enum,['purchase','inspiration']);
 const r=await session.executeTool({name:'opencli_search',arguments:{purpose:'reference',keyword:'no images',sources:['bing']}});assert.equal(r.error_code,'REFERENCE_IMAGES_DISABLED_BY_USER');assert.equal(searches,0);
 const direct=await runDomesticSearch({needs_retrieval:true,queries:[{purpose:'reference',keyword:'no images',sources:['bing']}]},{pageFactory:()=>assert.fail('must not start')});assert.equal(direct.coverage[0].status,'REFERENCE_IMAGES_DISABLED_BY_USER');
});
test('unrelated cached material is context rather than a mandatory menu; model can choose new material',async()=>{
 const cached={reference_id:'old_coffee',reference_kind:'public_reference',title:'离线咖啡摘要',summary:'这是受控咖啡做法，与本轮纸张主题无关。',source_url:'https://sspai.com/post/coffee-offline',observed_at:'2026-10-31T20:00:00Z'};
 const fresh={...cached,reference_id:'new_paper',title:'离线折页案例',summary:'纸张连续折叠并分栏记录，可组合成个人主题册。',source_url:'https://sspai.com/post/paper-offline'};
 const provider=new LlmProvider({hasConfig:()=>true});let calls=0,tools=0;
 provider.invoke=async input=>{if(++calls===1){assert.notEqual(input.tool_choice,'required');assert.match(JSON.stringify(input.messages),/old_coffee/);return{ok:true,tool_calls:[{id:'new_query',function:{name:'opencli_search',arguments:JSON.stringify({purpose:'inspiration',keyword:'paper folding creative record',sources:['web'],reason:'full context'})}}]};}assert.match(JSON.stringify(input.messages),/new_paper/);return{ok:true,text:JSON.stringify({candidates:[{id:'c1',name:'声音地图'},{id:'c2',name:'记忆折页'},{id:'c3',name:'未来信'}],material_reference_ids:['new_paper']}),finish_reason:'stop'};};
 const r=await provider.requestCandidates({requestJson:JSON.stringify({notes:'想给爱纸艺的朋友做轻量礼物'}),retrieval:{status:'partial',references:[cached]},tools:[{type:'function',function:{name:'opencli_search'}}],executeTool:async()=>{tools++;return{status:'partial',references:[fresh]};}});
 assert.equal(r.ok,true);assert.equal(tools,1);assert.deepEqual(r.grounding.reference_ids,['new_paper']);assert.equal('material_reference_ids'in JSON.parse(r.outputs.candidates_json),false);
});

test('actual permitted merchant observations remain material without a picture or quoted price',async()=>{const provider=new LlmProvider({hasConfig:()=>true});provider.invoke=async()=>({ok:true,text:JSON.stringify({candidates:[{id:'c1'}],product_references:[{candidate_id:'c1',product_id:'dp_observed'}]}),finish_reason:'stop'});const product={product_id:'dp_observed',title:'离线商户观察',source_url:'https://www.dianping.com/shop/offline123',observed_at:'2026-10-31T20:00:00Z',price_amount:null,image_url:null};const result=await provider.requestCandidates({requestJson:'{}',groundingRequired:true,retrieval:{status:'partial',products:[product]},tools:[]});assert.equal(result.ok,true);assert.deepEqual(result.grounding.product_ids,['dp_observed']);});
