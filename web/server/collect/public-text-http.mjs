/** Fixed public search snippets: no arbitrary article GET, browser, authentication or image requirement. */
import{createHash}from'node:crypto';
import{performance}from'node:perf_hooks';
import{publicReferenceUrl}from'./public-reference.mjs';
import{decodeHtmlEntities,PUBLIC_IMAGE_HTTP_MAX_BYTES}from'./public-image-http.mjs';
export const PUBLIC_TEXT_HTTP_ENDPOINT='https://cn.bing.com/search';
export const PUBLIC_TEXT_HTTP_MAX_BYTES=PUBLIC_IMAGE_HTTP_MAX_BYTES;
const fail=code=>Object.assign(new Error(code),{code});
const safeLimit=value=>Number.isInteger(value)&&value>0?Math.min(value,20):8;
function attributes(tag){const attrs={};for(const m of tag.matchAll(/\s([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)){const key=m[1].toLowerCase();attrs[key]=Object.hasOwn(attrs,key)?null:decodeHtmlEntities(m[2]??m[3]??m[4]);}return attrs;}
const hasClass=(attrs,name)=>typeof attrs.class==='string'&&attrs.class.split(/\s+/).includes(name);
const inert=html=>html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
const plain=(html,max)=>decodeHtmlEntities(inert(html).replace(/<\/?(?:p|div|br|li|h\d|ul|ol|section)\b[^>]*>/gi,' ').replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim().slice(0,max);
function tagPattern(name){return new RegExp('<\\/?'+name+'\\b(?:"[^"]*"|\x27[^\x27]*\x27|[^\x27">])*>','gi');}
/** Keep only outer matching elements, so adversarial nested markup cannot produce quadratic copies. */
function* elements(html,name,predicate=()=>true){let depth=0,start=0,attrs;
 for(const m of html.matchAll(tagPattern(name))){if(m[0].startsWith('</')){if(depth&&--depth===0)yield{attrs,html:html.slice(start,m.index)};}
 else if(depth)depth++;else{const candidate=attributes(m[0]);if(predicate(candidate)){attrs=candidate;start=m.index+m[0].length;depth=1;}}}
}
const firstElement=(html,name,predicate)=>elements(html,name,predicate).next().value??null;
function blockedStatus(html){
 for(const m of html.matchAll(/<(?:form|div|iframe|section)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)){
  const a=attributes(m[0]);if(/(?:^|[\s_-])(?:b_captcha|captcha-container|challenge-form|cf-challenge|g-recaptcha|h-captcha)(?:$|[\s_-])/i.test(`${a.id??''} ${a.class??''}`))return'restricted';
  if(/^<form/i.test(m[0])&&/captcha|challenge|anomaly/i.test(a.action??''))return'restricted';
  if(/^<iframe/i.test(m[0])&&/recaptcha|hcaptcha|challenge/i.test(a.src??''))return'restricted';
  if(/^<form/i.test(m[0])&&/login|signin|passport/i.test(a.action??''))return'login_required';
 }
 const title=plain((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)??[])[1]??'',200);
 return/^(?:access denied|robot check|security check|verify you are human|安全验证|访问受限|访问被拒绝|验证码)$/i.test(title)?'restricted':null;
}
function sourceUrl(href){
 if(typeof href!=='string')return null;const allowed=publicReferenceUrl(href,'bing');if(!allowed)return null;
 try{const u=new URL(allowed);if(u.protocol!=='https:'||u.username||u.password||u.port||/\/(?:users?|profile|account|member|login|passport|oauth|authorize)(?:\/|$)/i.test(decodeURIComponent(u.pathname)))return null;return u.href;}catch{return null;}
}
/** Only actual li.b_algo -> h2/a and b_caption/p content, never JS templates or article bodies. */
export function parseBingTextHtml(html,{keyword='',observedAt=null,limit=8}={}){
 const result={status:'invalid_response',records:[],records_seen:0,records_rejected:0,reported_total:null};
 if(typeof html!=='string')return result;if(Buffer.byteLength(html,'utf8')>PUBLIC_TEXT_HTTP_MAX_BYTES)return{...result,status:'response_too_large'};
 const doc=inert(html),blocked=blockedStatus(doc);if(blocked)return{...result,status:blocked};
 const seen=new Set();
 for(const card of elements(doc,'li',a=>hasClass(a,'b_algo'))){
  if(result.records_seen>=200){result.scan_limit_reached=true;break;}result.records_seen++;
  const heading=firstElement(card.html,'h2'),link=heading&&firstElement(heading.html,'a');
  const source=sourceUrl(link?.attrs.href),title=link&&plain(link.html,300);
  if(!source||!title){result.records_rejected++;continue;}if(seen.has(source))continue;seen.add(source);
  const caption=firstElement(card.html,'div',a=>hasClass(a,'b_caption'));
  const paragraph=caption&&firstElement(caption.html,'p'),summary=paragraph?plain(paragraph.html,800)||null:null;
  if(result.records.length>=safeLimit(limit))continue;
  result.records.push({reference_id:'web_'+createHash('sha256').update(source).digest('hex').slice(0,32),reference_kind:'public_reference',purpose:'inspiration',source_platform:'web',source_site:new URL(source).hostname,source_url:source,title,summary,has_summary:Boolean(summary),material_kind:summary?'search_snippet':'search_result_title',is_full_article:false,observed_at:typeof observedAt==='string'&&Number.isFinite(Date.parse(observedAt))?observedAt:null,image_kind:'reference_image',image_url:null,image_id:null,image_validation:null,query_params:{keyword},limitations:['公开搜索结果摘要或标题，未抓取文章全文','网页资料用于灵感，不代表商品SKU、实时价格或库存']});
 }
 result.status=result.records.length?'ok':result.records_seen?'no_allowed_reference':'empty_or_selector_changed';return result;
}
async function readLimited(response,cap,signal){
 const raw=response.headers?.get?.('content-length');if(raw&&/^\d+$/.test(raw)&&Number(raw)>cap)throw fail('TEXT_RESPONSE_TOO_LARGE');if(!response.body?.getReader)throw fail('TEXT_BODY_UNREADABLE');
 const reader=response.body.getReader(),chunks=[];let bytes=0;const cancel=()=>reader.cancel().catch(()=>{});signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
 try{while(true){if(signal.aborted)throw fail('TEXT_CANCELLED');const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>cap){reader.cancel().catch(()=>{});throw fail('TEXT_RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(next.value));}return{html:Buffer.concat(chunks).toString('utf8'),bytes};}finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
/** Exactly one no-auth fixed-engine request. There is no source-page fetch or automatic fallback. */
export async function runPublicTextHttpSearch({keyword,timeoutMs=8000,signal,fetchImpl=globalThis.fetch,now=()=>Date.now(),limit=8,maxResponseBytes=PUBLIC_TEXT_HTTP_MAX_BYTES}={}){
 const started=performance.now(),coverage={source:'web',engine:'bing',status:'failed',execution_mode:'public_http',native_executed:false,pages_requested:1,pages_completed:0,reported_total:null,observed_count:0,complete:false,bounded:true,pages:[],started_at:new Date(now()).toISOString(),limitations:['bounded_search_snippets_only','article_bodies_not_fetched']};
 const output={status:'failed',records:[],coverage,warnings:[]};const controller=new AbortController();let timer,timedOut=false,received;
 const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const finish=(status,code=null)=>{output.status=coverage.status=status;coverage.error_code=code;coverage.completed_at=new Date(now()).toISOString();coverage.elapsed_ms=Math.round(performance.now()-started);return output;};
 try{
  if(typeof keyword!=='string'||!keyword.trim()||keyword.trim().length>500)throw fail('TEXT_INVALID_QUERY');if(controller.signal.aborted)throw fail('TEXT_CANCELLED');
  const url=new URL(PUBLIC_TEXT_HTTP_ENDPOINT);url.searchParams.set('q',keyword.trim());url.searchParams.set('mkt','zh-CN');url.searchParams.set('setlang','zh-hans');
  const cap=Number.isInteger(maxResponseBytes)&&maxResponseBytes>0?Math.min(maxResponseBytes,PUBLIC_TEXT_HTTP_MAX_BYTES):PUBLIC_TEXT_HTTP_MAX_BYTES;
  const timeout=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(Math.floor(timeoutMs),15000):8000;
  const deadline=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(fail(timedOut?'TEXT_TIMEOUT':'TEXT_CANCELLED')),{once:true});timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);});
  const parsed=await Promise.race([(async()=>{
   const fetchStarted=performance.now();received=await fetchImpl(url.href,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'zh-CN,zh;q=0.9,en;q=0.7'}});coverage.http_status=received.status;coverage.fetch_ms=Math.round(performance.now()-fetchStarted);
   if(received.status>=300&&received.status<400||received.redirected)throw fail('TEXT_REDIRECT_BLOCKED');
   if(received.url){const landed=new URL(received.url);if(landed.origin!==url.origin||landed.pathname!==url.pathname||landed.username||landed.password)throw fail('TEXT_REDIRECT_BLOCKED');}
   if([401,403,429].includes(received.status))throw fail('TEXT_ACCESS_RESTRICTED');if(!received.ok)throw fail('TEXT_HTTP_FAILURE');
   if(!/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/i.test(received.headers?.get?.('content-type')??''))throw fail('TEXT_CONTENT_TYPE_INVALID');
   const body=await readLimited(received,cap,controller.signal);coverage.response_bytes=body.bytes;const parseStarted=performance.now();const value=parseBingTextHtml(body.html,{keyword:keyword.trim(),observedAt:new Date(now()).toISOString(),limit});coverage.parse_ms=Math.round(performance.now()-parseStarted);return value;
  })(),deadline]);
  if(['restricted','login_required'].includes(parsed.status)){coverage.pages.push({page:1,status:parsed.status,error_code:'TEXT_ACCESS_RESTRICTED'});return finish(parsed.status,'TEXT_ACCESS_RESTRICTED');}
  if(parsed.status==='invalid_response'||parsed.status==='response_too_large')return finish('failed','TEXT_RESPONSE_INVALID');
  output.records=parsed.records;coverage.pages_completed=1;coverage.observed_count=parsed.records.length;coverage.records_seen=parsed.records_seen;coverage.records_rejected=parsed.records_rejected;coverage.materials_with_summary=parsed.records.filter(r=>r.has_summary).length;coverage.limit_reached=parsed.records.length>=safeLimit(limit);coverage.scan_limit_reached=parsed.scan_limit_reached===true;coverage.pages.push({page:1,status:parsed.status,observed_count:parsed.records.length});return finish(parsed.status);
 }catch(cause){const code=timedOut?'TEXT_TIMEOUT':signal?.aborted?'TEXT_CANCELLED':/^TEXT_[A-Z_]+$/.test(cause?.code??'')?cause.code:'TEXT_REQUEST_FAILED';coverage.pages.push({page:1,status:'failed',error_code:code});return finish(code==='TEXT_ACCESS_RESTRICTED'?'restricted':code==='TEXT_CANCELLED'?'cancelled':'failed',code);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);try{if(received?.body&&!received.bodyUsed)received.body.cancel().catch(()=>{});}catch{}}
}
