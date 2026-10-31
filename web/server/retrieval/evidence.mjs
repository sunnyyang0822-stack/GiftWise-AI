import {unknownPhysical,validatePhysical} from '../media/scene.mjs';
import { randomUUID } from 'node:crypto';
import { cents,checkPrice } from './worker.mjs';
import { isDomesticProduct } from '../catalog/db.mjs';
function deepFreeze(v){if(v&&typeof v==='object'){for(const child of Object.values(v))deepFreeze(child);Object.freeze(v);}return v;}
// 只由服务端来源适配器调用，不接受客户端或模型上传的证据。
export function freezeEvidence(records,{source='unknown',now=new Date().toISOString(),taskId=null}={}) {
 if(!Array.isArray(records)||records.length>3)throw new Error('EVIDENCE_LIMIT');
 if(!['browser_observed','user_provided','seed','unknown'].includes(source))throw new Error('INVALID_SOURCE');
 const products=records.map(r=>{
  if(typeof r.name!=='string'||!r.name.trim()||typeof r.variant!=='string'||!Number.isInteger(r.quantity)||r.quantity<1||r.currency!=='CNY'||!Array.isArray(r.price_conditions)||r.price_conditions.some(c=>typeof c!=='string'))throw new Error('INVALID_PRODUCT');
  if(r.price_amount!==null)cents(r.price_amount);
  if(r.price_range){if(cents(r.price_range.min)>cents(r.price_range.max))throw new Error('INVALID_RANGE');}
  if(source==='browser_observed'&&(!r.evidence_ref||!r.source_url||r.page_kind!=='detail'||!Number.isFinite(Date.parse(r.observed_at??now))))throw new Error('DETAIL_EVIDENCE_REQUIRED');
  if(r.source_url){const u=new URL(r.source_url);if(u.protocol!=='https:'||u.username||u.password)throw new Error('INVALID_SOURCE_URL');}
  const physical=structuredClone(r.physical??unknownPhysical());validatePhysical(physical);deepFreeze(physical);
  return Object.freeze({physical,product_id:randomUUID(),name:r.name,variant:r.variant,quantity:r.quantity,price_amount:r.price_amount,price_range:r.price_range?Object.freeze({...r.price_range}):null,currency:'CNY',price_conditions:Object.freeze([...r.price_conditions]),price_source:source,source_url:r.source_url??null,observed_at:source==='browser_observed'?(r.observed_at??now):null,image_id:null,shipping_status:'unknown',stock_status:r.stock_status==='out_of_stock'?'out_of_stock':'unknown',evidence_ref:r.evidence_ref??null});
 });
 return Object.freeze({status:products.length===3?'ready':products.length?'partial':'unavailable',evidence_id:randomUUID(),products:Object.freeze(products),warnings:Object.freeze(source==='seed'?['估算·非实时价格']:[])});
}
export function bindCandidates(evidence,references,budget){
 const bindings=new Map();
 for(const ref of references){if(bindings.has(ref.candidate_id))throw new Error('DUPLICATE_CANDIDATE');const p=evidence.products.find(p=>p.product_id===ref.product_id);if(!p)throw new Error('UNKNOWN_PRODUCT');if(p.price_amount!==ref.estimated_total)throw new Error('PRICE_EVIDENCE_MISMATCH');if(p.stock_status==='out_of_stock')throw new Error('PRODUCT_OUT_OF_STOCK');if(checkPrice(p,budget)!=='within_budget')throw new Error('PRICE_NOT_VERIFIED_WITHIN_BUDGET');bindings.set(ref.candidate_id,p);}
 return bindings;
}

export function verifyCandidateEvidence(evidence,candidates,references,budget){
 if(!Array.isArray(candidates)||!Array.isArray(references)||references.length!==candidates.length)throw new Error('PRODUCT_REFERENCES_REQUIRED');
 if(evidence.products.some(p=>p.price_source==='browser_observed'&&(!Number.isFinite(Date.parse(p.observed_at))||Date.now()-Date.parse(p.observed_at)>600000||Date.parse(p.observed_at)>Date.now()+60000)))throw new Error('EVIDENCE_STALE');
 const seen=new Set();const refs=candidates.map(c=>{const matches=references.filter(r=>r.candidate_id===c.id);if(matches.length!==1)throw new Error('PRODUCT_REFERENCES_REQUIRED');const r=matches[0];if(Object.keys(r).some(k=>!['candidate_id','product_id'].includes(k)))throw new Error('INVALID_PRODUCT_REFERENCE');if(seen.has(r.product_id))throw new Error('DUPLICATE_PRODUCT');seen.add(r.product_id);const product=evidence.products.find(p=>p.product_id===r.product_id);if(!product||c.name!==product.name+' · '+product.variant)throw new Error('PRODUCT_SPEC_MISMATCH');return {...r,estimated_total:c.estimated_total};});
 return bindCandidates(evidence,refs,budget);
}

/** Optional references enrich individual suggestions; missing/stale references never reject a batch. */
export function bindOptionalCandidateEvidence(evidence, candidates, references, budget) {
 const bindings=new Map(), rejected=[];
 if(!Array.isArray(references))return {bindings,rejected};
 const seen=new Set();
 for(const reference of references){
  try{
   if(!reference||seen.has(reference.product_id))throw new Error('DUPLICATE_PRODUCT');
   const candidate=candidates.find(c=>c.id===reference.candidate_id);
   if(!candidate||references.filter(r=>r?.candidate_id===candidate.id).length!==1)throw new Error('INVALID_PRODUCT_REFERENCE');
   const product=evidence.products?.find(p=>p.product_id===reference.product_id);
   if(!product)throw new Error('UNKNOWN_PRODUCT');
   if(product.price_source==='browser_observed'&&!isDomesticProduct({...product,source_site:product.source_site??new URL(product.source_url).hostname,product_url:product.source_url}))throw new Error('FOREIGN_PURCHASE_SOURCE');
   if(candidate.name!==product.name+' · '+product.variant)throw new Error('PRODUCT_SPEC_MISMATCH');
   if(product.price_amount!==null&&candidate.estimated_total!==product.price_amount)throw new Error('PRICE_EVIDENCE_MISMATCH');
   if(product.price_source==='browser_observed'&&(!Number.isFinite(Date.parse(product.observed_at))||Date.now()-Date.parse(product.observed_at)>600000))throw new Error('EVIDENCE_STALE');
   // This binds an observed item/photo, not a claim that conditional prices are universally available.
   bindings.set(candidate.id,product);seen.add(product.product_id);
  }catch(error){rejected.push({candidate_id:reference?.candidate_id??null,code:error.message});}
 }
 return {bindings,rejected};
}
