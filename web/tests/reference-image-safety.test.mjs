import test from'node:test';import assert from'node:assert/strict';import vm from'node:vm';
import{validateSourceImage}from'../server/collect/domestic-detail.mjs';
import{fetchBrowserReferenceImage}from'../server/collect/domestic-browser.mjs';
import{publicReferenceUrl}from'../server/collect/public-reference.mjs';
import{referenceImageSlots}from'../server/retrieval/reference-images.mjs';
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
test('Bing地区缩略图只允许精确host/图片路径/HTTPS443/无凭证；重定向逐跳检查',async()=>{
 let calls=0;const transport=async()=>{calls++;return new Response(gif,{headers:{'content-type':'image/gif'}});};
 for(const host of ['tse1-mm.cn.bing.net','tse2-mm.cn.bing.net','tse3-mm.cn.bing.net','tse4-mm.cn.bing.net'])assert.equal((await validateSourceImage('https://'+host+'/th/id/fixture',{role:'reference',fetchImpl:transport})).ok,true);
 const initial=calls;
 for(const url of ['https://evil.cn.bing.net/th/id/x','https://tse9-mm.cn.bing.net/th/id/x','https://evil.tse3-mm.cn.bing.net/th/id/x','https://tse3-mm.cn.bing.net/login','http://tse3-mm.cn.bing.net/th/id/x','https://user:password@tse3-mm.cn.bing.net/th/id/x','https://tse3-mm.cn.bing.net:8443/th/id/x','https://127.0.0.1/th/id/x'])assert.equal((await validateSourceImage(url,{role:'reference',fetchImpl:transport})).ok,false);
 assert.equal(calls,initial);assert.equal((await validateSourceImage('https://tse3-mm.cn.bing.net/th/id/x',{fetchImpl:transport})).ok,false);
 const redirected=await validateSourceImage('https://tse3-mm.cn.bing.net/th/id/x',{role:'reference',fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})});assert.equal(redirected.error_code,'IMAGE_REDIRECT_NOT_ALLOWED');
});
test('浏览器参考图片GET不带凭证、遵守CORS、拒绝opaque重定向且不再发请求',async()=>{
 let calls=0;const evaluate=script=>vm.runInNewContext(script,{fetch:async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.mode,'cors');return{type:'opaqueredirect',status:0};},btoa});
 const image=await fetchBrowserReferenceImage(evaluate,'https://tse3-mm.cn.bing.net/th/id/x');assert.equal(image.image_transport_error,'IMAGE_REDIRECT_NOT_ALLOWED');assert.equal(calls,1);
 const response=await fetchBrowserReferenceImage(script=>vm.runInNewContext(script,{fetch:async()=>new Response(gif,{headers:{'content-type':'image/gif'}}),btoa}),'https://tse3-mm.cn.bing.net/th/id/x');assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),gif);
});
test('品牌商店商品根路径与编码/跳转链拒绝，资讯中的product词不误杀',()=>{
 for(const url of ['https://bincoocoffee.cn/product/coffee','https://bincoocoffee.cn/%70roduct/coffee','https://bincoocoffee.cn/cn/products/coffee','https://sspai.com/redirect?url='+encodeURIComponent('https://bincoocoffee.cn/product/coffee'),'https://sspai.com/redirect?target='+encodeURIComponent('https://item.jd.com/1.html')])assert.equal(publicReferenceUrl(url,'bing'),null);
 assert.equal(publicReferenceUrl('https://www.foodtalks.cn/news/product/design-history','bing'),'https://www.foodtalks.cn/news/product/design-history');
 assert.equal(publicReferenceUrl('https://www.foodtalks.cn/news/21343?signature=secret&uid=123&xsec_token=private','bing'),'https://www.foodtalks.cn/news/21343');
 const record={reference_id:'ref-shop',reference_kind:'public_reference',source_url:'https://bincoocoffee.cn/product/coffee',image_kind:'reference_image',image_id:'a'.repeat(32),image_validation:{ok:true,width:100,height:100}};
 const slots=referenceImageSlots([{id:'c1'}],{references:[record]},[{candidate_id:'c1',reference_id:record.reference_id,image:{id:record.image_id,kind:'reference_image',url:'/api/reference/images/'+record.image_id}}]);assert.equal(slots[0].status,'unavailable');
});
