import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

test('controlled real HTTP returns three final choices or an explicit failure without partial cards', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const tmp = resolve(root, '.tmp');
  const child = spawn(process.execPath, [resolve(root, 'web/server/server.mjs')], {
    cwd: root, env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, GW_HOST: '127.0.0.1', GW_PORT: '8904', GW_MODE: 'mock', GIFTWISE_INTAKE_PARSE: '0', GIFTWISE_CATALOG_SCRAPE: '0', GIFTWISE_IMAGE_GENERATION: '0', GIFTWISE_RETRIEVAL: 'unavailable', GW_LOCAL_DB: resolve(tmp, 'http-three-catalog.sqlite'), GW_LLM_LEDGER_FILE: resolve(tmp, 'http-three-ledger.jsonl'), LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', cookie = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await new Promise((ready, reject) => {
      const timer = setTimeout(() => reject(Error('own 8904 startup timeout')), 10000);
      child.stdout.on('data', () => { if (stdout.includes('已启动')) { clearTimeout(timer); ready(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`own server exited ${code}: ${stderr}`)); });
    });
    const post = async body => {
      const response = await fetch('http://127.0.0.1:8904/api/recommendations', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
      const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
      const json = await response.json();
      console.log(JSON.stringify({ mode: 'controlled_mock', http_status: response.status, response: json }));
      return { response, json };
    };
    const intake = { recipient_relation: 'friend', occasion: 'birthday', budget_amount: '800', currency: 'CNY' };
    const success = await post({ intake });
    assert.equal(success.response.status, 200);
    assert.deepEqual(success.json.selectable_candidate_ids, ['c1', 'c2', 'c3']);
    assert.equal(success.json.candidates.length, 3);
    const failed = await post({ intake, demo: 'partial_fail' });
    assert.equal(failed.response.status, 400);
    assert.equal(failed.json.status, 'failed');
    assert.equal(failed.json.errors[0].code, 'RECOMMENDATION_INCOMPLETE');
    assert.ok(!failed.json.candidates); assert.ok(!failed.json.recommendation_run_id);
    assert.equal(failed.json.repair_count, 1);
    const replay = await post({ intake, demo: 'partial_fail' });
    assert.equal(replay.response.status, 400);
    assert.equal(replay.json.run_id, failed.json.run_id);
    assert.deepEqual(replay.json.call_counts, failed.json.call_counts);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise(done => child.once('exit', done));
    console.log(JSON.stringify({ server_stdout: stdout, server_stderr: stderr, real_model_calls: 0, scraping_calls: 0, image_calls: 0 }));
  }
});
