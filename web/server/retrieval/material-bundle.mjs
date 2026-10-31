/** Import anonymous public text only. No networking, image handling or source-tree writes. */
import{constants,lstatSync,realpathSync,openSync,closeSync,fstatSync,readSync}from'node:fs';
import{resolve,relative,isAbsolute,sep,join}from'node:path';
import{strictParse}from'../jsonstrict.mjs';
import{publicReferenceUrl}from'../collect/public-reference.mjs';
export const MATERIAL_BUNDLE_MAX_BYTES=256*1024;
export const MATERIAL_BUNDLE_MAX_RECORDS=80;
const PROJECT_ROOT=resolve('E:/黑客松');
const ID=/^[A-Za-z0-9_-]{1,96}$/;
const fail=code=>Object.assign(new Error(code),{code});
const inside=(root,path)=>{const r=relative(root,path);return r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
function sourcePath(value,{directory=false}={}){
 if(typeof value!=='string'||!value||value.includes('\0'))throw fail('BUNDLE_PATH_INVALID');
 const path=resolve(value);if(!inside(PROJECT_ROOT,path))throw fail('BUNDLE_PATH_OUTSIDE_PROJECT');
 let cursor=PROJECT_ROOT;
 for(const part of ['',...relative(PROJECT_ROOT,path).split(sep).filter(Boolean)]){
  if(part)cursor=join(cursor,part);
  const stat=lstatSync(cursor);if(stat.isSymbolicLink())throw fail('BUNDLE_LINK_NOT_ALLOWED');
  if(!inside(PROJECT_ROOT,realpathSync.native(cursor)))throw fail('BUNDLE_PATH_OUTSIDE_PROJECT');
 }
 const stat=lstatSync(path);if(directory?!stat.isDirectory():!stat.isFile())throw fail('BUNDLE_PATH_INVALID');return path;
}
function readManifest(directory){
 const path=sourcePath(join(sourcePath(directory,{directory:true}),'manifest.json'));
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const stat=fstatSync(fd);if(!stat.isFile())throw fail('BUNDLE_PATH_INVALID');if(stat.size>MATERIAL_BUNDLE_MAX_BYTES)throw fail('BUNDLE_TOO_LARGE');
  const bytes=Buffer.alloc(MATERIAL_BUNDLE_MAX_BYTES+1);let length=0;
  while(length<bytes.length){const n=readSync(fd,bytes,length,bytes.length-length,null);if(!n)break;length+=n;}
  if(length>MATERIAL_BUNDLE_MAX_BYTES)throw fail('BUNDLE_TOO_LARGE');const text=bytes.subarray(0,length).toString('utf8');
  try{strictParse(text);return JSON.parse(text);}catch{throw fail('BUNDLE_JSON_INVALID');}
 }finally{closeSync(fd);}
}
function sourceUrl(value){
 if(typeof value!=='string'||value.length>2000)return null;
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  if(/\/(?:users?|profile|account|member|login|passport|oauth|authorize)(?:\/|$)/i.test(decodeURIComponent(url.pathname)))return null;
  if([...url.searchParams.keys()].some(k=>/token|cookie|auth|sign|session|password|secret|api.?key|^(?:uid|user_id|openid)$/i.test(k)))return null;
  return publicReferenceUrl(url.href,'bing');
 }catch{return null;}
}
function cleanText(value,max,{required=false}={}){
 if(value==null&&!required)return null;if(typeof value!=='string')throw fail('RECORD_TEXT_INVALID');
 const text=value.replace(/\s+/g,' ').trim();if(!text&&required||text.length>max)throw fail('RECORD_TEXT_INVALID');
 if(/\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_.-]{20,}|(?:password|passwd|token|cookie|authorization|api[_-]?key|secret)\s*[:=]|[\w.+-]+@[\w.-]+\.[a-z]+|(?<!\d)1[3-9]\d{9}(?!\d)|<\/?(?:script|iframe|object|embed)\b/i.test(text))throw fail('RECORD_TEXT_UNSAFE');
 return text||null;
}
const ALLOWED_FIELDS=new Set(['reference_id','reference_kind','title','summary','source_url','source_site','source_platform','source_scope','purpose','observed_at','material_kind','has_summary','is_full_article']);
function safeRecord(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!ID.test(raw.reference_id??'')||raw.reference_kind!=='public_reference')throw fail('RECORD_SCHEMA_INVALID');
 const source=sourceUrl(raw.source_url);if(!source)throw fail('RECORD_SOURCE_NOT_PUBLIC');
 if(typeof raw.observed_at!=='string'||(!Number.isFinite(Date.parse(raw.observed_at))||Date.parse(raw.observed_at)>Date.now()+1000))throw fail('RECORD_OBSERVATION_INVALID');
 if(raw.purpose!=null&&!['reference','inspiration'].includes(raw.purpose))throw fail('RECORD_PURPOSE_INVALID');
 // Source bundles contain excerpts, never full articles or application/user state.
 if(raw.is_full_article===true)throw fail('RECORD_FULL_BODY_NOT_ALLOWED');
 const title=cleanText(raw.title,300,{required:true}),summary=cleanText(raw.summary,2000);
 const kind=raw.material_kind==null?(summary?'search_snippet':'search_result_title'):raw.material_kind;
 if(typeof kind!=='string'||!/^[a-z][a-z0-9_]{0,39}$/.test(kind))throw fail('RECORD_MATERIAL_KIND_INVALID');
 if(raw.source_platform!=null&&!/^[a-z][a-z0-9_-]{0,39}$/.test(raw.source_platform))throw fail('RECORD_SOURCE_INVALID');
 return {reference_id:raw.reference_id,reference_kind:'public_reference',title,summary,source_url:source,source_site:new URL(source).hostname,source_platform:raw.source_platform??null,purpose:raw.purpose??'inspiration',observed_at:raw.observed_at,material_kind:summary?kind:'search_result_title',has_summary:Boolean(summary),is_full_article:false};
}
/** cache is a trusted injected material cache; its own persistence must enforce current-worktree taskPath. */
export async function importMaterialBundle(bundleDirectory,{cache}={}){
 const result={status:'failed',records_imported:0,records:[],rejected:[],cache_status:'not_requested'};
 let manifest;
 try{manifest=readManifest(bundleDirectory);if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.version!==1||Object.keys(manifest).some(k=>!['version','records'].includes(k))||!Array.isArray(manifest.records)||manifest.records.length>MATERIAL_BUNDLE_MAX_RECORDS)throw fail('BUNDLE_SCHEMA_INVALID');}
 catch(cause){result.rejected.push({kind:'bundle',code:/^BUNDLE_[A-Z_]+$/.test(cause?.code??'')?cause.code:'BUNDLE_READ_FAILED'});return result;}
 const accepted=[],counts=new Map();
 for(let index=0;index<manifest.records.length;index++){
  const raw=manifest.records[index];try{const record=safeRecord(raw);accepted.push({index,record});counts.set(record.reference_id,(counts.get(record.reference_id)??0)+1);
   if(Object.keys(raw).some(k=>!ALLOWED_FIELDS.has(k)))result.rejected.push({kind:'omitted_fields',index,reference_id:record.reference_id,code:'RECORD_FIELDS_DROPPED'});
  }catch(cause){result.rejected.push({kind:'record',index,code:/^RECORD_[A-Z_]+$/.test(cause?.code??'')?cause.code:'RECORD_INVALID'});}
 }
 for(const {index,record}of accepted){if(counts.get(record.reference_id)>1)result.rejected.push({kind:'record',index,reference_id:record.reference_id,code:'DUPLICATE_REFERENCE_ID'});else result.records.push(record);}
 if(cache!==undefined&&result.records.length){if(typeof cache?.put!=='function'){result.cache_status='failed';result.rejected.push({kind:'cache',code:'CACHE_PUT_UNAVAILABLE'});}else try{const receipt=await cache.put(structuredClone(result.records));if(receipt?.status==='unavailable'||receipt?.status==='failed'||receipt?.accepted===0)throw Error('CACHE_WRITE_FAILED');result.cache_status='saved';}catch{result.cache_status='failed';result.rejected.push({kind:'cache',code:'CACHE_WRITE_FAILED'});}}
 result.records_imported=result.cache_status==='failed'?0:result.records.length;
 result.status=result.cache_status==='failed'?'partial':result.records.length?(result.rejected.length?'partial':'ready'):'unavailable';return result;
}
