import { randomUUID } from 'node:crypto';
import {DOMESTIC_CONTENT_SOURCES} from '../collect/domestic-content.mjs';
export function validatePlan(p) {
 if(p?.category==='domestic') {
  if(!Array.isArray(p.queries)||p.queries.some(q=>!q||typeof q.keyword!=='string'||!q.keyword.trim()||q.keyword.length>200||q.city!=null&&typeof q.city!=='string'||q.sources!=null&&(!Array.isArray(q.sources)||q.sources.some(s=>typeof s!=='string'))))throw new Error('INVALID_RETRIEVAL_PLAN');
  return structuredClone(p);
 }
 if (!p || Object.keys(p).some(k=>!['category','keywords','limit'].includes(k)) || !['books','stationery','home','maker'].includes(p.category) || !Array.isArray(p.keywords) || p.keywords.length>3 || p.keywords.some(s=>typeof s!=='string'||! /^[\p{L}\p{N} ]{1,30}$/u.test(s)) || !Number.isInteger(p.limit)||p.limit<1||p.limit>3) throw new Error('INVALID_RETRIEVAL_PLAN');
 return structuredClone(p);
}
export class RetrievalWorker {
 constructor(provider,{queueLimit=4,timeoutMs=15000}={}) { this.provider=provider;this.limit=queueLimit;this.timeout=timeoutMs;this.queue=[];this.active=false;this.running=0;this.parallelReference=false;this.poisoned=false; }
 submit(plan,{signal,providerOptions}={}) {
  plan=validatePlan(plan);
  if(this.poisoned)return Promise.resolve({status:"unavailable",evidence_id:null,products:[],warnings:["检索器需维护者重启"]});
  if(this.queue.length>=this.limit) return Promise.reject(new Error('RETRIEVAL_QUEUE_FULL'));
  return new Promise((resolve,reject)=>{this.queue.push({plan,signal,providerOptions,resolve,reject});this.drain();});
 }
 drain() {
  while(this.queue.length){
   const plan=this.queue[0].plan;
   const reference=plan.category==='domestic'&&plan.queries?.length>0&&plan.queries.every(q=>q.purpose==='inspiration'&&q.sources?.length>0&&q.sources.every(s=>s==='web'||Object.hasOwn(DOMESTIC_CONTENT_SOURCES,s)));
   // Only stateless public HTTP queries share a bounded lane. Browser/purchase work stays exclusive.
   if(this.running&&(!reference||!this.parallelReference||this.running>=3))return;
   const j=this.queue.shift();this.running++;this.active=true;this.parallelReference=reference;
   this.runJob(j).finally(()=>{this.running--;this.active=this.running>0;this.drain();});
   if(!reference)return;
  }
 }
 async runJob(j) {
   const c=new AbortController();let timer;
   try {if(this.poisoned||j.signal?.aborted)throw new Error('RETRIEVAL_CANCELLED');
    const cancel=()=>c.abort();j.signal?.addEventListener('abort',cancel,{once:true});
    try { const abort=new Promise((_,reject)=>c.signal.addEventListener('abort',()=>reject(new Error('RETRIEVAL_ABORTED')),{once:true}));
     timer=setTimeout(()=>c.abort(),this.timeout);
     const result=await Promise.race([this.provider.search(j.plan,{...j.providerOptions,timeoutMs:Math.max(1,this.timeout-1000),signal:c.signal,taskId:randomUUID()}),abort]);
     j.resolve(structuredClone(result));
    } finally {j.signal?.removeEventListener('abort',cancel);}
   }catch {j.resolve({status:'unavailable',evidence_id:null,products:[],warnings:['补充检索暂不可用，仍可继续模型建议'],recommendations_available:true,enrichment_only:true});}
   finally {clearTimeout(timer);}
  }
}
export const unavailableProvider={async search(){return {status:'unavailable',evidence_id:null,products:[],warnings:['后台商品来源尚未验证；未获取实时价格']};}};
export function cents(s){if(typeof s!=='string'||!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s))throw new Error('INVALID_PRICE');const [a,b='']=s.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
export function checkPrice(product,budget){if(!product||product.price_conditions?.length||product.price_source==='unknown')return 'unknown';const price=product.price_range?.max??product.price_amount;if(price==null)return 'unknown';return cents(price)>cents(budget)?'over_budget':'within_budget';}
export function bindPrice(products,id,modelPrice,budget){const p=products.find(p=>p.product_id===id);if(!p)throw new Error('UNKNOWN_PRODUCT');if(p.price_amount!==modelPrice)throw new Error('PRICE_EVIDENCE_MISMATCH');return checkPrice(p,budget);}
