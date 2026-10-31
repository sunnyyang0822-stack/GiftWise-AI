import {randomUUID} from 'node:crypto';
import {unknownPhysical,validateScene} from './scene.mjs';
export function emptyMedia(){return {contract_version:'retrieval-media-v2',status:'unavailable',candidates:[],selected:null};}
export class MediaProvider {
 constructor(){this.jobs=new WeakMap();}
 candidates(bindings=[]){return {...emptyMedia(),candidates:bindings.map(b=>({...b,image:null}))};}
 async packaging(run,id){
  if(run.selected_candidate_id!==id||!run.selectable_candidate_ids.includes(id))throw new Error('INVALID_SELECTION');
  let jobs=this.jobs.get(run);if(!jobs){jobs=new Map();this.jobs.set(run,jobs);}
  if(!jobs.has(id)){
   const product=run.product_bindings?.get(id);
   const selected=validateScene({task_id:randomUUID(),status:'unavailable',candidate_id:id,product_id:product?.product_id??null,image:null,physical:structuredClone(product?.physical??unknownPhysical()),packaging:{form:'undetermined',description:null,scale:{status:'illustrative',note:'尺寸与包装比例未核实；不保证容纳或运输安全'}},scene:{description:null,props:[],props_are_included:false,text_baked_in:false},annotations:[],unknowns:['图像生成服务及费用未授权','包装形式需依据形状、尺寸、重量、易碎性确认']});
   jobs.set(id,Promise.resolve({...emptyMedia(),selected}));
  }
  return jobs.get(id);
 }
}
export const mediaProvider=new MediaProvider();
