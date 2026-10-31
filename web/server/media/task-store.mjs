import {mkdir,open,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const fingerprint=value=>createHash('sha256').update(value).digest('hex');
export class MediaTaskStore {
 constructor(root){this.root=resolve(root);this.instance=randomUUID();}
 taskPath(id){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('INVALID_MEDIA_TASK');return join(this.root,'tasks',id+'.json');}
 async create(record){
  await mkdir(join(this.root,'tasks'),{recursive:true});
  let file;try{file=await open(this.taskPath(record.task_id),'wx');}catch(error){if(error.code==='EEXIST')return {created:false,record:await this.read(record.task_id)};throw error;}
  try{await file.writeFile(JSON.stringify({...record,executor_instance:this.instance}));await file.sync();}finally{await file.close();}
  return {created:true,record:{...record,executor_instance:this.instance}};
 }
 async read(id){
  const record=JSON.parse(await readFile(this.taskPath(id),'utf8'));
  if(record.media.status==='pending'&&record.executor_instance!==this.instance){
   record.media.status=record.media.selected.status='failed';record.media.selected.execution='unknown';record.media.selected.error_code='IMAGE_EXECUTION_UNKNOWN';record.media.selected.unknowns.push('服务进程中断，供应商可能已执行；不会自动重试');
  }
  return record;
 }
 async save(record){const path=this.taskPath(record.task_id);const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(record));await rename(temp,path);}
 async saveAsset(bytes,extension){if(!['png','jpg'].includes(extension))throw new Error('IMAGE_TYPE_INVALID');const hash=fingerprint(bytes);await mkdir(join(this.root,'assets'),{recursive:true});const path=join(this.root,'assets',hash+'.'+extension);await writeFile(path,bytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});return hash;}
 async readAsset(record){const {sha256,extension}=record.asset??{};if(!/^[a-f0-9]{64}$/.test(sha256)||!['png','jpg'].includes(extension))throw new Error('IMAGE_ASSET_MISSING');const bytes=await readFile(join(this.root,'assets',sha256+'.'+extension));if(fingerprint(bytes)!==sha256)throw new Error('IMAGE_ASSET_CORRUPT');return bytes;}
}
