/** 离线结构与来源审核；成功仅表示待用户确认，不证明语义正确。 */
import { EXCLUSIONS } from './labels.mjs';

const TAGS = new Set(EXCLUSIONS.map(x => x.id).filter(x => x !== 'other'));
const KEYS = ['id', 'kind', 'tag', 'term', 'source_span', 'confidence', 'why', 'evidence'];
const length = text => [...text].length;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const error = (code, path, message) => ({code, path, message});
// 展示层仍必须使用 textContent，不能把任何字段当 HTML、Markdown 或链接渲染。
const plain = s => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|(?:https?:|javascript:|data:|www\.)|[`*_\[\]#]/iu.test(s);

// Python 3.12 Unicode 15.0.0 casefold 与逐码点 lower 的差异表（含 ß、ς、Cherokee）。
const CASEFOLD = Object.freeze({
  "\u00b5": "\u03bc",
  "\u00df": "ss",
  "\u0149": "\u02bcn",
  "\u017f": "s",
  "\u01f0": "j\u030c",
  "\u0345": "\u03b9",
  "\u0390": "\u03b9\u0308\u0301",
  "\u03b0": "\u03c5\u0308\u0301",
  "\u03c2": "\u03c3",
  "\u03d0": "\u03b2",
  "\u03d1": "\u03b8",
  "\u03d5": "\u03c6",
  "\u03d6": "\u03c0",
  "\u03f0": "\u03ba",
  "\u03f1": "\u03c1",
  "\u03f5": "\u03b5",
  "\u0587": "\u0565\u0582",
  "\u13a0": "\u13a0",
  "\u13a1": "\u13a1",
  "\u13a2": "\u13a2",
  "\u13a3": "\u13a3",
  "\u13a4": "\u13a4",
  "\u13a5": "\u13a5",
  "\u13a6": "\u13a6",
  "\u13a7": "\u13a7",
  "\u13a8": "\u13a8",
  "\u13a9": "\u13a9",
  "\u13aa": "\u13aa",
  "\u13ab": "\u13ab",
  "\u13ac": "\u13ac",
  "\u13ad": "\u13ad",
  "\u13ae": "\u13ae",
  "\u13af": "\u13af",
  "\u13b0": "\u13b0",
  "\u13b1": "\u13b1",
  "\u13b2": "\u13b2",
  "\u13b3": "\u13b3",
  "\u13b4": "\u13b4",
  "\u13b5": "\u13b5",
  "\u13b6": "\u13b6",
  "\u13b7": "\u13b7",
  "\u13b8": "\u13b8",
  "\u13b9": "\u13b9",
  "\u13ba": "\u13ba",
  "\u13bb": "\u13bb",
  "\u13bc": "\u13bc",
  "\u13bd": "\u13bd",
  "\u13be": "\u13be",
  "\u13bf": "\u13bf",
  "\u13c0": "\u13c0",
  "\u13c1": "\u13c1",
  "\u13c2": "\u13c2",
  "\u13c3": "\u13c3",
  "\u13c4": "\u13c4",
  "\u13c5": "\u13c5",
  "\u13c6": "\u13c6",
  "\u13c7": "\u13c7",
  "\u13c8": "\u13c8",
  "\u13c9": "\u13c9",
  "\u13ca": "\u13ca",
  "\u13cb": "\u13cb",
  "\u13cc": "\u13cc",
  "\u13cd": "\u13cd",
  "\u13ce": "\u13ce",
  "\u13cf": "\u13cf",
  "\u13d0": "\u13d0",
  "\u13d1": "\u13d1",
  "\u13d2": "\u13d2",
  "\u13d3": "\u13d3",
  "\u13d4": "\u13d4",
  "\u13d5": "\u13d5",
  "\u13d6": "\u13d6",
  "\u13d7": "\u13d7",
  "\u13d8": "\u13d8",
  "\u13d9": "\u13d9",
  "\u13da": "\u13da",
  "\u13db": "\u13db",
  "\u13dc": "\u13dc",
  "\u13dd": "\u13dd",
  "\u13de": "\u13de",
  "\u13df": "\u13df",
  "\u13e0": "\u13e0",
  "\u13e1": "\u13e1",
  "\u13e2": "\u13e2",
  "\u13e3": "\u13e3",
  "\u13e4": "\u13e4",
  "\u13e5": "\u13e5",
  "\u13e6": "\u13e6",
  "\u13e7": "\u13e7",
  "\u13e8": "\u13e8",
  "\u13e9": "\u13e9",
  "\u13ea": "\u13ea",
  "\u13eb": "\u13eb",
  "\u13ec": "\u13ec",
  "\u13ed": "\u13ed",
  "\u13ee": "\u13ee",
  "\u13ef": "\u13ef",
  "\u13f0": "\u13f0",
  "\u13f1": "\u13f1",
  "\u13f2": "\u13f2",
  "\u13f3": "\u13f3",
  "\u13f4": "\u13f4",
  "\u13f5": "\u13f5",
  "\u13f8": "\u13f0",
  "\u13f9": "\u13f1",
  "\u13fa": "\u13f2",
  "\u13fb": "\u13f3",
  "\u13fc": "\u13f4",
  "\u13fd": "\u13f5",
  "\u1c80": "\u0432",
  "\u1c81": "\u0434",
  "\u1c82": "\u043e",
  "\u1c83": "\u0441",
  "\u1c84": "\u0442",
  "\u1c85": "\u0442",
  "\u1c86": "\u044a",
  "\u1c87": "\u0463",
  "\u1c88": "\ua64b",
  "\u1e96": "h\u0331",
  "\u1e97": "t\u0308",
  "\u1e98": "w\u030a",
  "\u1e99": "y\u030a",
  "\u1e9a": "a\u02be",
  "\u1e9b": "\u1e61",
  "\u1e9e": "ss",
  "\u1f50": "\u03c5\u0313",
  "\u1f52": "\u03c5\u0313\u0300",
  "\u1f54": "\u03c5\u0313\u0301",
  "\u1f56": "\u03c5\u0313\u0342",
  "\u1f80": "\u1f00\u03b9",
  "\u1f81": "\u1f01\u03b9",
  "\u1f82": "\u1f02\u03b9",
  "\u1f83": "\u1f03\u03b9",
  "\u1f84": "\u1f04\u03b9",
  "\u1f85": "\u1f05\u03b9",
  "\u1f86": "\u1f06\u03b9",
  "\u1f87": "\u1f07\u03b9",
  "\u1f88": "\u1f00\u03b9",
  "\u1f89": "\u1f01\u03b9",
  "\u1f8a": "\u1f02\u03b9",
  "\u1f8b": "\u1f03\u03b9",
  "\u1f8c": "\u1f04\u03b9",
  "\u1f8d": "\u1f05\u03b9",
  "\u1f8e": "\u1f06\u03b9",
  "\u1f8f": "\u1f07\u03b9",
  "\u1f90": "\u1f20\u03b9",
  "\u1f91": "\u1f21\u03b9",
  "\u1f92": "\u1f22\u03b9",
  "\u1f93": "\u1f23\u03b9",
  "\u1f94": "\u1f24\u03b9",
  "\u1f95": "\u1f25\u03b9",
  "\u1f96": "\u1f26\u03b9",
  "\u1f97": "\u1f27\u03b9",
  "\u1f98": "\u1f20\u03b9",
  "\u1f99": "\u1f21\u03b9",
  "\u1f9a": "\u1f22\u03b9",
  "\u1f9b": "\u1f23\u03b9",
  "\u1f9c": "\u1f24\u03b9",
  "\u1f9d": "\u1f25\u03b9",
  "\u1f9e": "\u1f26\u03b9",
  "\u1f9f": "\u1f27\u03b9",
  "\u1fa0": "\u1f60\u03b9",
  "\u1fa1": "\u1f61\u03b9",
  "\u1fa2": "\u1f62\u03b9",
  "\u1fa3": "\u1f63\u03b9",
  "\u1fa4": "\u1f64\u03b9",
  "\u1fa5": "\u1f65\u03b9",
  "\u1fa6": "\u1f66\u03b9",
  "\u1fa7": "\u1f67\u03b9",
  "\u1fa8": "\u1f60\u03b9",
  "\u1fa9": "\u1f61\u03b9",
  "\u1faa": "\u1f62\u03b9",
  "\u1fab": "\u1f63\u03b9",
  "\u1fac": "\u1f64\u03b9",
  "\u1fad": "\u1f65\u03b9",
  "\u1fae": "\u1f66\u03b9",
  "\u1faf": "\u1f67\u03b9",
  "\u1fb2": "\u1f70\u03b9",
  "\u1fb3": "\u03b1\u03b9",
  "\u1fb4": "\u03ac\u03b9",
  "\u1fb6": "\u03b1\u0342",
  "\u1fb7": "\u03b1\u0342\u03b9",
  "\u1fbc": "\u03b1\u03b9",
  "\u1fbe": "\u03b9",
  "\u1fc2": "\u1f74\u03b9",
  "\u1fc3": "\u03b7\u03b9",
  "\u1fc4": "\u03ae\u03b9",
  "\u1fc6": "\u03b7\u0342",
  "\u1fc7": "\u03b7\u0342\u03b9",
  "\u1fcc": "\u03b7\u03b9",
  "\u1fd2": "\u03b9\u0308\u0300",
  "\u1fd3": "\u03b9\u0308\u0301",
  "\u1fd6": "\u03b9\u0342",
  "\u1fd7": "\u03b9\u0308\u0342",
  "\u1fe2": "\u03c5\u0308\u0300",
  "\u1fe3": "\u03c5\u0308\u0301",
  "\u1fe4": "\u03c1\u0313",
  "\u1fe6": "\u03c5\u0342",
  "\u1fe7": "\u03c5\u0308\u0342",
  "\u1ff2": "\u1f7c\u03b9",
  "\u1ff3": "\u03c9\u03b9",
  "\u1ff4": "\u03ce\u03b9",
  "\u1ff6": "\u03c9\u0342",
  "\u1ff7": "\u03c9\u0342\u03b9",
  "\u1ffc": "\u03c9\u03b9",
  "\uab70": "\u13a0",
  "\uab71": "\u13a1",
  "\uab72": "\u13a2",
  "\uab73": "\u13a3",
  "\uab74": "\u13a4",
  "\uab75": "\u13a5",
  "\uab76": "\u13a6",
  "\uab77": "\u13a7",
  "\uab78": "\u13a8",
  "\uab79": "\u13a9",
  "\uab7a": "\u13aa",
  "\uab7b": "\u13ab",
  "\uab7c": "\u13ac",
  "\uab7d": "\u13ad",
  "\uab7e": "\u13ae",
  "\uab7f": "\u13af",
  "\uab80": "\u13b0",
  "\uab81": "\u13b1",
  "\uab82": "\u13b2",
  "\uab83": "\u13b3",
  "\uab84": "\u13b4",
  "\uab85": "\u13b5",
  "\uab86": "\u13b6",
  "\uab87": "\u13b7",
  "\uab88": "\u13b8",
  "\uab89": "\u13b9",
  "\uab8a": "\u13ba",
  "\uab8b": "\u13bb",
  "\uab8c": "\u13bc",
  "\uab8d": "\u13bd",
  "\uab8e": "\u13be",
  "\uab8f": "\u13bf",
  "\uab90": "\u13c0",
  "\uab91": "\u13c1",
  "\uab92": "\u13c2",
  "\uab93": "\u13c3",
  "\uab94": "\u13c4",
  "\uab95": "\u13c5",
  "\uab96": "\u13c6",
  "\uab97": "\u13c7",
  "\uab98": "\u13c8",
  "\uab99": "\u13c9",
  "\uab9a": "\u13ca",
  "\uab9b": "\u13cb",
  "\uab9c": "\u13cc",
  "\uab9d": "\u13cd",
  "\uab9e": "\u13ce",
  "\uab9f": "\u13cf",
  "\uaba0": "\u13d0",
  "\uaba1": "\u13d1",
  "\uaba2": "\u13d2",
  "\uaba3": "\u13d3",
  "\uaba4": "\u13d4",
  "\uaba5": "\u13d5",
  "\uaba6": "\u13d6",
  "\uaba7": "\u13d7",
  "\uaba8": "\u13d8",
  "\uaba9": "\u13d9",
  "\uabaa": "\u13da",
  "\uabab": "\u13db",
  "\uabac": "\u13dc",
  "\uabad": "\u13dd",
  "\uabae": "\u13de",
  "\uabaf": "\u13df",
  "\uabb0": "\u13e0",
  "\uabb1": "\u13e1",
  "\uabb2": "\u13e2",
  "\uabb3": "\u13e3",
  "\uabb4": "\u13e4",
  "\uabb5": "\u13e5",
  "\uabb6": "\u13e6",
  "\uabb7": "\u13e7",
  "\uabb8": "\u13e8",
  "\uabb9": "\u13e9",
  "\uabba": "\u13ea",
  "\uabbb": "\u13eb",
  "\uabbc": "\u13ec",
  "\uabbd": "\u13ed",
  "\uabbe": "\u13ee",
  "\uabbf": "\u13ef",
  "\ufb00": "ff",
  "\ufb01": "fi",
  "\ufb02": "fl",
  "\ufb03": "ffi",
  "\ufb04": "ffl",
  "\ufb05": "st",
  "\ufb06": "st",
  "\ufb13": "\u0574\u0576",
  "\ufb14": "\u0574\u0565",
  "\ufb15": "\u0574\u056b",
  "\ufb16": "\u057e\u0576",
  "\ufb17": "\u0574\u056d",
});
const fold = s => [...s.normalize('NFKC')].map(c => CASEFOLD[c] ?? c.toLowerCase()).join('');

function parse(raw) {
  const value = JSON.parse(raw);
  // JSON.parse 校验完整语法后，对所有对象的解码键名独立查重（含 __proto__）。
  const stack = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]]/gs;
  for (const match of raw.matchAll(tokens)) {
    const token = match[0];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (/^\s*:/.test(raw.slice(match.index + token.length))) {
      const key = JSON.parse(token);
      const keys = stack.at(-1);
      if (keys.has(key)) throw new Error('重复键');
      keys.add(key);
    }
  }
  return value;
}

/** aiJson 必须是保留重复键信息的原始 JSON 字符串。无联网、时钟、存储或业务状态写入。 */
export function checkAiExclusions(aiJson, dislikes, { clarificationAnswers = [] } = {}) {
  const sources = [dislikes, ...clarificationAnswers.filter(value => typeof value === "string")];
  const anchored = span => typeof span === "string" && span.trim() && sources.some(source => typeof source === "string" && source.includes(span));
  const fail = (code, path, message) => ({status: 'needs_input', candidates: [], errors: [
    error(code, path, message),
    ...(typeof dislikes === 'string' && dislikes.trim() ? [error('INTAKE_CLARIFICATION_REQUIRED', 'dislikes', '请回答当前需要澄清的问题，原话已保留')] : []),
  ]});
  if (typeof dislikes !== 'string') return fail('AI_OUTPUT_INVALID', 'dislikes', '不喜欢的东西须为文字');
  if (length(dislikes) > 1000) return fail('AI_OUTPUT_LIMIT', 'dislikes', '原文最多 1000 码点');
  if (typeof aiJson !== 'string') return fail('AI_OUTPUT_INVALID', 'ai_json', '识别结果须为严格 JSON 字符串');
  // 原始字节边界先于解析，避免解析无界输入。
  if (Buffer.byteLength(aiJson, 'utf8') > 32768) return fail('AI_OUTPUT_LIMIT', 'ai_json', '识别结果最多 32768 UTF-8 字节');
  let data;
  try { data = parse(aiJson); } catch { return fail('AI_OUTPUT_INVALID', 'ai_json', '识别结果不是合法且无重复键的严格 JSON'); }
  const oldKeys = ['ai_exclusion_candidates', 'ai_unmapped_notes'];
  const semanticKeys = [...oldKeys, 'ai_semantic_constraints', 'ai_clarification_questions'];
  if ((!exact(data, oldKeys) && !exact(data, semanticKeys)) || !Array.isArray(data.ai_exclusion_candidates) || !Array.isArray(data.ai_unmapped_notes)) return fail('AI_OUTPUT_INVALID', 'ai_json', '识别信封字段或数组不合法');
  const semantics = Object.hasOwn(data, "ai_semantic_constraints") ? data.ai_semantic_constraints : [];
  const questions = Object.hasOwn(data, "ai_clarification_questions") ? data.ai_clarification_questions : [];
  if (!Array.isArray(semantics) || !Array.isArray(questions)) return fail('AI_OUTPUT_INVALID', 'ai_json', '语义限制与澄清问题须为数组');
  if (semantics.length > 5 || questions.length > 3) return fail('AI_OUTPUT_LIMIT', 'ai_json', '最多五条语义限制、三条澄清问题');
  for (const [index, item] of semantics.entries()) {
    if (!exact(item, ['source_span', 'interpretation', 'confidence']) || !anchored(item.source_span) || length(item.source_span) > 1000 || typeof item.interpretation !== 'string' || !item.interpretation.trim() || !plain(item.interpretation) || length(item.interpretation) > 300 || !['high','medium','low'].includes(item.confidence)) return fail('AI_OUTPUT_INVALID', `ai_semantic_constraints[${index}]`, '语义限制须包含原话依据、简短理解与可信度');
  }
  for (const [index, item] of questions.entries()) {
    if (!exact(item, ['source_span', 'question']) || !anchored(item.source_span) || length(item.source_span) > 1000 || typeof item.question !== 'string' || !item.question.trim() || !plain(item.question) || length(item.question) > 300) return fail('AI_OUTPUT_INVALID', `ai_clarification_questions[${index}]`, '澄清问题须锚定原话并可直接回答');
  }
  const items = data.ai_exclusion_candidates;
  const notes = data.ai_unmapped_notes;
  const ids = new Set();
  for (let i = 0; i < items.length; i++) {
    const x = items[i], path = `ai_exclusion_candidates[${i}]`;
    if (!exact(x, KEYS) || typeof x.id !== 'string' || !/^xc[1-9]$/.test(x.id) || ids.has(x.id) || !['tag', 'term'].includes(x.kind) || !['high', 'medium', 'low'].includes(x.confidence) || x.evidence !== 'user_text' || typeof x.source_span !== 'string' || typeof x.why !== 'string' || !plain(x.why)) return fail('AI_OUTPUT_INVALID', path, '候选字段、唯一标识、可信度或纯文本理由不合法');
    ids.add(x.id);
    if (x.kind === 'tag' ? (!TAGS.has(x.tag) || x.term !== null) : (x.tag !== null || typeof x.term !== 'string' || (x.term.length > 0 && !/[\p{L}\p{N}]/u.test(x.term)))) return fail('AI_OUTPUT_INVALID', path, '类别须来自词表且不能为 other，字面词须含文字或数字，无关字段须为 null');
  }
  if (notes.some(x => typeof x !== 'string' || !plain(x))) return fail('AI_OUTPUT_INVALID', 'ai_unmapped_notes', '未映射备注须为纯文本');
  if (items.length > 5 || notes.length > 3) return fail('AI_OUTPUT_LIMIT', 'ai_json', '最多五条候选、三条未映射备注');
  for (let i = 0; i < items.length; i++) {
    const x = items[i];
    if (length(x.source_span) > 1000 || length(x.why) > 200 || (x.kind === 'term' && (length(x.term) < 1 || length(x.term) > 40))) return fail('AI_OUTPUT_LIMIT', `ai_exclusion_candidates[${i}]`, '原文依据、理由或字面词长度超限');
  }
  if (notes.some(x => length(x) > 200)) return fail('AI_OUTPUT_LIMIT', 'ai_unmapped_notes', '每条未映射备注最多 200 码点');
  for (let i = 0; i < items.length; i++) {
    const x = items[i];
    if (!anchored(x.source_span) || (x.kind === 'term' && !fold(x.source_span).includes(fold(x.term)))) return fail('AI_OUTPUT_UNANCHORED', `ai_exclusion_candidates[${i}].source_span`, '依据须为逐字原文，字面词经归一化后须在依据中');
  }
  const clarificationQuestions = questions.map(item => ({ ...item }));
  const result = { candidates: items.map(item => ({ ...item })), semantic_constraints: semantics.map(item => ({ ...item })), clarification_questions: clarificationQuestions, unmapped_notes: notes.map(String), errors: [] };
  if (!items.length && !semantics.length && !clarificationQuestions.length && dislikes.trim()) result.clarification_questions.push({ source_span: dislikes, question: `你说的「${[...dislikes].slice(0, 80).join('')}」希望避免哪种情况？` });
  if (result.clarification_questions.length || !dislikes.trim()) return { ...result, status:'needs_input', confirmation_required:false, errors:[error('INTAKE_CLARIFICATION_REQUIRED','dislikes','请补充当前问题的回答，原话已保留')] };
  return { ...result, status:items.length ? 'needs_confirmation' : 'ready', confirmation_required:items.length > 0 };
}
