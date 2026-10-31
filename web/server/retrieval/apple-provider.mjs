import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {freezeEvidence} from './evidence.mjs';
export class ApplePublicProvider {
 constructor(packageRoot){this.packageRoot=packageRoot;}
 search(plan,{signal}){
  // 单一已验证详情来源；不将用户文字传入浏览器或命令。
  if(plan.category!=='home')return Promise.resolve({status:'unavailable',evidence_id:null,products:[],warnings:['当前来源不覆盖该品类']});
  return new Promise(resolve=>execFile(process.execPath,[fileURLToPath(new URL('../../../../research/opencli-prototype/apple-read.mjs',import.meta.url))],{shell:false,signal,timeout:22000,maxBuffer:16000,env:{...process.env,OPENCLI_PACKAGE_ROOT:this.packageRoot}},(err,stdout)=>{
   try{if(err)throw err;const data=JSON.parse(stdout);const e=freezeEvidence(data.products,{source:'browser_observed',now:data.observed_at});resolve({...e,warnings:[...data.warnings,'仅固定商品详情读取；通用搜索尚未接入，不能凑足三种不同礼物']});}
   catch{resolve({status:'unavailable',evidence_id:null,products:[],warnings:['公开来源读取失败，未采用价格']});}
  }));
 }
}
