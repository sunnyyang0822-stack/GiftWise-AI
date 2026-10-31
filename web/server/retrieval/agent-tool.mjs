import { normalizeRetrievalPlan } from './query-plan.mjs';
import { DOMESTIC_CONTENT_SOURCES } from '../collect/domestic-content.mjs';
import { retrievalView } from '../store.mjs';
import {createSourceAvailabilityTracker}from'./source-availability.mjs';

/** The model chooses whether to call; the server only validates and executes this fixed tool. */
export function createOpencliToolSession({ search, signal } = {}) {
  const audit=[];
  const availability=createSourceAvailabilityTracker();
  const queries=[];
  let aggregate={status:'skipped',evidence_id:null,products:[],references:[],contents:[],images:[],coverage:[],warnings:[],enrichment_only:true};
  const sources=[...new Set(['duckduckgo','bing','dianping',...Object.keys(DOMESTIC_CONTENT_SOURCES).filter(s=>s!=='douyin')])];
  const tools=[{type:'function',function:{name:'opencli_search',description:'按完整需求自主查公开图片与灵感，优先reference/duckduckgo公开搜索（OpenCLI通路），bing为公开DOM辅路；inspiration用于内容平台。当前全部国内电商直抓已停用，不能调用或重试。大众点评体验可用purchase。资料图是参考图，不是实时在售SKU、成交价或库存。遇安全验证停止该来源，换可用公开资料或直接建议。无图片/数据不阻断推荐。只读，不下单。',parameters:{type:'object',additionalProperties:false,properties:{purpose:{type:'string',enum:['purchase','inspiration','reference']},keyword:{type:'string',description:'本次具体图片或灵感检索词，不含姓名/联系方式/认证材料'},sources:{type:'array',items:{type:'string',enum:sources},minItems:1},city:{type:['string','null'],description:'仅相关本地商户查询需要；未知可为null'},reason:{type:'string',description:'内部工具使用理由，不面向用户'}},required:['purpose','keyword','sources','reason']}}}];
  function merge(result){
    const dedup=(records,key)=>[...new Map(records.map(r=>[r[key],r])).values()];
    aggregate={...aggregate,status:result.status,evidence_id:result.evidence_id??aggregate.evidence_id,
      products:dedup([...aggregate.products,...(result.products??[])],'product_id'),references:dedup([...aggregate.references,...(result.references??[])],'reference_id'),contents:dedup([...aggregate.contents,...(result.contents??[])],'source_url'),source_availability:result.source_availability??aggregate.source_availability,
      images:dedup([...aggregate.images,...(result.images??[])],'url'),coverage:[...aggregate.coverage,...(result.coverage??[])]};
  }
  async function executeTool(call) {
    const entry={tool_call_id:call.id??null,name:call.name,at:new Date().toISOString(),status:'requested'};
    audit.push(entry);
    try{
      const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;
      if(call.name==='opencli_product_details')throw new Error('COMMERCE_DISABLED_BY_USER');
      if(call.name!=='opencli_search')throw new Error('TOOL_NOT_ALLOWED');
      if(!args||Object.keys(args).some(k=>!['purpose','keyword','sources','city','reason'].includes(k)))throw new Error('INVALID_TOOL_ARGUMENTS');
      if(!Array.isArray(args.sources)||args.sources.some(s=>!sources.includes(s)))throw new Error('SOURCE_DISABLED_OR_NOT_ALLOWED');
      const plan=normalizeRetrievalPlan({needs_retrieval:true,decision_reason:args.reason,queries:[args]});
      if(plan.queries.length!==1||!plan.needs_retrieval)throw new Error('INVALID_TOOL_ARGUMENTS');
      if(signal?.aborted)throw new Error('RETRIEVAL_CANCELLED');
      entry.plan=plan;
      queries.push(...plan.queries);
      const allowed=plan.queries[0].sources.filter(source=>availability.getAvailability({source}).allow_request);
      const blocked=plan.queries[0].sources.filter(source=>!allowed.includes(source));
      const result=allowed.length?await search({...plan,queries:[{...plan.queries[0],sources:allowed}]},{signal}):{status:'unavailable',products:[],references:[],coverage:[]};
      for(const source of allowed)availability.observe({source,coverage:result.coverage,observation_id:call.id});
      result.coverage=[...(result.coverage??[]),...blocked.map(source=>({source,status:'source_paused',complete:false,pages_completed:0,observed_count:0}))];
      result.source_availability=availability.toModelContext({sources:[...sources,'jd','taobao']}).source_availability;
      entry.status=result.status;entry.coverage=result.coverage??[];
      merge(result);
      const view=retrievalView(result);
      return {...view,coverage:result.coverage??[],recommendations_available:true};
    }catch(error){entry.status='unavailable';entry.error_code=error.code??error.message;return {status:'unavailable',products:[],references:[],contents:[],images:[],...availability.toModelContext({sources:[...sources,'jd','taobao']}),recommendations_available:true,error_code:entry.error_code};}
  }
  return {tools,executeTool,audit,get retrieval(){return aggregate;},get plan(){return normalizeRetrievalPlan({needs_retrieval:queries.length>0,queries,decision_reason:'模型通过opencli_search工具调用自行请求'});}};
}
