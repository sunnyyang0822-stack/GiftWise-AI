import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../server/localdb/db.mjs';
import { createMaterialCache } from '../server/retrieval/material-cache.mjs';

const clock = Date.parse('2026-11-01T04:00:00Z');
const root = join(REPO_ROOT, '.tmp', 'material-cache-tests', String(process.pid));
mkdirSync(root, { recursive: true });
const directory = () => join(root, randomUUID());
const material = (n = 1, extra = {}) => ({ reference_kind: 'public_reference', reference_id: 'web_' + n.toString(16).padStart(32, '0'), title: `公开纸艺教程${n}`, summary: '这篇公开教程记录纸张折叠、连接及成品陈设的实际步骤，并说明材料选择与操作经验，可供模型结合需求发展创意。', source_url: `https://sspai.com/post/${n}`, observed_at: new Date(clock - n * 1000).toISOString(), source_platform: 'bing', ...extra });

test('有真实文本即缓存，无图无价可用，安全字段白名单且get返回clone', () => {
  const dir = directory(), cache = createMaterialCache({ directory: dir, now: () => clock });
  const record = material(1, { owner: 'private-owner', query: 'private-query', reason: 'private-reason', personalization: { name: 'private-name' }, price_amount: '999', stock_status: 'in_stock', image_url: 'https://example.cn/img.jpg' });
  Object.defineProperty(record, 'headers', { get() { throw Error('must not read headers'); } });
  assert.equal(cache.put([record]).status, 'stored');
  const first = cache.get();
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0].observed_at, record.observed_at);
  assert.equal(first.records[0].is_realtime, false);
  assert.equal(first.records[0].cache_observation, 'cached_public_material');
  const bytes = readFileSync(join(dir, 'materials.json'), 'utf8');
  for (const text of ['private-owner', 'private-query', 'private-reason', 'personalization', 'price_amount', 'stock_status', 'image_url', 'headers']) assert.equal(bytes.includes(text), false);
  first.records[0].title = 'mutated';
  assert.equal(cache.get().records[0].title, record.title);
});

test('web_/ref_a通用server ID兼容，商家页/无日期/未来/空摘要不伪造素材', () => {
  const cache = createMaterialCache({ directory: directory(), now: () => clock });
  const valid = material(1, { reference_id: 'ref_a' });
  const invalid = [material(2, { reference_kind: 'product' }), material(3, { source_url: 'https://item.jd.com/1.html' }), material(4, { observed_at: null }), material(5, { observed_at: new Date(clock + 1).toISOString() }), material(6, { observed_at: 'yesterday' }), material(7, { summary: '仅标题' }), material(8, { reference_id: 'bad/id' }), material(9, { source_url: 'https://sspai.com.evil.test/post/1' })];
  const result = cache.put([valid, ...invalid]);
  assert.equal(result.accepted, 1);
  assert.equal(result.rejected, invalid.length);
  assert.equal(cache.get().records[0].reference_id, 'ref_a');
  const raw = material(10, { title: '这是一段足够长但只是标题本身的公开说明', summary: '这是一段足够长但只是标题本身的公开说明' });
  assert.equal(cache.put([raw]).accepted, 0);
  assert.equal(cache.put([{ ...raw, text: material().summary }]).accepted, 1);
});

test('脱敏用户姓名地址及公开文本认证残片，不持久化查询/身份URL', () => {
  const dir = directory(), cache = createMaterialCache({ directory: dir, now: () => clock, sensitiveValues: [' 测试姓名 ', '测试市测试路88号'] });
  const record = material(1, { title: '测试姓名的公开教程', summary: '测试姓名在测试市测试路88号整理这篇步骤资料，联系fake@example.cn或13812345678。password=secret-value。其余公开步骤与材料经验足够构成正文。' });
  assert.equal(cache.put([record]).accepted, 1);
  const text = readFileSync(join(dir, 'materials.json'), 'utf8');
  for (const secret of ['测试姓名', '测试市测试路88号', 'fake@example.cn', '13812345678', 'secret-value']) assert.equal(text.includes(secret), false);
  assert.equal(cache.put([material(2, { source_url: 'https://sspai.com/post/2?q=private-search' }), material(3, { source_url: 'https://sspai.com/profile/123' }), material(4, { source_url: 'https://sspai.com/post/' + encodeURIComponent('测试姓名') })]).accepted, 0);
});

