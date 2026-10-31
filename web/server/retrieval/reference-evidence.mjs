import {publicReferenceUrl} from '../collect/public-reference.mjs';
import {isAllowedReferenceImageUrl} from '../collect/domestic-detail.mjs';

/** A retained image must still satisfy the source and image URL boundaries. */
export function isVerifiedReference(record) {
 return record?.reference_kind==='public_reference'&&!!publicReferenceUrl(record.source_url,'bing')&&
  record.image_kind==='reference_image'&&record.image_validation?.ok===true&&
  record.image_validation.width>0&&record.image_validation.height>0&&/^[a-f0-9]{32,64}$/.test(record.image_id??'')&&
  [record.image_url,record.image_validation.final_url].every(url=>url==null||isAllowedReferenceImageUrl(url));
}

/** Keep the entire first verified observation, never splice new URLs into old validation. */
export function mergeReferenceEvidence(previous=[],observations=[]) {
 const records=new Map();
 for(const record of [...previous,...observations]){
  if(!record||typeof record.reference_id!=='string')continue;
  if(!isVerifiedReference(records.get(record.reference_id)))records.set(record.reference_id,structuredClone(record));
 }
 return [...records.values()];
}

/** Explicit model citations bind public inspiration, never SKU evidence. */
export function bindReferenceEvidence(records=[],candidates=[],references=[]) {
 const bindings=new Map(),rejected=[],seen=new Set();
 for(const citation of Array.isArray(references)?references:[])try{
  const id=citation?.candidate_id,referenceId=citation?.reference_id;
  if(!candidates.some(c=>c.id===id)||references.filter(r=>r?.candidate_id===id).length!==1||seen.has(referenceId))throw Error('AMBIGUOUS_REFERENCE');
  const matches=records.filter(r=>r.reference_id===referenceId&&r.reference_kind==='public_reference');
  if(matches.length!==1)throw Error('UNKNOWN_REFERENCE');
  const record=matches[0],url=new URL(record.source_url);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('INVALID_REFERENCE_URL');
  bindings.set(id,record);seen.add(referenceId);
 }catch(error){rejected.push({candidate_id:citation?.candidate_id??null,code:error.message});}
 return{bindings,rejected};
}
