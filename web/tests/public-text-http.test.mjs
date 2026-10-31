import test from 'node:test';
import assert from 'node:assert/strict';
import{createHash}from'node:crypto';
import{parseBingTextHtml,runPublicTextHttpSearch,PUBLIC_TEXT_HTTP_ENDPOINT}from'../server/collect/public-text-http.mjs';
const observed='2026-10-31T23:30:00.000Z';
const options={keyword:'礼物做法 & coffee workshop',now:()=>Date.parse(observed)};
const encode=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
const card=({url='https://www.zhihu.com/question/123',title='公开咖啡角做法',summary='可把已有杯具、托盘和手写说明组合成日常使用的小角落。',before=''}={})=>'<li class="b_algo"><h2><a href="'+encode(url)+'">'+title+'</a></h2>'+before+(summary===null?'':'<div class="b_caption"><p>'+summary+'</p></div>')+'</li>';
const response=(html,status=200,headers={})=>new Response(html,{status,headers:{'content-type':'text/html; charset=utf-8',...headers}});

test('real HTML result fields become observed search snippets without price, image or SKU requirements',()=>{
 const result=parseBingTextHtml(card({title:'公开<em>咖啡角</em> &amp; 做法'}),{keyword:options.keyword,observedAt:observed});
 assert.equal(result.status,'ok');const r=result.records[0];assert.equal(r.title,'公开咖啡角 & 做法');assert.ok(r.summary.includes('已有杯具'));assert.equal(r.material_kind,'search_snippet');assert.equal(r.has_summary,true);assert.equal(r.is_full_article,false);assert.equal(r.purpose,'inspiration');assert.equal(r.source_platform,'web');assert.equal(r.reference_kind,'public_reference');assert.equal(r.observed_at,observed);assert.equal(r.image_url,null);assert.equal(r.image_kind,'reference_image');assert.ok(!('product_id' in r));assert.ok(!('price_amount' in r));assert.equal(r.reference_id,'web_'+createHash('sha256').update(r.source_url).digest('hex').slice(0,32));
});
test('title-only real results are retained but never labelled substantive snippets/full articles',()=>{
 const r=parseBingTextHtml(card({summary:null})).records[0];assert.equal(r.summary,null);assert.equal(r.material_kind,'search_result_title');assert.equal(r.has_summary,false);assert.equal(r.is_full_article,false);
});
test('nested li elements cannot truncate captions; ads, JS templates and wrong result classes are ignored',()=>{
 const nested=card({before:'<ul><li>related link</li></ul>',summary:'完整摘要仍位于嵌套列表后。'});
 const decoys='<li class="b_ad"><h2><a href="https://www.zhihu.com/question/ad">Advertisement</a></h2></li><li class="b_algo_fake"><h2><a href="https://www.zhihu.com/question/fake">Wrong class</a></h2></li><script>globalThis.searchScriptExecuted=true;document.write(\''+card()+'\')</script>';
 const result=parseBingTextHtml(decoys+nested);assert.equal(result.records.length,1);assert.equal(result.records[0].summary,'完整摘要仍位于嵌套列表后。');assert.equal(globalThis.searchScriptExecuted,undefined);
});
test('commerce, private, unknown and authentication URLs are filtered without fetching source pages',()=>{
 const urls=['https://item.jd.com/1.html','https://item.taobao.com/item.htm?id=1','https://amazon.com/product/1','https://127.0.0.1/a','https://[::1]/a','https://user:password@www.zhihu.com/question/1','https://www.zhihu.com/login','https://www.zhihu.com/account/settings','https://unknown.example.test/a'];
 const result=parseBingTextHtml(urls.map(url=>card({url})).join(''));assert.equal(result.records.length,0);assert.equal(result.records_rejected,urls.length);assert.equal(result.status,'no_allowed_reference');
});
test('public Bing ck targets are decoded and canonical source URLs retain no authentication parameters',()=>{
 const target='https://www.zhihu.com/question/123?utm_source=bing&token=private&x=public';
 const wrapped='https://www.bing.com/ck/a?u=a1'+Buffer.from(target).toString('base64url');
 const r=parseBingTextHtml(card({url:wrapped})).records[0];assert.equal(r.source_url,'https://www.zhihu.com/question/123?x=public');assert.ok(!JSON.stringify(r).includes('private'));
 const commerce='https://www.bing.com/ck/a?u=a1'+Buffer.from('https://item.jd.com/1.html').toString('base64url');assert.equal(parseBingTextHtml(card({url:commerce})).records.length,0);
});
test('duplicate/canonical URLs share stable IDs and discovery remains bounded',()=>{
 const cards=Array.from({length:30},(_,i)=>card({url:'https://www.zhihu.com/question/'+i}));
 const result=parseBingTextHtml(cards.join('')+cards[0],{limit:3});assert.equal(result.records.length,3);assert.equal(result.records_seen,31);assert.equal(result.reported_total,null);
 const a=parseBingTextHtml(card({url:'https://www.zhihu.com/question/123?utm_source=a'})).records[0];const b=parseBingTextHtml(card({url:'https://www.zhihu.com/question/123?utm_source=b'})).records[0];assert.equal(a.reference_id,b.reference_id);
});
test('actual challenge/login structures stop discovery while ordinary captcha scripts are inert',()=>{
 assert.equal(parseBingTextHtml('<div id="b_captcha">verify</div>'+card()).status,'restricted');assert.equal(parseBingTextHtml('<form action="/signin"></form>').status,'login_required');assert.equal(parseBingTextHtml('<title>Access Denied</title>').status,'restricted');assert.equal(parseBingTextHtml('<script>const b_captcha="unused";</script>'+card()).status,'ok');
});
test('one fixed no-auth request supplies search material and never requests the source article',async()=>{
 let calls=0;
 const result=await runPublicTextHttpSearch({...options,fetchImpl:async(url,init)=>{calls++;const u=new URL(url);assert.equal(u.origin+u.pathname,PUBLIC_TEXT_HTTP_ENDPOINT);assert.equal(u.searchParams.get('q'),options.keyword);assert.equal(u.searchParams.get('mkt'),'zh-CN');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.ok(!Object.keys(init.headers).some(k=>/cookie|authorization/i.test(k)));return response(card());}});
 assert.equal(calls,1);assert.equal(result.status,'ok');assert.equal(result.coverage.source,'web');assert.equal(result.coverage.execution_mode,'public_http');assert.equal(result.coverage.native_executed,false);assert.equal(result.coverage.pages_completed,1);assert.equal(result.coverage.observed_count,1);assert.equal(result.coverage.materials_with_summary,1);assert.equal(result.records[0].observed_at,observed);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.reported_total,null);
});
test('unknown and private redirects are rejected rather than followed or silently retried',async()=>{
 for(const location of ['https://127.0.0.1/private','https://evil.example.test/','https://cn.bing.com/search']){let calls=0;const r=await runPublicTextHttpSearch({...options,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}});assert.equal(calls,1);assert.equal(r.coverage.error_code,'TEXT_REDIRECT_BLOCKED');}
 const landed=response(card());Object.defineProperty(landed,'url',{value:'https://127.0.0.1/search'});assert.equal((await runPublicTextHttpSearch({...options,fetchImpl:async()=>landed})).coverage.error_code,'TEXT_REDIRECT_BLOCKED');
});
test('declared and streaming sizes and content types are checked before parsing',async()=>{
 const declared=await runPublicTextHttpSearch({...options,maxResponseBytes:128,fetchImpl:async()=>response('x',200,{'content-length':'9999999'})});assert.equal(declared.coverage.error_code,'TEXT_RESPONSE_TOO_LARGE');
 const streamed=await runPublicTextHttpSearch({...options,maxResponseBytes:128,fetchImpl:async()=>response('x'.repeat(1024),200,{'content-length':'1'})});assert.equal(streamed.coverage.error_code,'TEXT_RESPONSE_TOO_LARGE');
 const type=await runPublicTextHttpSearch({...options,fetchImpl:async()=>response('{}',200,{'content-type':'application/json'})});assert.equal(type.coverage.error_code,'TEXT_CONTENT_TYPE_INVALID');
});
test('access restrictions, empty results and title-only results report actual material availability',async()=>{
 const denied=await runPublicTextHttpSearch({...options,fetchImpl:async()=>response('password=do-not-emit',403)});assert.equal(denied.status,'restricted');assert.equal(denied.coverage.error_code,'TEXT_ACCESS_RESTRICTED');assert.ok(!JSON.stringify(denied).includes('do-not-emit'));
 const empty=await runPublicTextHttpSearch({...options,fetchImpl:async()=>response('<html>No results</html>')});assert.equal(empty.coverage.observed_count,0);assert.equal(empty.status,'empty_or_selector_changed');assert.equal(empty.coverage.complete,false);
 const titleOnly=await runPublicTextHttpSearch({...options,fetchImpl:async()=>response(card({summary:null}))});assert.equal(titleOnly.records.length,1);assert.equal(titleOnly.coverage.materials_with_summary,0);
});
test('timeout, stalled body and caller cancellation are bounded without alternative requests',async()=>{
 let calls=0;const timeout=await runPublicTextHttpSearch({...options,timeoutMs:10,fetchImpl:async()=>{calls++;return new Promise(()=>{});}});assert.equal(timeout.coverage.error_code,'TEXT_TIMEOUT');assert.equal(calls,1);
 const stream=new ReadableStream({cancel(){}});const body=await runPublicTextHttpSearch({...options,timeoutMs:10,fetchImpl:async()=>new Response(stream,{headers:{'content-type':'text/html'}})});assert.equal(body.coverage.error_code,'TEXT_TIMEOUT');
 const c=new AbortController();c.abort();const cancelled=await runPublicTextHttpSearch({...options,signal:c.signal,fetchImpl:async()=>{calls++;}});assert.equal(cancelled.status,'cancelled');assert.equal(calls,1);
});
