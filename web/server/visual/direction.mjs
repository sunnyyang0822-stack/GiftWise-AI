/**
 * 第 3–4 步：把「第 2 步的三个方案内容 + 用户 intake 条件」变成
 * **包装风格 + 色彩/视觉方向**，并且**每一个风格要素都能指回具体的 intake 字段与值**。
 *
 * ── 权威口径 ─────────────────────────────────────────────────────────────
 * `docs/architecture/用户链路契约-五步-2026-10-31.md`：第 3–4 步发生在用户选择**之前**，
 * 由生图模型决定包装风格与色彩视觉方向；第 5 步只对**选中的那一个**出最终包装图。
 * 该契约留了歧义 A（产物是文字规范还是图片），本模块按「先出结构化文字」实现，
 * 并把「改成出图片」的接口留在 provider.mjs 的 `channel` 边界上（见该文件）。
 *
 * ── 产品负责人 2026-10-31 追加的 7 条硬要求（逐条对应到本文件的实现）──
 * 1. 不得凭空生成：所有取值来自 `extractSignals()` 从 intake 抓到的信号
 *    （interests / gift_styles / hard_exclusions / dislikes / recipient_relation / occasion / 预算区间）。
 * 2. 优先级写死在 `PRIORITY_POLICY` 常量里，并由 `deriveDirectionCore()` 按该顺序执行：
 *    禁项（不喜欢的东西 = 绝对禁止） > 用户明示偏好 > 关系与场合的通用审美。
 * 3. 可追溯：每个要素都带 `based_on: {field, value}`（禁项的 `based_on` 见下方安全说明）。
 * 5. 不得退化成复述：`colorFromConcept()` / `MODIFIERS` 把概念落成
 *    具体主色 + 辅色 + 材质质感 + 视觉基调，而不是抄回用户原词。
 * 6. 第 5 步直接读：`directionPromptText()` 是唯一的生图 prompt 片段来源（plan.mjs 调用）。
 * 7. 冲突如实标注：`tradeoffs[]` 记录「保留了哪一边、放弃了哪一边、依据是什么」。
 *
 * ── 一条安全约束（与要求 3 有张力，这里这样解）────────────────────────────
 * 要求 3 要「指回具体的值」，要求 2/4 又要「输出绝对不含不喜欢的那个词」。
 * 解法：偏好类要素的 `based_on.value` 直接回显用户原话（如「喜欢黑白色调」），
 * 而**禁项**的 `based_on` 只记 `{field, value_sha256, code_points}` —— 不把被禁的词
 * 写进方向对象。禁项原文仍可从同一次响应的 `request.dislikes` / `request.forbidden_terms`
 * 逐字读到（`publicReport()` 本来就返回 `request`），因此可追溯性不丢。
 * 于是 `JSON.stringify(direction)` 里**绝不出现**被禁的词，可以被测试直接断言。
 */

import { createHash } from 'node:crypto';
import {
  ALL_CONCEPTS,
  COLOR_CONCEPTS,
  MATERIAL_CONCEPTS,
  TONE_CONCEPTS,
  conceptById,
  kindOf,
  matchConcepts,
} from './lexicon.mjs';
import { INTEREST_TABLE, GIFT_STYLE_TABLE, OCCASION_TABLE } from '../labels.mjs';

export const VISUAL_DIRECTION_VERSION = 'visual-direction-v1';

/**
 * 优先级策略：**代码顺序即优先级**，同时导出给报告与前端展示。
 * 这条顺序是产品负责人 2026-10-31 明确要求的，不许在实现里被调换。
 */
export const PRIORITY_POLICY = Object.freeze([
  { rank: 1, id: 'prohibition', zh: '用户明令不喜欢的（不喜欢的东西/禁忌词）= 绝对禁止，任何包装、配色、文案都不得出现' },
  { rank: 2, id: 'explicit_preference', zh: '用户明示偏好（自由文本里正面提到的颜色/风格/材质、已确认兴趣、风格标签）' },
  { rank: 3, id: 'baseline', zh: '我们的一般审美（由关系与场合推导的兜底方向），只有在上面两级都没给出时才生效' },
]);

/** 追求对象：绝不假定双方已有恋爱关系（要求 2 第三条）。 */
export const RELATION_GUARD = Object.freeze({
  no_relationship_assumption: true,
  banned_phrases: Object.freeze(['情侣', '我们俩', '我们之间', '恋爱中', '男朋友', '女朋友', '亲爱的', '宝贝']),
  note: '追求关系不代表对方已接受；包装与文案一律不得出现假定既有亲密关系或双向好感的表述。',
});

