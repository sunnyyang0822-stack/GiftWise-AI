import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmProvider } from '../server/llm/provider.mjs';
import { OpenAiCompatibleTransport, extractContent } from '../server/llm/transport.mjs';
const tools=[{type:'function',function:{name:'search_context',description:'受控来源检索',parameters:{type:'object',properties:{keyword:{type:'string'}},required:['keyword'],additionalProperties:false}}}];
const cfg={baseUrl:'https://model.example.test/v1',apiKey:'test-secret-key',model:'test',timeoutMs:1000,maxRetries:0,maxTokens:500,outputRetries:0};
const textReply=(value={action:'recommend',candidates:[]})=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const callReply=(name='search_context',args='{"keyword":"星图"}',id='call_1')=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:args}}]}}]});
function setup(payloads) {
 const bodies=[];
 const transport=new OpenAiCompatibleTransport({fetchImpl:async(_url,opts)=>{bodies.push(JSON.parse(opts.body));const next=payloads.shift();return {ok:true,status:200,json:async()=>next};},sleepImpl:async()=>{}});
 return {bodies,provider:new LlmProvider({live:transport,config:()=>cfg,hasConfig:()=>true})};
}
const input={requestJson:'{}',tools};
test('synthetic OpenAI tool calls execute callback and return role:tool before candidates',async()=>{
 const {provider,bodies}=setup([callReply(),textReply({action:'recommend',candidates:[],product_references:[{candidate_id:'A',product_id:'p1'}]})]);
 let received;
 const result=await provider.requestCandidates({...input,executeTool:async call=>{received=call;return {ok:true,products:[{product_id:'p1',title:'星图'}]};}});
 assert.equal(result.ok,true);assert.equal(result.synthetic,true);assert.equal(result.model_calls,2);
 assert.deepEqual(received,{name:'search_context',arguments:{keyword:'星图'},id:'call_1'});
 assert.deepEqual(bodies[0].tools,tools);assert.equal(bodies[0].tool_choice,'auto');
 const assistant=bodies[1].messages.at(-2),tool=bodies[1].messages.at(-1);
 assert.equal(assistant.role,'assistant');assert.equal(assistant.content,null);assert.equal(tool.role,'tool');assert.equal(tool.tool_call_id,'call_1');assert.equal(JSON.parse(tool.content).products[0].product_id,'p1');
 assert.ok(!('product_references' in JSON.parse(result.outputs.candidates_json)));assert.equal(JSON.parse(result.outputs.product_references_json)[0].product_id,'p1');
 assert.equal(result.tool_audit.length,1);
});
test('text-only response performs zero tool executions and preserves old extract semantics',async()=>{
 const {provider}=setup([textReply()]);let count=0;
 const result=await provider.requestCandidates({...input,executeTool:async()=>{count++;}});
 assert.equal(result.ok,true);assert.equal(count,0);assert.equal(result.model_calls,1);assert.deepEqual(result.tool_audit,[]);
 assert.equal(extractContent({choices:[{message:{content:' hello '}}]}).text,'hello');
 assert.equal(extractContent({choices:[{message:{content:null}}]}).ok,false);
 assert.equal(extractContent({choices:[{finish_reason:'length',message:{content:''}}]}).ok,true);
 assert.equal(extractContent(callReply()).ok,true);
 assert.equal(extractContent({choices:[{message:{content:'{}',tool_calls:[]}}]}).ok,true);
});
test('tool exceptions return safe failure to model then model recommends',async()=>{
 const {provider,bodies}=setup([callReply(),textReply()]);
 const result=await provider.requestCandidates({...input,executeTool:async()=>{throw new Error('password=test-secret-key');}});
 assert.equal(result.ok,true);assert.equal(JSON.parse(bodies[1].messages.at(-1).content).error.code,'TOOL_EXECUTION_FAILED');
 assert.ok(!JSON.stringify(result).includes('test-secret-key'));assert.ok(!JSON.stringify(result).includes('password='));
});
test('unknown shell tool and malformed duplicate arguments never reach executor',async()=>{
 for (const response of [callReply('shell','{"command":"Remove-Item X"}'),callReply('search_context','{"keyword":"a","keyword":"b"}')]) {
  const {provider,bodies}=setup([response,textReply()]);let count=0;
  const result=await provider.requestCandidates({...input,executeTool:async()=>{count++;return {};}});
  assert.equal(result.ok,true);assert.equal(count,0);assert.equal(JSON.parse(bodies[1].messages.at(-1).content).ok,false);
 }
});
test('maximum tool rounds forces tool_choice none then receives final recommendation',async()=>{
 const {provider,bodies}=setup([callReply(),textReply()]);let count=0;
 const result=await provider.requestCandidates({...input,maxToolRounds:1,executeTool:async()=>{count++;return {ok:false,error:{code:'NO_DATA'}};}});
 assert.equal(result.ok,true);assert.equal(count,1);assert.equal(bodies[1].tool_choice,'none');assert.equal(result.model_calls,2);
});
test('HTTP tool rejection preserves actual status and never reads error body or claims support',async()=>{
 let read=0;
 const live=new OpenAiCompatibleTransport({fetchImpl:async()=>({ok:false,status:400,json:async()=>{read++;throw new Error('secret');}})});
 const provider=new LlmProvider({live,config:()=>cfg,hasConfig:()=>true});
 const result=await provider.requestCandidates(input);
 assert.equal(result.ok,false);assert.equal(result.status,400);assert.equal(result.tool_protocol_support,'unverified');assert.equal(result.tool_audit.length,0);assert.equal(read,0);
});
test('cancellation signal is merged with timeout and does not retry',async()=>{
 const controller=new AbortController();let attempts=0;
 const live=new OpenAiCompatibleTransport({fetchImpl:async(_url,{signal})=>{attempts++;controller.abort();assert.equal(signal.aborted,true);throw Object.assign(new Error(),{name:'AbortError'});}});
 const result=await live.chat({...cfg,messages:[],tools,signal:controller.signal,maxRetries:3});
 assert.equal(result.code,'LLM_CANCELLED');assert.equal(attempts,1);
});
test('tool result and audit redact credentials before feeding back to model',async()=>{
 const {provider,bodies}=setup([callReply(),textReply()]);
 const result=await provider.requestCandidates({...input,executeTool:async()=>({ok:true,token:'private',description:'test-secret-key',products:[]})});
 const content=bodies[1].messages.at(-1).content;
 assert.ok(!content.includes('private'));assert.ok(!content.includes('test-secret-key'));assert.ok(!JSON.stringify(result.tool_audit).includes('test-secret-key'));
});
