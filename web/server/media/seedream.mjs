import {readImage} from './safe-read.mjs';
import {inspectRaster} from './raster.mjs';
import {parseHostEntry} from './hosts.mjs';

export const SEEDREAM_MODEL='doubao-seedream-4.5';
export const SEEDREAM_ENDPOINT='https://api.modelverse.cn/v1/images/generations';
/** 参考图上限：与契约一致，首版至多2张。 */
export const MAX_GENERATION_REFERENCES=2;
/** 只有「生图通道」的来源照片可作参考；页面截图走展示通道，永不作参考。
 *  同时接受展示契约词汇 source_photo（media-view.js 的「商品来源图」）与采集库词汇 product_image（/api/catalog 的 image_kind）。
 *  截图类（page_capture / screenshot / page_image）任何情况下都不在集合内。 */
export const REFERENCE_KINDS=Object.freeze(['source_photo','product_image']);
const TEXT_MAX=200;
const GRANT_MAX=120;
export class ImageProviderError extends Error {
 constructor(code,{execution='unknown',usage=null,actualModel=null,elapsedMs=null,httpStatus=null}={}){super(code);this.code=code;this.execution=execution;this.usage=usage;this.actualModel=actualModel;this.elapsedMs=elapsedMs;this.httpStatus=httpStatus;}
}
function usageOnly(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const out={};for(const [key,item] of Object.entries(value).slice(0,30))if(/^[a-z_]{1,60}$/.test(key)&&typeof item==='number'&&Number.isFinite(item)&&item>=0)out[key]=item;
 return Object.keys(out).length?out:null;
}
async function boundedJson(response,maxBytes=24000000){
 if(!response.body)throw new Error('NO_BODY');let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new Error('IMAGE_RESPONSE_TOO_LARGE');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function filledText(value,max){return typeof value==='string'&&value.trim().length>0&&[...value].length<=max;}
// 白名单是代码常量：拒绝 `*`，也不接受任何形式的任意改写（不引入环境变量开关）。
// 形状校验与匹配都收敛到 `hosts.mjs`（精确名 / 最左标签前缀通配 `img*.360buyimg.com`）。
function hostList(hosts){
 if(!Array.isArray(hosts))throw new Error('INVALID_REFERENCE_HOSTS');
 const out=[];
 for(const host of hosts){
  parseHostEntry(host); // 不合法（`*` / `*.domain` / URL / 路径）直接抛 INVALID_REFERENCE_HOSTS
  if(!out.includes(host))out.push(host);
 }
 return Object.freeze(out);
}
/**
 * 参考图 URL 的**结构性排除**（在读取字节之前判定，因此不可能落到网络或供应商那一层）。
 *
 * 排除的是「来源上就不是商品实拍」的地址，而不是「取不到」：
 *   - UI 精灵图 `-tps-<w>-<h>`（淘宝/1688 页面图标；实测 `gw.alicdn.com` 56 条里 47 条是这种）；
 *   - 促销内部位 `/internal/`（如 `tmpf.smzdm.com/internal/` 促销条幅）；
 *   - 视频/音频容器（mp4/m3u8/mov/webm/mp3）与矢量/不可解码扩展（svg/avif/heic/gif 等）；
 *   - 头像/图标字样（`avatar`/`logo`/`icon`/`qrcode`）。
 * 任一条命中 ⇒ `IMAGE_REFERENCE_SOURCE_EXCLUDED`，且**供应商调用次数为 0**。
 */
const EXCLUDED_PATH = [/\/internal\//i, /-tps-\d{1,5}-\d{1,5}(?=\.|$)/i, /(?:^|\/)(?:avatar|logo|icon|qrcode)[^/]*$/i];
const EXCLUDED_EXT = /\.(?:mp4|m3u8|mov|webm|avi|mkv|mp3|ico)(?:$|[?#])/i;
/** 扩展名一眼就是「本层不解码的栅格/矢量」→ 走格式错误码，而不是「来源被排除」。 */
const UNSUPPORTED_FORMAT_EXT = /\.(?:avif|heic|heif|gif|bmp|tiff?|svg)(?:$|[?#])/i;
function referenceUrlExcluded(url){
 if(typeof url!=='string')return true;
 let parsed;
 try{parsed=new URL(url);}catch{return true;}
 const pathname=parsed.pathname;
 if(EXCLUDED_EXT.test(pathname))return true;
 if(EXCLUDED_PATH.some(re=>re.test(decodeURIComponent(pathname))))return true;
 return false;
}
/** 扩展名已暴露为不可解码格式 ⇒ 连网络读取都不做。 */
function referenceUrlFormatUnsupported(url){
 if(typeof url!=='string')return false;
 try{return UNSUPPORTED_FORMAT_EXT.test(new URL(url).pathname);}catch{return false;}
}
/**
 * 参考图授权闸门：只对「用户实际选中的那一个商品」放行。
 * 凭据由流程侧在选定后一次性铸造（不改检索数据自身的 permission 字段），这里只做消费侧校验。
 * 返回 null 表示通过，否则返回明确的原因码。
 */
export function referenceRejection(ref,product,selected){
 if(!product||!ref||typeof ref!=='object'||Array.isArray(ref))return 'IMAGE_REFERENCE_NOT_AUTHORIZED';
 if(ref.product_id!==product.product_id||ref.variant!==product.variant)return 'IMAGE_REFERENCE_NOT_AUTHORIZED';
 // 展示通道的截图（usable_as_generation_reference:false）绝不作参考，先于许可判定拒绝。
 if(!REFERENCE_KINDS.includes(ref.kind)||ref.usable_as_generation_reference!==true)return 'IMAGE_REFERENCE_NOT_USABLE';
 const permission=ref.permission;
 if(!permission||typeof permission!=='object'||Array.isArray(permission))return 'IMAGE_REFERENCE_NOT_AUTHORIZED';
 if(permission.status!=='approved'||permission.scope!=='selected_product')return 'IMAGE_REFERENCE_NOT_AUTHORIZED';
 // 凭据自身也必须绑定在这个商品上，避免「一次放行」被挪用到同批其他商品。
 if(permission.product_id!==product.product_id||permission.variant!==product.variant)return 'IMAGE_REFERENCE_NOT_AUTHORIZED';
 if(!filledText(permission.usage_basis,TEXT_MAX)||!filledText(permission.evidence_ref,TEXT_MAX)||!filledText(permission.grant_id,GRANT_MAX))return 'IMAGE_REFERENCE_NOT_AUTHORIZED';
 if(!Number.isFinite(Date.parse(permission.granted_at)))return 'IMAGE_REFERENCE_NOT_AUTHORIZED';
 if(permission.task_id!==undefined&&permission.task_id!==selected?.task_id)return 'IMAGE_REFERENCE_NOT_AUTHORIZED';
 return null;
}
export class SeedreamProvider {
 constructor({apiKey=()=>process.env.IMAGE_API_KEY,fetchImpl=fetch,timeoutMs=60000,referenceHosts=[],imageReader=readImage}={}){Object.assign(this,{apiKey,fetchImpl,timeoutMs,referenceHosts:hostList(referenceHosts),imageReader,consumedGrants:new Set()});}
 available(){return Boolean(this.apiKey());}
 async generate({prompt,references=[],product,selected}={}){
  const key=this.apiKey();if(!key)throw new ImageProviderError('IMAGE_NOT_CONFIGURED',{execution:'not_submitted'});
  const list=Array.isArray(references)?references:[];
  const images=[];
  // 仅服务端核实的规格与使用依据可以进入参考图输入，永不接客户端URL或许可自声明。
  if(list.length){
   if(list.length>MAX_GENERATION_REFERENCES)throw new ImageProviderError('IMAGE_REFERENCE_NOT_AUTHORIZED',{execution:'not_submitted'});
   // 先全量校验授权，再取图：任一条不合法就整次拒绝，绝不对供应商发起任何请求、绝不静默退化为无参考图。
   const grants=[];
   for(const ref of list){
    const rejection=referenceRejection(ref,product,selected);
    if(rejection)throw new ImageProviderError(rejection,{execution:'not_submitted'});
    const grantId=ref.permission.grant_id;
    if(this.consumedGrants.has(grantId)||grants.includes(grantId))throw new ImageProviderError('IMAGE_REFERENCE_CREDENTIAL_REUSED',{execution:'not_submitted'});
    // 结构性排除（UI 精灵图 / 促销内部位 / 视频 / 头像）也放在「消费凭据之前」：
    // 请求本身不合法就不该把这次选定的一次性凭据烧掉。
    if(referenceUrlExcluded(ref.url))throw new ImageProviderError('IMAGE_REFERENCE_SOURCE_EXCLUDED',{execution:'not_submitted'});
    // 扩展名已暴露为不可解码格式：同样在读取字节之前给明确错误码。
    if(referenceUrlFormatUnsupported(ref.url))throw new ImageProviderError('IMAGE_REFERENCE_FORMAT_UNSUPPORTED',{execution:'not_submitted'});
    grants.push(grantId);
   }
   // 凭据在通过校验的瞬间即被消费：一次选定只授权一次提交（不自动重试，需重新选择以铸造新凭据）。
   for(const grantId of grants)this.consumedGrants.add(grantId);
   for(const ref of list){
    try{
     const {bytes}=await this.imageReader(ref.url,{hosts:this.referenceHosts,maxBytes:5000000,timeoutMs:5000});
     // 尺寸与类型一律以**字节**为准（不信扩展名、不信 content-type）；解不出的格式给出明确错误码。
     const raster=inspectRaster(bytes);
     images.push(`data:${raster.type};base64,${bytes.toString('base64')}`);
    }
    catch(error){
     // 格式不可解码是**独立且明确**的错误码：绝不与「被白名单阻断」混为一谈。
     const code=error?.code==='IMAGE_FORMAT_UNSUPPORTED'?'IMAGE_REFERENCE_FORMAT_UNSUPPORTED':'IMAGE_REFERENCE_BLOCKED';
     throw new ImageProviderError(code,{execution:'not_submitted'});
    }
   }
  }
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>6000)throw new ImageProviderError('IMAGE_PROMPT_INVALID',{execution:'not_submitted'});
  const body={model:SEEDREAM_MODEL,prompt,size:'2K',sequential_image_generation:'disabled',stream:false,response_format:'b64_json',watermark:true,...(images.length?{images}:{})};
  const started=performance.now();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  let metadata={};
  try{
   const response=await this.fetchImpl(SEEDREAM_ENDPOINT,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   metadata={httpStatus:response.status};
   if(!response.ok)throw new ImageProviderError('IMAGE_PROVIDER_HTTP',{execution:[400,401,403,422,429].includes(response.status)?'rejected':'unknown',...metadata});
   const data=await boundedJson(response);metadata={usage:usageOnly(data.usage),actualModel:typeof data.model==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(data.model)?data.model:null,httpStatus:response.status};
   if(data.error||!Array.isArray(data.data)||data.data.length!==1||data.data[0].error)throw new ImageProviderError('IMAGE_PROVIDER_FAILED',{execution:'failed',...metadata});
   const b64=data.data[0].b64_json;
   if(typeof b64!=='string'||b64.length>22000000||!b64.length||b64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(b64))throw new ImageProviderError('IMAGE_RESPONSE_INVALID',{...metadata});
   const bytes=Buffer.from(b64,'base64');const raster=inspectRaster(bytes);
   const reportedSize=typeof data.data[0].size==='string'&&/^[0-9]{1,5}[x×][0-9]{1,5}$/.test(data.data[0].size)?data.data[0].size:null;
   if(reportedSize&&reportedSize.replace('×','x')!==`${raster.width}x${raster.height}`)throw new ImageProviderError('IMAGE_SIZE_MISMATCH',{execution:'succeeded_output_invalid',...metadata});
   return {bytes,...raster,actual_model:metadata.actualModel,usage:metadata.usage,reported_size:reportedSize,elapsed_ms:Math.round(performance.now()-started),reference_count:images.length,reference_status:images.length?'used':'none_provided',http_status:response.status,byte_length:bytes.length};
  }catch(error){
   if(error instanceof ImageProviderError){error.elapsedMs=Math.round(performance.now()-started);throw error;}
   throw new ImageProviderError(controller.signal.aborted?'IMAGE_EXECUTION_UNKNOWN':'IMAGE_RESPONSE_UNCERTAIN',{execution:'unknown',...metadata,elapsedMs:Math.round(performance.now()-started)});
  }finally{clearTimeout(timer);}
 }
}