/** 风格标签 → 具体装修方向（不是复述标签，而是落成可执行的材料/结构）。 */
const MODIFIERS = Object.freeze({
  design: { keywords: ['几何构成', '大面积留白', '单色块'], materials: ['厚卡纸（素面，无印刷图案）'], tone: { id: 'minimal', zh: '极简、留白充足、装饰极少，靠材质与比例取胜' } },
  practical: { keywords: ['结构耐用', '可重复使用', '少装饰'], materials: ['可回收厚纸盒（结构简单）'], tone: { id: 'minimal', zh: '极简、留白充足、装饰极少，靠材质与比例取胜' } },
  personalized: { keywords: ['预留定制位', '可写名字/日期'], materials: ['可手写的素面卡纸吊牌'], tone: null },
  surprising: { keywords: ['层次开箱', '内层小惊喜'], materials: ['内外双层的盒体结构'], tone: null },
  memorable: { keywords: ['可留存纪念物', '日期元素'], materials: ['可长期保存的硬质内衬'], tone: null },
  experiential: { keywords: ['场景感', '一起完成的小体验'], materials: ['便签式步骤卡（非营销文案）'], tone: null },
  understated: { keywords: ['低饱和', '无大字标识'], materials: ['哑光质感表面（不反光）'], tone: { id: 'minimal', zh: '极简、留白充足、装饰极少，靠材质与比例取胜' } },
});

/** 兴趣 → 兜底方向（第 3 级）。仅在没有任何明示偏好时使用。 */
const INTEREST_BASELINE = Object.freeze({
  design_art: { color: 'color:gray', materials: ['哑光质感表面（不反光）', '厚卡纸（素面，无印刷图案）'], keywords: ['低饱和', '几何留白'], tone: { id: 'minimal', zh: '极简、留白充足、装饰极少，靠材质与比例取胜' } },
  coffee_food: { color: 'color:brown', materials: ['牛皮纸（原色，未漂白）', '亚麻/棉麻织物（织物纹理）'], keywords: ['暖棕', '手作痕迹'], tone: { id: 'natural', zh: '自然材质、柔和光线、有机形态，不刻意对称' } },
  reading_learning: { color: 'color:cream', materials: ['布艺缎带（宽幅、低光泽）', '厚卡纸（素面，无印刷图案）'], keywords: ['米白', '书卷气'], tone: { id: 'natural', zh: '自然材质、柔和光线、有机形态，不刻意对称' } },
  tech_digital: { color: 'color:black', materials: ['哑光金属件（小面积点缀）', '哑光质感表面（不反光）'], keywords: ['深色底', '利落直线'], tone: { id: 'industrial', zh: '哑光金属、直线构成、冷调灰度' } },
  sports_outdoors: { color: 'color:green', materials: ['耐磨织物（无光泽）', '牛皮纸（原色，未漂白）'], keywords: ['户外色', '结实'], tone: { id: 'natural', zh: '自然材质、柔和光线、有机形态，不刻意对称' } },
  music_movies: { color: 'color:black', materials: ['复古印刷卡纸', '哑光质感表面（不反光）'], keywords: ['深色底', '一点高亮色'], tone: { id: 'retro', zh: '低饱和暖调、复古印刷质感、老式字体气质' } },
  games_anime: { color: 'color:colorful', materials: ['亮面卡纸（有反光）'], keywords: ['明快配色', '图形化'], tone: { id: 'cute', zh: '圆润造型、轻快表情符号、软化边缘' } },
  travel_exploration: { color: 'color:blue', materials: ['牛皮纸（原色，未漂白）', '布艺缎带（宽幅、低光泽）'], keywords: ['大地色', '地图质感'], tone: { id: 'natural', zh: '自然材质、柔和光线、有机形态，不刻意对称' } },
  home_living: { color: 'color:cream', materials: ['亚麻/棉麻织物（织物纹理）', '原木（浅色木纹）'], keywords: ['浅木色', '棉麻'], tone: { id: 'natural', zh: '自然材质、柔和光线、有机形态，不刻意对称' } },
  plants_nature: { color: 'color:green', materials: ['亚麻/棉麻织物（织物纹理）'], keywords: ['苔藓绿', '植物感'], tone: { id: 'natural', zh: '自然材质、柔和光线、有机形态，不刻意对称' } },
  fashion_accessories: { color: 'color:black', materials: ['哑光金属件（小面积点缀）', '皮革/仿皮（细纹）'], keywords: ['黑金对比', '有设计感'], tone: { id: 'luxury', zh: '深色底、金属点缀、厚重材质、低冗余装饰' } },
  experiences_activities: { color: 'color:yellow', materials: ['厚卡纸（素面，无印刷图案）'], keywords: ['明亮轻快'], tone: { id: 'warm', zh: '暖色温、低对比、柔和过渡' } },
});

/** 场合 → 兜底视觉基调（第 3 级，仅影响语气与明度，不覆盖用户偏好）。 */
const OCCASION_BASELINE = Object.freeze({
  birthday: { keywords: ['明快'], note: '生日场合默认偏明快，但不覆盖用户明示的低饱和或黑白偏好' },
  festival: { keywords: ['节庆感'], note: '节日场合默认偏节庆色，但不覆盖用户明示偏好' },
  thanks: { keywords: ['温和中性'], note: '感谢场合默认克制中性' },
  anniversary: { keywords: ['纪念感'], note: '纪念日默认偏留存感，不假定关系承诺' },
  graduation_promotion: { keywords: ['祝贺感'], note: '祝贺场合默认明快' },
  other: { keywords: ['中性'], note: '未指定场合，取中性方向' },
});

const NEUTRAL_BASELINE = Object.freeze({
  color: 'color:gray',
  materials: ['厚卡纸（素面，无印刷图案）'],
  keywords: ['中性', '不喧闹'],
  tone: { id: 'minimal', zh: '极简、留白充足、装饰极少，靠材质与比例取胜' },
});

