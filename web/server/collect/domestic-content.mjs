/** 灵感资料通道：公开卡片内容不是商品报价、购买绑定或商品实拍证据。 */
import{publicReferenceUrl}from'./public-reference.mjs';
const clean = (value, limit = 300) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const configs = [
  { id: 'xiaohongshu', name: '小红书', domain: 'xiaohongshu.com', kind: 'content', base: 'https://www.xiaohongshu.com/search_result', query: 'keyword', cards: 'section.note-item, section:has(a[href*="/explore/"]), section:has(a[href*="/search_result/"])', links: 'a[href*="/explore/"], a[href*="/search_result/"]', title: '.title, [class*="title"]', author: '.author .name, .author-wrapper .name', summary: '.desc, .description', paths: '^/(explore|search_result|note)/[a-zA-Z0-9]+', cliArgs: ['query', '--limit', '--sort', '--note-type', '--publish-time', '--scope', '--location'] },
  { id: 'bilibili', name: '哔哩哔哩', domain: 'bilibili.com', kind: 'video', base: 'https://search.bilibili.com/video', query: 'keyword', pageKey: 'page', cards: '.bili-video-card, .video-item', links: 'a[href*="/video/"]', title: '.bili-video-card__info--tit, .title, h3', author: '.bili-video-card__info--author, .up-name', summary: '.desc', paths: '^/video/(BV[a-zA-Z0-9]+|av[0-9]+)', cliArgs: ['query', '--type', '--page', '--limit'] },
  { id: 'zhihu', name: '知乎', domain: 'zhihu.com', kind: 'content', base: 'https://www.zhihu.com/search', query: 'q', cards: '.SearchResult-Card, .SearchResult-Card .ContentItem, .List-item', links: 'a[href*="/question/"], a[href*="zhuanlan.zhihu.com/p/"]', title: '.ContentItem-title, h2', author: '.AuthorInfo-name', summary: '.RichContent-inner, .RichText', paths: '^/(question/[0-9]+|p/[0-9]+)', cliArgs: ['query', '--type', '--limit'] },
  { id: 'weibo', name: '微博', domain: 'weibo.com', kind: 'content', base: 'https://s.weibo.com/weibo', query: 'q', pageKey: 'page', cards: '.card-wrap', links: '.from a', title: '[node-type="feed_list_content_full"], [node-type="feed_list_content"], .txt', author: '.info .name, .name', summary: '.txt', paths: '^/([0-9]+/[a-zA-Z0-9]+|(detail|status)/[a-zA-Z0-9]+)', cliArgs: ['keyword', '--limit'] },
  { id: 'douban', name: '豆瓣', domain: 'douban.com', kind: 'content', base: 'https://search.douban.com/movie/subject_search', query: 'search_text', cards: '.item-root, .result-list .result-item', links: '.title a, h3 a, a[href*="/subject/"]', title: '.title-text, .title h3, h3', author: '.author', summary: '.meta.abstract, .meta, .abstract, .subject-abstract, p', paths: '^/(subject/[0-9]+|note/[0-9]+|event/[0-9]+)', cliArgs: ['keyword', '--type', '--limit'] },
  { id: 'douyin', name: '抖音', domain: 'douyin.com', kind: 'video', base: 'https://www.douyin.com/search/', cards: '[data-e2e="scroll-list"] li', links: 'a[href*="/video/"]', title: '[data-e2e="video-desc"], [class*="desc"], [class*="title"]', author: '[data-e2e="video-author"], [class*="author"]', summary: '[data-e2e="video-desc"], [class*="desc"]', paths: '^/video/[0-9]+', cliArgs: ['query', '--limit'] },
  { id: 'huodongxing', name: '活动行', domain: 'huodongxing.com', kind: 'event', base: 'https://www.huodongxing.com/events', query: 'search', cards: '.event-item, .activity-item', links: 'a[href*="/event/"]', title: '.event-title, .title, h3', author: '.organizer', summary: '.event-desc, .description', paths: '^/event/[0-9]+', cliArgs: null },
  { id: 'pinterest', name: 'Pinterest', domain: 'pinterest.com', kind: 'content', base: 'https://www.pinterest.com/search/pins/', query: 'q', cards: '[data-test-id="pin"], [data-test-id="pinWrapper"]', links: 'a[href*="/pin/"]', title: '[data-test-id="pinTitle"], h3', author: '[data-test-id="creator-profile-name"]', summary: '[data-test-id="pin-description"]', paths: '^/pin/[0-9]+', cliCommand: 'search-pins', cliArgs: ['query', '--limit'] },
  { id: 'pixiv', name: 'Pixiv', domain: 'pixiv.net', kind: 'content', base: 'https://www.pixiv.net/tags/', cards: 'li:has(a[href*="/artworks/"])', links: 'a[href*="/artworks/"]', title: '[title], h3', author: 'a[href*="/users/"]', summary: '[class*="description"]', paths: '^/(en/)?artworks/[0-9]+', cliArgs: ['query', '--limit', '--order', '--mode', '--page'] },
];

