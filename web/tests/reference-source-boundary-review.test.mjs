import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { validateSourceImage } from '../server/collect/domestic-detail.mjs';
import { fetchBrowserReferenceImage } from '../server/collect/domestic-browser.mjs';
import { publicReferenceUrl, readPublicReferencePageImage } from '../server/collect/public-reference.mjs';
import { referenceImageSlots, startReferenceImages } from '../server/retrieval/reference-images.mjs';
import { createOpencliToolSession } from '../server/retrieval/agent-tool.mjs';

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const imageUrl = 'https://tse1-mm.cn.bing.net/th/id/offline-boundary';

test('Bing区域图路径段边界和显式443：拒绝相似前缀、裸地区域及后缀欺骗', async () => {
  const requests = [];
  const fetchImpl = async url => { requests.push(String(url)); return new Response(gif, { headers: { 'content-type': 'image/gif' } }); };
  assert.equal((await validateSourceImage('https://tse1-mm.cn.bing.net:443/th?id=fixture', { role: 'reference', fetchImpl })).ok, true);
  const before = requests.length;
  for (const url of [
    'https://cn.bing.net/th/id/x',
    'https://tse1-mm.cn.bing.net.evil.test/th/id/x',
    'https://tse1-mm.cn.bing.net/thumbnail/id/x',
    'https://tse1-mm.cn.bing.net/thumbnails/id/x',
    'https://tse1-mm.cn.bing.net/th%2fid/x',
    'https://tse1-mm.cn.bing.net/th/../login',
  ]) assert.equal((await validateSourceImage(url, { role: 'reference', fetchImpl })).error_code, 'IMAGE_URL_NOT_ALLOWED', url);
  assert.equal(requests.length, before);
});

test('参考图重定向到商店CDN、非白名单或IPv6私网都在目标GET前拒绝', async () => {
  for (const target of ['https://img10.360buyimg.com/a.jpg', 'https://evil.test/a.gif', 'https://[::1]/a.gif', 'https://192.168.1.1/a.gif']) {
    const requests = [];
    const result = await validateSourceImage(imageUrl, { role: 'reference', fetchImpl: async url => {
      requests.push(String(url));
      return new Response(null, { status: 307, headers: { location: target } });
    } });
    assert.equal(result.error_code, 'IMAGE_REDIRECT_NOT_ALLOWED', target);
    assert.deepEqual(requests, [imageUrl]);
  }
});

test('浏览器CORS错误及可见跨来源302不暗中follow，也不触发降级网络请求', async () => {
  for (const mode of ['cors-failed', 'visible-redirect']) {
    let requests = 0;
    const response = await fetchBrowserReferenceImage(script => vm.runInNewContext(script, { btoa, fetch: async (_url, options) => {
      requests++;
      assert.equal(options.method, 'GET');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.mode, 'cors');
      assert.equal(options.redirect, 'manual');
      if (mode === 'cors-failed') throw new TypeError('offline CORS rejection');
      return new Response(null, { status: 302, headers: { location: 'https://img10.360buyimg.com/a.jpg' } });
    } }), imageUrl);
    assert.equal(requests, 1);
    if (mode === 'cors-failed') assert.equal(response.image_transport_error, 'IMAGE_CORS_OR_NETWORK_FAILED');
    else assert.equal(response.headers.get('location'), null);
    const validation = await validateSourceImage(imageUrl, { role: 'reference', fetchImpl: async () => response });
    assert.equal(validation.ok, false);
  }
});

test('明确参考CDN之间可跳转，每跳仍检查边界，后续商店跳转不放行', async () => {
  const approved = 'https://images.unsplash.com/offline.gif';
  for (const blockedSecondHop of [false, true]) {
    const requests = [];
    const result = await validateSourceImage(imageUrl, { role: 'reference', fetchImpl: async (url, options) => {
      requests.push(String(url));
      assert.equal(options.redirect, 'manual');
      assert.equal(options.credentials, 'omit');
      if (requests.length === 1) return new Response(null, { status: 302, headers: { location: approved } });
      if (blockedSecondHop) return new Response(null, { status: 302, headers: { location: 'https://img10.360buyimg.com/store.gif' } });
      return new Response(gif, { headers: { 'content-type': 'image/gif' } });
    } });
    assert.deepEqual(requests, [imageUrl, approved]);
    assert.equal(result.ok, !blockedSecondHop);
    if (blockedSecondHop) assert.equal(result.error_code, 'IMAGE_REDIRECT_NOT_ALLOWED');
  }
});

