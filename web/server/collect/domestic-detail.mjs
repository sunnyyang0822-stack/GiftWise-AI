/** 详情及原图观察。仅读取商品固定区域；图片GET纯内存，不读Cookie或创建浏览器/文件。未真实验证。 */
import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {buildJdDetailReadScript,normalizeJdDetail} from './jd-detail-reader.mjs';
import {buildAlibabaDetailReadScript} from './alibaba-reader.mjs';

const CDN = ['alicdn.com', '360buyimg.com', 'pddpic.com', 'byteimg.com', 'douyinpic.com', 'kwaicdn.com', 'kwimgs.com', 'vipstatic.com', 'suning.cn', 'mi-img.com', 'youpin.mi-img.com', 'geilicdn.com', 'dangdang.com'];
const REFERENCE_CDN=['mm.bing.net','th.bing.com','duckduckgo.com','pinimg.com','hdslb.com','xhscdn.com','zhimg.com','sinaimg.cn','doubanio.com','zdmimg.com','huaban.com','cdn.sspai.com','images.unsplash.com','images.pexels.com','imgix.net'];
const DETAILS = {
  jd: { host: 'item.jd.com', path: '^/[0-9]+\\.html$', root: '.product-intro, .page-content-main', title: '.sku-name, .sku-title-text', price: '.summary-price .p-price, .summary-price .price, .product-price--main', sku: '#choose-attrs .selected, #choose-attrs .item.selected, .specification-item-sku.selected, .specification-item-sku.active, .specification-item-sku[aria-checked="true"]', gallery: '#spec-n1 img, #spec-list img', currency: '.summary-price, .product-price-panel' },
  taobao: { host: 'item.taobao.com', path: '^/item\\.htm$', id: 'id', root: '#detail, [class*="ItemDetail--"]', title: '.tb-main-title, [class*="mainTitle--"]', price: '.tb-property .tb-rmb-num, [class*="Price--priceText"], [class*="priceText--"]', sku: '.tb-sku .tb-selected, [class*="skuItem--"][class*="selected"]', gallery: '#J_ImgBooth, #J_UlThumb img, [class*="mainPic--"] img', currency: '.tb-property, [class*="Price--"], [class*="price--"]' },
  tmall: { host: 'detail.tmall.com', path: '^/item\\.htm$', id: 'id', root: '#detail, [class*="ItemDetail--"]', title: '.tb-detail-hd h1, [class*="mainTitle--"]', price: '.tm-price-panel .tm-price, [class*="Price--priceText"], [class*="priceText--"]', sku: '.tb-sku .tb-selected, [class*="skuItem--"][class*="selected"]', gallery: '#J_ImgBooth, #J_UlThumb img, [class*="mainPic--"] img', currency: '.tm-price-panel, [class*="Price--"], [class*="price--"]' },
  '1688': { host: 'detail.1688.com', path: '^/offer/[0-9]+\\.html$', root: '#mod-detail, .detail-main, #detail', title: '.d-title, .title-text, [class*="title-text"]', price: '.price-component, .price-container, .price-now', sku: '.sku-selector .selected, .sku-item.selected', gallery: '.detail-gallery img, .detail-gallery-preview img, .detail-image-view img', currency: '.price-component, .price-container, .price-now' },
};
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const inDomain = (host, domains) => domains.some(d => host === d || host.endsWith(`.${d}`));

function validImageUrl(value, role) {
  try {
    const url = new URL(value);
    const regionalBing=role==='reference'&&/^tse[1-4]-mm\.cn\.bing\.net$/.test(url.hostname)&&/^\/th(?:\/|$)/.test(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || (!regionalBing&&!inDomain(url.hostname, role==='reference'?REFERENCE_CDN:CDN))) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

function detailUrl(value, platform) {
  const cfg = DETAILS[platform];
  if (!cfg) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== cfg.host || !new RegExp(cfg.path).test(url.pathname)) return null;
    if (cfg.id && !/^\d+$/.test(url.searchParams.get(cfg.id) || '')) return null;
    return url;
  } catch { return null; }
}

