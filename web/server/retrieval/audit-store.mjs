/** Internal, bounded evidence. Never an input to recommendation eligibility. */
import{randomUUID}from'node:crypto';
import{writeFileSync,renameSync,readdirSync,statSync,unlinkSync}from'node:fs';
import{join}from'node:path';
import{REPO_ROOT}from'../localdb/db.mjs';
import{taskPath,taskDirectory}from'../collect/task-paths.mjs';
import{DOMESTIC_CONTENT_SOURCES}from'../collect/domestic-content.mjs';
import{publicReferenceUrl}from'../collect/public-reference.mjs';

const code=v=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/.test(v)?v:null;
const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(v)?v:null;
const errorCode=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(v)&&(/_/.test(v)||['EACCES','ENOENT','ENOTDIR','EEXIST','EPERM'].includes(v))?v:null;
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const FILE=/^[a-f0-9-]{36}\.(?:json|tmp)$/;
export function retrievalSensitiveValues(input={}){
 const result=[];
 for(const root of [input,input.intake,input.inputParse].filter(v=>v&&typeof v==='object'))for(const key of ['name','recipient_name','sender_name','phone','email','address','password','token','cookie'])if(typeof root[key]==='string'&&root[key].trim())result.push(root[key]);
 return result;
}
export function createRetrievalAudit({directory=process.env.NODE_TEST_CONTEXT?join(REPO_ROOT,'.tmp/retrieval-audit-tests',String(process.pid)):join(REPO_ROOT,'.tmp/retrieval-audit'),sensitiveValues=[],maxFiles=200,maxAgeMs=7*86400000,onDiagnostic=code=>console.warn('[retrieval-audit]',code)}={}){
 const id=randomUUID(),created=new Date().toISOString();
 const data={version:1,retrieval_session_id:id,run_id:null,started_at:created,status:'in_progress',calls_total:0,calls_omitted:0,calls:[]};
 let receipt={status:'not_written',retrieval_session_id:id};
 const redact=(v,limit=200)=>{
  if(typeof v!=='string')return null;
  let text=v;
  for(const secret of sensitiveValues.filter(s=>typeof s==='string'&&s))text=text.split(secret).join('[已省略]');
  return text.replace(/https?:\/\/\S+/gi,'[链接已省略]').replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi,'[已省略]').replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g,'[已省略]').replace(/\b(?:Bearer\s+\S+|sk-[\w-]{12,}|eyJ[\w.-]{20,})/gi,'[已省略]').replace(/(?:password|passwd|token|cookie|authorization|api[_-]?key|secret)\s*[:=]\s*[^\s，,;；]+/gi,'[已省略]').replace(/[A-Za-z0-9_+/=-]{32,}/g,'[已省略]').replace(/\s+/g,' ').trim().slice(0,limit);
 };
 const publicUrl=value=>{
  try{
   const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
   const content=Object.values(DOMESTIC_CONTENT_SOURCES).some(c=>u.hostname===c.source_site||u.hostname.endsWith('.'+c.source_site));
   if(!content&&!publicReferenceUrl(value,'bing')&&u.hostname!=='www.dianping.com')return null;
   const path=decodeURIComponent(u.pathname);
   if(/\/(?:users?|profile|account|member|login|passport|oauth|authorize)(?:\/|$)/i.test(path)||/@|1[3-9]\d{9}/.test(path)||sensitiveValues.some(s=>s&&path.includes(s)))return null;
   u.search='';u.hash='';return u.href.length<=500?u.href:null;
  }catch{return null;}
 };
 function coverage(c={}){
  return{source:code(c.source??c.platform),status:code(c.status),error_code:errorCode(c.error_code),execution_mode:code(c.execution_mode),native_executed:c.native_executed===true,pages_completed:count(c.pages_completed),detail_pages_completed:count(c.detail_pages_completed),observed_count:count(c.observed_count),image_candidates:count(c.image_candidates),images_validation_attempted:count(c.images_validation_attempted),image_validation_limit:count(c.image_validation_limit),complete:c.complete===true,blocked_stage:code(c.blocked_stage),pages:(c.pages??[]).slice(0,6).map(p=>({page:count(p.page),status:code(p.status),error_code:errorCode(p.error_code)})),detail_status:code(c.detail?.status)};
 }
 function save(){
  let temporary;
  try{
   const dir=taskDirectory(directory),file=taskPath(join(dir,id+'.json'));temporary=taskPath(join(dir,id+'.tmp'));
   data.updated_at=new Date().toISOString();
   let bytes=Buffer.from(JSON.stringify(data));
   if(bytes.length>131072){
    data.metadata_truncated=true;
    for(const call of data.calls){call.returned_items=call.returned_items?.slice(0,2);call.items_omitted=Math.max(0,call.returned_items_total-(call.returned_items?.length??0));call.validated_images=call.validated_images.slice(0,3);call.images_omitted=Math.max(0,call.validated_images_total-call.validated_images.length);call.coverage=call.coverage.slice(0,4).map(c=>({...c,pages:c.pages.slice(0,2)}));call.queries=call.queries.slice(0,2);}
    bytes=Buffer.from(JSON.stringify(data));
   }
   if(bytes.length>131072)throw Object.assign(Error(),{code:'AUDIT_SIZE_LIMIT'});
   writeFileSync(temporary,bytes,{flag:'wx'});renameSync(temporary,file);temporary=null;
   const candidates=readdirSync(dir).filter(n=>FILE.test(n)).map(n=>{const path=taskPath(join(dir,n));return{path,mtime:statSync(path).mtimeMs};}).sort((a,b)=>b.mtime-a.mtime);
   const keep=Math.max(1,Math.min(200,Number(maxFiles)||200)),age=Math.max(1,Math.min(7*86400000,Number(maxAgeMs)||7*86400000));
   const others=candidates.filter(c=>c.path!==file);
   for(let i=0;i<others.length;i++)if(i>=keep-1||Date.now()-others[i].mtime>age)unlinkSync(taskPath(others[i].path));
   receipt={status:'saved',retrieval_session_id:id};
  }catch(error){receipt={status:'failed',retrieval_session_id:id,code:['PATH_OUTSIDE_WORKTREE','AUDIT_SIZE_LIMIT'].includes(error.code)?error.code:'AUDIT_WRITE_FAILED'};try{onDiagnostic(receipt.code);}catch{}}
  finally{if(temporary)try{unlinkSync(taskPath(temporary));}catch{}}
  return receipt;
 }
 function recordTool(entry={},result={}){
  try{
  // No arbitrary arguments, free-text reason, content body, headers or environment values.
  const collections={};for(const k of ['products','references','contents','images'])collections[k]=Array.isArray(result[k])?result[k].length:0;
  const records=[...(result.products??[]),...(result.references??[])];
  const imageErrors={};for(const r of records)if(r.image_validation?.ok===false){const c=code(r.image_validation.error_code)||'IMAGE_VALIDATION_FAILED';imageErrors[c]=(imageErrors[c]??0)+1;}
  const images=records.filter(r=>r.image_validation?.ok===true).map(r=>({reference_id:identifier(r.reference_id),product_id:identifier(r.product_id),image_id:identifier(r.image_id),source_url:publicUrl(r.source_url),mime:['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(r.image_validation.mime)?r.image_validation.mime:null,width:count(r.image_validation.width),height:count(r.image_validation.height),sha256:/^[a-f0-9]{64}$/.test(r.image_validation.sha256??'')?r.image_validation.sha256:null}));
  data.calls_total++;
  data.calls.push({sequence:data.calls_total,tool:['opencli_search','opencli_product_details'].includes(entry.name)?entry.name:'unregistered_tool',status:code(entry.status),error_code:entry.error_code?(errorCode(entry.error_code)||'UNCLASSIFIED_TOOL_ERROR'):null,queries:(entry.plan?.queries??[]).slice(0,4).map(q=>({purpose:code(q.purpose),sources:(q.sources??[]).slice(0,16).map(code).filter(Boolean),keyword:redact(q.keyword),city:redact(q.city,40)})),returned_counts:collections,returned_items_total:records.length,returned_items:records.slice(0,6).map(r=>({reference_id:identifier(r.reference_id),product_id:identifier(r.product_id),title:redact(r.title??r.name,100),source_url:publicUrl(r.source_url??r.product_url),image_id:identifier(r.image_id),image_validated:r.image_validation?.ok===true})),items_omitted:Math.max(0,records.length-6),coverage:(result.coverage??entry.coverage??[]).slice(0,16).map(coverage),validated_images_total:images.length,validated_images:images.slice(0,10),image_error_counts:imageErrors,images_omitted:Math.max(0,images.length-10)});
  if(data.calls.length>12)data.calls.shift();data.calls_omitted=Math.max(0,data.calls_total-data.calls.length);
  return save();
  }catch{receipt={status:'failed',retrieval_session_id:id,code:'AUDIT_SERIALIZATION_FAILED'};try{onDiagnostic(receipt.code);}catch{}return receipt;}
 }
 function finalize({runId=null,status='completed',errorCode:failure=null,bindings=[],rejected=[],candidateIds=[],references=[]}={}){
  try{
  data.run_id=identifier(runId);data.status=data.calls_total===0&&status==='completed'?'no_tool_calls':code(status);data.error_code=errorCode(failure);
  const known=new Set([...candidateIds,...bindings.map(b=>b.candidate_id)]);
  data.adopted_references=bindings.filter(b=>b.reference_id||b.product_id).slice(0,12).map(b=>{const r=references.find(r=>r.reference_id===b.reference_id),v=r?.image_validation;return{candidate_id:identifier(b.candidate_id),reference_id:identifier(b.reference_id),product_id:identifier(b.product_id),image_id:identifier(b.image?.id),image_kind:code(b.image?.kind),source_url:publicUrl(r?.source_url??b.image?.source_url),observed_at:timestamp(r?.observed_at),width:count(v?.width),height:count(v?.height),sha256:/^[a-f0-9]{64}$/.test(v?.sha256??'')?v.sha256:null};});
  data.rejected_references=rejected.slice(0,12).map(r=>({candidate_id:known.has(r.candidate_id)?identifier(r.candidate_id):null,code:errorCode(r.code)}));return save();
  }catch{receipt={status:'failed',retrieval_session_id:id,code:'AUDIT_SERIALIZATION_FAILED'};try{onDiagnostic(receipt.code);}catch{}return receipt;}
 }
 return{recordTool,finalize,get receipt(){return receipt;}};
}
