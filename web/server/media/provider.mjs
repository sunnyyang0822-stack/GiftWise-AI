import {fileURLToPath} from 'node:url';
import {unknownPhysical,validateScene} from './scene.mjs';
import {SeedreamProvider} from './seedream.mjs';
import {MediaTaskStore,fingerprint} from './task-store.mjs';
import {buildImagePlan,IMAGE_PLAN_VERSION} from './plan.mjs';
export function emptyMedia(){return {contract_version:'retrieval-media-v2',status:'unavailable',candidates:[],selected:null};}
/** 「未授权生图」分支的 task_id 序号：保证不同调用拿到不同 id，同时保持 64 位十六进制形状。 */
let unavailableSeq=0;
/**
 * 参考图 host 白名单（代码常量：拒绝 `*`、拒绝环境变量开关，形状与匹配见 `hosts.mjs`）。
 * 只有**实测观察到该主机确实在提供栅格图片字节**（GET 200 + magic bytes + 解码后真实宽高）才列入；
 * 未列入的主机一律如实失败为 `IMAGE_REFERENCE_BLOCKED`，绝不静默降级成「外观一致」。
 *
 * 实测证据（2026-10-31，本机直连，`GET`，原始输出见
 * docs/architecture/参考图接通-2026-10-31.md 与 web/tests/refimage-hosts.test.mjs）：
 * - y.zdmimg.com        ：商品主图 210,001 B JPEG(ffd8ffe0, 800×800)；带 `Accept: image/webp` 时同一 URL 返回 139,372 B RIFF/WEBP(800×800)。
 * - img.alicdn.com      ：`/bao/upload/...` 13688 B JPEG(360×360)；协商后 8,502 B WebP(360×360)。
 * - gw.alicdn.com       ：`/tfscom/.../…-0-dgshop.jpg_360x360q90.jpg` 26,558 B JPEG(360×360)；协商后 19,650 B WebP(360×360)。
 * - g-search1/2/3/4.alicdn.com：同一淘宝商品图对象 13,688 B JPEG(360×360)，四个节点字节完全相同（搜索图镜像）。
 * - cbu01.alicdn.com    ：1688 商品图 77,812 B JPEG(460×460)；`_.webp` 变体 11,474 B WebP(300×300)。
 * - a.zdmimg.com        ：`_a200.jpg` 8,488 B WebP(200×200)（smzdm 图片节点）。
 * - img*.360buyimg.com  ：`img10/11/12/13/14/20/30.360buyimg.com` 均 200 + PNG(89504e47) 真字节。
 *   ⚠️ 诚实记录：本机可达的京东页图片**都是页面 UI 资源**（24×24 / 37×37 / 113×112 / 200×200 / 339×339），
 *   **没有复现**「京东主图 720×720 JPEG」这一说法；京东商品页对本机出口限流（返回「PC频控页」）。
 *   该条目只能算「这些主机确实在提供图片」，商品主图证据**待补**，详见报告「没做什么」。
 *
 * ⛔ 明确不列入（并已用结构性防线挡住）：
 *   - `tmpf.smzdm.com/internal/`（促销条幅）、`cbu-video-process.oss-*.aliyuncs.com`（1688 内部素材）：
 *     主机不在白名单；`/internal/` 另有路径级排除。
 *   - 任何 `-tps-<w>-<h>.png` UI 精灵图：**同主机**也会被路径级排除（`IMAGE_REFERENCE_SOURCE_EXCLUDED`）。
 *     实测 `gw.alicdn.com` 抓到的 56 条图片里 47 条是这种精灵图，所以「主机白名单」必须配路径级防线。
 *   - `cloud.video.taobao.com`（mp4）、`avatarimg.smzdm.com`（头像）：主机不在白名单，另有扩展名/路径排除。
 */
