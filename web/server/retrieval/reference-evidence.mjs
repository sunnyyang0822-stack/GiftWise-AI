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