test('近20条/总80条/最长7天有界并报告截断，过期不改观察时刻续期', () => {
  let now = clock;
  const cache = createMaterialCache({ directory: directory(), maxRecords: 999, maxAgeMs: 999 * 86400000, now: () => now });
  const result = cache.put(Array.from({ length: 100 }, (_, i) => material(i + 1)));
  assert.equal(result.stored, 80);
  const snapshot = cache.get();
  assert.equal(snapshot.records.length, 20);
  assert.equal(snapshot.coverage.available_count, 80);
  assert.equal(snapshot.coverage.records_omitted, 60);
  assert.equal(snapshot.coverage.truncated, true);
  assert.equal(snapshot.coverage.max_age_ms, 7 * 86400000);
  assert.equal(snapshot.records[0].reference_id, material(1).reference_id);
  now += 8 * 86400000;
  assert.deepEqual(cache.get().records, []);
  assert.equal(cache.put([material(1)]).accepted, 0);
});

test('同一公开来源/ID去重保留较新原观察，不按语义关键词选礼', () => {
  const cache = createMaterialCache({ directory: directory(), now: () => clock, maxRecords: 3 });
  const old = material(1, { reference_id: 'ref_old' }), fresh = material(2, { source_url: old.source_url, observed_at: new Date(clock - 1).toISOString(), title: '完全不同的创意标题' });
  cache.put([old]); cache.put([fresh, material(3, { title: '和纸艺无关的自然观察' })]);
  const rows = cache.get().records;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, fresh.title);
  assert.equal(rows[0].observed_at, fresh.observed_at);
  assert.equal(rows[1].title, '和纸艺无关的自然观察');
});

test('损坏/超大文件读失败非阻塞，合法新观察可原子恢复', () => {
  const dir = directory(); mkdirSync(dir);
  writeFileSync(join(dir, 'materials.json'), '{broken');
  const cache = createMaterialCache({ directory: dir, now: () => clock });
  assert.equal(cache.get().coverage.status, 'unavailable');
  assert.equal(cache.put([material()]).status, 'stored');
  assert.equal(cache.get().records.length, 1);
  assert.equal(readdirSync(dir).filter(f => f.endsWith('.tmp')).length, 0);
  writeFileSync(join(dir, 'materials.json'), Buffer.alloc(512 * 1024 + 1));
  assert.equal(cache.get().coverage.status, 'unavailable');
});

test('只允许自己工作树.tmp缓存，写入失败不影响调用方且无原子临时文件残留', () => {
  const outside = createMaterialCache({ directory: join(REPO_ROOT, 'web', 'server'), now: () => clock });
  assert.equal(outside.put([material()]).status, 'unavailable');
  assert.equal(outside.get().records.length, 0);
  const dir = directory(); mkdirSync(join(dir, 'materials.json'), { recursive: true });
  const failed = createMaterialCache({ directory: dir, now: () => clock });
  assert.equal(failed.put([material()]).error_code, 'MATERIAL_CACHE_WRITE_FAILED');
  assert.equal(readdirSync(dir).filter(f => f.endsWith('.tmp')).length, 0);
});

test('拒绝符号链接或junction缓存目录', t => {
  const linked = directory(), target = directory(); mkdirSync(target);
  try { symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EISDIR', 'EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip(`当前环境不能创建受控junction夹具：${error.code}；路径拒绝逻辑未由此场景实测`); return; } throw error; }
  assert.equal(lstatSync(linked).isSymbolicLink(), true);
  assert.equal(createMaterialCache({ directory: linked, now: () => clock }).put([material()]).status, 'unavailable');
});
