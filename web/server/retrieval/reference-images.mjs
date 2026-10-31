import{bindReferenceEvidence}from'./reference-evidence.mjs';
import{publicReferenceUrl}from'../collect/public-reference.mjs';

export function referenceImageSlots(candidates,retrieval,bindings=[],pending=false){
 const used=new Set();
 return candidates.map(c=>{
  const matches=bindings.filter(b=>b.candidate_id===c.id&&b.image?.kind==='reference_image');
  const b=matches.length===1?matches[0]:null;
  const records=(retrieval.references??[]).filter(r=>r.reference_id===b?.reference_id);
  const r=records.length===1?records[0]:null,key=r?.image_validation?.sha256??r?.image_id;
  if(b&&r?.reference_kind==='public_reference'&&publicReferenceUrl(r.source_url,'bing')&&r.image_kind==='reference_image'&&r.image_validation?.ok===true&&r.image_validation.width>0&&r.image_validation.height>0&&/^[a-f0-9]{32,64}$/.test(r.image_id??'')&&r.image_id===b.image.id&&b.image.url===`/api/reference/images/${r.image_id}`&&!used.has(key)){used.add(key);return{...b,status:'ready'};}
  return{candidate_id:c.id,reference_id:null,image:null,status:pending?'pending':'unavailable'};
 });
}
function bindingsFromReferences(records,candidates,citations){
 const bound=bindReferenceEvidence(records.filter(r=>publicReferenceUrl(r.source_url,'bing')),candidates,citations);
 return{rejected:bound.rejected,bindings:[...bound.bindings].map(([candidate_id,r])=>({candidate_id,reference_id:r.reference_id,image:r.image_id&&r.image_validation?.ok?{id:r.image_id,url:`/api/reference/images/${r.image_id}`,version:r.image_id,kind:'reference_image',alt:`公开资料参考图：${r.title}`,source_url:r.source_url,price_observed_at:r.observed_at}:null}))};
}
/** One idempotent, bounded job after the final batch has passed. GET never calls this. */
export function startReferenceImages(run,{requestImages,session,requestJson,intakeJson=null,isCurrent=()=>true,signal,timeoutMs=180000}={}){
 if(run.reference_image_job)return run.reference_image_job;
 const frozen=JSON.stringify(run.candidates),owner=run.owner_scope,controller=new AbortController();
 const current=()=>isCurrent()&&run.owner_scope===owner&&JSON.stringify(run.candidates)===frozen;
 const initial=referenceImageSlots(run.candidates,run.retrieval,run.media?.candidates??[],true);
 const missing=initial.filter(s=>s.status!=='ready').map(s=>s.candidate_id);
 const job=run.reference_image_job={status:missing.length?'pending':'ready',missing_candidate_ids:missing};
 run.reference_image_slots=initial;run.media={...run.media,candidates:initial};
 if(!missing.length){job.promise=Promise.resolve();return job;}
 const remaining=10*60000-(Date.now()-Date.parse(run.created_at));
 const deadline=Math.max(1,Math.min(180000,timeoutMs,Number.isFinite(remaining)?remaining:180000));
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(abort,deadline);timer.unref?.();
 session.setSignal(controller.signal);
 session.finalize({runId:run.run_id,status:'in_progress',bindings:initial});
 job.promise=Promise.resolve().then(async()=>{
  let attempted=0;
  try{
   if(!current()||controller.signal.aborted)throw Error('REFERENCE_CANCELLED');
   const tools=structuredClone(session.tools);
   for(const tool of tools){tool.function.parameters.properties.purpose.enum=['reference','inspiration'];tool.function.parameters.properties.sources.items.enum=tool.function.parameters.properties.sources.items.enum.filter(s=>s!=='dianping');}
   const request=requestImages({requestJson,intakeJson,candidates:JSON.parse(frozen),missingCandidateIds:missing,references:run.retrieval.references??[],tools,signal:controller.signal,executeTool:async call=>{
    if(!current()||controller.signal.aborted)throw Error('REFERENCE_CANCELLED');
    if(++attempted>6)return{status:'unavailable',error_code:'REFERENCE_QUERY_LIMIT',references:[]};
    const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;
    if(!['reference','inspiration'].includes(args?.purpose)||args?.sources?.includes('dianping'))return{status:'unavailable',error_code:'REFERENCE_SOURCE_ONLY',references:[]};
    return session.executeTool({...call,arguments:args});
   }});
   const cancelled=new Promise((_,reject)=>{if(controller.signal.aborted)reject(Error('REFERENCE_CANCELLED'));else controller.signal.addEventListener('abort',()=>reject(Error('REFERENCE_CANCELLED')),{once:true});});
   const result=await Promise.race([request,cancelled]);
   run.call_counts.reference_images=(run.call_counts.reference_images??0)+(result.model_calls??0);
   if(!current()||controller.signal.aborted)throw Error('REFERENCE_CANCELLED');
   run.retrieval=session.retrieval;
   const citations=(Array.isArray(result.reference_references)?result.reference_references:[]).filter(r=>r&&typeof r==='object'&&missing.includes(r.candidate_id));
   const selected=bindingsFromReferences(run.retrieval.references??[],run.candidates,citations);
   job.rejected_references=selected.rejected;
   const slots=referenceImageSlots(run.candidates,run.retrieval,[...initial.filter(s=>s.status==='ready'),...selected.bindings]);
   run.reference_image_slots=slots;run.media={...run.media,candidates:slots};
   job.missing_candidate_ids=slots.filter(s=>s.status!=='ready').map(s=>s.candidate_id);
   job.status=job.missing_candidate_ids.length?'unavailable':'ready';job.error_code=result.ok?null:(result.code??'REFERENCE_MODEL_FAILED');job.error_detail=result.reason??null;
  }catch{job.status=controller.signal.aborted?'cancelled':'unavailable';job.error_code=controller.signal.aborted?'REFERENCE_TIMEOUT_OR_CANCELLED':'REFERENCE_IMAGE_FAILED';}
  finally{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(current()){
    run.reference_image_slots=run.reference_image_slots.map(s=>s.status==='pending'?{...s,status:'unavailable'}:s);
    run.media={...run.media,candidates:run.reference_image_slots};job.missing_candidate_ids=run.reference_image_slots.filter(s=>s.status!=='ready').map(s=>s.candidate_id);
   }
   job.completed_at=new Date().toISOString();
   session.finalize({runId:run.run_id,status:job.status==='ready'?'completed':job.status,errorCode:job.error_code,errorDetail:job.error_detail,bindings:run.reference_image_slots,rejected:job.rejected_references??[],candidateIds:run.candidates.map(c=>c.id),references:run.retrieval.references??[]});
  }
 });
 job.cancel=abort;
 return job;
}
