import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { deflateSync } from 'node:zlib';
import { buildDomesticDetailReadScript, validateSourceImage, enrichDomesticDetail } from '../server/collect/domestic-detail.mjs';

const URL_IMAGE = 'https://img10.360buyimg.com/n1/example.png';
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, bytes) { const body = Buffer.concat([Buffer.from(type), bytes]), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]); }
function png() { const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]); }
// 完整1x1灰色baseline JPEG：单分量、量化表、DC/AC Huffman表与一块零系数扫描。
function jpeg() {
  const segment = (marker, bytes) => { const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length + 2); return Buffer.concat([Buffer.from([255, marker]), length, bytes]); };
  const counts = Buffer.from([1, ...Array(15).fill(0)]);
  return Buffer.concat([Buffer.from([255, 216]), segment(219, Buffer.from([0, ...Array(64).fill(1)])), segment(192, Buffer.from([8, 0, 1, 0, 1, 1, 1, 17, 0])), segment(196, Buffer.concat([Buffer.from([0]), counts, Buffer.from([0, 16]), counts, Buffer.from([0])])), segment(218, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([63, 255, 217])]);
}
const respond = (bytes, type = 'image/png', status = 200) => new Response(bytes, { status, headers: { 'content-type': type } });

test('原图GET验证PNG/JPEG/GIF的MIME、magic、自然尺寸与字节长度', async () => {
  for (const [bytes, mime] of [[png(), 'image/png'], [jpeg(), 'image/jpeg'], [Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), 'image/gif']]) {
    let calls = 0;
    const result = await validateSourceImage(URL_IMAGE, { fetchImpl: async (_url, options) => { calls++; assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); assert.equal(Object.hasOwn(options.headers, 'Cookie'), false); return respond(bytes, mime); } });
    assert.equal(calls, 1);
    assert.equal(result.ok, true, result.error_code);
    assert.equal(result.mime, mime);
    assert.equal(result.width, 1);
    assert.equal(result.height, 1);
    assert.equal(result.byte_length, bytes.length);
  }
});

test('HTML、错误MIME、截断/CRC坏图及无真实码流WebP拒绝', async () => {
  const broken = png(); broken[broken.length - 5] ^= 1;
  for (const [bytes, mime, error] of [[Buffer.from('<html>login</html>'), 'text/html', 'IMAGE_MIME_NOT_ALLOWED'], [png(), 'image/jpeg', 'IMAGE_INVALID_BYTES'], [jpeg().subarray(0, 30), 'image/jpeg', 'IMAGE_INVALID_BYTES'], [broken, 'image/png', 'IMAGE_INVALID_BYTES'], [Buffer.from('RIFF\x12\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00', 'binary'), 'image/webp', 'IMAGE_INVALID_BYTES']]) {
    const result = await validateSourceImage(URL_IMAGE, { fetchImpl: async () => respond(bytes, mime) });
    assert.equal(result.ok, false);
    assert.equal(result.error_code, error);
  }
});

test('白名单外/私网/认证URL/非HTTPS在GET前拒绝，重定向逐跳检查', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return respond(png()); };
  for (const url of ['http://img10.360buyimg.com/1', 'https://127.0.0.1/1', 'https://[::1]/1', 'file:///tmp/1', 'data:image/png,x', 'https://360buyimg.com.evil.test/1', 'https://user:pass@img10.360buyimg.com/1', 'https://img10.360buyimg.com:8443/1']) assert.equal((await validateSourceImage(url, { fetchImpl })).error_code, 'IMAGE_URL_NOT_ALLOWED');
  assert.equal(calls, 0);
  const redirected = await validateSourceImage(URL_IMAGE, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/image.png' } }) });
  assert.equal(redirected.error_code, 'IMAGE_REDIRECT_NOT_ALLOWED');
  let redirects = 0;
  const valid = await validateSourceImage(URL_IMAGE, { fetchImpl: async () => ++redirects === 1 ? new Response(null, { status: 302, headers: { location: 'https://img11.360buyimg.com/large.png' } }) : respond(png()) });
  assert.equal(valid.ok, true);
  assert.equal(valid.final_url, 'https://img11.360buyimg.com/large.png');
});

test('体积/HTTP失败/取消有明确失败元数据', async () => {
  assert.equal((await validateSourceImage(URL_IMAGE, { fetchImpl: async () => respond(png()), maxBytes: 10 })).error_code, 'IMAGE_TOO_LARGE');
  assert.equal((await validateSourceImage(URL_IMAGE, { fetchImpl: async () => respond(null, 'image/png', 403) })).error_code, 'IMAGE_HTTP_STATUS');
  assert.equal((await validateSourceImage(URL_IMAGE, { fetchImpl: async () => { throw new Error('secret'); } })).error_code, 'IMAGE_GET_FAILED');
  assert.equal((await validateSourceImage(URL_IMAGE, { signal: AbortSignal.abort(), fetchImpl: async () => { throw new Error('must not run'); } })).error_code, 'IMAGE_ABORTED');
});

