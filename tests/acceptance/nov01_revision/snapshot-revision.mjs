// 内存快照边界的离线集成探针；虚构时钟只在本进程，非 HTTP/真实时间流逝证明。
import {mkdirSync,writeFileSync} from 'node:fs';
import {createAnalysis,getAnalysis} from '../../../web/server/exclusion-store.mjs';
import {runRecommendation} from '../../../web/server/pipeline.mjs';
const OUT='docs/test-reports/rev-qa-001/final-20261031/snapshot-results.json';
const results=[];
const check=(id,ok,actual)=>{results.push({id,status:ok?'PASS':'FAIL',actual});console.log(ok?'PASS':'FAIL',id);};
const intake={contract_version:'giftwise-20261031-v2',recipient_relation:'friend',occasion:'birthday',budget_mode:'other',budget_range:{min:'100',max:'300'},currency:'CNY',deadline_days:5,dislikes:'不要香水',interests:[],interest_confidence:{},gift_styles:[],hard_exclusions:{tags:[],terms:[],unresolved:[]},additional_context:'虚构内存边界'};
const candidates=[{id:'xc1',kind:'tag',tag:'fragrance',term:null,source_span:'不要香水',confidence:'high',why:'虚构测试',evidence:'user_text'}];
const realNow=Date.now;
let now=realNow();
Date.now=()=>now;
try {
 const id=createAnalysis({intake,mode:'mock',candidates,status:'needs_confirmation'});
 now+=600000;
 check('ttl-exact-10min-present',!!getAnalysis(id));
 now+=1;
 check('ttl-over-10min-removed',getAnalysis(id)===null);
 const r=await runRecommendation({intake,analysis:getAnalysis(id),exclusion_confirmation:{analysis_id:id,confirmed_ids:['xc1']},mode:'mock'});
 check('expired-blocks-recommendation',r.errors?.some(e=>e.code==='EXCLUSION_ANALYSIS_STALE')&&!r.report,r);
 const unknown=await runRecommendation({intake,analysis:getAnalysis('xa-forged'),exclusion_confirmation:{analysis_id:'xa-forged',confirmed_ids:['xc1']},mode:'mock'});
 check('unknown-blocks-recommendation',unknown.errors?.some(e=>e.code==='EXCLUSION_ANALYSIS_STALE'),unknown);
 const newId=createAnalysis({intake,mode:'mock',candidates,status:'needs_confirmation'});
 const input={intake,analysis:getAnalysis(newId),exclusion_confirmation:{analysis_id:newId,confirmed_ids:['xc1']},mode:'mock'};
 const [a,b]=await Promise.all([runRecommendation(input),runRecommendation(input)]);
 check('parallel-mock-confirm-idempotent',a.report?.recommendation_run_id===b.report?.recommendation_run_id&&a.run.call_counts.recommend===1,{a:a.report?.recommendation_run_id,b:b.report?.recommendation_run_id,calls:a.run.call_counts});
 const ids=Array.from({length:201},()=>createAnalysis({intake,mode:'mock',candidates,status:'needs_confirmation'}));
 check('bounded-200-oldest-pruned',getAnalysis(ids[0])===null&&!!getAnalysis(ids.at(-1)));
}finally{
 Date.now=realNow;
 mkdirSync('docs/test-reports/rev-qa-001/final-20261031',{recursive:true});
 writeFileSync(OUT,JSON.stringify({layer:'offline-mock-integration',clock:'test-process Date.now injection',results},null,2));
 process.exitCode=results.some(x=>x.status==='FAIL')?1:0;
}