/* ------------------------------------------------------------------ 信号抽取 */

const sha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex');

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

/**
 * 从 intake（原始输入）与 request（服务端冻结的派生请求）里抓出第 3–4 步需要的全部信号。
 *
 * 两个来源都用，是因为它们各自持有不同字段：
 *   - `interests` / `interest_confidence` 只在**原始 intake** 里有（request 里被拆成 facts 与 preference_inferences）；
 *   - `forbidden_tags` / `forbidden_terms` / `notes` / `facts` 只在**冻结 request** 里有。
 * 只读，不改写任何输入。
 */
export function extractSignals({ intake = {}, request = {} } = {}) {
  const raw = intake && typeof intake === 'object' && !Array.isArray(intake) ? intake : {};
  const req = request && typeof request === 'object' && !Array.isArray(request) ? request : {};

  const explicitTexts = [];
  if (typeof raw.additional_context === 'string' && raw.additional_context.trim()) {
    explicitTexts.push({ field: 'intake.additional_context', text: raw.additional_context });
  }
  if (typeof req.notes === 'string' && req.notes.trim() && req.notes !== raw.additional_context) {
    explicitTexts.push({ field: 'request.notes', text: req.notes });
  }
  /* 「不喜欢的东西」可能出现在原始 intake（`intake.dislikes`）或冻结请求
     （`request.dislikes`）里；两处都要扫，且**整段按禁项处理**（不看局部否定词）。
     原实现只看 `request.dislikes`：如果调用方只传了原始 intake，用户的禁忌就被漏掉了。 */
  const dislikes = [];
  if (typeof raw.dislikes === 'string' && raw.dislikes.trim()) dislikes.push({ field: 'intake.dislikes', text: raw.dislikes });
  if (typeof req.dislikes === 'string' && req.dislikes.trim() && req.dislikes !== raw.dislikes) dislikes.push({ field: 'request.dislikes', text: req.dislikes });
  for (const source of dislikes) explicitTexts.push({ ...source, prohibition_only: true });

  const preferences = [];
  const prohibitions = [];
  const pushUnique = (list, id) => {
    if (!list.some((entry) => entry.concept_id === id)) return true;
    return false;
  };

  for (const source of explicitTexts) {
    for (const hit of matchConcepts(source.text)) {
      // 字段级否定：`dislikes` 整段都是「不喜欢的东西」，命中即禁项，不看局部否定词。
      const negated = source.prohibition_only === true || hit.negated === true;
      if (negated) {
        if (!pushUnique(prohibitions, hit.concept.id)) continue;
        prohibitions.push({
          concept_id: hit.concept.id,
          kind: kindOf(hit.concept.id),
          label: hit.concept.zh,
          reason: 'user_dislike',
          // 不写入被禁的词本身：只保留可校验的指纹与出处。
          based_on: { field: source.field, value_sha256: sha256(source.text), code_points: [...source.text].length },
        });
      } else if (pushUnique(preferences, hit.concept.id)) {
        preferences.push({
          concept_id: hit.concept.id,
          kind: kindOf(hit.concept.id),
          label: hit.concept.zh,
          reason: 'explicit_text',
          // 偏好可以逐字回显（要求 3 要能当场演示「用户说黑白 ⇒ 我们出黑白」）。
          based_on: { field: source.field, value: hit.alias },
        });
      }
    }
  }

  // 明确的禁忌词数组（checker 已经在用同一份数据；此处只把「视觉概念」抽出来补进禁项）。
  const forbiddenTerms = asArray(req.forbidden_terms);
  forbiddenTerms.forEach((term, index) => {
    for (const hit of matchConcepts(term)) {
      if (!pushUnique(prohibitions, hit.concept.id)) continue;
      prohibitions.push({
        concept_id: hit.concept.id,
        kind: kindOf(hit.concept.id),
        label: hit.concept.zh,
        reason: 'forbidden_term',
        based_on: { field: `request.forbidden_terms[${index}]`, value_sha256: sha256(term), code_points: [...term].length },
      });
    }
  });
  const forbiddenTags = asArray(req.forbidden_tags);
  forbiddenTags.forEach((tagWord, index) => {
    for (const hit of matchConcepts(tagWord)) {
      if (!pushUnique(prohibitions, hit.concept.id)) continue;
      prohibitions.push({
        concept_id: hit.concept.id,
        kind: kindOf(hit.concept.id),
        label: hit.concept.zh,
        reason: 'forbidden_tag',
        based_on: { field: `request.forbidden_tags[${index}]`, value_sha256: sha256(tagWord), code_points: [...tagWord].length },
      });
    }
  });

  const confidence = raw.interest_confidence && typeof raw.interest_confidence === 'object' ? raw.interest_confidence : {};
  const interests = asArray(raw.interests).map((id, index) => ({
    id,
    zh: INTEREST_TABLE[id] ?? id,
    confidence: confidence[id] === 'confirmed' ? 'confirmed' : 'inferred',
    based_on: { field: `intake.interests[${index}]`, value: id },
  }));

  const giftStyles = asArray(req.gift_styles).length
    ? asArray(req.gift_styles)
    : asArray(raw.gift_styles);
  const gift_style_signals = giftStyles.map((id, index) => ({
    id,
    zh: GIFT_STYLE_TABLE[id] ?? id,
    based_on: { field: asArray(req.gift_styles).length ? `request.gift_styles[${index}]` : `intake.gift_styles[${index}]`, value: id },
  }));

  const relationId = typeof req.recipient_relation_id === 'string' && req.recipient_relation_id ? req.recipient_relation_id : (typeof raw.recipient_relation === 'string' ? raw.recipient_relation : '');
  const relationZh = typeof req.recipient_relation === 'string' && req.recipient_relation ? req.recipient_relation : (relationId || '未提供');
  const occasionId = typeof raw.occasion === 'string' && raw.occasion ? raw.occasion : null;
  const occasionZh = typeof req.occasion === 'string' && req.occasion ? req.occasion : (occasionId ? (OCCASION_TABLE[occasionId] ?? occasionId) : '未提供');

  const budgetRange = req.budget_range && typeof req.budget_range === 'object' ? req.budget_range : null;
  const budgetAmount = typeof req.budget_amount === 'string' ? req.budget_amount : (typeof raw.budget_amount === 'string' ? raw.budget_amount : null);

  const signals = {
    preferences,
    prohibitions,
    interests,
    gift_styles: gift_style_signals,
    relation: {
      id: relationId,
      zh: relationZh,
      pursuit: relationId === 'pursuit',
      low_pressure: relationId === 'pursuit' || relationId === 'mentor' || relationId === 'client_partner',
      based_on: { field: 'intake.recipient_relation', value: relationId || '(未提供)' },
    },
    occasion: {
      id: occasionId,
      zh: occasionZh,
      based_on: { field: 'intake.occasion', value: occasionId ?? '(未提供)' },
      ...(occasionId && OCCASION_BASELINE[occasionId] ? { baseline: OCCASION_BASELINE[occasionId] } : {}),
    },
    budget: {
      amount: budgetAmount,
      range: budgetRange,
      currency: typeof req.currency === 'string' ? req.currency : (typeof raw.currency === 'string' ? raw.currency : null),
      based_on: budgetRange
        ? { field: 'intake.budget_range', value: `${budgetRange.min ?? '?'}–${budgetRange.max ?? '?'}` }
        : { field: 'intake.budget_amount', value: budgetAmount ?? '(未提供)' },
    },
    available_days: typeof req.available_days === 'number' ? req.available_days : (typeof raw.deadline_days === 'number' ? raw.deadline_days : null),
  };
  return signals;
}

