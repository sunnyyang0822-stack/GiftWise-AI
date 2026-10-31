/** 来源暂停状态只在内存中保存。调用者须在每次导航/请求前检查，逐页观察后更新。 */
const COMMERCE = new Set([
  'jd', 'taobao', 'tmall', 'pinduoduo', 'douyin', 'kuaishou', '1688', 'vip',
  'suning', 'youpin', 'dewu', 'xianyu', 'dangdang', 'yanxuan', 'xiaomi', 'xiaohongshu_shop',
]);
const RISK = new Map([
  ['restricted', 'access_restricted'], ['access_restricted', 'access_restricted'],
  ['access_denied', 'access_restricted'], ['captcha', 'captcha'], ['captcha_required', 'captcha'],
  ['security_verification', 'security_verification'], ['security_check', 'security_verification'],
  ['risk_control', 'risk_control'], ['rate_limited', 'rate_limited'], ['too_many_requests', 'rate_limited'],
]);
const SUCCESS = new Set(['ok', 'ready', 'partial']);
const LOGIN = new Set(['login_required', 'requires_login', 'not_logged_in']);
const sourceName = value => typeof value === 'string' && /^[a-z0-9_-]{1,50}$/.test(value) ? value : null;
const statusName = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

// 只接受调用者明确提供的已脱敏访问提示，不扫描商品、用户原话或通用能力说明。
function textRisk(value) {
  if (typeof value !== 'string') return null;
  const text = value.slice(0, 4000).replace(/(?:无需|无须|没有|未出现|未触发|未检测到|不存在|不需要|未发现|无)(?:任何)?(?:验证码|安全验证|访问限制|访问受限|风控)/g, '');
  if (/验证码|captcha|robot check/i.test(text)) return 'captcha';
  if (/安全验证|security verification|security check/i.test(text)) return 'security_verification';
  if (/访问受限|访问被拒绝|access denied|access restricted/i.test(text)) return 'access_restricted';
  if (/请求太频繁|访问过于频繁|访问频次异常|操作频繁|too many requests|rate limit/i.test(text)) return 'rate_limited';
  return null;
}

/** 识别真实搜索/详情coverage，商品变化、空结果、超时、普通失败均不冒称风控。 */
export function classifySourceObservation(input = {}) {
  const nodes = [], seen = new Set();
  const source = sourceName(input.source);
  function visit(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    const nodeSource = sourceName(node.source || node.platform);
    if (source && nodeSource && nodeSource !== source) return;
    nodes.push(node);
    for (const key of ['coverage', 'detail', 'detail_observation', 'pages']) visit(node[key]);
  }
  visit(input);
  let risk = null, login = false, lastStatus = 'not_observed';
  for (const node of nodes) {
    const status = statusName(node.status);
    if (status) lastStatus = status;
    risk ||= RISK.get(status) || textRisk(node.safe_text);
    login ||= LOGIN.has(status);
  }
  return {
    risk: !!risk, reason_code: risk || (login ? 'login_required' : null),
    observed_status: lastStatus,
    availability: risk ? 'paused' : login ? 'login_required' : SUCCESS.has(lastStatus) ? 'available' : 'unknown',
  };
}

export function createSourceAvailabilityState() {
  return { sources: new Map(), riskEvents: new Map(), commercePause: null, sequence: 0 };
}
const processState = createSourceAvailabilityState();

