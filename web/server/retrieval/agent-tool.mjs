import { normalizeRetrievalPlan } from './query-plan.mjs';
import { DOMESTIC_CONTENT_SOURCES } from '../collect/domestic-content.mjs';
import { retrievalView } from '../store.mjs';
import {createSourceAvailabilityTracker}from'./source-availability.mjs';
import {mergeReferenceEvidence}from'./reference-evidence.mjs';

/** The model chooses whether to call; the server only validates and executes this fixed tool. */
export function createOpencliToolSession({ search, signal, auditStore=null, initialRetrieval=null } = {}) {
  const audit=[];
  let persistence=null;
  function persist(method,...args){try{persistence=auditStore?.[method](...args)??null;}catch{persistence={status:'failed',code:'AUDIT_WRITE_FAILED'};}return persistence;}
  const availability=createSourceAvailabilityTracker();
  const queries=[];
  let aggregate={status:'skipped',evidence_id:null,products:[],references:[],contents:[],images:[],coverage:[],warnings:[],enrichment_only:true};
  if(initialRetrieval)aggregate={...aggregate,...structuredClone(initialRetrieval)};
  const sources=[...new Set(['web','dianping',...Object.keys(DOMESTIC_CONTENT_SOURCES).filter(s=>s!=='douyin')])];
  const tools=[{type:'function',function:{name:'opencli_search',description:'按完整需求自主检索真实文字资料、做法、教程与案例。inspiration的web来源使用快速公开HTTP搜索摘要；选内容平台时也仅查其公开索引摘要，不宣称已读全文或直接接通平台。无图、无报价不丢资料。当前不抓推荐网图，不调用reference搜图；全部电商直抓仍停用。大众点评体验可用purchase。结合缓存和真实工具反馈选择资料，受限即停止，不绕验证。事实按来源与观察时刻，创意组合由模型结合用户上下文判断；不能把原创组合说成网上现成商品或编票价、库存。只读，不下单',parameters:{type:'object',additionalProperties:false,properties:{purpose:{type:'string',enum:['purchase','inspiration']},keyword:{type:'string',description:'本次具体文字资料或灵感检索词，不含姓名/联系方式/认证材料'},sources:{type:'array',items:{type:'string',enum:sources},minItems:1,maxItems:3},city:{type:['string','null'],description:'仅相关本地商户查询需要；未知可为null'},reason:{type:'string',description:'内部工具使用理由，不面向用户'}},required:['purpose','keyword','sources','reason']}}}];
  function merge(result){
    const dedup=(records,key)=>[...new Map(records.map(r=>[r[key],r])).values()];
    aggregate={...aggregate,status:result.status,evidence_id:result.evidence_id??aggregate.evidence_id,
      products:dedup([...aggregate.products,...(result.products??[])],'product_id'),references:mergeReferenceEvidence(aggregate.references,result.references??[]),contents:dedup([...aggregate.contents,...(result.contents??[])],'source_url'),source_availability:result.source_availability??aggregate.source_availability,
      images:dedup([...aggregate.images,...(result.images??[])],'url'),coverage:[...aggregate.coverage,...(result.coverage??[])]};
  }
  async function executeTool(call) {
    let persistedResult;
    const entry={tool_call_id:call.id??null,name:call.name,at:new Date().toISOString(),model_round:call.model_round??null,status:'requested'};
    audit.push(entry);
    try{
      const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;
      if(args?.purpose==='reference')throw new Error('REFERENCE_IMAGES_DISABLED_BY_USER');
      if(call.name==='opencli_product_details')throw new Error('COMMERCE_DISABLED_BY_USER');
      if(call.name!=='opencli_search')throw new Error('TOOL_NOT_ALLOWED');
      if(!args||Object.keys(args).some(k=>!['purpose','keyword','sources','city','reason'].includes(k)))throw new Error('INVALID_TOOL_ARGUMENTS');
      if(!Array.isArray(args.sources)||args.sources.length>3||args.sources.some(s=>!sources.includes(s)))throw new Error('SOURCE_DISABLED_OR_NOT_ALLOWED');
      const plan=normalizeRetrievalPlan({needs_retrieval:true,decision_reason:args.reason,queries:[args]});
      if(plan.queries.length!==1||!plan.needs_retrieval)throw new Error('INVALID_TOOL_ARGUMENTS');
      entry.plan=plan;
      if(signal?.aborted)throw new Error('RETRIEVAL_CANCELLED');
      queries.push(...plan.queries);
      const allowed=plan.queries[0].sources.filter(source=>availability.getAvailability({source}).allow_request);
      const blocked=plan.queries[0].sources.filter(source=>!allowed.includes(source));
      const result=allowed.length?await search({...plan,queries:[{...plan.queries[0],sources:allowed}]},{signal}):{status:'unavailable',products:[],references:[],coverage:[]};
      for(const source of allowed)availability.observe({source,coverage:result.coverage,observation_id:call.id});
      result.coverage=[...(result.coverage??[]),...blocked.map(source=>({source,status:'source_paused',complete:false,pages_completed:0,observed_count:0}))];
      result.source_availability=availability.toModelContext({sources:[...sources,'jd','taobao']}).source_availability;
      entry.status=result.status;entry.coverage=result.coverage??[];
      persistedResult=result;
      merge(result);
      const view=retrievalView(result);
      return {...view,coverage:result.coverage??[],recommendations_available:true};
    }catch(error){entry.status=signal?.aborted?'cancelled':'unavailable';entry.error_code=error.code??error.message;persistedResult={status:entry.status,products:[],references:[],contents:[],images:[],...availability.toModelContext({sources:[...sources,'jd','taobao']}),recommendations_available:true,error_code:entry.error_code};merge(persistedResult);return persistedResult;}
    finally{if(auditStore)entry.audit_persistence=persist('recordTool',entry,persistedResult);}
  }
  return {tools,executeTool,audit,setSignal:next=>{signal=next;},finalize:options=>persist('finalize',options),get persistence(){return persistence;},get retrieval(){return aggregate;},get plan(){return normalizeRetrievalPlan({needs_retrieval:queries.length>0,queries,decision_reason:'模型通过opencli_search工具调用自行请求'});}};
}
