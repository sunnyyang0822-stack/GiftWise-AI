import { randomUUID } from 'node:crypto';
export function validatePlan(p) {
 if (!p || Object.keys(p).some(k=>!['category','keywords','limit'].includes(k)) || !['books','stationery','home'].includes(p.category) || !Array.isArray(p.keywords) || p.keywords.length>3 || p.keywords.some(s=>typeof s!=='string'||! /^[\p{L}\p{N} ]{1,30}$/u.test(s)) || !Number.isInteger(p.limit)||p.limit<1||p.limit>3) throw new Error('INVALID_RETRIEVAL_PLAN');
 return structuredClone(p);
}
export class RetrievalWorker {
 constructor(provider,{queueLimit=4,timeoutMs=15000}={}) { this.provider=provider;this.limit=queueLimit;this.timeout=timeoutMs;this.queue=[];this.active=false;this.poisoned=false; }
 submit(plan,{signal}={}) {
  plan=validatePlan(plan);
  if(this.poisoned)return Promise.resolve({status:"unavailable",evidence_id:null,products:[],warnings:["检索器需维护者重启"]});
  if(this.queue.length>=this.limit) return Promise.reject(new Error('RETRIEVAL_QUEUE_FULL'));
  return new Promise((resolve,reject)=>{this.queue.push({plan,signal,resolve,reject});this.drain();});
 }
 async drain() {
  if(this.active)return;this.active=true;
  while(this.queue.length){const j=this.queue.shift();const c=new AbortController();let timer;
   try {if(this.poisoned||j.signal?.aborted)throw new Error('RETRIEVAL_CANCELLED');
    const cancel=()=>c.abort();j.signal?.addEventListener('abort',cancel,{once:true});
    try { const abort=new Promise((_,reject)=>c.signal.addEventListener('abort',()=>reject(new Error('RETRIEVAL_ABORTED')),{once:true}));
     timer=setTimeout(()=>c.abort(),this.timeout);
     const result=await Promise.race([this.provider.search(j.plan,{signal:c.signal,taskId:randomUUID()}),abort]);
     j.resolve(structuredClone(result));
    } finally {j.signal?.removeEventListener('abort',cancel);}
   }catch {if(c.signal.aborted)this.poisoned=true;j.resolve({status:'unavailable',evidence_id:null,products:[],warnings:['后台检索失败、取消或超时；价格未核实']});}
   finally {clearTimeout(timer);}
  }this.active=false;
 }
}
export const unavailableProvider={async search(){return {status:'unavailable',evidence_id:null,products:[],warnings:['后台商品来源尚未验证；未获取实时价格']};}};
export function cents(s){if(typeof s!=='string'||!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s))throw new Error('INVALID_PRICE');const [a,b='']=s.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
export function checkPrice(product,budget){if(!product||product.price_conditions?.length||product.price_source==='unknown')return 'unknown';const price=product.price_range?.max??product.price_amount;if(price==null)return 'unknown';return cents(price)>cents(budget)?'over_budget':'within_budget';}
export function bindPrice(products,id,modelPrice,budget){const p=products.find(p=>p.product_id===id);if(!p)throw new Error('UNKNOWN_PRODUCT');if(p.price_amount!==modelPrice)throw new Error('PRICE_EVIDENCE_MISMATCH');return checkPrice(p,budget);}
