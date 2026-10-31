/** 新语义/澄清协议定向测试；全部受控provider，零真实模型/采集调用。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyzeExclusionIntake,prepareExclusionRecommendation} from '../server/exclusion-service.mjs';
import {getAnalysis} from '../server/exclusion-store.mjs';
import {withExclusionContext,currentExclusionContext} from '../server/exclusion-context.mjs';
import {checkAiExclusions} from '../server/exclusion-checker.mjs';
import {adaptIntakeObject} from '../server/intake.mjs';
import {runRecommendation,runPresentation} from '../server/pipeline.mjs';
import {buildMockPresentation} from '../server/mock-model.mjs';
import {buildRecommendEnvelope,buildRecommendMessages,buildPresentEnvelope,buildPresentMessages,buildExclusionsMessages,assertIntakeHasNoDerivedFields} from '../server/llm/prompt.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const taskTmp=fileURLToPath(new URL('../../.tmp/',import.meta.url));
mkdirSync(taskTmp,{recursive:true});
const base=JSON.parse(readFileSync(new URL('../../workflow/examples/intake.json',import.meta.url),'utf8'));
const fixture=readFileSync(new URL('../../workflow/examples/candidates.json',import.meta.url),'utf8');
const source='别让人看起来像表白，卡片也别写得暧昧';
const intake=(dislikes=source)=>({...base,recipient_relation:'friend',deadline_days:7,dislikes});
const envelope=(semantics=[],questions=[],items=[])=>({ai_exclusion_candidates:items,ai_unmapped_notes:[],ai_semantic_constraints:semantics,ai_clarification_questions:questions});
const semantic=(span=source,interpretation='保持普通朋友的边界，卡片使用自然中性措辞',confidence='high')=>({source_span:span,interpretation,confidence});
const physical=(span='不要香水')=>({id:'xc1',kind:'tag',tag:'fragrance',term:null,source_span:span,confidence:'high',why:'原话明确避开香水',evidence:'user_text'});
const analyze=(value,data,owner='owner-a',continuation)=>analyzeExclusionIntake({intake:value,mode:'replay',owner,continuation,provider:async()=>JSON.stringify(data)});
function prepare(value,response,owner='owner-a') {
  const confirmation={analysis_id:response.analysis_id,confirmed_ids:response.candidates.map(item=>item.id)};
  return {...prepareExclusionRecommendation({intake:value,analysis:getAnalysis(response.analysis_id),confirmation,owner}),confirmation};
}

test('语气边界直接ready，不生成具体禁品、不要求再确认',async()=>{
  const value=intake(); const r=await analyze(value,envelope([semantic()]));
  assert.equal(r.status,'ready'); assert.equal(r.confirmation_required,false); assert.deepEqual(r.candidates,[]); assert.deepEqual(r.clarification_questions,[]);
  const p=prepare(value,r); assert.equal(p.ok,true); assert.deepEqual(p.intake,value);
  const adapted=withExclusionContext(p.analysis,()=>adaptIntakeObject(p.intake));
  assert.equal(adapted.status,'ready'); const request=JSON.parse(adapted.request_json);
  assert.equal(request.dislikes,source); assert.equal(request.notes,value.additional_context); assert.equal(request.exclusion_context.original,source);
  assert.equal(request.forbidden_terms.includes('表白'),false); assert.equal(request.forbidden_terms.includes('暧昧'),false);
});

test('同样机制接受其他开放语义，confidence不作强制澄清阈值',async()=>{
  for(const [raw,meaning] of [['不希望像在催他回礼','避免造成必须回礼的压力'],['最好不要在大家面前郑重其事地送','用低调私下的方式赠送']]) {
    const r=await analyze(intake(raw),envelope([semantic(raw,meaning,'low')]));
    assert.equal(r.status,'ready'); assert.equal(r.semantic_constraints[0].confidence,'low'); assert.deepEqual(r.clarification_questions,[]);
  }
});

test('语义限制与明确禁品并存，只对真实禁品确认',async()=>{
  const value=intake(source+'，不要香水'); const r=await analyze(value,envelope([semantic()],[],[physical()]));
  assert.equal(r.status,'needs_confirmation'); assert.equal(r.confirmation_required,true); assert.equal(r.candidates[0].tag,'fragrance');
  const p=prepare(value,r); const request=JSON.parse(withExclusionContext(p.analysis,()=>adaptIntakeObject(p.intake)).request_json);
  // pipeline将在用户确认后冻结fragrance；此处语义上下文不能成为字面禁词。
  assert.deepEqual(request.forbidden_terms,base.hard_exclusions.terms); assert.equal(request.exclusion_context.semantic_constraints[0].source_span,source);
});

test('真正歧义接续回答，不替换原话或清空已有信息',async()=>{
  const value=intake('别太正式');
  const first=await analyze(value,envelope([],[{source_span:'别太正式',question:'你主要是希望送礼方式轻松，还是不想要正式包装？'}]));
  assert.equal(first.status,'needs_input'); assert.ok(first.analysis_id);
  const answer='是送礼方式轻松，包装简洁即可'; let seen;
  const second=await analyzeExclusionIntake({intake:value,owner:'owner-a',mode:'replay',continuation:{analysis_id:first.analysis_id,answer},provider:async args=>{seen=args;return JSON.stringify(envelope([semantic('别太正式','送礼方式轻松自然'),semantic(answer,'包装简洁')]))}});
  assert.equal(second.status,'ready'); assert.equal(seen.dislikes,value.dislikes); assert.equal(seen.clarifications[0].answer,answer);
  assert.equal(getAnalysis(second.analysis_id).intake.dislikes,value.dislikes); assert.equal(getAnalysis(second.analysis_id).clarifications[0].answer,answer);
  assert.notEqual(second.analysis_id,first.analysis_id);
});

test('两轮回答和用户修正保留完整历史，后续理解可更新',async()=>{
  const value=intake('别太正式');
  const a=await analyze(value,envelope([],[{source_span:'别太正式',question:'更在意包装还是赠送方式？'}]));
  const b=await analyze(value,envelope([],[{source_span:'包装',question:'包装想偏简洁还是随意？'}]),'owner-a',{analysis_id:a.analysis_id,answer:'包装'});
  const c=await analyze(value,envelope([semantic('不，主要是赠送方式自然','用户修正为赠送方式自然')]),'owner-a',{analysis_id:b.analysis_id,answer:'不，主要是赠送方式自然'});
  assert.equal(c.status,'ready'); assert.deepEqual(getAnalysis(c.analysis_id).clarifications.map(x=>x.answer),['包装','不，主要是赠送方式自然']);
});

test('provider失败或坏输出保留旧问题、分析ID及已有状态，可原ID重试',async()=>{
  const value=intake('别太正式'); const first=await analyze(value,envelope([],[{source_span:'别太正式',question:'希望包装还是赠送方式更轻松？'}]));
  for(const provider of [async()=>{throw Error('private');},async()=>'{bad']) {
    const r=await analyzeExclusionIntake({intake:value,mode:'replay',owner:'owner-a',continuation:{analysis_id:first.analysis_id,answer:'赠送方式'},provider});
    assert.equal(r.status,'error'); assert.equal(r.analysis_id,first.analysis_id); assert.deepEqual(r.clarification_questions,first.clarification_questions); assert.equal(getAnalysis(first.analysis_id).status,'needs_input');
  }
  const retried=await analyze(value,envelope([semantic('赠送方式','赠送方式轻松自然')]),'owner-a',{analysis_id:first.analysis_id,answer:'赠送方式'});
  assert.equal(retried.status,'ready');
});

test('跨owner、不同表单或过期引用不允许续答',async()=>{
  const value=intake('别太正式'); const first=await analyze(value,envelope([],[{source_span:'别太正式',question:'更在意哪种形式？'}]));
  for(const [v,owner,id] of [[value,'other-owner',first.analysis_id],[{...value,budget_amount:'400'},'owner-a',first.analysis_id],[value,'owner-a','xa-missing']]) {
    let called=false; const r=await analyzeExclusionIntake({intake:v,mode:'replay',owner,continuation:{analysis_id:id,answer:'包装'},provider:async()=>{called=true;return '{}';}});
    assert.equal(r.status,'error'); assert.equal(called,false); assert.equal(r.errors[0].code,'EXCLUSION_ANALYSIS_STALE');
  }
});

test('旧两键信封具体禁品仍兼容，伪造语义来源和错误字段拒绝',()=>{
  const old=checkAiExclusions(JSON.stringify({ai_exclusion_candidates:[physical()],ai_unmapped_notes:[]}),'不要香水'); assert.equal(old.status,'needs_confirmation');
  for(const data of [envelope([semantic('不存在')]),{...envelope(),ai_semantic_constraints:null},{...envelope(),ai_clarification_questions:null},{...envelope(),passed:true},envelope([],[{source_span:source,question:'<script>bad</script>'}])]) assert.equal(checkAiExclusions(JSON.stringify(data),source).status,'needs_input');
});

test('未理解片段给原话关联的问题，不叫用户改格式重输',()=>{
  const r=checkAiExclusions(JSON.stringify({ai_exclusion_candidates:[],ai_unmapped_notes:['需要知道所指情境']}),'别这样');
  assert.equal(r.status,'needs_input'); assert.equal(r.clarification_questions[0].source_span,'别这样'); assert.doesNotMatch(r.clarification_questions[0].question,/重新|重输|香水|衣服/);
});

test('浏览器伪造派生语义上下文拒绝，其他请求不继承上下文',async()=>{
  const value=intake(); const r=await analyze(value,envelope([semantic()])); const p=prepare(value,r);
  const bad=adaptIntakeObject({...value,exclusion_context:{original:'伪造'}}); assert.ok(bad.errors.some(x=>x.code==='INTAKE_UNKNOWN_FIELD'));
  assert.equal(assertIntakeHasNoDerivedFields({...value,exclusion_context:{}}).ok,false);
  await withExclusionContext(p.analysis,async()=>{await Promise.resolve();assert.equal(currentExclusionContext().original,source);});
  assert.equal(currentExclusionContext(),null); assert.equal(JSON.parse(adaptIntakeObject(value).request_json).exclusion_context,undefined);
});

test('长原话、原notes和补充回答不被拼接截断或写回用户输入',async()=>{
  const value={...intake('原'.repeat(1000)),additional_context:'注'.repeat(1000)};
  const a=await analyze(value,envelope([],[{source_span:'原',question:'你希望避免哪种表达？'}]));
  const answer='答'.repeat(600); const b=await analyze(value,envelope([semantic(answer,'使用中性自然的表达')]),'owner-a',{analysis_id:a.analysis_id,answer});
  const p=prepare(value,b); const adapted=withExclusionContext(p.analysis,()=>adaptIntakeObject(p.intake));
  assert.equal(adapted.status,'ready',JSON.stringify(adapted.errors)); const request=JSON.parse(adapted.request_json);
  assert.equal(request.dislikes,value.dislikes); assert.equal(request.notes,value.additional_context); assert.equal(request.exclusion_context.clarifications[0].answer,answer); assert.deepEqual(p.intake,value);
});

const servicesFor=(captured)=>({retrievalEnabled:false,libraryEnabled:false,catalogScrape:false,provideRealProducts:async()=>({catalog:{status:'unavailable',results:[],accounting:{scrape_calls:0}}}),visualDirectionProvider:{generate:async()=>({ok:false,notices:[]})},requestCandidates:async(requestJson)=>{captured.push(requestJson);return {ok:true,outputs:{candidates_json:fixture}};}});
async function recommend(value,response,captured,owner='owner-a') {
  const p=prepare(value,response,owner); assert.equal(p.ok,true);
  return withExclusionContext(p.analysis,()=>runRecommendation({intake:p.intake,analysis:p.analysis,exclusion_confirmation:p.confirmation,ownerScope:owner,mode:'dify'},servicesFor(captured)));
}

test('推荐和呈现provider捕获同一冻结语义原文/理解/问答，提示词要求遵循',async()=>{
  const value=intake('别太正式'); const a=await analyze(value,envelope([],[{source_span:'别太正式',question:'主要希望哪部分轻松？'}]));
  const answer='卡片像普通朋友聊天就好'; const b=await analyze(value,envelope([semantic(answer,'卡片用自然中性措辞')]),'owner-a',{analysis_id:a.analysis_id,answer});
  const captured=[]; const result=await recommend(value,b,captured);
  assert.equal(result.kind,'report',JSON.stringify(result.errors)); assert.ok(result.run.selectable_candidate_ids.length>0,JSON.stringify(result.run.validation));
  const frozen=JSON.parse(captured[0]).exclusion_context; assert.equal(frozen.original,value.dislikes); assert.equal(frozen.clarifications[0].answer,answer);
  let presentRequest; const presented=await runPresentation({runId:result.run.run_id,selectedCandidateId:result.run.selectable_candidate_ids[0],ownerScope:'owner-a'},{requestPresentation:async(requestJson,candidateJson)=>{presentRequest=requestJson;const output=buildMockPresentation(JSON.parse(requestJson),JSON.parse(candidateJson));return {ok:true,outputs:{presentation_json:output.presentation_json}};}});
  assert.equal(presented.kind,'presentation',JSON.stringify(presented.errors)); assert.equal(presentRequest,captured[0]); assert.deepEqual(JSON.parse(presentRequest).exclusion_context,frozen);
  const recMessages=buildRecommendMessages(buildRecommendEnvelope({requestJson:captured[0]})); const presMessages=buildPresentMessages(buildPresentEnvelope({requestJson:presentRequest,candidateJson:result.run.candidates[0]}));
  for(const messages of [recMessages,presMessages]){assert.match(messages[0].content,/用户后续修正优先/);assert.match(messages[0].content,/卡片/);assert.match(messages[1].content,/exclusion_context/);}
  writeFileSync(taskTmp+'semantic-provider-capture.json',JSON.stringify({kind:'controlled_provider_not_live_model',recommend_request:JSON.parse(captured[0]),presentation_request:JSON.parse(presentRequest),same_frozen_request:captured[0]===presentRequest},null,2));
});

test('相同intake的新分析/续答不复用旧run，同分析并发去重且不串上下文',async()=>{
  const value=intake('希望自然一点'); const a=await analyze(value,envelope([semantic('希望自然一点','保持日常语气')])); const b=await analyze(value,envelope([semantic('希望自然一点','不使用郑重的赠送仪式')]));
  const captured=[]; const [ra,rb]=await Promise.all([recommend(value,a,captured),recommend(value,b,captured)]);
  assert.notEqual(ra.run.run_id,rb.run.run_id); assert.equal(captured.length,2); assert.notDeepEqual(JSON.parse(captured[0]).exclusion_context,JSON.parse(captured[1]).exclusion_context);
  const c=await analyze(value,envelope([semantic('希望自然一点','卡片简洁')])) ;const next=[];const [rc,rd]=await Promise.all([recommend(value,c,next),recommend(value,c,next)]);
  assert.equal(rc.run.run_id,rd.run.run_id); assert.equal(next.length,1);
});

test('Python校验/工作流读取新增request字段，不因额外语义字段拒绝',()=>{
  const capture=JSON.parse(readFileSync(taskTmp+'semantic-provider-capture.json','utf8'));
  writeFileSync(taskTmp+'semantic-python-request.json',JSON.stringify(capture.recommend_request));
  const py=`import json,sys\nfrom validator.rules import validate\nfrom workflow.runtime import check\nr=open(sys.argv[1],encoding='utf-8').read()\nc=open('workflow/examples/candidates.json',encoding='utf-8').read()\nv=validate(r,c)\ns=check(r,c,0)\nassert not any(e['path'].startswith('request') for e in v['errors']),v\nassert json.loads(s['request_json'])['exclusion_context']==json.loads(r)['exclusion_context']\nprint(json.dumps({'validator_status':v['status'],'context_preserved':True,'errors':v['errors']},ensure_ascii=True))`;
  const proc=spawnSync('python',['-c',py,taskTmp+'semantic-python-request.json'],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPYCACHEPREFIX:taskTmp+'pycache'},encoding:'utf8'});
  writeFileSync(taskTmp+'semantic-python-raw.txt',(proc.stdout||'')+(proc.stderr||'')); assert.equal(proc.status,0,proc.stderr);
});

test('模型用户消息携带完整问答，原话不改写为系统指令',()=>{
  const history=[{questions:['你希望哪部分自然？'],answer:'卡片'}]; const messages=buildExclusionsMessages({dislikes:source,clarifications:history});
  assert.deepEqual(JSON.parse(messages[1].content).clarifications,history); assert.equal(JSON.parse(messages[1].content).dislikes,source); assert.match(messages[0].content,/恰好四键/);
});

test('分析引用必须一致；长原话的自然问题限长但原话仍完整',async()=>{
  const value=intake();const response=await analyze(value,envelope([semantic()]));
  const wrong=prepareExclusionRecommendation({intake:value,analysis:getAnalysis(response.analysis_id),confirmation:{analysis_id:'xa-other',confirmed_ids:[]},owner:'owner-a'});
  assert.equal(wrong.ok,false);assert.equal(wrong.errors[0].code,'EXCLUSION_ANALYSIS_STALE');
  const raw='原'.repeat(1000);const r=checkAiExclusions(JSON.stringify(envelope()),raw);
  assert.equal(r.clarification_questions[0].source_span,raw);assert.ok([...r.clarification_questions[0].question].length<=300);
});