test('允许内容域上的规范化商品根路径及嵌套公开跳转不把商品页伪装成资讯', () => {
  const shopPaths = ['/product/design', '/%70roduct/design', '/cn/%70roducts/design', '//product/design', '/%2fproduct/design'];
  for (const path of shopPaths) assert.equal(publicReferenceUrl(`https://sspai.com${path}`, 'bing'), null, path);
  const shop = 'https://item.jd.com/10179988291541.html';
  const middle = `https://sspai.com/redirect?destination=${encodeURIComponent(shop)}`;
  const outer = `https://www.foodtalks.cn/redirect?next=${encodeURIComponent(middle)}`;
  assert.equal(publicReferenceUrl(outer, 'bing'), null);
  const bing = `https://cn.bing.com/ck/a?u=a1${Buffer.from(outer).toString('base64url')}`;
  assert.equal(publicReferenceUrl(bing, 'bing'), null);
  const news = 'https://www.foodtalks.cn/news/product/design-history';
  assert.equal(publicReferenceUrl(`https://sspai.com/redirect?target=${encodeURIComponent(news)}`, 'bing'), news);
  assert.equal(publicReferenceUrl(`${news}?utm_source=test#image`, 'bing'), news);
});

test('内容页观察后跳到商店：已观察图片不可绑定，合法news/product文章可保留', async () => {
  const expected = 'https://www.foodtalks.cn/news/product/design-history';
  for (const actual of ['https://sspai.com/product/design', 'https://item.jd.com/10179988291541.html', expected]) {
    const navigation = [];
    const result = await readPublicReferencePageImage({
      goto: async url => navigation.push(url),
      evaluate: async () => ({ status: 'ok', source_url: actual, image_url: imageUrl, image_provenance: 'public_page_image' }),
    }, { sourceUrl: expected, source: 'bing' });
    assert.deepEqual(navigation, [expected]);
    assert.equal(result.image_url, actual === expected ? imageUrl : null);
    assert.equal(result.status, actual === expected ? 'ok' : 'source_redirected');
  }
});

const candidates = [1, 2, 3].map(i => ({ id: `c${i}`, name: `离线灵感${i}` }));
const references = () => candidates.map((candidate, i) => ({
  reference_id: `ref${i + 1}`, title: candidate.name, reference_kind: 'public_reference',
  source_url: `https://www.foodtalks.cn/news/product/design-${i + 1}`,
  image_kind: 'reference_image', image_id: String(i + 1).repeat(32),
  image_validation: { ok: true, width: 100, height: 100, sha256: String(i + 1).repeat(64) },
}));
const bindings = records => records.map((record, i) => ({ candidate_id: candidates[i].id, reference_id: record.reference_id, image: { kind: 'reference_image', id: record.image_id, url: `/api/reference/images/${record.image_id}` } }));

test('同字节不同image_id的重复图只留一个，其余独立合法图仍可用', () => {
  const records = references();
  records[1].image_validation.sha256 = records[0].image_validation.sha256;
  const slots = referenceImageSlots(candidates, { references: records }, bindings(records));
  assert.deepEqual(slots.map(slot => slot.status), ['ready', 'unavailable', 'ready']);
  assert.equal(slots[1].image, null);
});

test('未知引用仅留下对应图片缺口，另外两图及文字可选性不受影响', async () => {
  const records = references();
  const session = createOpencliToolSession({ search: async () => ({ status: 'partial', references: records }) });
  await session.executeTool({ name: 'opencli_search', arguments: { purpose: 'reference', keyword: '离线边界', sources: ['bing'], reason: 'offline-only' } });
  const run = { run_id: 'offline-boundary-98', created_at: new Date().toISOString(), owner_scope: 'offline-review', candidates: structuredClone(candidates), retrieval: session.retrieval, media: { candidates: [] }, selectable_candidate_ids: ['c1', 'c2', 'c3'], call_counts: {} };
  const before = JSON.stringify(run.candidates);
  const job = startReferenceImages(run, { session, requestJson: '{}', requestImages: async () => ({ ok: true, model_calls: 0, reference_references: [{ candidate_id: 'c1', reference_id: 'ref1' }, { candidate_id: 'c2', reference_id: 'unknown' }, { candidate_id: 'c3', reference_id: 'ref3' }] }) });
  await job.promise;
  assert.deepEqual(run.reference_image_slots.map(slot => slot.status), ['ready', 'unavailable', 'ready']);
  assert.equal(job.status, 'unavailable');
  assert.deepEqual(job.missing_candidate_ids, ['c2']);
  assert.ok(job.rejected_references.some(item => item.candidate_id === 'c2' && item.code === 'UNKNOWN_REFERENCE'));
  assert.equal(JSON.stringify(run.candidates), before);
  assert.deepEqual(run.selectable_candidate_ids, ['c1', 'c2', 'c3']);
  assert.equal(run.call_counts.reference_images, 0);
});
