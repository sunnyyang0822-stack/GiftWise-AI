import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// 固定只读公开练习来源；不接受用户URL、脚本、shell或个人profile。
export class OpenCliDemoProvider {
 constructor(packageRoot){this.packageRoot=packageRoot;}
 async search(plan,{signal}) {
  if(plan.category!=='books')return {status:'unavailable',evidence_id:null,products:[],warnings:['当前仅配置公开练习书籍来源；不是真实商品报价']};
  return new Promise(resolve=>{
   execFile(process.execPath,[fileURLToPath(new URL('../../../research/opencli-prototype/probe.mjs',import.meta.url))],{shell:false,signal,timeout:25000,maxBuffer:32000,env:{...process.env,OPENCLI_PACKAGE_ROOT:this.packageRoot}},(err,stdout)=>{
    if(err){resolve({status:'unavailable',evidence_id:null,products:[],warnings:['专用浏览器读取失败']});return;}
    let records;try{records=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));}catch{resolve({status:'unavailable',evidence_id:null,products:[],warnings:['浏览器响应无效']});return;}
    resolve({status:'unavailable',evidence_id:null,products:[],warnings:['公开练习站读取成功，但价格随机且为GBP，不作为CNY商品价格证据'],demo_evidence:records});
   });
  });
 }
}