export const DOMESTIC_CONTENT_SOURCES = Object.freeze(Object.fromEntries(configs.map(c => [c.id, Object.freeze({
  id: c.id, name: c.name, source_site: c.domain, purpose: 'inspiration', record_kind: c.kind,
  implementation: 'readonly_dom', verification_status: 'not_live_verified', pagination: c.pageKey ? 'url_page' : 'first_page_only',
  opencli: c.cliArgs ? { command: `${c.id} ${c.cliCommand || 'search'}`, access: 'read', inspected_version: '1.8.8', adapter_file: `clis/${c.id}/${c.cliCommand || 'search'}.js`, arguments: c.cliArgs, native_executed: false } : null,
  limitations: c.cliArgs ? ['已静态盘点安装适配器；DOM检索未真实验证', '只读取搜索卡片，不提取全文'] : ['安装包未发现活动行适配器；Web入口及选择器未真实验证'],
  searchUrl(keyword, city, page = 1) {
    const q = clean(keyword, 500);
    if (!q) throw new TypeError('灵感检索关键词不能为空');
    const url = new URL(c.base + (c.id === 'douyin' ? encodeURIComponent(q) : c.id === 'pixiv' ? `${encodeURIComponent(q)}/artworks` : ''));
    if (c.query) url.searchParams.set(c.query, q);
    if (c.id === 'douyin') url.searchParams.set('type', 'video');
    if (c.pageKey) url.searchParams.set(c.pageKey, String(Math.max(1, Math.floor(Number(page) || 1))));
    return url.href;
  },
})])));

function sourceUrl(value, config) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (!(url.hostname === config.domain || url.hostname.endsWith(`.${config.domain}`))) return null;
    if (!new RegExp(config.paths).test(url.pathname)) return null;
    url.hash = '';
    return publicReferenceUrl(url.href,'bing');
  } catch { return null; }
}

export function normalizeDomesticContent(source, raw, { observedAt, keyword, city } = {}) {
  const config = configs.find(c => c.id === source);
  if (!config) throw new TypeError('不支持的灵感来源');
  const source_url = sourceUrl(raw.source_url || raw.url, config);
  const title = clean(raw.title, 120);
  if (!source_url || !title) return null;
  let image_url = null;
  // 只接收明确由内容卡片提取的图，不从作者头像、全页图片或商品通道补图。
  if (raw.image_provenance === 'content_card' && typeof raw.image_url === 'string') {
    try { const image = new URL(raw.image_url, source_url); if (['https:', 'http:'].includes(image.protocol) && !image.username && !image.password) image_url = image.href; } catch { /* 缺图保留null */ }
  }
  return {
    record_kind: config.kind, purpose: 'inspiration', title, source_url, source_site: config.domain, source_platform: source,
    product_url: null, image_url, image_role: image_url ? 'inspiration_reference' : null,
    summary: clean(raw.summary, 300) || null, author: clean(raw.author, 80) || null,
    location: clean(raw.location, 120) || null, source_time_text: clean(raw.source_time_text, 80) || null,
    observed_at: observedAt && Number.isFinite(Date.parse(observedAt)) ? observedAt : null,
    query_params: { keyword: keyword ?? null, city: city ?? null },
    relevance: { keyword: keyword ?? null, basis: 'model_selected_query', verified: false },
  };
}

export function buildDomesticContentReadScript(source) {
  const config = configs.find(c => c.id === source);
  if (!config) throw new TypeError('不支持的灵感来源');
  return `(${readCards.toString()})(${JSON.stringify(config)})`;
}