/** 默认所有tracker共享本进程暂停状态；测试可注入独立processState。暂停不自动重试/解封。 */
export function createSourceAvailabilityTracker({
  now = Date.now, riskWindowMs = 15 * 60 * 1000, repeatThreshold = 2,
  processState: shared = processState, commerceEnabled = false,
} = {}) {
  if (!Number.isFinite(riskWindowMs) || riskWindowMs <= 0 || !Number.isInteger(repeatThreshold) || repeatThreshold < 2) throw new TypeError('INVALID_SOURCE_AVAILABILITY_POLICY');
  const sessions = new Map();
  const sessionMap = sessionId => {
    if (!sessions.has(sessionId)) sessions.set(sessionId, new Map());
    return sessions.get(sessionId);
  };
  function getAvailability({ sessionId = 'default', source } = {}) {
    source = sourceName(source);
    if (!source) return { source: null, status: 'unknown', allow_request: false, reason_code: 'invalid_source', scope: null };
    if (COMMERCE.has(source) && commerceEnabled !== true) return {
      source, status: 'paused_by_product_scope', allow_request: false,
      reason_code: 'COMMERCE_DISABLED_BY_USER', scope: 'product_scope',
      observed_status: sessions.get(sessionId)?.get(source)?.observed_status || shared.sources.get(source)?.observed_status || null,
      paused_at: null,
    };
    const global = COMMERCE.has(source) ? shared.commercePause : null;
    const processPause = shared.sources.get(source);
    const session = sessions.get(sessionId)?.get(source);
    const paused = global || processPause;
    return {
      source, status: paused ? 'paused' : session?.availability || 'unknown',
      allow_request: !paused && session?.availability !== 'login_required',
      reason_code: paused?.reason_code || session?.reason_code || null,
      scope: global ? 'process_commerce' : processPause ? 'process_source' : session?.availability === 'login_required' ? 'session_source' : null,
      observed_status: session?.observed_status || processPause?.observed_status || null,
      paused_at: paused?.paused_at || null,
    };
  }
  function observe(input = {}) {
    const source = sourceName(input.source);
    if (!source) return getAvailability(input);
    const sessionId = input.sessionId ?? 'default';
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw new TypeError('INVALID_SOURCE_AVAILABILITY_CLOCK');
    const classified = classifySourceObservation(input);
    sessionMap(sessionId).set(source, classified);
    if (classified.risk) {
      const paused_at = new Date(timestamp).toISOString();
      if (!shared.sources.has(source)) shared.sources.set(source, { ...classified, paused_at });
      // 汇总重复传递同一观察ID只记一次。无ID时每次observe代表一次独立真实观察。
      const eventId = typeof input.observation_id === 'string' && input.observation_id ? `${source}:${input.observation_id}` : `${source}:${timestamp}:${++shared.sequence}`;
      for (const [id, event] of shared.riskEvents) if (timestamp - event.at > riskWindowMs) shared.riskEvents.delete(id);
      if (COMMERCE.has(source) && !shared.riskEvents.has(eventId)) shared.riskEvents.set(eventId, { at: timestamp, source });
      if (shared.riskEvents.size >= repeatThreshold && !shared.commercePause) shared.commercePause = { reason_code: 'repeated_commerce_risk', paused_at };
    }
    return getAvailability({ sessionId, source });
  }
  function toModelContext({ sessionId = 'default', sources = ['jd', 'taobao'] } = {}) {
    const source_availability = [...new Set(sources)].map(source => getAvailability({ sessionId, source }));
    const paused = source_availability.some(item => !item.allow_request);
    return {
      source_availability,
      recommendations_available: true,
      alternatives: paused ? [
        { kind: 'model_suggestion', available: true, hint: '继续结合用户需求给出建议；缺失报价、来源或图片不阻断，不编造商品、价格和库存。' },
        { kind: 'reference_image_search', source: 'duckduckgo', available: null, hint: '可按实际安装与可用能力使用DuckDuckGo查找相关参考图片；参考图不冒充商品实拍、SKU或购买来源。' },
        { kind: 'content_inspiration', available: null, hint: '尚未明确购买时，可按实际可用能力寻找灵感或相关图片；内容不能充当商品报价或购买来源。' },
      ] : [],
      ...(paused ? { instruction: '停止向已暂停来源发起搜索、详情、分页或重试；不得用切换账号、身份或端口继续受限来源请求。优先参考图片与内容灵感；来源可用性仅限制外部请求，不影响最终推荐。' } : {}),
    };
  }
  return { observe, getAvailability, toModelContext };
}
