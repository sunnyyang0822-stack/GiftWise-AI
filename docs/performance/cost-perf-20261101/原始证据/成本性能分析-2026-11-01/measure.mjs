import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(base,'runtime');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(process.argv[2]==='child'){
 const out=process.env.MEASURE_OUT;
 const write=(file,obj)=>fs.appendFileSync(path.join(out,file),JSON.stringify(obj)+'\n');
 const realFetch=globalThis.fetch;
 globalThis.fetch=(url,opts)=>{if(!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)){write('network-blocked.jsonl',{host:new URL(url).hostname});throw Error('EXTERNAL_NETWORK_BLOCKED');}return realFetch(url,opts);};
 let phase='startup';
 const sample=()=>write('samples.jsonl',{at:new Date().toISOString(),phase,pid:process.pid,rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed,cpu_us:process.cpuUsage(),resource:process.resourceUsage()});
 const timer=setInterval(sample,100);sample();
 const {server}=await import(pathToFileURL(path.join(root,'web/server/server.mjs')));
 const importR=rel=>import(pathToFileURL(path.join(root,rel)));
 process.on('message',async msg=>{
  try{
   if(msg.phase){phase=msg.phase;sample();}
   if(msg.media){
    const {runPresentation}=await importR('web/server/pipeline.mjs');
    const {createRun}=await importR('web/server/store.mjs');
    const {validateForDecision}=await importR('web/server/checker.mjs');
    const {strictParse}=await importR('web/server/jsonstrict.mjs');
    const {mediaProvider}=await importR('web/server/media/provider.mjs');
    const {MediaTaskStore}=await importR('web/server/media/task-store.mjs');
    const {ImageProviderError}=await importR('web/server/media/seedream.mjs');
    let seq=0;
    mediaProvider.store=new MediaTaskStore(path.join(root,'.tmp','measured-media-'+process.pid));
    mediaProvider.jobs=new WeakMap();
    const seed=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64');
    mediaProvider.transport={available:()=>true,generate:async()=>{let n=++seq;await sleep(150);if(n%5===0)throw new ImageProviderError('IMAGE_EXECUTION_UNKNOWN',{execution:'unknown'});const bytes=Buffer.concat([seed,Buffer.alloc(800000,n)]);return {bytes,extension:'png',type:'image/png',width:1,height:1,actual_model:'fixture-only',reference_count:0};}};
    const request={contract_version:'giftwise-20261031-v2',recipient_relation:'朋友',recipient_relation_id:'friend',occasion:'生日',budget_amount:'800',currency:'CNY',available_days:null,facts:[],forbidden_tags:[],forbidden_terms:[],notes:''};
    const candidates=[1,2,3].map(n=>({id:'c'+n,name:'笔记本方向'+n,description:'不同设计'+n,estimated_total:'100.00',currency:'CNY',estimated_preparation_days:2,tags:['other'],reason:'日常心意',fact_refs:[],inferences:[],unknowns:[]}));
    const validation=validateForDecision(JSON.stringify(request),JSON.stringify({candidates}),strictParse);
    if(!validation.all_passed)throw Error('FIXTURE_VALIDATION_FAILED');
    const presentation={contract_version:'giftwise-20261031-v2',style:'自然轻松',packaging:{color_palette:['米白'],description:'受控呈现说明：无需新增包装，可直接交付所选礼物并附上贺卡。'},card_text:'生日快乐，愿你享受自己的节奏。',giving_advice:{timing:'方便时送出',wording:'一点小心意',relationship_cautions:[]},unknowns:[],currency:'CNY',revised_estimated_preparation_days:2};
    write('fixture.jsonl',{request,candidates,presentation,image_seed_bytes:seed.length,image_padding_bytes:800000,artificial_delay_ms:150,fail_every:5});
    for(let batch=0;batch<5;batch++)await Promise.all([0,1].map(async()=>{
      const run=createRun({owner_scope:'isolated-fixture',mode:'llm',media_generation_authorized:true,request,request_json:JSON.stringify(request),candidates,validation,status:'passed',selectable_candidate_ids:['c1','c2','c3'],repair_count:0,notices:[]});
      run.media=mediaProvider.candidates();run.catalog_bindings=new Map();run.product_bindings=new Map();
      const start=performance.now();
      const result=await runPresentation({runId:run.run_id,selectedCandidateId:'c1',ownerScope:run.owner_scope},{requestPresentation:async()=>({ok:true,outputs:{presentation_json:JSON.stringify(presentation)}})});
      if(result.kind!=='presentation'||result.view.media.status!=='pending')throw Error('FIXTURE_NOT_PENDING:'+JSON.stringify(result));
      const text=performance.now()-start;const record=await mediaProvider.wait(result.view.media.selected.task_id);
      write('media.jsonl',{run_id:run.run_id,text_ms:text,terminal_ms:performance.now()-start,status:record.media.status,execution:record.media.selected.execution,task_id:record.task_id});
    }));
   }
   if(msg.stop){clearInterval(timer);sample();server.close(()=>process.exit(0));}
   else process.send({done:msg.id});
  }catch(e){write('errors.jsonl',{error:e.stack});process.send({error:e.message,done:msg.id});}
 });
}else{
 const runDir=path.join(base,'runs',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(runDir,{recursive:true});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));if(port===8903)throw Error('FORBIDDEN_PORT');
 const env={};for(const key of ['SystemRoot','WINDIR','Path','PATHEXT','ComSpec'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{TEMP:runDir,TMP:runDir,USERPROFILE:runDir,APPDATA:runDir,LOCALAPPDATA:runDir,MEASURE_OUT:runDir,GW_HOST:'127.0.0.1',GW_PORT:String(port),GW_MODE:'mock',GIFTWISE_INTAKE_PARSE:'0',GIFTWISE_CATALOG_SCRAPE:'0',GIFTWISE_IMAGE_GENERATION:'0',GIFTWISE_STYLE_DIRECTION_CHANNEL:'rules',GIFTWISE_RETRIEVAL:'unavailable',GW_LOCAL_DB:path.join(root,'.tmp','nonexistent-'+process.pid+'.sqlite'),GW_LLM_LEDGER_FILE:path.join(root,'.tmp','measurement-'+process.pid+'.jsonl')});
 fs.writeFileSync(path.join(runDir,'conditions.json'),JSON.stringify({sha:'15e29edcc150c3a4a8a9ba04e9f0c8a2bb614879',node:process.version,os:os.type()+' '+os.release(),cpus:os.cpus().length,cpu:os.cpus()[0].model,totalmem:os.totalmem(),env_keys:Object.keys(env),port,period_ms:100,concurrency:2,http_tasks:20,media_tasks:10,scope:'Node server; no browser, no model, no external requests; client separate process'},null,2));
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'child'],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});
 child.stdout.on('data',x=>fs.appendFileSync(path.join(runDir,'stdout.txt'),x));child.stderr.on('data',x=>fs.appendFileSync(path.join(runDir,'stderr.txt'),x));
 let id=0;const command=msg=>new Promise((resolve,reject)=>{const key=++id;const timeout=setTimeout(()=>reject(Error('child command timed out')),15000);const cb=r=>{if(r.done===key){clearTimeout(timeout);child.off('message',cb);r.error?reject(Error(r.error)):resolve();}};child.on('message',cb);child.send({...msg,id:key});});
 const snapshot=()=>{const files={};function walk(d){if(!fs.existsSync(d))return;for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,x.name);if(x.isDirectory())walk(p);else files[path.relative(root,p)]=fs.statSync(p).size;}}walk(path.join(root,'.tmp'));return files;};
 const before=snapshot();
 try{
  let ready=false;for(let n=0;n<100;n++){try{const r=await fetch('http://127.0.0.1:'+port+'/api/config');if(r.ok){ready=true;break;}}catch{}await sleep(50);}if(!ready)throw Error('SERVER_NOT_READY');
  await command({phase:'idle'});await sleep(2000);
  await command({phase:'http-load'});
  const rows=[];const post=async(route,body,cookie='')=>{const t=performance.now();const payload=JSON.stringify(body);const r=await fetch('http://127.0.0.1:'+port+route,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:payload});return {status:r.status,json:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]??cookie,ms:performance.now()-t,bytes:Buffer.byteLength(payload)};};
  const task=async n=>{const intake={recipient_relation:n%2?'partner':'pursuit',occasion:'birthday',budget_amount:'800',currency:'CNY'};const a=await post('/api/recommendations',{intake});let b=null;if(a.status===200)b=await post('/api/presentations',{recommendation_run_id:a.json.recommendation_run_id,selected_candidate_id:'c1'},a.cookie);rows.push({n,recommend_ms:a.ms,recommend_http:a.status,candidate_count:a.json.candidates?.length,input_bytes:a.bytes,present_ms:b?.ms,present_http:b?.status,mode:a.json.mode,media_status:b?.json.media?.status});if(a.status!==200||b?.status!==200)throw Error('HTTP_FIXTURE_FAILED:'+JSON.stringify({recommend_status:a.status,errors:a.json.errors,present_status:b?.status}));};
  for(let n=0;n<20;n+=2)await Promise.all([task(n),task(n+1)]);
  fs.writeFileSync(path.join(runDir,'http.json'),JSON.stringify(rows,null,2));
  await command({phase:'media-fixture',media:true});
  await command({phase:'retained-idle'});await sleep(1000);
  const final=snapshot();fs.writeFileSync(path.join(runDir,'disk.json'),JSON.stringify({before,after:final,logical_delta_bytes:Object.entries(final).reduce((s,[k,v])=>s+v-(before[k]??0),0),note:'logical file bytes, .tmp only; source/log telemetry excluded'},null,2));
  const ps=execFileSync('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${child.pid} | Select-Object Id,WorkingSet64,PeakWorkingSet64,PrivateMemorySize64,@{n='CPUSeconds';e={$_.TotalProcessorTime.TotalSeconds}} | ConvertTo-Json`],{encoding:'utf8'});fs.writeFileSync(path.join(runDir,'windows-process.json'),ps);
  await command({phase:'finished'});child.send({stop:true});await new Promise(r=>child.once('exit',r));
  fs.writeFileSync(path.join(base,'latest-run.txt'),runDir);console.log(runDir);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill();}
}
