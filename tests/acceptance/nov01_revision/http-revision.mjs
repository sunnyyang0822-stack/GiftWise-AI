// QA 独立新版 HTTP 场景；只连接明确的专用 mock 服务，保存虚构请求和原始响应。
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ensureLocalServer} from '../../../web/tools/server-identity.mjs';
const BASE=process.env.GW_BASE;
if(!BASE)throw Error('必须显式设置 GW_BASE');
await ensureLocalServer(BASE,{explicit:true});
const OUT=process.env.GW_QA_OUT||'docs/test-reports/rev-qa-001/final-20261031/http-final';
mkdirSync(OUT,{recursive:true});
const responses=[],results=[];
async function api(path,payload){
  const started=new Date().toISOString();
  const r=await fetch(BASE+path,{method:payload?'POST':'GET',headers:payload?{'content-type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(8000)});
  const raw=await r.text();const body=JSON.parse(raw);
  responses.push({started,path,payload,http_status:r.status,raw});return body;
}
const check=(id,ok,actual)=>{const status=ok?'PASS':'FAIL';results.push({id,status,actual});console.log(status,id);};
const has=(r,code)=>r.errors?.some(x=>x.code===code);
const base=()=>({contract_version:'giftwise-20261031-v2',recipient_relation:'pursuit',closeness:'limited',occasion:'birthday',budget_mode:'other',budget_range:{min:'100',max:'300'},currency:'CNY',deadline_days:5,interests:[],interest_confidence:{},gift_styles:[],dislikes:'',hard_exclusions:{tags:[],terms:[],unresolved:[]},additional_context:'QA 虚构请求，不假定双向好感'});
try {
 const cfg=await api('/api/config');if(cfg.mode!=='mock')throw Error('拒绝非 mock 服务');
 const health=await api('/healthz');
 check('service-mock-config',cfg.mode==='mock'&&cfg.budget_slider?.step===50,{health,mode:cfg.mode});
 check('six-numeric-times',JSON.stringify(cfg.ranges.deadline.map(x=>x.value))==='[1,5,7,30,90,365]',cfg.ranges.deadline);
 check('config-no-credentials',!/api_key|Bearer /i.test(JSON.stringify(cfg)));
 for(const field of ['recipient_relation','occasion']) {
  for(const value of ['', ' ', '字'.repeat(1001),null,3]) {
   const i=base();i[field]='other';i[field+'_custom']=value;
   const r=await api('/api/recommendations',{intake:i});
   check(field+':invalid-custom-'+String(value).slice(0,10),r.status==='needs_input'&&!r.candidates,r.errors);
  }
  const i=base();i[field]='other';
  check(field+':missing-custom',(await api('/api/recommendations',{intake:i})).status==='needs_input');
  i[field+'_custom']=field==='occasion'?'搬家答谢':'社团指导老师';
  const r=await api('/api/recommendations',{intake:i});
  check(field+':valid-frozen',r.request?.[field]===i[field+'_custom'],r.request);
  const conflict={...base(),[field+'_custom']:'虚构自定义'};
  check(field+':illegal-combination',(await api('/api/recommendations',{intake:conflict})).status==='needs_input');
 }
 for(const [id,range,mode] of [['missing-min',{max:'300'},'other'],['missing-max',{min:'100'},'other'],['blank-min',{min:'',max:'300'},'other'],['reversed',{min:'301',max:'300'},'other'],['over-limit',{min:'0',max:'10000.01'},'other'],['slider-custom',{min:'1.01',max:'300'},'slider']]) {
  const r=await api('/api/recommendations',{intake:{...base(),budget_mode:mode,budget_range:range}});
  check('budget:'+id,r.status==='needs_input'&&!r.candidates,r.errors);
 }
 const zero=await api('/api/recommendations',{intake:{...base(),budget_mode:'zero',budget_range:{min:'0',max:'0'}}});
 check('zero-legal',zero.request?.budget_amount==='0'&&zero.candidates?.length===3,zero.status);
 const below=await api('/api/recommendations',{intake:{...base(),budget_range:{min:'1000',max:'1000'}}});
 check('below-min-warning-selectable',below.validation?.candidate_results.every(x=>x.passed&&x.warnings.some(w=>w.code==='BELOW_BUDGET_RANGE'))&&below.selectable_candidate_ids.length===3,below.validation);
 const i={...base(),dislikes:'不要香水'};
 const no=await api('/api/recommendations',{intake:i});
 check('unconfirmed-blocked',has(no,'INTAKE_CLARIFICATION_REQUIRED')&&!no.recommendation_run_id,no);
 const blank=await api('/api/exclusions/analyze',{intake:base()});
 check('empty-dislikes-no-analysis',blank.analysis_id===null&&blank.candidates.length===0,blank);
 const a=await api('/api/exclusions/analyze',{intake:i});
 check('analysis-anchored',a.status==='needs_confirmation'&&a.candidates.every(c=>i.dislikes.includes(c.source_span)),a);
 const confirm={analysis_id:a.analysis_id,confirmed_ids:a.candidates.map(x=>x.id)};
 for(const [id,c,input] of [
  ['forged-id',{...confirm,analysis_id:'xa-forged'},i],
  ['wrong-candidate',{...confirm,confirmed_ids:['xc9']},i],
  ['duplicate-id',{...confirm,confirmed_ids:[...confirm.confirmed_ids,...confirm.confirmed_ids]},i],
  ['partial',{...confirm,confirmed_ids:[]},i],
  ['changed-intake',confirm,{...i,additional_context:'已变更的虚构输入'}]]) {
   const r=await api('/api/recommendations',{intake:input,exclusion_confirmation:c});
   check('confirmation:'+id,r.status==='needs_input'&&!r.recommendation_run_id,r.errors);
 }
 const report=await api('/api/recommendations',{intake:i,exclusion_confirmation:confirm});
 check('confirmed-three-candidates',report.candidates?.length===3&&report.request.forbidden_tags.includes('fragrance'),report.status);
 const repeat=await api('/api/recommendations',{intake:i,exclusion_confirmation:confirm});
 check('confirmation-idempotent',repeat.recommendation_run_id===report.recommendation_run_id&&repeat.call_counts.recommend===report.call_counts.recommend,repeat.call_counts);
 check('before-choice-zero-presentation',report.selected_candidate_id===null&&report.call_counts.presentation===0,report.call_counts);
 const denied=await api('/api/presentations',{recommendation_run_id:report.recommendation_run_id,selected_candidate_id:'c9'});
 check('forged-selection-rejected',has(denied,'INVALID_SELECTION'),denied);
 const failedId=report.candidates.find(c=>!report.selectable_candidate_ids.includes(c.id))?.id;
 if(failedId) {
  const refused=await api('/api/presentations',{recommendation_run_id:report.recommendation_run_id,selected_candidate_id:failedId});
  check('failed-candidate-rejected',has(refused,'CANDIDATE_NOT_PASSED'),refused);
 }
 // 测试显式扮演用户，点击本次真实通过项；服务本身不得自动替用户选择。
 const selectedId=report.selectable_candidate_ids[0];
 const selected=report.candidates.find(c=>c.id===selectedId);
 if(!selected)throw Error('无合格候选，呈现检查 BLOCKED');
 const presentation=await api('/api/presentations',{recommendation_run_id:report.recommendation_run_id,selected_candidate_id:selectedId});
 const summary=presentation.recheck_summary;
 check('bill-one-gift',summary?.gift_estimated_total===selected.estimated_total&&presentation.candidate.id===selectedId,summary);
 check('packaging-no-quote',presentation.status==='completed'&&!Object.hasOwn(presentation.presentation_json,'additional_cost')&&!Object.hasOwn(presentation.presentation_json,'revised_estimated_total')&&Object.keys(presentation.presentation_json.packaging).join()==='color_palette',presentation.presentation_json);
 check('bill-not-verified',summary?.business_data_verification==='not_verified',summary);
 const replay=await api('/api/presentations',{recommendation_run_id:report.recommendation_run_id,selected_candidate_id:selectedId});
 check('presentation-idempotent',replay.idempotent_replay===true&&replay.call_counts.presentation===presentation.call_counts.presentation,replay.call_counts);
 check('repairs-at-most-one',replay.repair_count<=1&&replay.remaining_repairs===1-replay.repair_count,replay.repair_count);
 const unrecognized=await api('/api/exclusions/analyze',{intake:{...base(),dislikes:'虚构且无法映射的偏好'}});
 check('unmapped-blocked',unrecognized.status==='needs_input'&&unrecognized.candidates.length===0,unrecognized);
} catch(err) {results.push({id:'probe-exception',status:'BLOCKED',actual:String(err)});console.error(err);}
finally {
 const counts=Object.fromEntries(['PASS','FAIL','SKIP','BLOCKED'].map(s=>[s,results.filter(x=>x.status===s).length]));
 writeFileSync(join(OUT,'http-traces.json'),JSON.stringify(responses,null,2));
 writeFileSync(join(OUT,'http-results.json'),JSON.stringify({base:BASE,mode:'mock',counts,results},null,2));
 console.log('TOTAL',JSON.stringify(counts));process.exitCode=counts.FAIL||counts.BLOCKED?1:0;
}