/* ------------------------------------------------------------------ 方向推导 */

function colorSlots(conceptId) {
  const concept = conceptById(conceptId);
  if (!concept || !concept.slots) return null;
  return { concept, ...concept.slots };
}

function prohibitedSet(prohibitions) {
  return new Set(prohibitions.map((entry) => entry.concept_id));
}

/** 一个候选色是否被禁：自身被禁，或它的主色名/hex 与某个被禁颜色相同。 */
function colorAllowed(conceptId, banned) {
  if (banned.has(conceptId)) return false;
  const concept = conceptById(conceptId);
  if (!concept) return false;
  return ![...banned].some((id) => {
    const bannedConcept = conceptById(id);
    return Boolean(bannedConcept) && kindOf(id) === 'color' && bannedConcept.hex === concept.hex;
  });
}

/** 把「用户明示偏好」落成具体主色/辅色/材质/基调（要求 5：不得只是复述）。 */
function fromPreferences(preferences) {
  const colors = preferences.filter((entry) => entry.kind === 'color');
  const tones = preferences.filter((entry) => entry.kind === 'tone');
  const materials = preferences.filter((entry) => entry.kind === 'material');
  const primaryPreference = colors[0] ?? null;
  const slots = primaryPreference ? colorSlots(primaryPreference.concept_id) : null;
  const out = {
    primary: slots ? { zh: slots.primary.zh, hex: slots.primary.hex, concept_id: primaryPreference.concept_id, based_on: primaryPreference.based_on } : null,
    secondary: slots ? slots.secondary.map((item) => ({ zh: item.zh, hex: item.hex, concept_id: primaryPreference.concept_id, based_on: primaryPreference.based_on })) : [],
    materials: materials.map((entry) => {
      const concept = conceptById(entry.concept_id);
      return { zh: concept?.material ?? concept?.zh ?? entry.label, concept_id: entry.concept_id, based_on: entry.based_on };
    }),
    tone: tones.length
      ? { id: conceptById(tones[0].concept_id)?.tone?.id ?? 'minimal', zh: conceptById(tones[0].concept_id)?.tone?.zh ?? tones[0].label, concept_id: tones[0].concept_id, based_on: tones[0].based_on }
      : null,
    keywords: preferences.map((entry) => ({ text: entry.label, concept_id: entry.concept_id, based_on: entry.based_on })),
  };
  // 明示了颜色但只给了一色：补一个中性辅色，仍然指回同一条依据。
  if (out.primary && out.secondary.length === 0) {
    out.secondary = [{ zh: '中性灰', hex: '#9A9A96', concept_id: null, based_on: primaryPreference.based_on }];
  }
  return out;
}

