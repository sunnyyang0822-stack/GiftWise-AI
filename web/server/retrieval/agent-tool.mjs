import { normalizeRetrievalPlan } from './query-plan.mjs';
import { DOMESTIC_PLATFORMS } from '../collect/domestic-platforms.mjs';
import { DOMESTIC_CONTENT_SOURCES } from '../collect/domestic-content.mjs';
import {DOMESTIC_EXTRA_PLATFORMS}from'../collect/domestic-extra-platforms.mjs';
import { retrievalView } from '../store.mjs';

/** The model chooses whether to call; the server only validates and executes this fixed tool. */
export function createOpencliToolSession({ search,details, signal } = {}) {
  const audit=[];
  const queries=[];
  let aggregate={status:'skipped',evidence_id:null,products:[],contents:[],images:[],coverage:[],warnings:[],enrichment_only:true};
  const sources=[...new Set([...Object.keys(DOMESTIC_PLATFORMS),...Object.keys(DOMESTIC_EXTRA_PLATFORMS),'dianping',...Object.keys(DOMESTIC_CONTENT_SOURCES)])];
  const tools=[{type:'function',function:{name:'opencli_search',description:'按当前完整需求决定是否查外部资料。购买信息仅国内电商/大众点评；未明确购买的灵感与参考图片可用国内外内容平台。不需要查时直接推荐。检索词宜用核心物品/活动加少量属性，避免把整段需求变成同时匹配的长词串；无结果时可自主简化重试。只读查询，不下单支付。',parameters:{type:'object',additionalProperties:false,properties:{purpose:{type:'string',enum:['purchase','inspiration']},keyword:{type:'string',description:'本次具体相关检索词，不含姓名/联系方式/认证材料'},sources:{type:'array',items:{type:'string',enum:sources},minItems:1},city:{type:['string','null'],description:'仅相关本地商户查询需要；未知可为null'},reason:{type:'string',description:'内部工具使用理由，不面向用户'}},required:['purpose','keyword','sources','reason']}}}];
  tools.push({type:'function',function:{name:'opencli_product_details',description:'只读查看本次搜索中你选出的商品详情、已选规格、实际价格条件与原图。product_ids必须来自此前opencli_search返回，不能传任意URL。按需求选合适商品，不自动取首条。',parameters:{type:'object',additionalProperties:false,properties:{product_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:6},reason:{type:'string'}},required:['product_ids','reason']}}});
  function merge(result){
    const dedup=(records,key)=>[...new Map(records.map(r=>[r[key],r])).values()];
    aggregate={...aggregate,status:result.status,evidence_id:result.evidence_id??aggregate.evidence_id,
      products:dedup([...aggregate.products,...(result.products??[])],'product_id'),contents:dedup([...aggregate.contents,...(result.contents??[])],'source_url'),
      images:dedup([...aggregate.images,...(result.images??[])],'url'),coverage:[...aggregate.coverage,...(result.coverage??[])]};
  }
  async function executeTool(call) {
    const entry={tool_call_id:call.id??null,name:call.name,at:new Date().toISOString(),status:'requested'};
    audit.push(entry);
    try{
      const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;
      if(call.name==='opencli_product_details'){
        if(!args||Object.keys(args).some(k=>!['product_ids','reason'].includes(k))||!Array.isArray(args.product_ids)||args.product_ids.length<1||args.product_ids.length>6||args.product_ids.some(id=>!aggregate.products.some(p=>p.product_id===id)))throw new Error('INVALID_TOOL_ARGUMENTS');
        if(typeof details!=='function')throw new Error('DETAIL_TOOL_UNAVAILABLE');
        const records=[...new Set(args.product_ids)].map(id=>aggregate.products.find(p=>p.product_id===id));
        entry.product_ids=args.product_ids;entry.reason=args.reason;
        const result=await details(records,{signal});entry.status=result.status;entry.coverage=result.coverage??[];merge(result);
        return {...retrievalView(result),coverage:result.coverage??[],recommendations_available:true};
      }
      if(call.name!=='opencli_search')throw new Error('TOOL_NOT_ALLOWED');
      if(!args||Object.keys(args).some(k=>!['purpose','keyword','sources','city','reason'].includes(k)))throw new Error('INVALID_TOOL_ARGUMENTS');
      const plan=normalizeRetrievalPlan({needs_retrieval:true,decision_reason:args.reason,queries:[args]});
      if(plan.queries.length!==1||!plan.needs_retrieval)throw new Error('INVALID_TOOL_ARGUMENTS');
      if(signal?.aborted)throw new Error('RETRIEVAL_CANCELLED');
      entry.plan=plan;
      queries.push(...plan.queries);
      const result=await search(plan,{signal});
      entry.status=result.status;entry.coverage=result.coverage??[];
      merge(result);
      const view=retrievalView(result);
      return {...view,coverage:result.coverage??[],recommendations_available:true};
    }catch(error){entry.status='unavailable';entry.error_code=error.code??error.message;return {status:'unavailable',products:[],contents:[],images:[],recommendations_available:true,error_code:entry.error_code};}
  }
  return {tools,executeTool,audit,get retrieval(){return aggregate;},get plan(){return normalizeRetrievalPlan({needs_retrieval:queries.length>0,queries,decision_reason:'模型通过opencli_search工具调用自行请求'});}};
}
