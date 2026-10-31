import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeHtmlEntities,parseBingImageHtml,searchPublicImagesHttp,runPublicImageHttpSearch,PUBLIC_IMAGE_HTTP_ENDPOINT} from '../server/collect/public-image-http.mjs';
const observed='2026-10-31T22:00:00.000Z';
const metadata=(patch={})=>({purl:'https://zhuanlan.zhihu.com/p/123456',murl:'https://images.unsplash.com/photo-123',turl:'https://ts4.mm.bing.net/th?id=OIP.reference&pid=15.1',t:'咖啡角 & 木托盘',desc:'公开资料，不代表在售商品',...patch});
const encode=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const card=(value=metadata())=>'<a class="iusc other" m="'+encode(JSON.stringify(value))+'"></a>';
const htmlResponse=(html,status=200,headers={})=>new Response(html,{status,headers:{'content-type':'text/html; charset=utf-8',...headers}});
const options={keyword:'咖啡角 & 木托盘',now:()=>Date.parse(observed)};

test('parser decodes JSON m attributes and preserves reference-only provenance',()=>{
 const result=parseBingImageHtml(card(),{keyword:options.keyword,observedAt:observed});
 assert.equal(result.status,'ok');assert.equal(result.records.length,1);
 const r=result.records[0];assert.equal(r.title,'咖啡角 & 木托盘');assert.equal(r.image_url,metadata().turl);assert.equal(r.image_provenance.kind,'search_thumbnail');assert.equal(r.observed_at,observed);assert.equal(r.reference_kind,'public_reference');assert.equal(r.image_kind,'reference_image');assert.equal(r.image_validation,null);assert.equal(r.product_url,null);assert.equal(r.sku_id,null);assert.equal(r.is_live_quote,false);assert.ok(!('product_id' in r));
 assert.equal(decodeHtmlEntities('&#x4e2d;&#25991; &quot;&apos;&amp;'),'中文 "\'&');
});
test('quoted greater-than and numeric entities parse without evaluating script',()=>{
 const raw=encode(JSON.stringify(metadata({t:'木盒 > 折纸 "创意"'}))).replaceAll('&quot;','&#34;');
 const result=parseBingImageHtml('<script>globalThis.remoteCodeExecuted=true; captcha = "test";</script><a m="'+raw+'" class=iusc></a>');
 assert.equal(result.records[0].title,'木盒 > 折纸 "创意"');assert.equal(globalThis.remoteCodeExecuted,undefined);
});
test('only permitted public source pages survive; commerce and redirects to commerce never become references',()=>{
 const rows=['https://item.jd.com/1.html','https://amazon.com/product/1','https://www.zhihu.com/redirect?target=https%3A%2F%2Fitem.taobao.com%2Fitem.htm%3Fid%3D1','https://unknown.example.test/story','https://www.zhihu.com/login'].map(purl=>card(metadata({purl})));
 const result=parseBingImageHtml(rows.join(''));
 assert.equal(result.records.length,0);assert.equal(result.records_rejected,5);assert.equal(result.status,'no_allowed_reference');
});
test('image URLs reuse reference GET allowlist, reject private/identity URLs and permit a safe fallback',()=>{
 for(const image of ['http://127.0.0.1/a.jpg','https://127.1/a.jpg','https://[::1]/a.jpg','https://localhost/a.jpg','https://user:password@ts4.mm.bing.net/th','https://ts4.mm.bing.net:444/th','javascript:alert(1)','https://img.alicdn.com/commerce.jpg']) {
  assert.equal(parseBingImageHtml(card(metadata({turl:image,murl:image}))).records.length,0);
 }
 const fallback=parseBingImageHtml(card(metadata({turl:'https://unknown.example.test/a.jpg'}))).records[0];
 assert.equal(fallback.image_url,'https://images.unsplash.com/photo-123');assert.equal(fallback.image_provenance.kind,'search_image');
});
test('malformed or ambiguous metadata is rejected and duplicates/results are bounded',()=>{
 const duplicate='<a class="iusc" m="{}" m="'+encode(JSON.stringify(metadata()))+'"></a>';
 const cards=Array.from({length:40},(_,i)=>card(metadata({purl:'https://www.zhihu.com/question/'+i,turl:'https://ts4.mm.bing.net/th?id='+i})));
 const result=parseBingImageHtml('<a class="iusc" m="not-json"></a>'+duplicate+cards.join('')+cards[0],{limit:2});
 assert.equal(result.records.length,2);assert.equal(result.records_seen,43);assert.equal(result.records_rejected,2);assert.equal(result.reported_total,null);
});
test('genuine challenge structures stop parsing but ordinary captcha script references do not',()=>{
 for(const blocker of ['<div id="b_captcha">Verify</div>','<form action="/challenge/verify"></form>','<iframe src="https://www.recaptcha.net/recaptcha"></iframe>','<title>Access Denied</title>'])assert.equal(parseBingImageHtml(blocker+card()).status,'restricted');
 const ordinary='<script>const captchaName="captcha"; const b_captcha="unused resource";</script><style>.captcha-name{}</style>';
 assert.equal(parseBingImageHtml(ordinary+card()).status,'ok');
 assert.equal(parseBingImageHtml('<form action="/signin"></form>').status,'login_required');
});
test('fixed unauthenticated HTTP request preserves actual observation and bounded coverage',async()=>{
 let calls=0;
 const result=await searchPublicImagesHttp({...options,fetchImpl:async(url,init)=>{
  calls++;const parsed=new URL(url);assert.equal(parsed.origin+parsed.pathname,PUBLIC_IMAGE_HTTP_ENDPOINT);assert.equal(parsed.searchParams.get('q'),options.keyword);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.method,'GET');assert.ok(!('Authorization' in init.headers));assert.ok(!('Cookie' in init.headers));return htmlResponse(card());
 }});
 assert.equal(calls,1);assert.equal(result.records[0].observed_at,observed);assert.equal(result.coverage.execution_mode,'public_http');assert.equal(result.coverage.native_executed,false);assert.equal(result.coverage.pages_completed,1);assert.equal(result.coverage.observed_count,1);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.reported_total,null);assert.ok(result.coverage.response_bytes>0);
});
test('all redirects including private destinations are rejected without a second request',async()=>{
 for(const location of ['https://127.0.0.1/private','https://unknown.example.test/','https://cn.bing.com/images/search']) {
  let calls=0;const result=await searchPublicImagesHttp({...options,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}});
  assert.equal(calls,1);assert.equal(result.coverage.error_code,'HTTP_REDIRECT_BLOCKED');assert.equal(result.records.length,0);
 }
 const landed=htmlResponse(card());Object.defineProperty(landed,'url',{value:'https://127.0.0.1/images/search'});
 const result=await searchPublicImagesHttp({...options,fetchImpl:async()=>landed});assert.equal(result.coverage.error_code,'HTTP_REDIRECT_BLOCKED');
});
test('headers and streaming limits both bound untrusted response bytes',async()=>{
 const declared=await searchPublicImagesHttp({...options,maxResponseBytes:128,fetchImpl:async()=>htmlResponse('x',200,{'content-length':'1000000'})});assert.equal(declared.coverage.error_code,'HTTP_RESPONSE_TOO_LARGE');
 const streaming=await searchPublicImagesHttp({...options,maxResponseBytes:128,fetchImpl:async()=>htmlResponse('x'.repeat(1000),200,{'content-length':'1'})});assert.equal(streaming.coverage.error_code,'HTTP_RESPONSE_TOO_LARGE');assert.equal(streaming.records.length,0);
 const wrongType=await searchPublicImagesHttp({...options,fetchImpl:async()=>new Response('{}',{headers:{'content-type':'application/json'}})});assert.equal(wrongType.coverage.error_code,'HTTP_CONTENT_TYPE_INVALID');
});
test('HTTP access denial never reads the error body or emits error body/credentials',async()=>{
 let bodyReads=0;
 const result=await searchPublicImagesHttp({...options,fetchImpl:async()=>({ok:false,status:403,headers:new Headers(),body:{getReader(){bodyReads++;throw Error('token=private');},cancel:async()=>{}}})});
 assert.equal(bodyReads,0);assert.equal(result.status,'restricted');assert.equal(result.coverage.error_code,'HTTP_RESTRICTED');assert.ok(!JSON.stringify(result).includes('private'));
});
test('timeouts bound ignored fetch signals and stalled response bodies with no retry',async()=>{
 let calls=0;const timeout=await searchPublicImagesHttp({...options,timeoutMs:10,fetchImpl:async()=>{calls++;return new Promise(()=>{});}});assert.equal(timeout.coverage.error_code,'HTTP_TIMEOUT');assert.equal(calls,1);
 let cancelled=0;
 const body=new ReadableStream({cancel(){cancelled++;}});
 const stalled=await searchPublicImagesHttp({...options,timeoutMs:10,fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/html'}})});assert.equal(stalled.coverage.error_code,'HTTP_TIMEOUT');assert.equal(cancelled,1);
});
test('caller cancellation and unsupported sources make no hidden browser or network attempts',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const result=await searchPublicImagesHttp({...options,signal:controller.signal,fetchImpl:async()=>{calls++;}});assert.equal(result.status,'cancelled');assert.equal(calls,0);
 const unsupported=await runPublicImageHttpSearch({...options,source:'duckduckgo',fetchImpl:async()=>{calls++;}});assert.equal(unsupported.coverage.error_code,'HTTP_SOURCE_UNSUPPORTED');assert.equal(calls,0);
});
test('wrapper aggregates a finite page budget and stops on access restriction without dropping earlier observations',async()=>{
 let calls=0;
 const result=await runPublicImageHttpSearch({...options,maxPages:3,fetchImpl:async()=>{calls++;return calls===1?htmlResponse(card()):htmlResponse('restricted',429);}});
 assert.equal(calls,2);assert.equal(result.status,'partial');assert.equal(result.records.length,1);assert.equal(result.coverage.pages_completed,1);assert.equal(result.coverage.pages.length,2);assert.equal(result.coverage.complete,false);
});
test('wrapper clamps pages and records and never labels bounded search as full-platform coverage',async()=>{
 let calls=0;
 const result=await runPublicImageHttpSearch({...options,maxPages:100,limit:30,fetchImpl:async()=>{calls++;return htmlResponse(card(metadata({purl:'https://www.zhihu.com/question/'+calls})));}});
 assert.equal(calls,3);assert.equal(result.coverage.pages_requested,3);assert.equal(result.coverage.pages_completed,3);assert.equal(result.records.length,3);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.reported_total,null);
});