function fromBaseline(signals) {
  const confirmed = signals.interests.filter((entry) => entry.confidence === 'confirmed');
  const pool = confirmed.length ? confirmed : signals.interests;
  const primaryInterest = pool[0] ?? null;
  const preset = primaryInterest ? INTEREST_BASELINE[primaryInterest.id] ?? NEUTRAL_BASELINE : NEUTRAL_BASELINE;
  const slots = colorSlots(preset.color);
  const basedOn = primaryInterest ? primaryInterest.based_on : { field: 'request.recipient_relation', value: signals.relation.id || '(未提供)' };
  const out = {
    primary: slots ? { zh: slots.primary.zh, hex: slots.primary.hex, concept_id: preset.color, based_on: basedOn } : null,
    secondary: slots ? slots.secondary.map((item) => ({ zh: item.zh, hex: item.hex, concept_id: preset.color, based_on: basedOn })) : [],
    materials: preset.materials.map((zh) => ({ zh, concept_id: null, based_on: basedOn })),
    tone: preset.tone ? { ...preset.tone, concept_id: null, based_on: basedOn } : null,
    keywords: preset.keywords.map((text) => ({ text, concept_id: null, based_on: basedOn })),
  };
  return out;
}

/**
 * 核心推导（**纯函数、确定性、零网络**）。
 * 优先级严格按 PRIORITY_POLICY：先算基础方向 → 再用明示偏好覆盖 → 最后无条件剔除禁项。
 */
