import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIntakeText, buildIntakeParseMessages, toRecommendConstraints } from '../server/llm/intake-parse.mjs';
import { adaptIntakeObject } from '../server/intake.mjs';
import { checkAiExclusions } from '../server/exclusion-checker.mjs';

const form = {recipient_relation:'friend', occasion:'birthday', budget_amount:'300', currency:'CNY', deadline_days:7};
const enabled = {enabled:true, literalPreferenceGate:false};
const parse = (raw, text, prior=form) => parseIntakeText({text, form:prior, useCache:false, config:enabled, provider:{available:()=>true, requestIntakeParse:async()=>({ok:true,parse:raw})}});

test('确定预算保留原值、区间及合法边界', async()=>{
  for(const amount of ['800','0','20','10000']) {
    const r=await parse({budget:{amount,explicit:true}},`预算${amount}`);
    assert.equal(r.intake.budget_amount,amount);
    assert.deepEqual(r.intake.budget_range,{min:String(Math.max(0,Number(amount)-50)),max:amount});
    assert.equal(r.intake_validation.status,'ready');
  }
  const r=await parse({budget:{min:'800',max:'1000',explicit:true}},'预算800–1000');
  assert.deepEqual(r.intake.budget_range,{min:'800',max:'1000'});
});

test('缺失、非法预算保留必要检查，不静默补值',async()=>{
  const {budget_amount,...prior}=form;
  for(const raw of [{},{budget:{amount:'-1'}},{budget:{amount:'10001'}},{budget:{amount:'NaN'}}]) {
    const r=await parse(raw,'预算不确定',prior);
    assert.equal(r.intake_validation.status,'needs_input');
    assert.equal(r.intake.budget_amount,undefined);
  }
});

test('见面礼、朋友了解不多、原话语气和明确排除项',async()=>{
  const text='Hi~ 我希望送给我一个没有那么熟的朋友，类似见面礼的礼物，他似乎喜欢某幻君，我需要避开香水、衣服……';
  const r=await parse({recipient_relation:{value:'friend',explicit:true},closeness:{value:'limited',explicit:true},occasion:{value:'other',explicit:true},occasion_custom:'见面礼',literal_preferences:['他似乎喜欢某幻君'],dislikes:'避开香水、衣服',exclusion_terms:[{text:'香水',confidence:'high'},{text:'衣服',confidence:'high'}]},text);
  assert.equal(r.intake.occasion_custom,'见面礼'); assert.equal(r.intake.closeness,'limited');
  assert.deepEqual(r.parse.literal_preferences,['他似乎喜欢某幻君']);
  assert.deepEqual(r.intake.hard_exclusions.terms,['香水','衣服']);
  assert.equal(r.parse.required_followups.some(x=>x.id==='city'),false);
  assert.equal(r.intake.additional_context,'他似乎喜欢某幻君');
});

test('原话之外的喜好与未经锚定或低把握排除词不自动成为约束',async()=>{
  const r=await parse({literal_preferences:['确定喜欢某幻君'],exclusion_terms:[{text:'香水',confidence:'low'},'礼盒'],dislikes:'不确定是否避开香水'},'不确定是否避开香水');
  assert.deepEqual(r.parse.literal_preferences,[]);
  assert.equal(r.intake.hard_exclusions,undefined);
  assert.equal(r.intake.dislikes,'不确定是否避开香水');
  assert.ok(r.parse.dropped.length>=3);
});

test('选项外喜好与多种兴趣并存，低把握以推断保留',async()=>{
  const text='似乎喜欢机械结构，也喜欢演唱会和摄影';
  const r=await parse({literal_preferences:['似乎喜欢机械结构','喜欢演唱会和摄影'],interests:[{id:'mechanical_things',evidence:'似乎喜欢机械结构'},{id:'music_movies',explicit:false,evidence:'演唱会'}]},text);
  assert.ok(r.intake.additional_context.includes('似乎喜欢机械结构'));
  assert.deepEqual(r.intake.interests,['music_movies']); assert.equal(r.intake.interest_confidence.music_movies,'inferred');
  assert.equal(r.intake_validation.status,'ready'); assert.equal(r.parse.required_followups.some(x=>x.id==='city'),false);
});

test('体验枚举不会自动触发城市门禁，模型识别当地体验时自然追问',async()=>{
  const a=await parse({interests:[{id:'experiences_activities',explicit:false}],gift_styles:['experiential']},'喜欢活动');
  assert.equal(a.parse.required_followups.some(x=>x.id==='city'),false);
  const b=await parse({experiential_mentioned:true},'想请朋友参加当地陶艺课');
  assert.equal(b.parse.required_followups.find(x=>x.id==='city').required,false);
  assert.equal(b.intake_validation.status,'ready'); assert.equal(b.parse.schema_version,'intake-parse-v3'); assert.doesNotMatch(b.parse.region_price.note,/无法|没有/);
  const c=await parse({experiential_mentioned:true,city:{value:'杭州'}},'想请杭州的朋友上陶艺课');
  assert.equal(c.parse.city,'杭州'); assert.equal(c.parse.required_followups.some(x=>x.id==='city'),false);
});