function publicAddress(address, family) {
  if (family === 4) {
    const p = address.split('.').map(Number);
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && [0, 168].includes(p[1])) || (p[0] === 198 && [18, 19, 51].includes(p[1])) || (p[0] === 203 && p[1] === 0 && p[2] === 113));
  }
  return family === 6 && /^[23][0-9a-f]{0,3}:/i.test(address) && !/^2001:0?db8:/i.test(address) && !address.includes('.') && !/^2001:(?:0:|2:|10:|20:)/i.test(address);
}

/** 默认传输固定已验证DNS地址。fetchImpl仅是可信传输/离线测试注入，不读取或转发认证。 */
async function pinnedGet(url, { signal, headers }) {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address, a.family))) throw Object.assign(new Error('Unsafe DNS address'), { code: 'IMAGE_PRIVATE_ADDRESS' });
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', signal, headers, agent: false, lookup: (_host, options, callback) => options.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family) }, res => {
      const responseHeaders = new Headers();
      for (const name of ['content-type', 'content-length', 'location']) if (res.headers[name]) responseHeaders.set(name, String(res.headers[name]));
      resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: responseHeaders, body: Readable.toWeb(res) });
    });
    req.once('error', reject);
    req.setTimeout(15000, () => req.destroy(Object.assign(new Error('Image timeout'), { code: 'IMAGE_TIMEOUT' })));
    req.end();
  });
}

const fail = (error_code, extras = {}) => ({ ok: false, mime: null, width: null, height: null, byte_length: 0, error_code, ...extras });
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};

function pngDimensions(b) {
  if (b.length < 45 || !b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG');
  let offset = 8, width, height, ihdr, ended = false;
  const idat = [];
  while (offset + 12 <= b.length) {
    const size = b.readUInt32BE(offset), end = offset + 12 + size;
    if (end > b.length) throw new Error('PNG truncated');
    const type = b.toString('ascii', offset + 4, offset + 8);
    if (crc32(b.subarray(offset + 4, end - 4)) !== b.readUInt32BE(end - 4)) throw new Error('PNG CRC');
    if (offset === 8 && (type !== 'IHDR' || size !== 13)) throw new Error('PNG header');
    if (type === 'IHDR') { if (ihdr) throw new Error('PNG duplicate header'); ihdr = b.subarray(offset + 8, end - 4); width = ihdr.readUInt32BE(0); height = ihdr.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(b.subarray(offset + 8, end - 4));
    offset = end;
    if (type === 'IEND') { if (size !== 0 || offset !== b.length) throw new Error('PNG ending'); ended = true; break; }
  }
  if (!ended || !idat.length || !width || !height || width * height > 40_000_000) throw new Error('PNG incomplete');
  // 非交错PNG额外核对解压后行长度及滤波标识；交错图仍执行限额解压/CRC。
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr[9]];
  if (!channels || ![1, 2, 4, 8, 16].includes(ihdr[8]) || ihdr[10] || ihdr[11] || ihdr[12] > 1) throw new Error('PNG format');
  const decoded = inflateSync(Buffer.concat(idat), { maxOutputLength: 170_000_000 });
  if (ihdr[12] === 0) {
    const stride = Math.ceil(width * channels * ihdr[8] / 8) + 1;
    if (decoded.length !== stride * height) throw new Error('PNG rows');
    for (let i = 0; i < decoded.length; i += stride) if (decoded[i] > 4) throw new Error('PNG filter');
  }
  return { width, height };
}

function jpegDimensions(b) {
  if (b.length < 20 || b.readUInt16BE(0) !== 0xffd8 || b.readUInt16BE(b.length - 2) !== 0xffd9) throw new Error('JPEG');
  let offset = 2, width, height, scan = false, quant = false, table = false, entropy = 0;
  while (offset < b.length - 2) {
    if (b[offset] !== 255) throw new Error('JPEG marker');
    while (b[offset] === 255) offset++;
    const marker = b[offset++];
    if (marker === 0xd9) throw new Error('JPEG early ending');
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > b.length) throw new Error('JPEG length');
    const size = b.readUInt16BE(offset);
    if (size < 2 || offset + size > b.length - 2) throw new Error('JPEG truncated');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size < 11 || !b[offset + 7] || size !== 8 + 3 * b[offset + 7]) throw new Error('JPEG SOF');
      height = b.readUInt16BE(offset + 3); width = b.readUInt16BE(offset + 5);
    }
    if (marker === 0xdb) quant = true;
    if (marker === 0xc4 || marker === 0xcc) table = true;
    offset += size;
    if (marker === 0xda) {
      scan = true;
      while (offset < b.length - 2) {
        if (b[offset] !== 255) { offset++; entropy++; continue; }
        if (b[offset + 1] === 0 || (b[offset + 1] >= 0xd0 && b[offset + 1] <= 0xd7)) { offset += 2; continue; }
        break;
      }
    }
  }
  if (!width || !height || !scan || !quant || !table || !entropy) throw new Error('JPEG incomplete');
  return { width, height };
}

