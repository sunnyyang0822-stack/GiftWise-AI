export function emptyMedia(){return {status:'unavailable',candidates:[],selected:null};}
export class MediaProvider {
 constructor(){this.jobs=new WeakMap();}
 candidates(bindings=[]){return {status:'unavailable',candidates:bindings.map(b=>({...b,image:null})),selected:null};}
 async packaging(run,id){
  if(run.selected_candidate_id!==id||!run.selectable_candidate_ids.includes(id))throw new Error('INVALID_SELECTION');
  let jobs=this.jobs.get(run);if(!jobs){jobs=new Map();this.jobs.set(run,jobs);}
  if(!jobs.has(id))jobs.set(id,Promise.resolve({status:'unavailable',candidates:[],selected:null}));
  return jobs.get(id);
 }
}
export const mediaProvider=new MediaProvider();
