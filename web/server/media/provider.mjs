import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {unknownPhysical,validateScene} from './scene.mjs';
import {SeedreamProvider} from './seedream.mjs';
import {MediaTaskStore,fingerprint} from './task-store.mjs';
import {buildImagePlan,IMAGE_PLAN_VERSION} from './plan.mjs';
export function emptyMedia(){return {contract_version:'retrieval-media-v2',status:'unavailable',candidates:[],selected:null};}
export class MediaProvider {
 constructor({transport=null,store=null}={}){this.transport=transport;this.store=store;this.jobs=new WeakMap();this.active=new Map();}
 candidates(bindings=[]){return {...emptyMedia(),candidates:bindings.map(b=>({...b,image:null}))};}
 async packaging(run,id){
  if(run.selected_candidate_id!==id||!run.selectable_candidate_ids.includes(id))throw new Error('INVALID_SELECTION');
  let jobs=this.jobs.get(run);if(!jobs){jobs=new Map();this.jobs.set(run,jobs);}
  const key=id+':'+IMAGE_PLAN_VERSION;
  if(!jobs.has(key)){const job=this.begin(run,id);jobs.set(key,job);}
  const result=await jobs.get(key);
  // 已缓存pending不锁死为旧响应；读取同一任务状态，不重新提交。
  if(result.status==='pending'&&this.store){const record=await this.store.read(result.selected.task_id);return record.media;}
  return result;
 }
 async begin(run,id){
  const product=run.product_bindings?.get(id);
  if(!this.transport?.available()||run.media_generation_authorized!==true||!this.store){
   const selected=validateScene({task_id:randomUUID(),status:'unavailable',candidate_id:id,product_id:product?.product_id??null,plan_version:IMAGE_PLAN_VERSION,image:null,physical:structuredClone(product?.physical??unknownPhysical()),packaging:{form:'undetermined',description:null,scale:{status:'illustrative',note:'尺寸与包装比例未核实；不保证容纳或运输安全'}},scene:{description:null,props:[],props_are_included:false,text_baked_in:false},annotations:[],unknowns:['此运行未启用真实生图或服务端未配置图像服务']});
   return {...emptyMedia(),selected};
  }
  if(!run.run_id||!run.presentation?.recheck?.passed)throw new Error('PRESENTATION_NOT_PASSED');
  const taskId=fingerprint(JSON.stringify([run.run_id,id,IMAGE_PLAN_VERSION]));
  const plan=buildImagePlan(run,id,taskId);
  const record={task_id:taskId,run_id:run.run_id,candidate_id:id,owner_hash:fingerprint(run.owner_scope||'internal'),plan_version:IMAGE_PLAN_VERSION,plan_fingerprint:fingerprint(plan.prompt),created_at:new Date().toISOString(),media:{...emptyMedia(),status:'pending',candidates:run.media?.candidates??[],selected:plan.selected}};
  const saved=await this.store.create(record);
  if(saved.record.plan_fingerprint!==record.plan_fingerprint)throw new Error('IMAGE_PLAN_VERSION_CONFLICT');
  if(saved.created){const job=this.execute(saved.record,plan);this.active.set(taskId,job);void job.finally(()=>this.active.delete(taskId));}
  return saved.record.media;
 }
 async execute(record,plan){
  let result;
  try{
   result=await this.transport.generate(plan);
   const hash=await this.store.saveAsset(result.bytes,result.extension);
   record.asset={sha256:hash,extension:result.extension,type:result.type};
   Object.assign(record.media.selected,{status:'ready',execution:'succeeded',image:{id:hash,url:'/api/media/assets/'+record.task_id,version:hash,kind:'ai_illustration',alt:'AI包装效果示意，非商品实拍，外观与尺寸未验证',source_url:null,attribution:'ModelVerse Seedream 4.5 AI生成，非商品实拍；场景道具不是赠品',width:result.width,height:result.height},generation:{requested_model:'doubao-seedream-4.5',actual_model:result.actual_model,width:result.width,height:result.height,reported_size:result.reported_size,elapsed_ms:result.elapsed_ms,usage:result.usage,cost_status:'not_measured',reference_count:result.reference_count},appearance_consistency:'not_verified'});
   record.media.status='ready';validateScene(record.media.selected);
  }catch(error){
   record.media.status=record.media.selected.status=error.execution==='not_submitted'?'unavailable':'failed';
   record.media.selected.error_code=typeof error.code==='string'&&/^IMAGE_[A-Z_]+$/.test(error.code)?error.code:'IMAGE_STORAGE_OR_OUTPUT_FAILED';
   record.media.selected.execution=error.execution??(result?'succeeded_output_unavailable':'unknown');
   record.media.selected.image=null;record.media.selected.annotations=[];
   record.media.selected.generation={actual_model:error.actualModel??result?.actual_model??null,usage:error.usage??result?.usage??null,elapsed_ms:error.elapsedMs??result?.elapsed_ms??null,cost_status:'not_measured'};
   record.media.selected.unknowns.push('失败或超时不证明供应商未执行；本方案不自动重试');
  }
  record.completed_at=new Date().toISOString();
  // 保存失败仍保留最初pending日志；重启后转执行未知，不二次收费。
  await this.store.save(record).catch(()=>{});
 }
 async task(run,id){const record=await this.store.read(id);if(record.run_id!==run.run_id||record.owner_hash!==fingerprint(run.owner_scope||'internal')||record.candidate_id!==run.selected_candidate_id)throw new Error('MEDIA_TASK_NOT_FOUND');return record;}
 async wait(id){await this.active.get(id);return this.store.read(id);}
}
export const mediaProvider=new MediaProvider({transport:new SeedreamProvider(),store:new MediaTaskStore(fileURLToPath(new URL('../../../.tmp/media-store/',import.meta.url)))});