export const REFERENCE_IMAGE_HOSTS=Object.freeze([
 'y.zdmimg.com',
 'img.alicdn.com',
 'gw.alicdn.com',
 'g-search1.alicdn.com',
 'g-search2.alicdn.com',
 'g-search3.alicdn.com',
 'g-search4.alicdn.com',
 'cbu01.alicdn.com',
 'a.zdmimg.com',
 'img*.360buyimg.com',
]);
export class MediaProvider {
 constructor({transport=null,store=null}={}){this.transport=transport;this.store=store;this.jobs=new WeakMap();this.active=new Map();}
 /**
  * 候选图槽位。
  *
  * 这里**不再无条件写 `image:null`**（原实现 `:10` 会把真实商品图抹掉）。
  * 候选图走的是「来源展示」通道：URL 必须是**同源相对路径**（前端
  * `web/public/js/media-view.js` 的 `localMediaUrl()` 只接受 `/...`），
  * 因此只接受 `kind==='source_photo'` 且 `url` 以 `/` 开头的对象；
  * 其余一律回落成 `null`（⛔ 绝不用占位图冒充真实商品图）。
  */
 candidates(bindings=[]){
  return {...emptyMedia(),candidates:bindings.map((b)=>{
   const {image,...rest}=b&&typeof b==='object'?b:{};
   const valid=image&&typeof image==='object'&&image.kind==='source_photo'&&typeof image.url==='string'&&image.url.startsWith('/')&&typeof image.id==='string'&&image.id.length>0?{
    id:image.id,url:image.url,version:typeof image.version==='string'?image.version:image.id,kind:'source_photo',
    alt:typeof image.alt==='string'?image.alt:null,source_url:typeof image.source_url==='string'?image.source_url:null,
    attribution:typeof image.attribution==='string'?image.attribution:null,
    price_basis:typeof image.price_basis==='string'?image.price_basis:null,
    price_observed_at:typeof image.price_observed_at==='string'?image.price_observed_at:null,
   }:null;
   return {...rest,image:valid};
  })};
 }