export function deriveDirectionCore({ intake = {}, request = {}, candidates = [], channel = 'rules' } = {}) {
  const signals = extractSignals({ intake, request });
  const banned = prohibitedSet(signals.prohibitions);
  const tradeoffs = [];

  const hasExplicitPreferenceRaw = signals.preferences.length > 0;
  /* 用户可能同时说「喜欢粉色」和「不要粉色」。
     按优先级 1（明令不喜欢 > 明示偏好），**先**把被禁的偏好剔出去，再挑主色，
     并如实记录这条冲突 —— 不能静默丢掉用户自己说过的话。 */
  const usablePreferences = signals.preferences.filter((entry) => {
    if (!entry.concept_id) return true;
    const isBanned = banned.has(entry.concept_id) || (kindOf(entry.concept_id) === 'color' && !colorAllowed(entry.concept_id, banned));
    if (!isBanned) return true;
    tradeoffs.push({
      decision: 'preference_dropped_for_prohibition',
      kept: 'user_prohibition',
      dropped: `明示偏好：${entry.label ?? conceptById(entry.concept_id)?.zh ?? entry.concept_id}`,
      reason: '该偏好命中用户自己明令不喜欢的内容；按优先级 1，禁项优先于明示偏好',
      based_on: entry.based_on ?? null,
    });
    return false;
  });
  const hasExplicitPreference = usablePreferences.length > 0;
  const base = hasExplicitPreference ? fromPreferences(usablePreferences) : fromBaseline(signals);
  if (hasExplicitPreferenceRaw && !hasExplicitPreference) {
    tradeoffs.push({
      decision: 'fell_back_to_baseline',
      kept: 'user_prohibition',
      dropped: '全部明示偏好',
      reason: '用户明示的风格偏好全部命中禁项，因此只用基线方向，不另起审美',
      based_on: signals.preferences[0]?.based_on ?? null,
    });
  }

  // 第 2 级（风格标签）只在没有明示颜色/材质/基调偏好时补充，避免覆盖用户原话。
  const styleMaterials = [];
  const styleKeywords = [];
  let styleTone = null;
  for (const style of signals.gift_styles) {
    const modifier = MODIFIERS[style.id];
    if (!modifier) continue;
    for (const zh of modifier.materials) {
      if (banned.has('material:glossy') && /亮面/.test(zh)) continue;
      styleMaterials.push({ zh, concept_id: null, based_on: style.based_on, source: 'gift_style' });
    }
    for (const text of modifier.keywords) styleKeywords.push({ text, concept_id: null, based_on: style.based_on, source: 'gift_style' });
    if (!styleTone && modifier.tone) styleTone = { ...modifier.tone, concept_id: null, based_on: style.based_on };
  }

  // 场合兜底关键词（第 3 级），只加词，不改用户选定的颜色。
  const occasionKeywords = [];
  if (signals.occasion.baseline) {
    for (const text of signals.occasion.baseline.keywords) {
      occasionKeywords.push({ text, concept_id: null, based_on: signals.occasion.based_on, source: 'occasion_baseline' });
    }
  }

  const palette = {
    primary: base.primary ? { ...base.primary } : null,
    secondary: base.secondary.map((item) => ({ ...item })),
  };
  const materials = [...base.materials, ...(hasExplicitPreference ? [] : styleMaterials)];
  const keywords = [...base.keywords, ...(hasExplicitPreference ? [] : styleKeywords), ...occasionKeywords];
  let tone = base.tone ?? styleTone ?? null;

  // ── 第 1 级：禁项绝对优先。命中即剔除，并如实记录取舍。 ──
  const dropIfBanned = (item, kindLabel) => {
    if (!item) return { kept: item, removed: false };
    const bannedById = item.concept_id && banned.has(item.concept_id);
    const bannedByText = [...banned].some((id) => {
      const concept = conceptById(id);
      if (!concept) return false;
      return typeof item.zh === 'string' && item.zh.includes(concept.zh);
    });
    if (!bannedById && !bannedByText) return { kept: item, removed: false };
    tradeoffs.push({
      decision: 'removed_for_prohibition',
      kept: 'user_prohibition',
      dropped: `${kindLabel}：${item.zh ?? item.text ?? '(无名)'}`,
      reason: '该要素命中用户明令不喜欢的内容，按优先级 1 一律剔除',
      based_on: item.based_on ?? null,
    });
    return { kept: null, removed: true };
  };

  const textBanned = (item) => [...banned].some((id) => {
    const concept = conceptById(id);
    return Boolean(concept) && typeof item?.zh === 'string' && item.zh.includes(concept.zh);
  });
  if (palette.primary) {
    const primaryBanned = palette.primary.concept_id ? !colorAllowed(palette.primary.concept_id, banned) : textBanned(palette.primary);
    if (primaryBanned) {
      tradeoffs.push({
        decision: 'removed_for_prohibition',
        kept: 'user_prohibition',
        dropped: `主色：${palette.primary.zh}`,
        reason: '主色命中用户明令不喜欢的颜色，按优先级 1 不得出现',
        based_on: palette.primary.based_on ?? null,
      });
      palette.primary = null;
    }
  }
  palette.secondary = palette.secondary.filter((item) => {
    const allowed = item.concept_id ? colorAllowed(item.concept_id, banned) : !textBanned(item);
    if (!allowed) {
      tradeoffs.push({
        decision: 'removed_for_prohibition',
        kept: 'user_prohibition',
        dropped: `辅色：${item.zh}`,
        reason: '辅色命中用户明令不喜欢的颜色，按优先级 1 不得出现',
        based_on: item.based_on ?? null,
      });
    }
    return allowed;
  });
  if (!palette.primary && palette.secondary.length) {
    const promoted = palette.secondary.shift();
    palette.primary = { ...promoted };
    tradeoffs.push({
      decision: 'promoted_secondary',
      kept: 'usable_color',
      dropped: '原主色（因命中禁项被移除）',
      reason: '主色被禁项剔除后，把未被禁的第一个辅色提升为主色，保证方向仍然可执行',
      based_on: promoted.based_on ?? null,
    });
  }
  if (!palette.primary) {
    // 所有候选颜色都被禁：如实说明「不给主色」，绝不用被禁的颜色顶。
    palette.primary = {
      zh: '无指定主色（候选颜色均因用户明令不喜欢而排除）',
      hex: null,
      concept_id: null,
      based_on: signals.prohibitions[0]?.based_on ?? { field: 'request.dislikes', value_sha256: sha256('') },
    };
  }

  const keptMaterials = materials.map((item) => dropIfBanned(item, '材质')).filter((r) => r.kept).map((r) => r.kept);
  const keptKeywords = keywords.map((item) => dropIfBanned(item, '关键词')).filter((r) => r.kept).map((r) => r.kept);
  if (tone) {
    const bannedTone = tone.concept_id && banned.has(tone.concept_id);
    const bannedText = [...banned].some((id) => conceptById(id)?.zh && typeof tone.zh === 'string' && tone.zh.includes(conceptById(id).zh));
    if (bannedTone || bannedText) {
      tradeoffs.push({
        decision: 'removed_for_prohibition',
        kept: 'user_prohibition',
        dropped: `视觉基调：${tone.zh}`,
        reason: '视觉基调命中用户明令不喜欢的风格，按优先级 1 不得出现',
        based_on: tone.based_on ?? null,
      });
      tone = null;
    }
  }
  if (!tone) {
    tone = {
      id: hasExplicitPreference ? 'user_preference' : 'neutral',
      zh: hasExplicitPreference
        ? '按用户明示偏好执行，不加我们自己的额外风格；成片保持克制、不堆叠装饰'
        : '中性克制：以材质与比例为主，不引入未经用户确认的风格',
      concept_id: null,
      based_on: signals.preferences[0]?.based_on ?? { field: 'request.recipient_relation', value: signals.relation.id || '(未提供)' },
    };
  }

  // 明示偏好与场合兜底冲突时：保留偏好，记录取舍（要求 7）。
  if (hasExplicitPreference && signals.occasion.baseline && signals.occasion.baseline.keywords) {
    const preferredLabels = signals.preferences.map((entry) => entry.label);
    tradeoffs.push({
      decision: 'preference_over_baseline',
      kept: `用户明示偏好：${preferredLabels.join('、')}`,
      dropped: `场合默认方向：${signals.occasion.baseline.keywords.join('、')}`,
      reason: signals.occasion.baseline.note,
      based_on: signals.preferences[0].based_on,
    });
  }

  // 追求对象守卫：所有面向人的文字都过一遍违禁表述扫描。
  const guardedTexts = [tone.zh, ...keptKeywords.map((k) => k.text), ...keptMaterials.map((m) => m.zh), palette.primary.zh];
  const guardHits = RELATION_GUARD.banned_phrases.filter((phrase) => guardedTexts.some((text) => typeof text === 'string' && text.includes(phrase)));
  if (guardHits.length) {
    // 命中说明词表本身有问题：这里直接删掉含违禁表述的词，并如实记录。
    for (const phrase of guardHits) {
      tradeoffs.push({
        decision: 'removed_for_relation_guard',
        kept: 'relation_guard',
        dropped: `含关系假定表述「${phrase}」的文案`,
        reason: RELATION_GUARD.note,
        based_on: signals.relation.based_on,
      });
    }
  }

  const candidateDigest = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && typeof c === 'object' && typeof c.id === 'string')
    .map((c) => ({ id: c.id, name: typeof c.name === 'string' ? c.name : '' }));

  const direction = {
    contract_version: VISUAL_DIRECTION_VERSION,
    channel,
    derived_from: {
      intake_fields: ['intake.interests', 'intake.gift_styles', 'intake.hard_exclusions', 'intake.dislikes', 'intake.recipient_relation', 'intake.occasion', 'intake.budget_range'],
      candidates: candidateDigest,
      candidates_based_on: { field: 'recommendation.candidates', value: '第 2 步输出的三个方案内容（仅作为包装题材，不覆盖任何用户偏好）' },
    },
    priority_policy: PRIORITY_POLICY.map((entry) => ({ ...entry })),
    palette: {
      primary: palette.primary,
      secondary: palette.secondary,
    },
    materials: keptMaterials,
    visual_tone: tone,
    keywords: keptKeywords,
    prohibitions: signals.prohibitions.map((entry) => ({ ...entry })),
    signals: {
      interests: signals.interests,
      gift_styles: signals.gift_styles,
      relation: signals.relation,
      occasion: signals.occasion,
      budget: signals.budget,
      available_days: signals.available_days,
      explicit_preference_fields: signals.preferences.map((entry) => entry.based_on.field),
    },
    tradeoffs,
    relation_guard: { ...RELATION_GUARD, banned_phrases: [...RELATION_GUARD.banned_phrases], applied: true, hits: guardHits },
    honesty: {
      not_a_design_deliverable: '本方向是**文字包装风格规范**，不是可生产图纸；尺寸与相对比例未核实。',
      ambiguity_note: '契约歧义 A（第 4 步产物是文字还是图片）按「先出结构化文字」实现；改成出图片的开关见 web/server/visual/provider.mjs 的 channel。',
    },
  };
  return direction;
}

