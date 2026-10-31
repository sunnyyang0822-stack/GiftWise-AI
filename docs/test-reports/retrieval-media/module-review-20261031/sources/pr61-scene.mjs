const fields=['dimensions','shape','weight','fragility','materials'];
export const unknownPhysical=()=>Object.fromEntries(fields.map(k=>[k,{status:'unknown',value:null,unit:null,sources:[]}]));
const point=p=>p&&Object.keys(p).length===2&&['x','y'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1);
function fail(){throw new Error('MEDIA_SCENE_INVALID');}
export function validatePhysical(physical){
 if(!physical||Object.keys(physical).length!==5)fail();
 for(const key of fields){const p=physical[key];if(!p||!['known','unknown','conflicting','suggested'].includes(p.status)||!Array.isArray(p.sources)||p.sources.length>5)fail();
  if(p.status==='unknown'){if(p.value!==null||p.unit!==null||p.sources.length)fail();continue;}
  if(p.status==='conflicting'){if(p.value!==null||p.unit!==null||p.sources.length<2)fail();}
  else {
   if(!p.sources.length)fail();
   if(key==='dimensions'){if(!p.value||!Object.keys(p.value).length||Object.keys(p.value).some(k=>!['length','width','height','diameter'].includes(k))||Object.values(p.value).some(n=>typeof n!=='number'||!Number.isFinite(n)||n<=0)||!['mm','cm','m'].includes(p.unit))fail();}
   else if(key==='weight'){if(typeof p.value!=='number'||!Number.isFinite(p.value)||p.value<=0||!['g','kg'].includes(p.unit))fail();}
   else {if(p.unit!==null)fail();if(key==='shape'&&(typeof p.value!=='string'||!p.value.trim()||p.value.length>100))fail();if(key==='fragility'&&!['fragile','not_fragile'].includes(p.value))fail();if(key==='materials'&&(!Array.isArray(p.value)||p.value.length>10||p.value.some(s=>typeof s!=='string'||s.length>100)))fail();}
  }
  for(const source of p.sources){if(source?.context!==undefined&&(typeof source.context!=='string'||[...source.context].length>200))fail();if(!source||!['browser_observed','user_provided','model_suggestion'].includes(source.kind)||typeof source.evidence_ref!=='string'||!source.evidence_ref)fail();if(p.status==='known'&&(source.kind==='model_suggestion'||source.unit!==p.unit||JSON.stringify(source.value)!==JSON.stringify(p.value)))fail();if(p.status==='suggested'&&source.kind!=='model_suggestion')fail();if(source.kind==='browser_observed'){let u;try{u=new URL(source.source_url);}catch{fail();}if(u.protocol!=='https:'||u.username||u.password||!Number.isFinite(Date.parse(source.observed_at)))fail();}}
 }
 return physical;
}
export function validateScene(s){
 if(!s||typeof s.task_id!=='string'||typeof s.candidate_id!=='string'||!['pending','ready','failed','unavailable'].includes(s.status))fail();validatePhysical(s.physical);
 if(!s.packaging||!['gift_bag','paper_wrap','cylinder','bouquet','transparent_display','irregular','combination','undetermined'].includes(s.packaging.form)||!['evidence_based','illustrative','needs_input'].includes(s.packaging.scale?.status)||typeof s.packaging.scale.note!=='string')fail();
 if(['unknown','conflicting','suggested'].includes(s.physical.dimensions.status)&&s.packaging.scale.status==='evidence_based')fail();
 if(!s.scene||s.scene.props_are_included!==false||s.scene.text_baked_in!==false||!Array.isArray(s.scene.props)||s.scene.props.length>10||s.scene.props.some(t=>typeof t!=='string')||!Array.isArray(s.unknowns)||s.unknowns.some(t=>typeof t!=='string')||!Array.isArray(s.annotations)||s.annotations.length>5)fail();
 if(s.image===null){if(s.annotations.length||s.status==='ready')fail();return s;}
 if(!s.image||typeof s.image.version!=='string'||!s.image.version||s.image.kind!=='ai_illustration'||!s.image.alt?.includes('AI包装效果示意'))fail();
 const ids=new Set();for(const a of s.annotations){if(!a||typeof a.id!=='string'||ids.has(a.id)||a.image_version!==s.image.version||typeof a.text!=='string'||![...a.text].length||[...a.text].length>30||/[<>\n\r]/.test(a.text)||a.text_style!=='handwritten'||!point(a.target)||!point(a.label))fail();ids.add(a.id);if(a.curve!==null&&(!Array.isArray(a.curve?.control_points)||![1,2].includes(a.curve.control_points.length)||a.curve.control_points.some(p=>!point(p))))fail();}
 return s;
}
