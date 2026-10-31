/** 有界匿名公开文本观察缓存；素材由模型选择，不按关键词/礼物类别筛选。 */
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { REPO_ROOT } from '../localdb/db.mjs';
import { taskPath, taskDirectory } from '../collect/task-paths.mjs';
import { publicReferenceUrl } from '../collect/public-reference.mjs';

const MAX_FILE_BYTES = 512 * 1024;
const WEEK = 7 * 86400000;
const ID = /^[A-Za-z0-9_-]{1,96}$/;
const bounded = (value, fallback, maximum) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(maximum, Math.max(1, Math.floor(Number(value)))) : fallback;

export function createMaterialCache({ directory = join(REPO_ROOT, '.tmp/material-cache'), maxRecords = 80, maxAgeMs = WEEK, now = Date.now, sensitiveValues = [] } = {}) {
  const capacity = bounded(maxRecords, 80, 80), ageLimit = bounded(maxAgeMs, WEEK, WEEK);
  const secrets = (Array.isArray(sensitiveValues) ? sensitiveValues : []).filter(s => typeof s === 'string' && s.trim()).slice(0, 100).map(s => s.trim());
  const redact = (value, limit) => {
    if (typeof value !== 'string') return '';
    let text = value.slice(0, limit * 8);
    for (const secret of secrets) text = text.split(secret).join('[已省略]');
    return text.replace(/https?:\/\/\S+/gi, '[链接已省略]')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, '[已省略]')
      .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[已省略]')
      .replace(/\b(?:Bearer\s+\S+|sk-[\w-]{12,}|eyJ[\w.-]{20,})/gi, '[已省略]')
      .replace(/(?:password|passwd|token|cookie|authorization|api[_-]?key|secret)\s*[:=]\s*[^\s，,;；]+/gi, '[已省略]')
      .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[已省略]')
      .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  };
  function time() {
    const value = typeof now === 'function' ? now() : now;
    const ms = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(ms)) throw Error('CACHE_CLOCK_INVALID');
    return ms;
  }
  function location(create = false) {
    const root = join(REPO_ROOT, '.tmp'), absolute = resolve(directory);
    const rel = relative(root, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) throw Error('CACHE_PATH_NOT_ALLOWED');
    taskPath(absolute);
    // 缓存路径不允许任何既有符号链接/junction，即使目标仍在工作树内。
    for (let current = absolute; ; current = dirname(current)) {
      try { if (lstatSync(current).isSymbolicLink()) throw Error('CACHE_PATH_NOT_ALLOWED'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current === REPO_ROOT) break;
      if (dirname(current) === current) throw Error('CACHE_PATH_NOT_ALLOWED');
    }
    const dir = create ? taskDirectory(absolute) : absolute;
    const file = taskPath(join(dir, 'materials.json'));
    try { if (lstatSync(file).isSymbolicLink()) throw Error('CACHE_PATH_NOT_ALLOWED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return file;
  }
  function safeUrl(value) {
    const canonical = publicReferenceUrl(value, 'bing');
    if (!canonical) return null;
    const url = new URL(canonical);
    if (url.protocol !== 'https:') return null;
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return null; }
    if (/\/(?:users?|profile|account|member|people|space|login|passport)(?:\/|$)/i.test(path) || /@|1[3-9]\d{9}/.test(path) || secrets.some(s => path.includes(s))) return null;
    // 仅允许内容身份参数；查询词、姓名、地址或owner均不作为共享缓存键/字段落盘。
    for (const [key, value] of url.searchParams) {
      if (!['id', 'article_id', 'articleId', 'p', 'v'].includes(key) || !/^[A-Za-z0-9_-]{1,64}$/.test(value) || secrets.some(s => value.includes(s))) return null;
    }
    return url.href.length <= 700 ? url.href : null;
  }
  function normalize(raw, clock) {
    if (!raw || typeof raw !== 'object' || raw.reference_kind !== 'public_reference' || !ID.test(raw.reference_id || '')) return null;
    const observed = raw.observed_at;
    if (typeof observed !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(observed)) return null;
    const ms = Date.parse(observed);
    if (!Number.isFinite(ms) || ms > clock || clock - ms > ageLimit) return null;
    const source_url = safeUrl(raw.source_url), fullTitle = redact(raw.title, 1000), title = fullTitle.slice(0, 180);
    const summary = [raw.summary, raw.text].map(value => redact(value, 1000)).find(value => value.length >= 20 && value !== title && value !== fullTitle && value.replace(/\[已省略\]|\[链接已省略\]|[\s\p{P}\p{S}]/gu, '').length >= 12);
    if (!source_url || !title || !summary) return null;
    // 只复制白名单字段，不遍历原对象，headers/personalization等字段绝不进入持久化。
    return {
      reference_kind: 'public_reference', reference_id: raw.reference_id, title, summary, source_url,
      source_site: new URL(source_url).hostname,
      source_platform: typeof raw.source_platform === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(raw.source_platform) && !secrets.some(s => raw.source_platform.includes(s)) ? raw.source_platform : null,
      observed_at: observed, material_kind: ['search_snippet','article_excerpt','case_excerpt','tutorial_excerpt'].includes(raw.material_kind)?raw.material_kind:'public_excerpt', has_summary:true, is_full_article:false, cache_observation: 'cached_public_material', is_realtime: false,
    };
  }
  function prune(records, clock) {
    const byUrl = new Map(), byId = new Set();
    const valid = records.map(raw => { try { return normalize(raw, clock); } catch { return null; } }).filter(Boolean).sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
    for (const record of valid) if (!byUrl.has(record.source_url) && !byId.has(record.reference_id)) { byUrl.set(record.source_url, record); byId.add(record.reference_id); }
    return [...byUrl.values()].slice(0, capacity);
  }
  function load(clock) {
    const file = location();
    let stat;
    try { stat = lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw Error('CACHE_FILE_INVALID');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > 80) throw Error('CACHE_FILE_INVALID');
    return prune(data.records, clock);
  }
  function get() {
    try {
      const records = load(time());
      return structuredClone({ records: records.slice(0, 20), coverage: { status: records.length ? 'cached_observations' : 'empty', scope: 'bounded_public_text_cache', available_count: records.length, returned_count: Math.min(20, records.length), records_omitted: Math.max(0, records.length - 20), truncated: records.length > 20, max_records: capacity, max_age_ms: ageLimit, is_realtime: false } });
    } catch { return { records: [], coverage: { status: 'unavailable', scope: 'bounded_public_text_cache', error_code: 'MATERIAL_CACHE_READ_FAILED', is_realtime: false } }; }
  }
  function put(records) {
    let temporary;
    try {
      const clock = time(), supplied = Array.isArray(records) ? records : [], selected = supplied.slice(0, 160);
      const accepted = selected.map(raw => { try { return normalize(raw, clock); } catch { return null; } }).filter(Boolean);
      let previous = [];
      try { previous = load(clock); } catch { /* 损坏旧缓存可用本次合法公开观察原子替换 */ }
      const combined = prune([...accepted, ...previous], clock);
      const file = location(true);
      temporary = taskPath(join(dirname(file), `materials-${process.pid}-${randomUUID()}.tmp`));
      const body = Buffer.from(JSON.stringify({ version: 1, records: combined }));
      if (body.length > MAX_FILE_BYTES) throw Error('CACHE_FILE_TOO_LARGE');
      writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
      location(); // 写入前后重新检查已有目录/链接边界。
      renameSync(temporary, file); temporary = null;
      return { status: 'stored', accepted: accepted.length, rejected: selected.length - accepted.length, stored: combined.length, input_omitted: Math.max(0, supplied.length - selected.length), truncated: supplied.length > selected.length || accepted.length + previous.length > combined.length, is_realtime: false };
    } catch { return { status: 'unavailable', error_code: 'MATERIAL_CACHE_WRITE_FAILED', is_realtime: false }; }
    finally { if (temporary) try { unlinkSync(taskPath(temporary)); } catch { /* 只清理本次创建的原子临时文件 */ } }
  }
  return { put, get };
}