function gifDimensions(b) {
  if (b.length < 14 || !['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))) throw new Error('GIF');
  const width = b.readUInt16LE(6), height = b.readUInt16LE(8);
  let offset = 13 + ((b[10] & 128) ? 3 * (1 << ((b[10] & 7) + 1)) : 0), images = 0, ended = false;
  const subblocks = () => { let total = 0; while (offset < b.length) { const size = b[offset++]; if (!size) return total; if (offset + size > b.length) throw new Error('GIF truncated'); offset += size; total += size; } throw new Error('GIF blocks'); };
  while (offset < b.length) {
    const marker = b[offset++];
    if (marker === 0x3b) { ended = offset === b.length; break; }
    if (marker === 0x21) { offset++; subblocks(); continue; }
    if (marker !== 0x2c || offset + 9 > b.length) throw new Error('GIF descriptor');
    const flags = b[offset + 8]; offset += 9;
    if (flags & 128) offset += 3 * (1 << ((flags & 7) + 1));
    if (b[offset] < 2 || b[offset] > 8) throw new Error('GIF LZW');
    offset++;
    if (!subblocks()) throw new Error('GIF empty');
    images++;
  }
  if (!ended || !images) throw new Error('GIF incomplete');
  return { width, height };
}

function webpDimensions(b) {
  if (b.length < 26 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP' || b.readUInt32LE(4) + 8 !== b.length) throw new Error('WEBP');
  let offset = 12, dimensions = null, bitstream = false;
  while (offset + 8 <= b.length) {
    const type = b.toString('ascii', offset, offset + 4), size = b.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > b.length) throw new Error('WEBP truncated');
    if (type === 'VP8X') { if (size !== 10) throw new Error('WEBP VP8X'); dimensions = { width: 1 + b.readUIntLE(start + 4, 3), height: 1 + b.readUIntLE(start + 7, 3) }; }
    if (type === 'VP8 ') { if (size < 11 || !b.subarray(start + 3, start + 6).equals(Buffer.from([157, 1, 42]))) throw new Error('WEBP VP8'); dimensions ||= { width: b.readUInt16LE(start + 6) & 0x3fff, height: b.readUInt16LE(start + 8) & 0x3fff }; bitstream = true; }
    if (type === 'VP8L') { if (size < 6 || b[start] !== 47) throw new Error('WEBP VP8L'); const bits = b.readUInt32LE(start + 1); dimensions ||= { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; bitstream = true; }
    offset = start + size + (size & 1);
  }
  if (offset !== b.length || !bitstream || !dimensions) throw new Error('WEBP incomplete');
  return dimensions;
}

function avifDimensions(b) {
  if(b.length<32||b.toString('ascii',4,8)!=='ftyp')throw new Error('AVIF');
  const brandEnd=b.readUInt32BE(0);
  if(brandEnd>b.length||!/(avif|avis)/.test(b.toString('ascii',8,brandEnd)))throw new Error('AVIF brand');
  let dimensions=null,media=false;
  function boxes(start,end,depth=0){
    if(depth>8)throw new Error('AVIF nesting');
    for(let p=start;p<end;){if(p+8>end)throw new Error('AVIF box');let size=b.readUInt32BE(p),header=8;const type=b.toString('ascii',p+4,p+8);
      if(size===1){if(p+16>end)throw new Error('AVIF length');const n=b.readBigUInt64BE(p+8);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('AVIF length');size=Number(n);header=16;}else if(size===0)size=end-p;
      if(size<header||p+size>end)throw new Error('AVIF truncated');
      if(type==='ispe'){if(size<20)throw new Error('AVIF ispe');const width=b.readUInt32BE(p+12),height=b.readUInt32BE(p+16);if(!dimensions)dimensions={width,height};}
      if(type==='mdat'&&size>header)media=true;
      if(['meta','iprp','ipco'].includes(type))boxes(p+header+(type==='meta'?4:0),p+size,depth+1);
      p+=size;
    }
  }
  boxes(0,b.length);if(!dimensions||!media)throw new Error('AVIF incomplete');return dimensions;
}
export function inspectImage(bytes, mime) {
  const parsers = { 'image/png': pngDimensions, 'image/jpeg': jpegDimensions, 'image/gif': gifDimensions, 'image/webp': webpDimensions, 'image/avif': avifDimensions };
  const parser = parsers[mime];
  if (!parser) throw new Error('MIME');
  const dimensions = parser(bytes);
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 40_000_000) throw new Error('Image dimensions');
  return dimensions;
}

export async function validateSourceImage(value, { fetchImpl, signal, maxBytes = 8 * 1024 * 1024, includeBytes = false, role = 'product' } = {}) {
  const limit = Math.min(20 * 1024 * 1024, Math.max(1, Number(maxBytes) || 8 * 1024 * 1024));
  let url = validImageUrl(value,role);
  if (!url) return fail('IMAGE_URL_NOT_ALLOWED');
  if (signal?.aborted) return fail('IMAGE_ABORTED');
  let reader;
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      const response = await (fetchImpl || pinnedGet)(url, { method: 'GET', redirect: 'manual', credentials: 'omit', imageRole:role, signal, headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' } });
      if(['IMAGE_CORS_OR_NETWORK_FAILED','IMAGE_REDIRECT_NOT_ALLOWED','IMAGE_TOO_LARGE'].includes(response.image_transport_error))return fail(response.image_transport_error);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel?.();
        const target = response.headers.get('location');
        if (!target) return fail('IMAGE_REDIRECT_INVALID');
        url = validImageUrl(new URL(target, url).href,role);
        if (!url) return fail('IMAGE_REDIRECT_NOT_ALLOWED');
        if (redirects === 4) return fail('IMAGE_REDIRECT_LIMIT');
        continue;
      }
      if (!response.ok) { await response.body?.cancel?.(); return fail('IMAGE_HTTP_STATUS', { http_status: response.status }); }
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp','image/avif'].includes(mime)) { await response.body?.cancel?.(); return fail('IMAGE_MIME_NOT_ALLOWED', { mime: mime || null }); }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > limit) { await response.body?.cancel?.(); return fail('IMAGE_TOO_LARGE', { mime }); }
      if (!response.body?.getReader) return fail('IMAGE_NO_BODY', { mime });
      reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        if (signal?.aborted) { await reader.cancel(); return fail('IMAGE_ABORTED', { mime, byte_length: size }); }
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); return fail('IMAGE_TOO_LARGE', { mime, byte_length: size }); }
        chunks.push(Buffer.from(chunk.value));
      }
      if (response.headers.has('content-length') && Number.isFinite(length) && length !== size) return fail('IMAGE_LENGTH_MISMATCH', { mime, byte_length: size });
      try {
        const bytes = Buffer.concat(chunks);
        const dimensions = inspectImage(bytes, mime);
        return { ok: true, mime, ...dimensions, byte_length: size, sha256: createHash('sha256').update(bytes).digest('hex'), error_code: null, final_url: url.href, validation_level: 'signature_structure_dimensions', observed_at: new Date().toISOString(),...(includeBytes?{bytes}:{}) };
      } catch { return fail('IMAGE_INVALID_BYTES', { mime, byte_length: size }); }
    }
  } catch (error) { await reader?.cancel?.().catch(() => {}); return fail(signal?.aborted ? 'IMAGE_ABORTED' : error?.code === 'IMAGE_PRIVATE_ADDRESS' ? error.code : 'IMAGE_GET_FAILED'); }
}

