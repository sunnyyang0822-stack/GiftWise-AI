// 显式授权入口：仅设置GIFTWISE_SEEDREAM_LIVE_TEST=1时执行一次真实图片调用。
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
if(process.env.GIFTWISE_SEEDREAM_LIVE_TEST!=='1')throw new Error('LIVE_IMAGE_TEST_NOT_ENABLED');
if(!process.env.IMAGE_API_KEY)throw new Error('IMAGE_NOT_CONFIGURED');
process.env.GW_PORT='0';process.env.GW_MODE='mock';
const {server}=await import('../../web/server/server.mjs');
const {runRecommendation,runPresentation}=await import('../../web/server/pipeline.mjs');
const {buildMockCandidates}=await import('../../web/server/mock-model.mjs');
const {mediaProvider}=await import('../../web/server/media/provider.mjs');
if(!server.listening)await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
try{
 const session=await fetch(origin+'/api/config');const cookie=session.headers.get('set-cookie').split(';')[0];const owner=cookie.slice(16).split('.')[0];
 const intake=JSON.parse(readFileSync(new URL('../../workflow/examples/intake.json',import.meta.url)));
 delete intake.budget_amount;Object.assign(intake,{contract_version:'giftwise-20261031-v2',budget_mode:'other',budget_range:{min:'0',max:'600'},deadline_days:30,dislikes:'',previous_gifts:'虚构历史：去年送过相册',hard_exclusions:{tags:[],terms:[],unresolved:[]}});
 // 受控文本提供者，禁用真实Dify；核心规则、存储、选择和图片API均走实际实现。
 const recommendation=await runRecommendation({intake,mode:'dify',ownerScope:owner},{retrievalEnabled:false,enableImageGeneration:true,requestCandidates:async raw=>({ok:true,outputs:{candidates_json:buildMockCandidates(JSON.parse(raw)).candidates_json}})});
 assert.equal(recommendation.kind,'report');const id=recommendation.report.selectable_candidate_ids[0];assert.ok(id);
 let actualCalls=0;const generate=mediaProvider.transport.generate.bind(mediaProvider.transport);mediaProvider.transport.generate=async plan=>{actualCalls++;return generate(plan);};
 const selected=await runPresentation({runId:recommendation.run.run_id,selectedCandidateId:id,ownerScope:owner},{requestPresentation:async()=>({ok:true,outputs:{presentation_json:JSON.stringify({contract_version:'giftwise-20261031-v2',style:'克制柔和',packaging:{color_palette:['米色','浅蓝']},card_text:'愿你度过轻松的一天',giving_advice:{timing:'对方方便时',wording:'一份小心意，方便时收下即可',relationship_cautions:['不期待回应，不假定已有亲密关系']},unknowns:['实际物品外观、尺寸与易碎性未知'],currency:'CNY',revised_estimated_preparation_days:5})}})});
 assert.equal(selected.kind,'presentation');const initialStatus=selected.view.media.status;assert.equal(initialStatus,'pending');const taskId=selected.view.media.selected.task_id;
 const repeat=await fetch(origin+'/api/presentations',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({recommendation_run_id:recommendation.run.run_id,selected_candidate_id:id})});const repeated=await repeat.json();assert.equal(repeated.media.selected.task_id,taskId);
 await mediaProvider.wait(taskId);
 const task=await fetch(origin+'/api/media/tasks/'+taskId,{headers:{Cookie:cookie}});const media=await task.json();assert.equal(media.status,'ready',media.selected?.error_code);assert.equal(media.selected.annotations.length,0);
 const image=await fetch(origin+media.selected.image.url,{headers:{Cookie:cookie}});assert.equal(image.status,200);const bytes=Buffer.from(await image.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),media.selected.image.version);
 assert.equal(actualCalls,1);
 const other=await fetch(origin+'/api/media/assets/'+taskId);assert.equal(other.status,404);
 const report={mode:'real_seedream_controlled_text_not_real_dify',recorded_at:new Date().toISOString(),initial_status:initialStatus,final_status:media.status,duplicate_request_same_task:true,actual_image_calls:actualCalls,dify_calls:0,retrieval:{status:recommendation.report.retrieval.status,note:'本次生图测试不执行浏览器检索，不代表检索通过'},candidate_id:id,task_id:taskId,image:media.selected.image,generation:media.selected.generation,annotations:[],annotation_status:media.selected.annotation_status,asset_bytes:bytes.length,asset_sha256:media.selected.image.version,unauthorized_asset_status:other.status,visual_acceptance:'not_verified_by_backend'};
 writeFileSync(new URL('../../docs/research/opencli/seedream-live-result.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({status:'failed',code:/^[A-Z_]+$/.test(error.message)?error.message:'LIVE_PRODUCT_WIRING_FAILED',note:'未自动重试；请检查任务日志，供应商可能已执行'}));process.exitCode=1;}
finally{await new Promise(resolve=>server.close(resolve));server.closeAllConnections();}
