// Offline data/protocol fixtures only. This file never starts browsers or calls a model.
import test from'node:test';
import assert from'node:assert/strict';
import{mkdtempSync,readFileSync,readdirSync,writeFileSync,existsSync}from'node:fs';
import{join}from'node:path';
import{REPO_ROOT}from'../server/localdb/db.mjs';
import{taskDirectory}from'../server/collect/task-paths.mjs';
import{createRetrievalAudit}from'../server/retrieval/audit-store.mjs';
import{createOpencliToolSession}from'../server/retrieval/agent-tool.mjs';
const parent=taskDirectory(join(REPO_ROOT,'.tmp/audit-unit'));
const dir=()=>mkdtempSync(join(parent,'case-'));
const read=(directory,audit)=>JSON.parse(readFileSync(join(directory,audit.receipt.retrieval_session_id+'.json'),'utf8'));
const entry=(keyword='陶艺造型')=>({name:'opencli_search',status:'partial',plan:{queries:[{purpose:'reference',sources:['bing'],keyword,reason:'DO_NOT_LOG_INTERNAL_REASON'}]}});

test('先落盘工具事实，最终run与采用图片关联；白名单脱敏不存认证/原文/reason',()=>{
 const directory=dir(),audit=createRetrievalAudit({directory,sensitiveValues:['小明','虹桥路99号']});
 const secret='PRIVATE_RAW_BODY_NOT_ALLOWED';
 audit.recordTool(entry('小明 13812345678 abc@example.com 虹桥路99号 token=credential 陶艺'),{status:'partial',headers:{Cookie:'credential'},body:secret,references:[{reference_id:'ref_fixture',image_id:'a'.repeat(32),source_url:'https://www.bilibili.com/video/BVfixture/?token=credential&userid=123&sign=private',image_validation:{ok:true,mime:'image/jpeg',width:672,height:378,sha256:'b'.repeat(64)}},{reference_id:'ref_bad',source_url:'https://outside.example/secret',image_validation:{ok:false,error_code:'IMAGE_MIME_NOT_ALLOWED'}}],coverage:[{source:'bing',status:'ok',pages_completed:1,observed_count:2,complete:false,limitations:[secret],execution_mode:'public_dom'}]});
 let saved=read(directory,audit);assert.equal(saved.run_id,null);assert.equal(saved.calls_total,1);assert.equal(saved.calls[0].returned_counts.references,2);assert.equal(saved.calls[0].validated_images_total,1);assert.equal(saved.calls[0].image_error_counts.IMAGE_MIME_NOT_ALLOWED,1);assert.equal(saved.calls[0].validated_images[0].source_url,'https://www.bilibili.com/video/BVfixture/');
 const bytes=JSON.stringify(saved);for(const banned of ['小明','13812345678','abc@example.com','虹桥路99号','credential','PRIVATE_RAW_BODY','DO_NOT_LOG_INTERNAL_REASON','userid','sign=','Cookie'])assert.equal(bytes.includes(banned),false,banned);
 audit.finalize({runId:'gw-fixture-1',bindings:[{candidate_id:'c1',reference_id:'ref_fixture',image:{id:'a'.repeat(32),kind:'reference_image'}}],rejected:[{candidate_id:'c2',code:'UNKNOWN_REFERENCE',secret}]});
 saved=read(directory,audit);assert.equal(saved.run_id,'gw-fixture-1');assert.equal(saved.status,'completed');assert.equal(saved.adopted_references[0].reference_id,'ref_fixture');assert.equal(saved.rejected_references[0].code,'UNKNOWN_REFERENCE');assert.equal(audit.receipt.status,'saved');
});
test('工具失败/取消返回前已保存明确状态；取消不查询，部分资料不被审计清空',async()=>{
 for(const cancelled of [false,true]){
  const directory=dir(),audit=createRetrievalAudit({directory}),controller=new AbortController();let calls=0;
  if(cancelled)controller.abort();
  const session=createOpencliToolSession({auditStore:audit,signal:controller.signal,search:async()=>{calls++;throw Object.assign(Error('private failure body'),{code:'SOURCE_TIMEOUT'});}});
  const result=await session.executeTool({id:'offline',name:'opencli_search',arguments:{purpose:'reference',sources:['bing'],keyword:'离线灵感',reason:'private reason'}});
  assert.equal(result.recommendations_available,true);const saved=read(directory,audit);assert.equal(saved.calls_total,1);assert.equal(saved.calls[0].queries[0].keyword,'离线灵感');assert.equal(saved.calls[0].error_code,cancelled?'RETRIEVAL_CANCELLED':'SOURCE_TIMEOUT');assert.equal(saved.calls[0].status,cancelled?'cancelled':'unavailable');assert.equal(calls,cancelled?0:1);
  session.finalize({status:cancelled?'cancelled':'failed',errorCode:'MODEL_NOT_COMPLETED'});assert.equal(read(directory,audit).status,cancelled?'cancelled':'failed');
 }
});
test('写入失败/越界只返回内部诊断，不阻断工具或伪称审计已成功',async()=>{
 const directory=dir(),blocked=join(directory,'file-not-directory');writeFileSync(blocked,'fixture');
 const diagnostics=[],audit=createRetrievalAudit({directory:blocked,onDiagnostic:c=>diagnostics.push(c)});
 const session=createOpencliToolSession({auditStore:audit,search:async()=>({status:'partial',products:[],references:[],coverage:[{source:'bing',status:'empty'}]})});
 const result=await session.executeTool({name:'opencli_search',arguments:{purpose:'reference',keyword:'离线',sources:['bing'],reason:'fixture'}});
 assert.equal(result.status,'partial');assert.equal(result.recommendations_available,true);assert.equal(session.persistence.status,'failed');assert.deepEqual(diagnostics,['AUDIT_WRITE_FAILED']);
 const outside=join(REPO_ROOT,'..','forbidden-retrieval-audit');const boundary=createRetrievalAudit({directory:outside,onDiagnostic:()=>{}});boundary.recordTool(entry(),{});assert.equal(boundary.receipt.code,'PATH_OUTSIDE_WORKTREE');assert.equal(existsSync(outside),false);
});
test('保留数量/调用/图片有界；仅清理自己命名记录，不删相邻文件',()=>{
 const directory=dir();writeFileSync(join(directory,'keep-me.txt'),'fixture');
 for(let i=0;i<4;i++)createRetrievalAudit({directory,maxFiles:2}).finalize({runId:'gw-'+i});
 assert.equal(readdirSync(directory).filter(n=>n.endsWith('.json')).length,2);assert.equal(readFileSync(join(directory,'keep-me.txt'),'utf8'),'fixture');
 const audit=createRetrievalAudit({directory,maxFiles:2});const refs=Array.from({length:25},(_,i)=>({reference_id:'ref-'+i,image_validation:{ok:true,mime:'image/png',width:1,height:1}}));
 for(let i=0;i<15;i++)audit.recordTool(entry('图片'.repeat(1000)),{references:refs});
 const saved=read(directory,audit);assert.equal(saved.calls_total,15);assert.equal(saved.calls.length,12);assert.equal(saved.calls_omitted,3);assert.equal(saved.calls[0].queries[0].keyword.length,200);assert.equal(saved.calls[0].validated_images_total,25);assert.equal(saved.calls[0].validated_images.length,10);assert.equal(saved.calls[0].images_omitted,15);assert.ok(Buffer.byteLength(JSON.stringify(saved))<=131072);
});
