import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {freezeEvidence} from './evidence.mjs';
import {unknownPhysical} from '../media/scene.mjs';
export class DfrobotPublicProvider {
 constructor(packageRoot){this.packageRoot=packageRoot;}
 async search(plan,{signal,taskId}){
  if(plan.category!=='maker')return Promise.resolve({status:'unavailable',evidence_id:null,products:[],warnings:['当前来源仅覆盖确认科技兴趣的创客方向']});
  const base=resolve(tmpdir());const profile=await mkdtemp(join(base,"giftwise-retrieval-"));
  try{return await new Promise(resolve=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL('../../../research/opencli-prototype/dfrobot-read.mjs',import.meta.url))],{shell:false,windowsHide:true,stdio:['ignore','pipe','ignore'],env:Object.fromEntries(Object.entries({...Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','LOCALAPPDATA','USERPROFILE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),OPENCLI_PACKAGE_ROOT:this.packageRoot,GIFTWISE_TASK_PROFILE:profile,...(process.env.GIFTWISE_CHROME_PATH?{GIFTWISE_CHROME_PATH:process.env.GIFTWISE_CHROME_PATH}:{})}))});
   let output='',failed=false;const stop=()=>{failed=true;if(process.platform==='win32'&&child.pid)execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true},()=>{});else child.kill();};
   const timer=setTimeout(stop,48000);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
   child.stdout.on('data',b=>{output+=b;if(Buffer.byteLength(output)>32000)stop();});
   const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
   child.on('error',()=>{finish();resolve({status:'unavailable',evidence_id:null,products:[],warnings:['后台浏览器无法启动']});});
   child.on('close',code=>{finish();try{
    if(failed||code!==0)throw new Error('READ_FAILED');const data=JSON.parse(output);
    const records=data.products.slice(0,plan.limit).map(p=>{const physical=unknownPhysical();for(const [field,unit] of [['dimensions','mm'],['weight','g']]){const value=p.measurements?.[field];if(value!==null&&value!==undefined)physical[field]={status:'known',value,unit,sources:[{kind:'browser_observed',source_url:p.source_url,evidence_ref:p.evidence_ref,observed_at:p.observed_at,value,unit,context:field==='dimensions'?'组装后尺寸，不代表配送包装尺寸':'页面所列商品重量，非运输包装重量'}]};}return {...p,physical};});
    const evidence=freezeEvidence(records,{source:'browser_observed',taskId});resolve({...evidence,warnings:data.warnings});
   }catch{resolve({status:'unavailable',evidence_id:null,products:[],warnings:['公开来源读取失败，未采用价格']});}});
  });}finally{if(profile.startsWith(base+sep)&&profile!==base)await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200}).catch(()=>{});}
 }
}
