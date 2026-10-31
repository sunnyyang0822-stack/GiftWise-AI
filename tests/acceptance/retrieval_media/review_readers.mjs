// 只复核PR57真实导出函数与PR58资料；简化DOM用于字符串/绑定断言，不是浏览器验收。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const results=[];
function test(id,input,expected,fn){try{const actual=fn();results.push({id,input,expected,status:'PASS',actual:actual??'断言通过'});console.log('PASS',id);}catch(e){results.push({id,input,expected,status:'FAIL',actual:e.stack});console.error('FAIL',id,e.stack);}}
class Element {
 constructor(tag){this.tag=tag;this.attrs={};this.children=[];this.textContent='';this.hidden=false;this.style={setProperty(){}};}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(){}
 append(...ns){this.children.push(...ns);}
 replaceChildren(...ns){this.children=[...ns];}
 querySelector(selector){return this.children.flatMap(x=>x instanceof Element?[x,...x.walk()]:[]).find(x=>selector.startsWith('.')&&x.attrs.class?.split(' ').includes(selector.slice(1)))??null;}
 *walk(){for(const c of this.children)if(c instanceof Element){yield c;yield* c.walk();}}
 text(){return this.textContent+this.children.map(x=>x instanceof Element?x.text():String(x)).join('');}
}
globalThis.document={createElement:tag=>new Element(tag)};
globalThis.location={origin:'http://qa.local'};
const {validAnnotations,localMediaUrl,candidateMedia,packagingMedia}=await import(pathToFileURL(join(process.env.QA_FRONTEND_ROOT,'web/public/js/media-view.js')));
const annotation={id:'a',text:'贺卡位置',target:{x:0,y:1},label:{x:1,y:0},image_version:'v2',curve:null};
test('frontend-coordinate-version',{},'合法端点保留，旧版本/越界丢弃',()=>{assert.equal(validAnnotations([annotation],'v2').length,1);assert.equal(validAnnotations([annotation],'v3').length,0);assert.equal(validAnnotations([{...annotation,target:{x:Infinity,y:0}}],'v2').length,0);});
test('frontend-url-boundary',{},'仅本站相对媒体，远程/脚本/协议相对拒绝',()=>{assert.equal(localMediaUrl('/qa.png'),'http://qa.local/qa.png');for(const s of ['javascript:QA','//evil.invalid/x','https://evil.invalid/x','data:QA','/\\evil'])assert.equal(localMediaUrl(s),null);});
const report={retrieval:{products:[{product_id:'p1',image_id:'im1',price_source:'seed',observed_at:null,price_conditions:['条件未知']}]},media:{status:'unavailable',candidates:[{candidate_id:'c1',product_id:'p1',image:{id:'im1',url:'/qa.png',kind:'demo',alt:'开发样例'}}]}};
test('frontend-candidate-binding',{},'candidate→product→image三引用匹配且保留价格来源',()=>{const n=candidateMedia(report,{id:'c1'});assert.equal(n.attrs['data-image-id'],'im1');assert(n.text().includes('开发样例估算'));});
test('frontend-mismatched-image',{},'产品image_id不符不展示',()=>{const r=structuredClone(report);r.media.candidates[0].image.id='other';assert.equal(candidateMedia(r,{id:'c1'}).attrs['data-image-id'],'missing');});
test('frontend-duplicate-binding',{},'同候选重复媒体引用降级',()=>{const r=structuredClone(report);r.media.candidates.push(r.media.candidates[0]);assert.equal(candidateMedia(r,{id:'c1'}).attrs['data-image-id'],'missing');});
test('frontend-selected-null',{},'v2无图selected不崩溃且保留文字',()=>{const n=packagingMedia({selected_candidate_id:'c1',media:{contract_version:'retrieval-media-v2',status:'unavailable',selected:{candidate_id:'c1',image:null,annotations:[],packaging:{scale:{note:'比例未核实'}},scene:{description:'文字方案'}}}});assert(n.text().includes('文字方案'));assert(n.text().includes('暂无图片'));});
test('frontend-ai-vs-demo-label',{kind:'ai_illustration',status:'ready'},'真实provider AI信封不得无条件标为摄影开发夹具、非AI生成',()=>{const n=packagingMedia({selected_candidate_id:'c1',media:{contract_version:'retrieval-media-v2',status:'ready',selected:{candidate_id:'c1',image:{id:'qa',version:'v2',url:'/qa.png',kind:'ai_illustration',alt:'AI包装效果示意'},annotations:[]}}});assert(!n.text().includes('非AI生成结果'),n.text());});
const wf=process.env.QA_WORKFLOW_ROOT;
const fixture=JSON.parse(readFileSync(join(wf,'workflow/examples/retrieval-media/cases.json'),'utf8'));
test('workflow-sidecar-status',{},'夹具状态属于共享枚举',()=>{assert(['ready','partial','unavailable'].includes(fixture.retrieval.status));assert(['pending','ready','failed','unavailable'].includes(fixture.media.status));});
test('workflow-reference-binding',{},'三个候选引用独立商品并与媒体绑定一致',()=>{const refs=JSON.parse(fixture.product_references_json);assert.equal(new Set(refs.map(x=>x.product_id)).size,3);for(const r of refs){assert(fixture.retrieval.products.some(p=>p.product_id===r.product_id));assert(fixture.media.candidates.some(m=>m.candidate_id===r.candidate_id&&m.product_id===r.product_id));}});
test('workflow-source-no-fake-live',{},'虚构夹具保持seed/null图片/无实时成功',()=>{for(const p of fixture.retrieval.products){assert.equal(p.price_source,'seed');assert.equal(p.image_id,null);assert.equal(p.observed_at,null);}});
test('workflow-v2-prompt-alignment',{contract:'retrieval-media-v2'},'包装提示词不能禁止v2已定义的physical/version/curve字段',()=>{const text=readFileSync(join(wf,'workflow/prompts/packaging-image.md'),'utf8');assert(!text.includes('当前共享product没有专门尺寸/重量/易碎性字段')&&!text.includes('不加font/curve/placement_status等字段'),'仍声明无物理字段并禁止curve，尚未对齐后台v2');});
writeFileSync(process.env.QA_RESULTS,JSON.stringify({scope:'exported-functions-with-minimal-DOM-and-static-workflow-not-browser',frontend_sha:process.env.QA_FRONTEND_SHA,workflow_sha:process.env.QA_WORKFLOW_SHA,results,counts:{PASS:results.filter(x=>x.status==='PASS').length,FAIL:results.filter(x=>x.status==='FAIL').length}},null,2));
process.exitCode=results.some(x=>x.status==='FAIL')?1:0;