export function buildDomesticDetailReadScript(platform) {
  const cfg = DETAILS[platform];
  if (!cfg) throw new TypeError('尚未实现该平台详情读取');
  return `(${readDetail.toString()})(${JSON.stringify(cfg)})`;
}

function readDetail(cfg) {
  const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const body = text(document.body);
  const result = { page_kind: 'detail', page_url: location.href, title: null, specifications: null, price_text: null, currency_evidence: null, price_conditions: [], price_unit: null, image_url: null };
  if (/验证码|安全验证|访问受限|异常访问/.test(body) || /captcha|risk_handler|_____tmd_____/i.test(location.pathname)) return { ...result, status: 'restricted' };
  if (/扫码登录|请先登录|登录后查看/.test(body) || /login|passport|signin/i.test(location.hostname + location.pathname)) return { ...result, status: 'login_required' };
  if (location.hostname !== cfg.host || !new RegExp(cfg.path).test(location.pathname)) return { ...result, status: 'redirected' };
  const root = document.querySelector(cfg.root);
  if (!root) return { ...result, status: 'detail_root_missing' };
  const usable = node => node && !node.closest('.recommend, .recommendations, .recommend-wrap, [class*="recommend"], [class*="Recommend"], .related-products');
  const first = selector => Array.from(root.querySelectorAll(selector)).find(usable);
  result.title = text(first(cfg.title)) || null;
  result.price_text = text(first(cfg.price)) || null;
  const currency = text(first(cfg.currency));
  result.currency_evidence = currency.match(/[¥￥]|人民币|CNY|元/)?.[0] || null;
  result.price_conditions = currency.match(/首单到手价|新人专享|新客专享|券后|补贴后|会员价|预售价|定金|起批|起/g) || [];
  result.price_context_text=currency||null;
  result.price_unit = (result.price_text || currency).match(/(?:元|[¥￥])\s*\/\s*([^\s，,;；]+)/)?.[1] || null;
  const specs = Array.from(root.querySelectorAll(cfg.sku)).filter(usable).map(text).filter(Boolean);
  if(!specs.length&&cfg.host==='item.jd.com'){
    const exact=Array.from(root.querySelectorAll('.specification-item-sku-text')).map(text).filter(value=>value&&result.title?.endsWith(value)).sort((a,b)=>b.length-a.length);
    if(exact.length){specs.push(exact[0]);result.specifications_basis='same_sku_detail_title_exact_option';}
  }
  result.specifications = specs.length ? [...new Set(specs)].join('；') : null;
  const image = first(cfg.gallery);
  result.image_url = image?.getAttribute('data-origin') || image?.getAttribute('jqimg') || image?.getAttribute('data-src') || image?.currentSrc || image?.src || null;
  return { ...result, status: result.title ? 'ok' : 'detail_title_missing' };
}

