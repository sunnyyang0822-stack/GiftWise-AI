/** Fixed-endpoint, unauthenticated public image discovery. Never downloads images or executes HTML. */
import {performance} from 'node:perf_hooks';
import {normalizePublicReference, publicReferenceUrl, PUBLIC_REFERENCE_SOURCES} from './public-reference.mjs';
import {isAllowedReferenceImageUrl} from './domestic-detail.mjs';

export const PUBLIC_IMAGE_HTTP_ENDPOINT = 'https://cn.bing.com/images/search';
export const PUBLIC_IMAGE_HTTP_MAX_BYTES = 2 * 1024 * 1024;
const bounded = (value, fallback, max) => Number.isInteger(value) && value > 0 ? Math.min(value,max) : fallback;
const error = code => Object.assign(new Error(code),{code});

export function decodeHtmlEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt|nbsp);/gi, (whole,entity) => {
    const key=entity.toLowerCase();
    const named={quot:'"',apos:"'",amp:'&',lt:'<',gt:'>',nbsp:' '};
    if (key[0] !== '#') return named[key];
    const code=key[1] === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return code>0 && code<=0x10ffff && !(code>=0xd800&&code<=0xdfff) ? String.fromCodePoint(code) : '\ufffd';
  });
}
function attributes(tag) {
  const out={};
  for(const match of tag.matchAll(/\s([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const key=match[1].toLowerCase();
    // Duplicate m attributes have ambiguous provenance; never guess which the browser used.
    if(Object.hasOwn(out,key)) {out[key]=null;continue;}
    out[key]=decodeHtmlEntities(match[2]??match[3]??match[4]);
  }
  return out;
}
const plain = text => decodeHtmlEntities(String(text??'').replace(/<[^>]*>/g,' ')).replace(/[\ue000-\ue003]/g,'').replace(/\s+/g,' ').trim();
function challengeStatus(html) {
  const visible=html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  for(const match of visible.matchAll(/<(?:form|div|iframe|section)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const attrs=attributes(match[0]);
    if(/(?:^|[\s_-])(?:b_captcha|captcha-container|challenge-form|cf-challenge|g-recaptcha|h-captcha)(?:$|[\s_-])/i.test(`${attrs.id??''} ${attrs.class??''}`))return 'restricted';
    if(/^<form/i.test(match[0]) && /(?:captcha|challenge|anomaly)/i.test(attrs.action??''))return 'restricted';
    if(/^<iframe/i.test(match[0]) && /(?:recaptcha|hcaptcha|challenge)/i.test(attrs.src??''))return 'restricted';
    if(/^<form/i.test(match[0]) && /(?:login|signin|passport)/i.test(attrs.action??''))return 'login_required';
  }
  const title=plain((visible.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)??[])[1]);
  if(/^(?:access denied|robot check|security check|verify you are human|安全验证|访问受限|访问被拒绝|验证码)$/i.test(title))return 'restricted';
  const text=plain(visible);
  if(/our systems have detected unusual traffic|此请求已被阻止.{0,30}安全验证|检测到异常访问.{0,30}验证/i.test(text))return 'restricted';
  return null;
}
/** Parse m(JSON) attributes as inert data. The result contains unvalidated reference images, never SKUs. */
export function parseBingImageHtml(html,{keyword='',observedAt=null,limit=12}={}) {
  if(typeof html !== 'string')return {status:'invalid_response',records:[],records_seen:0,records_rejected:0,reported_total:null};
  if(Buffer.byteLength(html,'utf8')>PUBLIC_IMAGE_HTTP_MAX_BYTES)return {status:'response_too_large',records:[],records_seen:0,records_rejected:0,reported_total:null};
  const blocked=challengeStatus(html);
  if(blocked)return {status:blocked,records:[],records_seen:0,records_rejected:0,reported_total:null};
  const inert=html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const records=[],seen=new Set();let count=0,rejected=0;
  for(const match of inert.matchAll(/<a\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const attrs=attributes(match[0]);
    if(!/(?:^|\s)iusc(?:\s|$)/i.test(attrs.class??'') || !Object.hasOwn(attrs,'m'))continue;
    count++;
    let metadata;
    try {metadata=JSON.parse(attrs.m);if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw error('INVALID_CARD');}
    catch {rejected++;continue;}
    const source=typeof metadata.purl==='string' ? publicReferenceUrl(metadata.purl,'bing') : null;
    const imageCandidates=[metadata.turl,metadata.murl].filter(v=>typeof v==='string'&&isAllowedReferenceImageUrl(v));
    const image=imageCandidates[0];
    const title=plain(typeof metadata.t==='string'&&metadata.t ? metadata.t : attrs['aria-label']);
    if(!source||!image||!title) {rejected++;continue;}
    const record=normalizePublicReference({title,source_url:source,snippet:typeof metadata.desc==='string'?plain(metadata.desc):null,image_url:image,image_provenance:image===metadata.turl?'search_thumbnail':'search_image'},{source:'bing',keyword,observedAt});
    if(!record?.image_url) {rejected++;continue;}
    const key=`${record.source_url}\n${record.image_url}`;
    if(seen.has(key))continue;
    seen.add(key);
    if(records.length<bounded(limit,12,30))records.push(record);
  }
  return {status:records.length?'ok':count?'no_allowed_reference':'empty_or_selector_changed',records,records_seen:count,records_rejected:rejected,reported_total:null};
}
async function readLimitedHtml(response,maxBytes,signal) {
  const rawLength=response.headers?.get?.('content-length');
  if(rawLength && /^\d+$/.test(rawLength) && Number(rawLength)>maxBytes)throw error('HTTP_RESPONSE_TOO_LARGE');
  if(!response.body?.getReader)throw error('HTTP_BODY_UNREADABLE');
  const reader=response.body.getReader();let bytes=0;
  const chunks=[];const abort=()=>{reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  try {
    while(true) {
      if(signal.aborted)throw error('HTTP_CANCELLED');
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes) {await reader.cancel();throw error('HTTP_RESPONSE_TOO_LARGE');}
      chunks.push(Buffer.from(value));
    }
    return {html:Buffer.concat(chunks).toString('utf8'),bytes};
  }finally {signal.removeEventListener('abort',abort);reader.releaseLock();}
}
/** One bounded GET. Manual redirects are rejected, including same-engine redirects: no identity/session negotiation. */
export async function searchPublicImagesHttp({keyword,page=1,limit=12,timeoutMs=8000,signal,fetchImpl=globalThis.fetch,now=()=>Date.now(),maxResponseBytes=PUBLIC_IMAGE_HTTP_MAX_BYTES}={}) {
  const started=performance.now(),startedAt=new Date(now()).toISOString();
  const coverage={source:'bing',status:'failed',execution_mode:'public_http',native_executed:false,pages_completed:0,pages_requested:1,reported_total:null,observed_count:0,complete:false,bounded:true,pages:[],limitations:['bounded_public_http_search','images_not_yet_validated'],started_at:startedAt};
  const output={status:'failed',records:[],coverage,warnings:[]};
  const controller=new AbortController();let timer,timedOut=false,received;
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const finish=(status,code=null)=>{output.status=coverage.status=status;coverage.error_code=code;coverage.elapsed_ms=Math.round(performance.now()-started);coverage.completed_at=new Date(now()).toISOString();return output;};
  try {
    if(typeof keyword!=='string'||!keyword.trim()||keyword.trim().length>500||!Number.isInteger(page)||page<1||page>3)throw error('HTTP_INVALID_SEARCH');
    if(controller.signal.aborted)throw error('HTTP_CANCELLED');
    const url=new URL(PUBLIC_REFERENCE_SOURCES.bing.searchUrl(keyword,page));
    if(url.origin!==new URL(PUBLIC_IMAGE_HTTP_ENDPOINT).origin||url.pathname!=='/images/search')throw error('HTTP_ENDPOINT_NOT_ALLOWED');
    const cap=bounded(maxResponseBytes,PUBLIC_IMAGE_HTTP_MAX_BYTES,PUBLIC_IMAGE_HTTP_MAX_BYTES);
    const deadline=new Promise((_,reject)=>{
      const aborted=()=>reject(error(timedOut?'HTTP_TIMEOUT':'HTTP_CANCELLED'));
      controller.signal.addEventListener('abort',aborted,{once:true});
      timer=setTimeout(()=>{timedOut=true;controller.abort();},bounded(timeoutMs,8000,15000));
    });
    const parsed=await Promise.race([(async()=>{
      const fetchStarted=performance.now();
      const response=await fetchImpl(url.href,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'zh-CN,zh;q=0.9,en;q=0.7'}});
      received=response;
      coverage.http_status=response.status;coverage.fetch_ms=Math.round(performance.now()-fetchStarted);
      if(response.status>=300&&response.status<400||response.redirected)throw error('HTTP_REDIRECT_BLOCKED');
      if(response.url){const landed=new URL(response.url);if(landed.origin!==url.origin||landed.pathname!==url.pathname||landed.username||landed.password)throw error('HTTP_REDIRECT_BLOCKED');}
      if([401,403,429].includes(response.status))throw error('HTTP_RESTRICTED');
      if(!response.ok)throw error('HTTP_STATUS_FAILURE');
      const type=response.headers?.get?.('content-type')??'';
      if(!/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/i.test(type))throw error('HTTP_CONTENT_TYPE_INVALID');
      const body=await readLimitedHtml(response,cap,controller.signal);coverage.response_bytes=body.bytes;
      const parseStarted=performance.now();
      const result=parseBingImageHtml(body.html,{keyword,observedAt:new Date(now()).toISOString(),limit});
      coverage.parse_ms=Math.round(performance.now()-parseStarted);return result;
    })(),deadline]);
    if(['restricted','login_required'].includes(parsed.status)){coverage.pages.push({page,status:parsed.status,error_code:'HTTP_ACCESS_RESTRICTED'});coverage.blocked_stage='response_challenge';return finish(parsed.status,'HTTP_ACCESS_RESTRICTED');}
    coverage.pages_completed=1;coverage.records_seen=parsed.records_seen;coverage.records_rejected=parsed.records_rejected;coverage.observed_count=parsed.records.length;coverage.limit_reached=parsed.records.length>=bounded(limit,12,30);coverage.pages.push({page,status:parsed.status,observed_count:parsed.records.length});
    output.records=parsed.records;return finish(parsed.status);
  }catch(cause){
    const code=timedOut?'HTTP_TIMEOUT':signal?.aborted?'HTTP_CANCELLED':/^HTTP_[A-Z_]+$/.test(cause?.code??'')?cause.code:'HTTP_REQUEST_FAILED';
    coverage.blocked_stage=code==='HTTP_REDIRECT_BLOCKED'?'redirect':code==='HTTP_RESTRICTED'?'http_access':'http_request';coverage.pages.push({page,status:'failed',error_code:code});
    return finish(code==='HTTP_RESTRICTED'?'restricted':code==='HTTP_CANCELLED'?'cancelled':'failed',code);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);try{if(received?.body&&!received.bodyUsed)received.body.cancel().catch(()=>{});}catch{/* cancellation is cleanup, never a second request */}}
}
/** Aggregate a bounded page budget; no automatic fallback, browser, login or retries. */
export async function runPublicImageHttpSearch({source='bing',keyword,maxPages=1,limit=12,timeoutMs=8000,signal,fetchImpl,now,maxResponseBytes}={}) {
  if(source!=='bing')return {status:'failed',records:[],coverage:{source,status:'failed',error_code:'HTTP_SOURCE_UNSUPPORTED',execution_mode:'public_http',native_executed:false,pages_completed:0,observed_count:0,complete:false},warnings:[]};
  const started=performance.now(),budget=bounded(timeoutMs,8000,15000),pageLimit=bounded(maxPages,1,3),recordLimit=bounded(limit,12,30);
  const records=[],seen=new Set(),pages=[];let last,firstStartedAt,completed=0,seenCount=0,rejected=0,fetchMs=0,parseMs=0,responseBytes=0;
  for(let page=1;page<=pageLimit&&records.length<recordLimit;page++){
    const remaining=Math.floor(budget-(performance.now()-started));if(remaining<1)break;
    last=await searchPublicImagesHttp({keyword,page,limit:recordLimit-records.length,timeoutMs:remaining,signal,fetchImpl,now,maxResponseBytes});
    firstStartedAt??=last.coverage.started_at;fetchMs+=last.coverage.fetch_ms??0;parseMs+=last.coverage.parse_ms??0;responseBytes+=last.coverage.response_bytes??0;
    completed+=last.coverage.pages_completed;seenCount+=last.coverage.records_seen??0;rejected+=last.coverage.records_rejected??0;
    pages.push(...last.coverage.pages);
    for(const record of last.records){const key=record.source_url+'\n'+record.image_url;if(!seen.has(key)){seen.add(key);records.push(record);}}
    if(last.status!=='ok')break;
  }
  const status=records.length?last?.status==='ok'?'ok':'partial':last?.status??'failed';
  return {status,records,coverage:{...(last?.coverage??{source:'bing',error_code:'HTTP_TIMEOUT',execution_mode:'public_http',native_executed:false,complete:false}),status,started_at:firstStartedAt,fetch_ms:fetchMs,parse_ms:parseMs,response_bytes:responseBytes,pages_requested:pageLimit,pages_completed:completed,observed_count:records.length,records_seen:seenCount,records_rejected:rejected,pages,limit_reached:records.length>=recordLimit,bounded:true,elapsed_ms:Math.round(performance.now()-started)},warnings:[]};
}
