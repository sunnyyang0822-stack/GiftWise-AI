/** 本地真实HTTP接线测试；解析开关关闭、mock排除项/推荐，零真实模型调用。需A单validateForDecision接口。 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import test from 'node:test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const base={recipient_relation:'friend',occasion:'birthday',budget_amount:'300',currency:'CNY'};

test('缺失、null和不确定时间不阻塞parse/validate/排除项分析/推荐前置路径',async()=>{
  const taskTmp=resolve(root,'.tmp');
  const child=spawn(process.execPath,[resolve(root,'web/server/server.mjs')],{cwd:root,env:{...process.env,GW_PORT:'8905',GW_HOST:'127.0.0.1',GW_MODE:'mock',GIFTWISE_INTAKE_PARSE:'0',GIFTWISE_CATALOG_SCRAPE:'0',GIFTWISE_IMAGE_GENERATION:'0',GIFTWISE_RETRIEVAL:'unavailable',GW_LOCAL_DB:resolve(taskTmp,'http-missing-catalog.sqlite'),GIFTWISE_CATALOG_DB:resolve(taskTmp,'http-missing-catalog.sqlite'),GW_LLM_LEDGER_FILE:resolve(taskTmp,'http-no-model-ledger.jsonl'),LLM_API_KEY:'',LLM_BASE_URL:'',LLM_MODEL:''},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',cookie='';
  child.stdout.on('data',chunk=>{stdout+=chunk;}); child.stderr.on('data',chunk=>{stderr+=chunk;});
  try {
    await new Promise((ready,reject)=>{
      const timer=setTimeout(()=>reject(Error(`server startup timeout: ${stdout} ${stderr}`)),10000);
      const onData=()=>{if(stdout.includes('已启动')){clearTimeout(timer);ready();}};
      child.stdout.on('data',onData);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(Error(`server exited ${code}: ${stderr}`));});
    });
    const post=async(path,body)=>{
      const response=await fetch('http://127.0.0.1:8905'+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
      const setCookie=response.headers.get('set-cookie'); if(setCookie) cookie=setCookie.split(';')[0];
      const raw=await response.text(); console.log(JSON.stringify({path,request:body,http_status:response.status,response:JSON.parse(raw)}));
      return {http:response.status,value:JSON.parse(raw)};
    };
    for(const extra of [{},{deadline_days:null},{deadline_days:'不确定'}]) {
      const intake={...base,...extra};
      const parsed=await post('/api/intake/parse',{text:'朋友生日',form:intake});
      assert.equal(parsed.value.status,'disabled');
      assert.equal(parsed.value.intake_validation.status,'ready');
      assert.equal(parsed.value.parse.constraints.days_band,null);
      assert.equal(parsed.value.parse.required_followups.some(x=>x.id==='deadline_confirm'),false);
      const validation=await post('/api/intake/validate',{intake}); assert.equal(validation.value.status,'ready');
      const exclusionsIntake={...intake,dislikes:'不要香水'};
      const analysis=await post('/api/exclusions/analyze',{intake:exclusionsIntake});
      assert.equal(analysis.value.status,'needs_confirmation'); assert.ok(analysis.value.analysis_id);
      const recommendation=await post('/api/recommendations',{text:'朋友生日',intake:exclusionsIntake,exclusion_confirmation:{analysis_id:analysis.value.analysis_id,confirmed_ids:analysis.value.candidates.map(x=>x.id)}});
      assert.ok(recommendation.value.recommendation_run_id,JSON.stringify(recommendation.value));
      assert.equal(recommendation.value.mode,'mock');
      assert.equal(recommendation.value.nl_parse.constraints,null);
      assert.equal(recommendation.value.nl_parse.required_followups.some(x=>x.id==='deadline_confirm'),false);
    }
    const bad={...base,budget_amount:'-1'};
    for(const path of ['/api/intake/validate','/api/exclusions/analyze','/api/recommendations']) {
      const r=await post(path,{intake:bad});
      assert.equal(r.value.status,'needs_input'); assert.ok(r.value.errors.some(x=>x.path.includes('budget')));
    }
  } finally {
    child.kill();
    await new Promise(done=>{if(child.exitCode!==null||child.signalCode!==null)return done();child.once('exit',done);});
    console.log(JSON.stringify({server_stdout:stdout,server_stderr:stderr,real_model_calls:0,mode:'mock',intake_parse_enabled:false}));
  }
});
