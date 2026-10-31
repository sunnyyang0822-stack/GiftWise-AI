import {readImage} from './safe-read.mjs';
import {inspectRaster} from './raster.mjs';

export const SEEDREAM_MODEL='doubao-seedream-4.5';
export const SEEDREAM_ENDPOINT='https://api.modelverse.cn/v1/images/generations';
export class ImageProviderError extends Error {
 constructor(code,{execution='unknown',usage=null,actualModel=null,elapsedMs=null}={}){super(code);this.code=code;this.execution=execution;this.usage=usage;this.actualModel=actualModel;this.elapsedMs=elapsedMs;}
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
export class SeedreamProvider {
 constructor({apiKey=()=>process.env.IMAGE_API_KEY,fetchImpl=fetch,timeoutMs=60000,referenceHosts=[],imageReader=readImage}={}){Object.assign(this,{apiKey,fetchImpl,timeoutMs,referenceHosts,imageReader});}
 available(){return Boolean(this.apiKey());}
 async generate({prompt,references=[],product}){
  const key=this.apiKey();if(!key)throw new ImageProviderError('IMAGE_NOT_CONFIGURED',{execution:'not_submitted'});
  const images=[];
  // 仅服务端核实的规格与使用依据可以进入参考图输入，永不接客户端URL或许可自声明。
  for(const ref of references){
   if(references.length>2||!product||ref.product_id!==product.product_id||ref.variant!==product.variant||ref.permission?.status!=='approved'||!ref.permission.usage_basis||!ref.permission.evidence_ref)throw new ImageProviderError('IMAGE_REFERENCE_NOT_AUTHORIZED',{execution:'not_submitted'});
   try{const {bytes,type}=await this.imageReader(ref.url,{hosts:this.referenceHosts,maxBytes:5000000,timeoutMs:5000});inspectRaster(bytes);images.push(`data:${type};base64,${bytes.toString('base64')}`);}
   catch{throw new ImageProviderError('IMAGE_REFERENCE_BLOCKED',{execution:'not_submitted'});}
  }
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>6000)throw new ImageProviderError('IMAGE_PROMPT_INVALID',{execution:'not_submitted'});
  const body={model:SEEDREAM_MODEL,prompt,size:'2K',sequential_image_generation:'disabled',stream:false,response_format:'b64_json',watermark:true,...(images.length?{images}:{})};
  const started=performance.now();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  let metadata={};
  try{
   const response=await this.fetchImpl(SEEDREAM_ENDPOINT,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   if(!response.ok)throw new ImageProviderError('IMAGE_PROVIDER_HTTP',{execution:[400,401,403,422,429].includes(response.status)?'rejected':'unknown'});
   const data=await boundedJson(response);metadata={usage:usageOnly(data.usage),actualModel:typeof data.model==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(data.model)?data.model:null};
   if(data.error||!Array.isArray(data.data)||data.data.length!==1||data.data[0].error)throw new ImageProviderError('IMAGE_PROVIDER_FAILED',{execution:'failed',...metadata});
   const b64=data.data[0].b64_json;
   if(typeof b64!=='string'||b64.length>22000000||!b64.length||b64.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(b64))throw new ImageProviderError('IMAGE_RESPONSE_INVALID',{...metadata});
   const bytes=Buffer.from(b64,'base64');const raster=inspectRaster(bytes);
   const reportedSize=typeof data.data[0].size==='string'&&/^[0-9]{1,5}[x×][0-9]{1,5}$/.test(data.data[0].size)?data.data[0].size:null;
   if(reportedSize&&reportedSize.replace('×','x')!==`${raster.width}x${raster.height}`)throw new ImageProviderError('IMAGE_SIZE_MISMATCH',{execution:'succeeded_output_invalid',...metadata});
   return {bytes,...raster,actual_model:metadata.actualModel,usage:metadata.usage,reported_size:reportedSize,elapsed_ms:Math.round(performance.now()-started),reference_count:images.length};
  }catch(error){
   if(error instanceof ImageProviderError){error.elapsedMs=Math.round(performance.now()-started);throw error;}
   throw new ImageProviderError(controller.signal.aborted?'IMAGE_EXECUTION_UNKNOWN':'IMAGE_RESPONSE_UNCERTAIN',{execution:'unknown',...metadata,elapsedMs:Math.round(performance.now()-started)});
  }finally{clearTimeout(timer);}
 }
}