/* ------------------------------------------------------------------ 校验与消费 */

/**
 * 结构性校验：方向必须完整到「第 5 步能直接用」。
 * 任何一项缺失都返回错误码，绝不静默补默认值。
 */
export function validateDirection(direction) {
  const errors = [];
  const fail = (code, path, message) => errors.push({ code, path, message });
  if (!direction || typeof direction !== 'object' || Array.isArray(direction)) {
    fail('DIRECTION_INVALID', 'visual_direction', '视觉方向必须为对象');
    return { ok: false, errors };
  }
  if (direction.contract_version !== VISUAL_DIRECTION_VERSION) fail('DIRECTION_INVALID', 'visual_direction.contract_version', '视觉方向契约版本不符');
  for (const path of ['palette', 'materials', 'visual_tone', 'keywords', 'prohibitions', 'tradeoffs', 'priority_policy']) {
    if (!Object.hasOwn(direction, path)) fail('DIRECTION_INVALID', `visual_direction.${path}`, '缺少必填字段');
  }
  if (!direction.palette?.primary || typeof direction.palette.primary.zh !== 'string' || !direction.palette.primary.based_on?.field) {
    fail('DIRECTION_UNTRACEABLE', 'visual_direction.palette.primary', '主色必须带 based_on 指回 intake 字段');
  }
  for (const [index, item] of (Array.isArray(direction.palette?.secondary) ? direction.palette.secondary : []).entries()) {
    if (!item?.based_on?.field) fail('DIRECTION_UNTRACEABLE', `visual_direction.palette.secondary[${index}]`, '辅色必须带 based_on');
  }
  for (const key of ['materials', 'keywords']) {
    for (const [index, item] of (Array.isArray(direction[key]) ? direction[key] : []).entries()) {
      if (!item?.based_on?.field) fail('DIRECTION_UNTRACEABLE', `visual_direction.${key}[${index}]`, '每个风格要素都必须带 based_on');
    }
  }
  if (!direction.visual_tone?.based_on?.field) fail('DIRECTION_UNTRACEABLE', 'visual_direction.visual_tone', '视觉基调必须带 based_on');
  for (const [index, item] of (Array.isArray(direction.prohibitions) ? direction.prohibitions : []).entries()) {
    if (!item?.based_on?.field) fail('DIRECTION_UNTRACEABLE', `visual_direction.prohibitions[${index}]`, '禁项必须带 based_on');
  }
  // 禁项绝不出现在应用面（配色/材质/基调/关键词）里。
  const surface = JSON.stringify(styleSurface(direction));
  for (const item of Array.isArray(direction.prohibitions) ? direction.prohibitions : []) {
    const concept = conceptById(item.concept_id);
    if (concept && surface.includes(concept.zh)) {
      fail('DIRECTION_PROHIBITED_LEAK', `visual_direction.prohibitions[${item.concept_id}]`, '被禁概念出现在了风格应用面里');
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 「风格应用面」= 会被真正执行/展示的那部分（不含追溯段）。
 * 测试与校验都以它为断言对象：**被禁的词不允许出现在这里**。
 */
export function styleSurface(direction) {
  if (!direction || typeof direction !== 'object') return {};
  const primary = direction.palette?.primary ?? null;
  return {
    primary_color: primary ? { name: primary.zh, hex: primary.hex ?? null } : null,
    secondary_colors: (direction.palette?.secondary ?? []).map((item) => item.zh),
    materials: (direction.materials ?? []).map((item) => item.zh),
    visual_tone: direction.visual_tone?.zh ?? null,
    keywords: (direction.keywords ?? []).map((item) => item.text),
    tradeoffs: (direction.tradeoffs ?? []).map((entry) => entry.dropped),
  };
}

/** 应用面全文（用于「不得出现 X」这类断言）。 */
export function styleSurfaceText(direction) {
  return JSON.stringify(styleSurface(direction));
}

/**
 * 第 5 步生图 prompt 的方向片段（**唯一来源**，见要求 6）。
 * 只输出正向描述：被禁的词不会进入 prompt（禁项只以「避开用户已确认的排除项」这句概括，
 * 具体忌讳词仍由 plan.mjs 既有的 avoid 通道携带，行为与改动前一致）。
 */
export function directionPromptText(direction) {
  if (!direction) return '';
  const primary = direction.palette?.primary;
  const secondary = (direction.palette?.secondary ?? []).map((item) => item.zh).join('/');
  const materials = (direction.materials ?? []).map((item) => item.zh).join('、');
  const keywords = (direction.keywords ?? []).map((item) => item.text).join('、');
  const paletteText = primary
    ? `主色 ${primary.zh}${primary.hex ? `(${primary.hex})` : ''}${secondary ? `，辅色 ${secondary}` : ''}`
    : '不指定主色';
  return [
    `包装风格与色彩方向（由第 3–4 步确定，第 5 步必须沿用，不得另起一套审美）：${paletteText}`,
    `指定材质与质感：${materials || '未指定，取克制的中性材质'}`,
    `视觉基调：${direction.visual_tone?.zh ?? '中性克制'}`,
    `风格关键词：${keywords || '无'}`,
    direction.tradeoffs?.length
      ? `已如实记录的取舍：${direction.tradeoffs.map((entry) => `${entry.decision}（保留 ${entry.kept}，放弃 ${entry.dropped}）`).join('；')}`
      : '无取舍记录（用户偏好与场合默认方向不冲突）',
  ].join('。');
}

/**
 * 呈现文字与第 4 步方向的对齐校验（要求 6 的另一半：文字面也不许另起一套配色）。
 * 分级处理，**不改写任何内容**：
 *   - `errors`：呈现配色里出现**被禁概念**（「不喜欢的东西」是绝对禁止）→ DIRECTION_PROHIBITED_COLOR；
 *   - `warnings`：存在**用户明示颜色偏好**时，呈现配色一个都没体现该偏好 → DIRECTION_PREFERENCE_IGNORED。
 *     这一条只做 warning：文案与配色的措辞自由度比生图 prompt 高，
 *     把它做成硬错会误杀「用户本意是黑白，模型写成『深灰与米白的中性组合』」这类仍然合规的输出。
 *     真正被硬保证的是第 5 步的生图 prompt（`directionPromptText()`：唯一来源、由代码生成）。
 */
export function presentationAlignmentErrors(direction, presentation) {
  const errors = [];
  const warnings = [];
  if (!direction || !presentation || typeof presentation !== 'object') return { errors, warnings };
  const palette = Array.isArray(presentation?.packaging?.color_palette) ? presentation.packaging.color_palette.filter((item) => typeof item === 'string') : [];
  const banned = (direction.prohibitions ?? []).filter((entry) => entry.kind === 'color');
  if (!ALL_CONCEPTS.length) return { errors, warnings };
  palette.forEach((item, index) => {
    for (const entry of banned) {
      const concept = conceptById(entry.concept_id);
      if (concept && [...item.toLowerCase()].length && item.toLowerCase().includes(concept.zh.toLowerCase())) {
        errors.push({
          code: 'DIRECTION_PROHIBITED_COLOR',
          path: `presentation.packaging.color_palette[${index}]`,
          message: '该配色命中用户明令不喜欢的颜色，按优先级 1 不得出现在包装方案里',
        });
      }
    }
  });
  const primary = direction.palette?.primary;
  const lockedByPreference = Boolean(primary && primary.based_on && /additional_context|notes|dislikes/.test(String(primary.based_on.field)));
  if (lockedByPreference && palette.length) {
    const concept = primary.concept_id ? conceptById(primary.concept_id) : null;
    const accepted = new Set([primary.zh, concept?.zh, ...(concept?.aliases ?? [])].filter((item) => typeof item === 'string' && item));
    const represented = palette.some((item) => [...accepted].some((alias) => item.includes(alias)));
    if (!represented) {
      warnings.push({
        code: 'DIRECTION_PREFERENCE_IGNORED',
        path: 'presentation.packaging.color_palette',
        message: `用户明示的包装主色是「${primary.zh}」，呈现配色里没有体现；请勿另起一套审美`,
      });
    }
  }
  return { errors, warnings };
}

export { COLOR_CONCEPTS, MATERIAL_CONCEPTS, TONE_CONCEPTS, conceptById, kindOf, matchConcepts };