function detailDom({ price = '¥39.90', currency = '¥', specifications = [], image = URL_IMAGE } = {}) {
  const node = (value, recommended = false) => ({ innerText: value, closest: () => recommended ? {} : null });
  const gallery = (url, recommended = false) => ({ closest: () => recommended ? {} : null, getAttribute: name => name === 'data-origin' ? url : null });
  const root = { querySelectorAll: selector => {
    if (selector === '.sku-name') return [node('推荐区错误商品', true), node('当前商品名称')];
    if (selector.startsWith('.summary-price .')) return price ? [node(price)] : [];
    if (selector === '.summary-price') return [node(currency)];
    if (selector.startsWith('#choose-attrs')) return specifications.map(s => node(s));
    if (selector.startsWith('#spec-n1')) return [gallery('https://img10.360buyimg.com/recommended.png', true), gallery(image)];
    throw new Error('不应读取全页或非固定商品区域');
  } };
  return vm.runInNewContext(buildDomesticDetailReadScript('jd'), { location: new URL('https://item.jd.com/123.html'), document: { body: { innerText: '' }, querySelector: selector => { assert.equal(selector, '.product-intro'); return root; } } });
}

test('仅当前商品gallery/标题/已选SKU；原图GET完成才输出绑定图片', async () => {
  const raw = detailDom();
  assert.equal(raw.title, '当前商品名称');
  assert.equal(raw.specifications, null);
  assert.equal(raw.image_url, URL_IMAGE);
  const goto = [];
  const record = await enrichDomesticDetail({ goto: async url => goto.push(url), evaluate: async () => raw }, { product_url: 'https://item.jd.com/123.html', title: '搜索标题', specifications: '未知规格不应沿用' }, { platform: 'jd', fetchImpl: async () => respond(png()) });
  assert.deepEqual(goto, ['https://item.jd.com/123.html']);
  assert.equal(record.title, '当前商品名称');
  assert.equal(record.specifications, null);
  assert.equal(record.price_amount, '39.90');
  assert.equal(record.currency, 'CNY');
  assert.equal(record.image_url, URL_IMAGE);
  assert.equal(record.image_validation.ok, true);
  assert.equal(record.image_provenance.page_kind, 'detail');
  assert.equal(record.image_provenance.product_url, record.product_url);
});

test('价格缺币种/条件报价不冒充确定价，坏图不阻断详情', async () => {
  const raw = detailDom({ price: '券后39.90起', currency: '元', specifications: ['黑色', '标准套装'] });
  const record = await enrichDomesticDetail({ goto: async () => {}, evaluate: async () => raw }, { product_url: 'https://item.jd.com/123.html' }, { platform: 'jd', fetchImpl: async () => respond(Buffer.from('<html>'), 'text/html') });
  assert.equal(record.specifications, '黑色；标准套装');
  assert.equal(record.price_amount, null);
  assert.deepEqual(record.price_conditions, ['券后', '起']);
  assert.equal(record.image_url, null);
  assert.equal(record.image_validation.ok, false);
  assert.equal(record.detail_observation.status, 'ok');
  const unknown = await enrichDomesticDetail({ goto: async () => {}, evaluate: async () => detailDom({ price: '39.90', currency: '' }) }, { product_url: 'https://item.jd.com/123.html' }, { platform: 'jd', fetchImpl: async () => respond(png()) });
  assert.equal(unknown.currency, null);
  assert.equal(unknown.price_amount, null);
});

test('换商品/登录/错误站点保留观察状态，搜索卡片图片不得冒充详情图', async () => {
  const invalid = await enrichDomesticDetail({ goto: async () => { throw new Error('must not run'); } }, { product_url: 'https://item.jd.com.evil.test/123.html' }, { platform: 'jd' });
  assert.equal(invalid.detail_observation.status, 'detail_url_not_allowed');
  const result = await enrichDomesticDetail({ goto: async () => {}, evaluate: async () => ({ ...detailDom(), page_url: 'https://item.jd.com/456.html' }) }, { title: '原商品', product_url: 'https://item.jd.com/123.html', image_url: URL_IMAGE }, { platform: 'jd', fetchImpl: async () => respond(png()) });
  assert.equal(result.title, '原商品');
  assert.equal(result.detail_observation.status, 'detail_product_changed');
  assert.equal(result.image_provenance.page_kind, 'search');
});