 async packaging(run,id){
  if(run.selected_candidate_id!==id||!run.selectable_candidate_ids.includes(id))throw new Error('INVALID_SELECTION');
  // A plan-version upgrade must not resubmit a selected task already known to this trusted run.
  const previous=run.selections?.get(id)?.media??(run.media?.selected?.candidate_id===id?run.media:null);
  if(previous?.selected?.task_id){
   if(previous.status==='unavailable')return previous;
   return (await this.task(run,previous.selected.task_id)).media;
  }
  let jobs=this.jobs.get(run);if(!jobs){jobs=new Map();this.jobs.set(run,jobs);}
  const key=id+':'+IMAGE_PLAN_VERSION;
  if(!jobs.has(key)){const job=this.begin(run,id);jobs.set(key,job);}
  const result=await jobs.get(key);
  // 已缓存pending不锁死为旧响应；读取同一任务状态，不重新提交。
  if(result.status==='pending'&&this.store){const record=await this.task(run,result.selected.task_id);return record.media;}
  return result;
 }
 async begin(run,id){
  const product=run.product_bindings?.get(id);
  if(!this.transport?.available()||run.media_generation_authorized!==true||!this.store){
   /* 未授权/未部署时的 task_id 也必须是 **64 位十六进制**：`server.mjs` 的
      `/api/media/(tasks|assets)/[a-f0-9]{64}` 路由只认这种形状，原来用 `randomUUID()`
      会落到「方法不允许 405」而不是诚实的 404。此任务不会写入 store，
      因此 `/api/media/tasks/<id>` 会如实返回「找不到该任务记录」。
      计数器保证**不同运行/不同调用拿到的 id 不同**（不共享任务）。 */
   const selected=validateScene({task_id:fingerprint(JSON.stringify([run.run_id??null,id,IMAGE_PLAN_VERSION,'unavailable',String(unavailableSeq++)])),status:'unavailable',candidate_id:id,product_id:product?.product_id??null,plan_version:IMAGE_PLAN_VERSION,image:null,physical:structuredClone(product?.physical??unknownPhysical()),packaging:{form:'undetermined',description:null,scale:{status:'illustrative',note:'尺寸与包装比例未核实；不保证容纳或运输安全'}},scene:{description:null,props:[],props_are_included:false,text_baked_in:false},annotations:[],unknowns:['此运行未启用真实生图或服务端未配置图像服务']});
   return {...emptyMedia(),selected};
  }
  if(!run.run_id||!run.presentation?.recheck?.passed)throw new Error('PRESENTATION_NOT_PASSED');
  const taskId=fingerprint(JSON.stringify([run.run_id,id,IMAGE_PLAN_VERSION]));
  const plan=buildImagePlan(run,id,taskId);
  const record={task_id:taskId,run_id:run.run_id,candidate_id:id,owner_hash:fingerprint(run.owner_scope||'internal'),plan_version:IMAGE_PLAN_VERSION,plan_fingerprint:fingerprint(plan.prompt),created_at:new Date().toISOString(),media:{...emptyMedia(),status:'pending',candidates:run.media?.candidates??[],selected:plan.selected}};
  const saved=await this.store.create(record);
  if(saved.record.run_id!==run.run_id||saved.record.candidate_id!==id||saved.record.owner_hash!==record.owner_hash)throw new Error('MEDIA_TASK_NOT_FOUND');
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
   Object.assign(record.media.selected,{status:'ready',execution:'succeeded',image:{id:hash,url:'/api/media/assets/'+record.task_id,version:hash,kind:'ai_illustration',alt:'AI包装效果示意，非商品实拍，外观与尺寸未验证',source_url:null,attribution:'ModelVerse Seedream 4.5 AI生成，非商品实拍；场景道具不是赠品',width:result.width,height:result.height},generation:{requested_model:'doubao-seedream-4.5',actual_model:result.actual_model,width:result.width,height:result.height,reported_size:result.reported_size,elapsed_ms:result.elapsed_ms,usage:result.usage,cost_status:'not_measured',reference_count:result.reference_count,reference_status:result.reference_status??'none_provided',http_status:result.http_status??null,byte_length:result.byte_length??null},appearance_consistency:'not_verified'});
   record.media.status='ready';validateScene(record.media.selected);
  }catch(error){
   record.media.status=record.media.selected.status=error.execution==='not_submitted'?'unavailable':'failed';
   record.media.selected.error_code=typeof error.code==='string'&&/^IMAGE_[A-Z_]+$/.test(error.code)?error.code:'IMAGE_STORAGE_OR_OUTPUT_FAILED';
   record.media.selected.execution=error.execution??(result?'succeeded_output_unavailable':'unknown');
   record.media.selected.image=null;record.media.selected.annotations=[];
   record.media.selected.generation={actual_model:error.actualModel??result?.actual_model??null,usage:error.usage??result?.usage??null,elapsed_ms:error.elapsedMs??result?.elapsed_ms??null,cost_status:'not_measured',reference_count:result?.reference_count??0,reference_status:result?.reference_status??'not_submitted',http_status:error.httpStatus??result?.http_status??null,byte_length:result?.byte_length??null};
   record.media.selected.unknowns.push('失败或超时不证明供应商未执行；本方案不自动重试');
  }
  record.completed_at=new Date().toISOString();
  // 保存失败仍保留最初pending日志；重启后转执行未知，不二次收费。
  await this.store.save(record).catch(()=>{});
 }
 async task(run,id){const record=await this.store.read(id);if(record.run_id!==run.run_id||record.owner_hash!==fingerprint(run.owner_scope||'internal')||record.candidate_id!==run.selected_candidate_id)throw new Error('MEDIA_TASK_NOT_FOUND');return record;}
 async wait(id){await this.active.get(id);return this.store.read(id);}
}
export const mediaProvider=new MediaProvider({transport:new SeedreamProvider({referenceHosts:[...REFERENCE_IMAGE_HOSTS]}),store:new MediaTaskStore(fileURLToPath(new URL('../../../.tmp/media-store/',import.meta.url)))});
