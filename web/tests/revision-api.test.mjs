import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const intake = { contract_version:'giftwise-20261031-v2', budget_mode:'other', budget_range:{min:'0',max:'300'}, currency:'CNY', deadline_days:5, recipient_relation:'friend', closeness:'unknown', occasion:'birthday', interests:[], interest_confidence:{}, gift_styles:[], dislikes:'不要香水', hard_exclusions:{tags:[],terms:[],unresolved:[]}, additional_context:'' };

test('新版排除项分析与确认闸门', async () => {
  const port = 8796;
  const child = spawn(process.execPath, ['web/server/server.mjs'], { env: {...process.env, GW_PORT:String(port), GW_MODE:'mock'}, stdio:['ignore','pipe','pipe'] });
  try {
    await new Promise((resolve, reject) => { const timer=setTimeout(()=>resolve(),500); child.stdout.on('data', b=>{if (String(b).includes('已启动')) {clearTimeout(timer); resolve();}}); child.on('error', reject); });
    const post = async (path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)})).json();
    const empty = await post('/api/recommendations', {intake});
    assert.equal(empty.status, 'needs_input');
    assert.equal(empty.errors[0].code, 'INTAKE_CLARIFICATION_REQUIRED');
    const analysis = await post('/api/exclusions/analyze', {intake});
    assert.equal(analysis.status, 'needs_confirmation');
    assert.match(analysis.analysis_id, /^xa-/);
    const report = await post('/api/recommendations', {intake, exclusion_confirmation:{analysis_id:analysis.analysis_id, confirmed_ids:['xc1']}});
    assert.ok(report.recommendation_run_id);
    const repeat = await post('/api/recommendations', {intake, exclusion_confirmation:{analysis_id:analysis.analysis_id, confirmed_ids:['xc1']}});
    assert.equal(repeat.recommendation_run_id, report.recommendation_run_id);
  } finally { child.kill(); }
});