export async function enrichDomesticDetail(page, record, { platform, signal, fetchImpl, includeImageBytes = false } = {}) {
  const observation = { platform, page_kind: 'detail', status: 'not_observed', observed_at: new Date().toISOString(), verification_status: 'not_live_verified' };
  const output = { ...record, image_url: null, image_validation: null, image_provenance: null, detail_observation: observation };
  const requested = detailUrl(record?.product_url, platform);
  if (!requested) { observation.status = DETAILS[platform] ? 'detail_url_not_allowed' : 'detail_platform_not_implemented'; return output; }
  if (signal?.aborted) { observation.status = 'aborted'; return output; }
  try {
    await page.goto(requested.href);
    if (page.wait) await page.wait(2);
    if (signal?.aborted) { observation.status = 'aborted'; return output; }
    let raw;
    if(platform==='jd'){
      const observed=await page.evaluate(buildJdDetailReadScript());
      if(observed.source_url){
        const normalized=normalizeJdDetail(observed,{product_url:requested.href,external_id:record.external_id});
        raw={...normalized,page_url:observed.source_url,status:normalized.observation.status,price_text:normalized.observation.price_text,
          currency_evidence:normalized.currency,price_context_text:normalized.observation.price_context};
      }else raw=observed; // injected legacy fixture compatibility
    }else if(['taobao','tmall'].includes(platform)){
      const observed=await page.evaluate(buildAlibabaDetailReadScript(platform));
      raw={...observed,page_url:observed.product_url??requested.href};
      if(['detail_root_missing','detail_title_missing'].includes(raw.status)){
        await page.wait(3);const retry=await page.evaluate(buildAlibabaDetailReadScript(platform));raw={...retry,page_url:retry.product_url??requested.href};
      }
    }else raw=await page.evaluate(buildDomesticDetailReadScript(platform));
    if (['restricted','login_required'].includes(raw.status)) { observation.status=raw.status; return output; }
    const actual = detailUrl(raw.page_url, platform);
    const sameProduct = actual && actual.pathname === requested.pathname && (!DETAILS[platform].id || actual.searchParams.get(DETAILS[platform].id) === requested.searchParams.get(DETAILS[platform].id))&&(!requested.searchParams.get('skuId')||!actual.searchParams.get('skuId')||requested.searchParams.get('skuId')===actual.searchParams.get('skuId'));
    observation.status = sameProduct ? raw.status : 'detail_product_changed';
    observation.observed_at = new Date().toISOString();
    if (sameProduct && raw.status === 'ok') {
      observation.verification_status='page_observed';
      output.page_kind='detail';
      output.title = clean(raw.title) || null;
      output.specifications = clean(raw.specifications) || null;
      output.specifications_basis=raw.specifications_basis??(output.specifications?'selected_option':null);
      output.secondary_price_text=raw.secondary_price_text??null;
      output.price_text = clean(raw.price_text) || null;
      output.currency = output.price_text && raw.currency_evidence ? 'CNY' : null;
      const price = output.currency ? output.price_text?.replace(/\s+/g,'').match(/^(?:[¥￥]|人民币|CNY)?(\d[\d,]*(?:\.\d+)?)(?:元)?$/) : null;
      output.price_amount = price ? price[1].replace(/,/g, '') : null;
      output.price_conditions = [...new Set([...(Array.isArray(raw.price_conditions) ? raw.price_conditions.filter(c => typeof c === 'string') : []), ...(output.price_text?.match(/券后|补贴后|会员价|预售价|定金|起批|起/g) || [])])];
      output.price_unit = clean(raw.price_unit) || null;
      output.price_observed_at = observation.observed_at;
      output.scraped_at = observation.observed_at;
      output.observed_at=observation.observed_at;
      output.raw_excerpt={...record.raw_excerpt,detail_price_context:raw.price_context_text??null,detail_specifications:output.specifications,detail_title:output.title};
    }
    if (signal?.aborted) { observation.status = 'aborted'; return output; }
    const detailImage = sameProduct && raw.status === 'ok' && clean(raw.image_url);
    const candidate = detailImage || clean(record.image_url);
    if (candidate) {
      let imageUrl;
      try { imageUrl = new URL(candidate, requested).href; } catch { imageUrl = candidate; }
      output.image_validation = await validateSourceImage(imageUrl, { fetchImpl, signal,includeBytes:includeImageBytes });
      if(output.image_validation.ok&&raw.image_natural_width&&raw.image_natural_height&&
        (raw.image_natural_width!==output.image_validation.width||raw.image_natural_height!==output.image_validation.height)){
        output.image_validation=fail('IMAGE_DIMENSION_MISMATCH');
      }
      output.image_provenance = { page_kind: detailImage ? 'detail' : 'search', product_url: requested.href, observed_at: observation.observed_at };
      if (output.image_validation.ok) output.image_url = imageUrl;
    }
    return output;
  } catch { observation.status = signal?.aborted ? 'aborted' : 'detail_read_failed'; return output; }
}
