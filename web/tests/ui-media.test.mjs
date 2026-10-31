import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recommendationMedia} from '../public/js/media-preview.js';
import {validAnnotations,localMediaUrl} from '../public/js/media-view.js';
import {previewRequest,setPreviewScenario} from '../public/js/preview-api.js';
test('草案sidecar独立绑定三候选，不修改核心候选',async()=>{
 const candidates=[1,2,3].map(i=>({id:`c${i}`,name:`虚构样例${i}`,estimated_total:'80.00'}));
 const before=JSON.stringify(candidates);const sidecar=recommendationMedia(candidates);
 assert.equal(before,JSON.stringify(candidates));assert.equal(sidecar.media.selected,null);
 assert.equal(new Set(sidecar.media.candidates.map(x=>x.image.url)).size,3);
 for(const item of sidecar.media.candidates){const p=sidecar.retrieval.products.find(p=>p.product_id===item.product_id);assert.equal(p.image_id,item.image.id);assert.equal(p.observed_at,null);assert.equal(p.price_range,null);assert.equal(p.stock_status,'unknown');assert.equal(p.evidence_ref,null);assert.ok(Array.isArray(p.price_conditions));assert.equal(item.image.kind,'demo');assert.equal(p.price_source,'seed');const jpg=await readFile(new URL(`../public${item.image.url}`,import.meta.url));assert.equal(jpg[0],255);assert.equal(jpg[1],216);assert.match(item.image.attribution,/Pexels/);}
});
test('媒体URL与归一化标注拒绝越界和注入',()=>{
 globalThis.location={origin:'http://127.0.0.1:19002'};
 for(const url of ['javascript:alert(1)','data:image/svg+xml,test','http://127.0.0.1:9342/','//outside.example/a','/\\outside/a'])assert.equal(localMediaUrl(url),null);
 assert.equal(localMediaUrl('/img/media-demo/art.svg'),'http://127.0.0.1:19002/img/media-demo/art.svg');
 assert.equal(validAnnotations([{text:'中文说明',target:{x:.3,y:.6},label:{x:.8,y:.2}}]).length,1);
 assert.equal(validAnnotations([{text:'越界',target:{x:2,y:0},label:{x:0,y:0}}]).length,0);
 assert.equal(validAnnotations([{text:'旧坐标',image_version:'old',target:{x:.2,y:.3},label:{x:.8,y:.2}}],'new').length,0);
 assert.equal(validAnnotations([{text:'曲线越界',image_version:'new',target:{x:.2,y:.3},label:{x:.8,y:.2},curve:{control_points:[{x:2,y:.4}]}}],'new').length,0);
 delete globalThis.location;
});
test('选择前无包装，失败候选禁选，同一选择复用模拟呈现',async()=>{
 const intake={recipient_relation:'pursuit',occasion:'birthday',budget_mode:'slider',budget_range:{min:'100',max:'300'},deadline_days:5,dislikes:''};
 setPreviewScenario('normal');const {data:r}=await previewRequest('/api/recommendations',{intake});assert.equal(r.media.selected,null);
 const payload={recommendation_run_id:r.recommendation_run_id,selected_candidate_id:r.candidates[0].id};
 const [first,second]=await Promise.all([previewRequest('/api/presentations',payload),previewRequest('/api/presentations',payload)]);
 assert.equal(first,second);assert.equal(first.data.media.selected.candidate_id,payload.selected_candidate_id);assert.equal(first.data.media.selected.annotations.length,3);
 assert.equal(first.data.media.selected.image.kind,'demo');assert.equal(first.data.recheck_summary.gift_estimated_total,'80.00');
 setPreviewScenario('blocked');const {data:b}=await previewRequest('/api/recommendations',{intake});assert.equal((await previewRequest('/api/presentations',{recommendation_run_id:b.recommendation_run_id,selected_candidate_id:b.candidates[0].id})).ok,false);
});