function readCards(config) {
  const text = (node, max = 300) => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const body = text(document.body, 20000);
  const restricted = /验证码|安全验证|访问受限|请求太频繁|访问频次异常|安全限制|Access Denied|Robot Check/i.test(body) || /captcha|risk_handler|_____tmd_____/i.test(location.pathname);
  const login = /登录后查看|请先登录|扫码登录|登录后可见/.test(body) || /passport|login|signin/i.test(location.hostname + location.pathname);
  const sameSite = location.hostname === config.domain || location.hostname.endsWith('.' + config.domain);
  const records = [];
  if (sameSite && !restricted && !login) for (const card of document.querySelectorAll(config.cards)) {
    const link = card.querySelector(config.links);
    if (!link) continue;
    const image = card.querySelector('img:not(.avatar):not([class*="avatar"]):not([class*="Avatar"])');
    const titleNode = card.querySelector(config.title);
    const title = text(titleNode, 120) || link.getAttribute('title') || image?.alt || text(link, 120);
    if (!title) continue;
    records.push({ title, source_url: link.href, summary: text(card.querySelector(config.summary)), author: text(card.querySelector(config.author), 80), image_url: image?.currentSrc || image?.getAttribute('data-src') || image?.src || null, image_provenance: 'content_card' });
  }
  return { status: restricted ? 'restricted' : login ? 'login_required' : !sameSite ? 'redirected' : records.length ? 'ok' : 'empty_or_selector_changed', records, next_available: Boolean(document.querySelector('a[rel="next"], .pagination-next:not(.disabled), .woo-pagination-next:not(.woo-pagination-disabled)')) };
}

/** 仅执行调用方/模型明确选择的一个source；不导入native模块、不读取Cookie、不创建浏览器或输出文件。 */
export async function runDomesticContentSearch(page, { source, keyword, city, packageRoot, maxPages = 1, signal } = {}) {
  const registry = DOMESTIC_CONTENT_SOURCES[source];
  if (!registry) throw new TypeError('不支持的灵感来源');
  const requested = Math.min(12, Math.max(1, Math.floor(Number(maxPages) || 1)));
  const coverage = { source, keyword, purpose: 'inspiration', pages_requested: requested, pages_completed: 0, complete: false, status: 'empty_or_selector_changed', limitations: [...registry.limitations], pages: [] };
  const records = [], seen = new Set();
  // packageRoot兼容上层契约，DOM实现无需加载/执行包路径提供的任意代码。
  void packageRoot;
  for (let n = 1; n <= requested; n++) {
    if (signal?.aborted) { coverage.status = 'aborted'; break; }
    if (n > 1 && registry.pagination === 'first_page_only') { coverage.limitations.push('未核实分页能力，仅覆盖首屏'); break; }
    try {
      await page.goto(registry.searchUrl(keyword, city, n));
      if (signal?.aborted) { coverage.status = 'aborted'; break; }
      if (page.wait) await page.wait(2);
      if (signal?.aborted) { coverage.status = 'aborted'; break; }
      const result = await page.evaluate(buildDomesticContentReadScript(source));
      if (signal?.aborted) { coverage.status = 'aborted'; break; }
      const observedAt = new Date().toISOString();
      coverage.pages.push({ page: n, status: result.status, observed_at: observedAt });
      coverage.status = result.status;
      if (result.status !== 'ok') { coverage.limitations.push(result.status); break; }
      const normalized = (result.records || []).map(raw => normalizeDomesticContent(source, raw, { observedAt, keyword, city })).filter(Boolean);
      if (!normalized.length) {
        coverage.status = 'no_valid_content';
        coverage.pages.at(-1).status = coverage.status;
        coverage.limitations.push('未得到符合来源白名单的有效内容');
        break;
      }
      coverage.pages_completed++;
      for (const record of normalized) {
        if (!seen.has(record.source_url)) { seen.add(record.source_url); records.push(record); }
      }
      if (n < requested && !result.next_available) { coverage.limitations.push('未发现可用下一页，未推断覆盖全部结果'); break; }
    } catch (error) {
      coverage.status = signal?.aborted ? 'aborted' : 'failed';
      coverage.pages.push({ page: n, status: coverage.status, error_code: typeof error?.code === 'string' ? error.code : 'CONTENT_PAGE_READ_FAILED' });
      break;
    }
  }
  coverage.complete = coverage.pages_completed === requested;
  coverage.scope = coverage.complete ? 'requested_pages_only' : 'partial_or_unavailable';
  return { records, coverage };
}
