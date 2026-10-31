import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const intake = { contract_version:'giftwise-20261031-v2', budget_mode:'other', budget_range:{min:'0',max:'300'}, currency:'CNY', deadline_days:5, recipient_relation:'friend', closeness:'unknown', occasion:'birthday', interests:[], interest_confidence:{}, gift_styles:[], dislikes:'不要香水', hard_exclusions:{tags:[],terms:[],unresolved:[]}, additional_context:'' };
const root=fileURLToPath(new URL('../../',import.meta.url));

function waitForStartup(child, logs, timeoutMs=15000) {
  return new Promise((resolve,reject)=>{
    const finish=error=>{
      clearTimeout(timer);
      child.stdout.off('data',onData); child.off('error',onError); child.off('exit',onExit);
      error ? reject(error) : resolve();
    };
    const onData=()=>{if(logs.stdout.includes('已启动')) finish();};
    const onError=error=>finish(error);
    const onExit=(code,signal)=>finish(Error(`服务未就绪即退出：code=${code}, signal=${signal}; ${logs.stderr}`));
    const timer=setTimeout(()=>finish(Error(`等待本次子服务就绪超时；${logs.stdout} ${logs.stderr}`)),timeoutMs);
    child.stdout.on('data',onData); child.once('error',onError); child.once('exit',onExit);
    onData();
  });
}

test('新版排除项分析与确认闸门', async () => {
  const port = 8796;
  const tmpRoot=join(root,'.tmp'); await mkdir(tmpRoot,{recursive:true});
  const taskTmp=await mkdtemp(join(tmpRoot,'revision-api-'));
  const child = spawn(process.execPath, [join(root,'web/server/server.mjs')], {cwd:root,env:{...process.env,TEMP:taskTmp,TMP:taskTmp,TMPDIR:taskTmp,GW_PORT:String(port),GW_MODE:'mock',GW_HOST:'127.0.0.1',GW_LOCAL_DB:join(taskTmp,'isolated-catalog.sqlite'),GIFTWISE_CATALOG_DB:join(taskTmp,'isolated-catalog.sqlite'),GW_LLM_LEDGER_FILE:join(taskTmp,'no-real-model-ledger.jsonl'),GIFTWISE_CATALOG_SCRAPE:'0',GIFTWISE_IMAGE_GENERATION:'0',GIFTWISE_RETRIEVAL:'unavailable',LLM_API_KEY:'',LLM_BASE_URL:'',LLM_MODEL:''},stdio:['ignore','pipe','pipe']});
  const closed=new Promise(resolve=>child.once('close',resolve));
  const logs={stdout:'',stderr:''}; const started=Date.now(); let cookie='';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{logs.stdout+=chunk;}); child.stderr.on('data',chunk=>{logs.stderr+=chunk;});
  try {
    // 只有本次child的就绪信号才允许探测健康；端口被占用时不会误用他人服务。
    await waitForStartup(child,logs);
    const healthResponse=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(5000)});
    const health=await healthResponse.json();
    assert.equal(healthResponse.status,200); assert.equal(health.status,'ok'); assert.equal(health.mode,'mock'); assert.equal(health.attestation.pid,child.pid);
    console.log(JSON.stringify({event:'owned_service_ready',ready_ms:Date.now()-started,health}));
    const post=async(path,body,{sessionCookie=cookie,persistCookie=true}={})=>{
      let response;
      try {response=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'content-type':'application/json',...(sessionCookie?{cookie:sessionCookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});}
      catch(error){console.log(JSON.stringify({event:'http_failure',path,message:error.message,cause_code:error.cause?.code}));throw error;}
      if(persistCookie&&response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
      const raw=await response.text(); console.log(JSON.stringify({path,http:response.status,response:JSON.parse(raw)})); return JSON.parse(raw);
    };
    const empty = await post('/api/recommendations', {intake});
    assert.equal(empty.status, 'needs_input');
    assert.equal(empty.errors[0].code, 'INTAKE_CLARIFICATION_REQUIRED');
    const analysis = await post('/api/exclusions/analyze', {intake});
    assert.equal(analysis.status, 'needs_confirmation');
    assert.match(analysis.analysis_id, /^xa-/);
    assert.equal(analysis.confirmation_required,true); assert.deepEqual(analysis.semantic_constraints,[]); assert.deepEqual(analysis.clarification_questions,[]);
    const confirmation={analysis_id:analysis.analysis_id,confirmed_ids:['xc1']};
    const foreign=await post('/api/recommendations',{intake,exclusion_confirmation:confirmation},{sessionCookie:'',persistCookie:false});
    assert.equal(foreign.status,'needs_input'); assert.equal(foreign.errors[0].code,'EXCLUSION_ANALYSIS_STALE');
    const unconfirmed=await post('/api/recommendations',{intake,exclusion_confirmation:{analysis_id:analysis.analysis_id,confirmed_ids:[]}});
    assert.equal(unconfirmed.status,'needs_input'); assert.equal(unconfirmed.errors[0].code,'INTAKE_CLARIFICATION_REQUIRED');
    const report = await post('/api/recommendations', {intake,exclusion_confirmation:confirmation});
    assert.ok(report.recommendation_run_id);
    assert.ok(report.request.forbidden_tags.includes('fragrance'));
    assert.equal(report.request.exclusion_context.original,intake.dislikes);
    assert.deepEqual(report.request.exclusion_context.clarifications,[]);
    const repeat = await post('/api/recommendations', {intake,exclusion_confirmation:confirmation});
    assert.equal(repeat.recommendation_run_id, report.recommendation_run_id);
  } finally {
    if(child.exitCode===null&&child.signalCode===null) child.kill();
    await closed;
    console.log(JSON.stringify({event:'owned_service_closed',pid:child.pid,stdout:logs.stdout,stderr:logs.stderr,real_model_calls:0}));
  }
});
