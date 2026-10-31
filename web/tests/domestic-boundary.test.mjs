import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../server/localdb/db.mjs';
import { taskPath, taskDirectory, taskProcessEnv } from '../server/collect/task-paths.mjs';
import { findChrome } from '../server/collect/chrome.mjs';

const temp = mkdtempSync(join(taskDirectory(join(REPO_ROOT, '.tmp/boundary-tests')), 'test-'));
test('中文URL必须fileURLToPath解码；编码路径与..越界在创建前拒绝', () => {
  assert.equal(taskPath(fileURLToPath(new URL('../../.tmp/boundary-tests', import.meta.url))), join(REPO_ROOT, '.tmp/boundary-tests'));
  assert.throws(() => taskPath('E:/%E9%BB%91%E5%AE%A2%E6%9D%BE/profile'), /工作树/);
  assert.throws(() => taskPath(join(REPO_ROOT, '..', 'escape/profile')), /工作树/);
  assert.equal(taskPath(join(temp, 'future/profile')), join(temp, 'future/profile'));
});
test('junction不能绕过词法边界；拒绝不存在目标的链接', (t) => {
  const link = join(temp, 'outside-link');
  try { symlinkSync(dirname(REPO_ROOT), link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EISDIR','EPERM','ENOTSUP'].includes(error.code)) { t.skip(`当前文件系统不能创建junction测试夹具：${error.code}`); return; } throw error; }
  try { assert.throws(() => taskPath(join(link, 'would-write')), /工作树/); }
  finally { unlinkSync(link); }
  const dangling = join(temp, 'dangling');
  symlinkSync(join(dirname(REPO_ROOT), 'nonexistent-boundary-fixture'), dangling, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => taskPath(join(dangling, 'would-write')), /链接/); }
  finally { unlinkSync(dangling); }
});
test('浏览器/CLI子进程临时、缓存及应用目录均在工作树；不改父环境', () => {
  const env = taskProcessEnv({ KEEP: 'same', TEMP: 'outside' }, join(temp, 'runtime'));
  for (const key of ['TEMP','TMP','TMPDIR','XDG_CACHE_HOME','npm_config_cache','OPENCLI_CACHE_DIR','USERPROFILE','APPDATA','LOCALAPPDATA']) assert.equal(taskPath(env[key]), env[key]);
  assert.equal(env.KEEP, 'same'); assert.equal(Object.hasOwn(env, 'HOME'), false);
});
test('Google Chrome专用入口无Edge回退；旧provider不调用系统temp浏览器', () => {
  assert.doesNotMatch(findChrome() || '', /msedge|edge.exe|chromium/i);
  const chrome = readFileSync(new URL('../server/collect/chrome.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(chrome, /msedge|Microsoft\/Edge/);
  assert.match(chrome, /env: childEnv/);
  const old = readFileSync(new URL('../server/retrieval/dfrobot-provider.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(old, /tmpdir|mkdtemp|spawn\(/);
});