// Captured once by the root probe; inert m attribute only, no request or full HTML needed.
const CAPTURED_BING_M = "{&quot;sid&quot;:&quot;&quot;,&quot;cturl&quot;:&quot;&quot;,&quot;cid&quot;:&quot;cAc12wiq&quot;,&quot;purl&quot;:&quot;https://zhuanlan.zhihu.com/p/90079087&quot;,&quot;murl&quot;:&quot;https://picb.zhimg.com/v2-12a30790a7a4ec5aaba243354409378c_r.jpg&quot;,&quot;turl&quot;:&quot;https://ts1.explicit.bing.net/th?id=OIP.cAc12wiqvdIIkZk4ypeC3QHaFe&amp;pid=15.1&quot;,&quot;md5&quot;:&quot;700735db08aabdd208919938ca9782dd&quot;,&quot;shkey&quot;:&quot;08rEOEj6PETuCnb8Z16EX+1pfPQROW0Zylf3OrsnbDQ=&quot;,&quot;t&quot;:&quot;\u624b\u600e\u4e48\u753b\uff1f10\u7ec4\u624b\u7684\u753b\u6cd5\u6559\u7a0b\u5408\u96c6\uff01\uff01 - \u77e5\u4e4e&quot;,&quot;mid&quot;:&quot;9549BF35D677F1D6B20FBE90C9F901ACD8CD4796&quot;,&quot;desc&quot;:&quot;\ue000\u624b\ue001\u600e\u4e48\u753b\uff1f10\u7ec4\ue000\u624b\ue001\u7684\u753b\u6cd5\u6559\u7a0b\u5408\u96c6\uff01\uff01 - \u77e5\u4e4e&quot;}";
test('existing real Bing m attribute is compatible with offline parser',()=>{const result=parseBingImageHtml('<a class="iusc" m="'+CAPTURED_BING_M+'"></a>',{keyword:'captured root probe',observedAt:observed});assert.equal(result.records.length,1);assert.equal(result.records[0].source_site,'zhuanlan.zhihu.com');assert.equal(result.records[0].image_provenance.kind,'search_image');assert.ok(result.records[0].image_url.includes('zhimg.com'));});