test('下个月不猜成30或1天；保留原话，不生成时间带宽',async()=>{
  for(const days of [undefined,1,30]) {
    const r=await parse({deadline:{days,phrase:'下个月',explicit:false}},'下个月送礼');
    assert.equal(r.intake.deadline_days,null); assert.equal(r.parse.echo.deadline_days,null);
    assert.equal(r.parse.constraints.days_band,null); assert.equal(r.parse.deadline_check,null);
    assert.equal(r.parse.required_followups.some(x=>x.id==='deadline_confirm'),false);
    assert.equal(r.intake.additional_context,'下个月');
  }
  const {deadline_days,...prior}=form;
  const missing=await parse({deadline:{phrase:'下个月',explicit:false}},'下个月送礼',prior);
  assert.equal(missing.intake.deadline_days,null);
  assert.equal(missing.intake_validation.status,'ready');
  assert.deepEqual(missing.intake_validation.errors,[]);
});

test('明确3天仅作参考，不生成时间带宽或日期追问',async()=>{
  const r=await parse({deadline:{days:3,phrase:'3天后',explicit:true}},'3天后送');
  assert.equal(r.intake.deadline_days,3); assert.equal(r.parse.echo.deadline_days,3);
  assert.equal(r.parse.constraints.days_band,null); assert.equal(r.parse.candidate_gates.days_band,null);
  assert.equal(r.parse.required_followups.some(x=>x.id==='deadline_confirm'),false);
});

test('additional_context保留用户补充和原话，不塞内部约束解释',async()=>{
  const r=await parse({additional_context:'初次见面',literal_preferences:['似乎喜欢机械结构']},'初次见面，他似乎喜欢机械结构',{...form,additional_context:'希望轻松一点'});
  assert.equal(r.intake.additional_context,'希望轻松一点\n初次见面\n似乎喜欢机械结构');
  assert.doesNotMatch(r.intake.additional_context,/硬约束|不得|用户原话|产品负责人/);
});

test('合法长补充不被可选原话拼接挤成整体失败，余文保留解析明细',async()=>{
  const literal='喜欢陶艺';
  const r=await parse({literal_preferences:[literal]},literal,{...form,additional_context:'字'.repeat(1000)});
  assert.equal(r.intake_validation.status,'ready'); assert.equal(r.intake.additional_context.length,1000);
  assert.ok(r.parse.unmapped.includes(literal)); assert.deepEqual(r.parse.literal_preferences,[literal]);
});

test('从other改成已有场合或关系时清除旧custom，现有契约只有occasion_custom',async()=>{
  const r=await parse({occasion:'birthday',recipient_relation:'friend'},'朋友生日',{...form,occasion:'other',occasion_custom:'见面礼',recipient_relation:'other',recipient_relation_custom:'邻居'});
  assert.equal(r.intake_validation.status,'ready'); assert.equal(r.intake.occasion_custom,undefined); assert.equal(r.intake.recipient_relation_custom,undefined);
  assert.ok(adaptIntakeObject({...form,rcasion_custom:'见面礼'}).errors.some(x=>x.code==='INTAKE_UNKNOWN_FIELD'));
});

test('排除词礼盒、具包、包装盒均按原话审核，词不常见不作废',()=>{
  for(const term of ['礼盒','具包','包装盒']) {
    const source_span=`不要${term}`;
    const result=checkAiExclusions(JSON.stringify({ai_exclusion_candidates:[{id:'xc1',kind:'term',tag:null,term,source_span,confidence:'medium',why:'请确认原话所指范围',evidence:'user_text'}],ai_unmapped_notes:[]}),source_span);
    assert.equal(result.status,'needs_confirmation'); assert.equal(result.candidates[0].term,term);
  }
});

test('解析不可用时给简洁提示，保留真实状态和必要校验',async()=>{
  const r=await parseIntakeText({text:'想送礼',form,config:enabled,useCache:false,provider:{available:()=>false,requestIntakeParse:async()=>{throw Error();}}});
  assert.equal(r.degraded,true); assert.equal(r.reason_code,'LLM_NOT_CONFIGURED');
  assert.equal(r.notices[0],'解析服务暂不可用，请检查或补充表单。');
  assert.equal(r.intake_validation.status,'ready');
});

test('提示词包含开放理解与不确定日期约定',()=>{
  const prompt=buildIntakeParseMessages({text:'任意需求'})[0].content;
  assert.match(prompt,/不能用固定关键词强制分类/); assert.match(prompt,/省略 days/); assert.match(prompt,/似乎/);
});

test('文本预算非法不能静默沿用旧预算',async()=>{
  const r=await parse({budget:{amount:'10001'}},'预算10001');
  assert.equal(r.intake_validation.status,'needs_input');
  assert.ok(r.intake_validation.errors.some(x=>x.path==='intake.budget_amount'));
});

test('未提供时间也可ready，旧时间带宽不会进入推荐信封',async()=>{
  const {deadline_days,...prior}=form;
  const r=await parse({occasion:'birthday'},'生日',prior);
  assert.equal(r.intake_validation.status,'ready');
  assert.equal(r.intake.deadline_days,undefined);
  assert.deepEqual(r.parse.required_followups,[]);
  assert.equal(toRecommendConstraints({constraints:{days_band:{min:1,max:1}}}),null);
});

test('不确定或不合法的可选时间不触发日期确认，也不编造天数',async()=>{
  for(const deadline of [{phrase:'不确定',explicit:false},{days:-1},{days:366},{days:true},{days:1.5}]) {
    const r=await parse({deadline},'时间不确定',form);
    assert.equal(r.intake.deadline_days,null);
    assert.equal(r.intake_validation.status,'ready');
    assert.equal(r.parse.constraints.days_band,null);
    assert.equal(r.parse.required_followups.some(x=>x.id==='deadline_confirm'),false);
  }
});
