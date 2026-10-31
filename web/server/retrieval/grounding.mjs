import {publicReferenceUrl} from '../collect/public-reference.mjs';

/** Structural provenance only. Relevance and creative use remain model judgments. */
export function isGroundingMaterial(record) {
 try{
  const url=new URL(record?.source_url);
  return record.reference_kind==='public_reference'&&record.has_summary!==false&&record.material_kind!=='image_reference'&&/^[a-zA-Z0-9_-]{1,96}$/.test(record.reference_id??'')&&
   url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!!publicReferenceUrl(url.href,'bing')&&
   typeof record.title==='string'&&!!record.title.trim()&&typeof record.summary==='string'&&!!record.summary.trim()&&
   typeof record.observed_at==='string'&&Number.isFinite(Date.parse(record.observed_at));
 }catch{return false;}
}

export function isGroundingProduct(record){
 try{const u=new URL(record?.source_url??record?.product_url);return /^[a-zA-Z0-9_-]{1,96}$/.test(record.product_id??'')&&typeof (record.title??record.name)==='string'&&!!(record.title??record.name).trim()&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^(?:www\.)?dianping\.com$/.test(u.hostname)&&/^\/shop\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)&&typeof record.observed_at==='string'&&Number.isFinite(Date.parse(record.observed_at));}catch{return false;}
}

export function confirmedGrounding(candidates,citations,records,materialIds=[],products=[],productCitations=[]) {
 const known=new Map(records.filter(isGroundingMaterial).map(r=>[r.reference_id,r]));
 const ids=new Set((Array.isArray(citations)?citations:[]).filter(c=>candidates?.some(v=>v.id===c?.candidate_id)&&known.has(c.reference_id)).map(c=>c.reference_id));
 for(const id of Array.isArray(materialIds)?materialIds:[])if(known.has(id))ids.add(id);
 const observed=new Set(products.filter(isGroundingProduct).map(p=>p.product_id));
 const productIds=[...new Set((Array.isArray(productCitations)?productCitations:[]).filter(c=>candidates?.some(v=>v.id===c?.candidate_id)&&observed.has(c.product_id)).map(c=>c.product_id))];
 return {status:ids.size||productIds.length?'grounded':'unconfirmed',reference_ids:[...ids],product_ids:productIds};
}
