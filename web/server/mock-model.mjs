/**
 * 模拟数据生成（必须显著标注为模拟，不得让演示者或评委误以为已联通 Dify）。
 *
 * 为什么是模拟：接入层未配置真实模型凭证（DIFY_API_KEY），从未成功调用过一次，
 * 因而无法调用真实推荐接口。这里用确定性「模拟模型」产生
 * 三个候选与呈现内容：它只看 confirmed 事实、风格与关系，**不做预算/禁忌过滤**，
 * 由独立的规则校验负责拦截不合格候选——这与真实链路的职责划分一致。
 *
 * 关系文案：partner（恋人）与 pursuit（追求对象）使用完全不同的贺卡语气、赠送话术与
 * 风险提示；pursuit 默认低压力，不暗示关系已确定、不默认告白、不制造回应压力。
 */

import { dump } from "./jsonstrict.mjs";
import { INTEREST_TABLE, GIFT_STYLE_TABLE, CLOSENESS_TABLE } from "./labels.mjs";
import { MOCK_CANDIDATE_NOTICE, MOCK_PRESENTATION_NOTICE } from "./config.mjs";

/** 金额字符串 → 分（BigInt）；非法返回 null。 */
function centsOf(value) {
  const raw = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(raw)) return null;
  const [int, frac = ""] = raw.split(".");
  return BigInt(int) * 100n + BigInt((frac + "00").slice(0, 2));
}

/** 分（BigInt）→ 两位小数字符串。 */
function textOf(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

/** 模拟候选池：成本、准备天数、类别标签、适配的兴趣与风格都固定，便于复核。 */
export const MOCK_CATALOG = [
  {
    key: "drinkware",
    name: "简洁杯具与杯垫",
    description: "以日常饮用器具为方向，不涉及具体豆种或食品口味。",
    estimated_total: "138.00",
    estimated_preparation_days: 1,
    tags: ["other"],
    interests: ["coffee_food", "home_living"],
    styles: ["practical", "understated"],
    reason: "围绕已确认的宽泛兴趣选择相关但较少依赖口味的方向；未确认对方具体偏好。",
    unknowns: ["对方是否已有同类物品", "具体规格与颜色偏好", "实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送"],
  },
  {
    key: "stationery",
    name: "空白便笺与书写笔",
    description: "以低负担的通用记录用品为方向，不推定其职业或阅读爱好。",
    estimated_total: "96.00",
    estimated_preparation_days: 2,
    tags: ["other"],
    interests: ["reading_learning", "design_art", "home_living"],
    styles: ["practical", "design", "understated"],
    reason: "回应送礼者提出希望实用、精致但不张扬的风格要求；这是送礼者的选择，不是收礼人已确认的偏好。",
    unknowns: ["对方是否使用纸笔", "实际价格、库存和送达均未核实；估算含基础包装、贺卡和配送"],
  },
  {
    key: "coffee_beans",
    name: "单品咖啡豆礼盒",
    description: "以食品类方向回应咖啡兴趣，口味为通用拼配。",
    estimated_total: "118.00",
    estimated_preparation_days: 1,
    tags: ["food"],
    interests: ["coffee_food"],
    styles: ["practical", "surprising"],
    reason: "兴趣组包含咖啡与美食，食品方向直接相关；仍不确认对方对具体口味的偏好。",
    unknowns: ["对方是否饮用咖啡或有器具", "口味与烘焙度偏好", "保质期与实际价格未核实"],
  },
  {
    key: "scented_candle",
    name: "无标识香氛蜡烛",
    description: "以居家氛围类方向为主，气味为清淡型。",
    estimated_total: "128.00",
    estimated_preparation_days: 2,
    tags: ["fragrance"],
    interests: ["home_living", "design_art"],
    styles: ["design", "understated"],
    reason: "依送礼者选择的有设计感、精致但不张扬方向，选择居家氛围类物件。",
    unknowns: ["对方对气味是否敏感", "实际价格与库存未核实"],
  },
  {
    key: "plant_pot",
    name: "桌面绿植与素色陶盆",
    description: "以可长期摆放的植物方向为主，盆器为素色。",
    estimated_total: "88.00",
    estimated_preparation_days: 3,
    tags: ["plant"],
    interests: ["plants_nature", "home_living"],
    styles: ["design", "understated"],
    reason: "选择可长期保留、不需要对方即时回应的方向，适合了解不多的情况。",
    unknowns: ["对方是否愿意照料植物", "实际价格与库存未核实"],
  },
  {
    key: "desk_lamp",
    name: "便携阅读灯与书签",
    description: "以阅读辅助方向为主，不推定具体阅读类型。",
    estimated_total: "108.00",
    estimated_preparation_days: 2,
    tags: ["other"],
    interests: ["reading_learning", "tech_digital"],
    styles: ["practical", "design"],
    reason: "与阅读学习兴趣相关且不涉及尺寸敏感的穿戴类物品，风险相对可控。",
    unknowns: ["对方阅读习惯与使用场景", "实际价格与库存未核实"],
  },
  {
    key: "experience",
    name: "可自主挑选的体验额度",
    description: "以保留收礼人自主选择空间为方向，具体支持渠道需购买前确认。",
    estimated_total: "188.00",
    estimated_preparation_days: 1,
    tags: ["other"],
    interests: ["experiences_activities", "travel_exploration", "music_movies"],
    styles: ["experiential", "surprising"],
    reason: "具体兴趣不足时，让对方自主挑选可能降低选错物品的风险；不把猜测兴趣当事实。",
    unknowns: ["对方对额度类礼物的接受程度", "可用范围和有效期", "实际价格与交付均未核实"],
  },
];

const FALLBACK_POOL = ["stationery", "drinkware", "experience"];

function scoreCandidate(item, confirmedInterests, styles) {
  let score = 0;
  for (const key of item.interests) if (confirmedInterests.includes(key)) score += 3;
  for (const key of item.styles) if (styles.includes(key)) score += 1;
  return score;
}

/** 确定性挑选三个不同思路（同一输入永远同一输出，便于复核与比对）。 */
export function pickMockIdeas(request) {
  const confirmed = (Array.isArray(request.facts) ? request.facts : [])
    .map((f) => (typeof f?.id === "string" && f.id.startsWith("interest:") ? f.id.slice("interest:".length) : null))
    .filter(Boolean);
  const styles = Array.isArray(request.gift_styles) ? request.gift_styles : [];
  const ranked = MOCK_CATALOG.map((item, index) => ({ item, index, score: scoreCandidate(item, confirmed, styles) })).sort(
    (a, b) => b.score - a.score || a.index - b.index,
  );
  const chosen = [];
  const usedFamilies = new Set();
  for (const entry of ranked) {
    if (chosen.length === 3) break;
    // 三个候选必须是不同思路：同 key 与同类别组合不重复。
    const family = entry.item.tags.join("+");
    if (usedFamilies.has(family)) continue;
    usedFamilies.add(family);
    chosen.push(entry.item);
  }
  for (const key of FALLBACK_POOL) {
    if (chosen.length >= 3) break;
    const item = MOCK_CATALOG.find((x) => x.key === key);
    if (item && !chosen.includes(item)) chosen.push(item);
  }
  return chosen.slice(0, 3);
}

function focusText(request) {
  const confirmed = (Array.isArray(request.facts) ? request.facts : [])
    .map((f) => (typeof f?.id === "string" && f.id.startsWith("interest:") ? INTEREST_TABLE[f.id.slice(9)] : null))
    .filter(Boolean);
  if (confirmed.length > 0) return `已确认兴趣：${confirmed.join("、")}`;
  const inferred = (Array.isArray(request.preference_inferences) ? request.preference_inferences : [])
    .map((x) => (x?.interest_id && INTEREST_TABLE[x.interest_id] ? INTEREST_TABLE[x.interest_id] : null))
    .filter(Boolean);
  if (inferred.length > 0) return `兴趣尚未确认（仅有猜测：${inferred.join("、")}）`;
  return "未提供兴趣信息，按低风险通用方向处理";
}

function styleText(request) {
  const styles = (Array.isArray(request.gift_styles) ? request.gift_styles : [])
    .map((s) => GIFT_STYLE_TABLE[s])
    .filter(Boolean);
  return styles.length > 0 ? styles.join("、") : "未指定";
}

/** 生成三个候选（模拟数据）。返回 candidates_json 字符串与说明。 */
export function buildMockCandidates(request) {
  const ideas = pickMockIdeas(request);
  const factIds = (Array.isArray(request.facts) ? request.facts : [])
    .map((f) => (typeof f?.id === "string" ? f.id : null))
    .filter(Boolean);
  const candidates = ideas.map((idea, index) => {
    const refs = factIds.filter((id) => {
      const key = id.startsWith("interest:") ? id.slice(9) : null;
      return key ? idea.interests.includes(key) : false;
    });
    return {
      id: `c${index + 1}`,
      name: idea.name,
      description: idea.description,
      estimated_total: idea.estimated_total,
      currency: "CNY",
      estimated_preparation_days: idea.estimated_preparation_days,
      tags: [...idea.tags],
      reason: idea.reason + `（依据：${focusText(request)}；送礼者风格要求：${styleText(request)}）`,
      fact_refs: refs,
      inferences: [idea.inferences || `在了解不多时，${idea.name}属于相对稳妥的方向，但不保证对方喜欢。`],
      unknowns: [...idea.unknowns],
      presentation: "可采用简洁中性包装；详细方案待用户选择后生成",
      _mock_source: idea.key,
    };
  });
  return {
    candidates,
    candidates_json: dump({ candidates }),
    notice: MOCK_CANDIDATE_NOTICE,
    mock: true,
  };
}

/**
 * 一次自动修订（模拟）：只改未通过项，已通过项逐字节不变（对齐 N6 的状态保护）。
 * 返回新批次与说明；调用方负责判定是否还有全局额度。
 */
export function buildMockRevision(request, candidates, validation) {
  const budgetCents = centsOf(request.budget_amount);
  const availableDays = typeof request.available_days === "number" ? request.available_days : null;
  const forbiddenTags = new Set(Array.isArray(request.forbidden_tags) ? request.forbidden_tags : []);
  const forbiddenTerms = (Array.isArray(request.forbidden_terms) ? request.forbidden_terms : []).map((t) => t.normalize("NFKC").toLowerCase());
  const changed = [];
  const next = candidates.map((candidate, index) => {
    const result = validation.candidate_results[index];
    if (!result || result.passed) return candidate; // 已通过项必须保持不变
    const codes = new Set(result.errors.map((e) => e.code));
    const revised = JSON.parse(JSON.stringify(candidate));
    const notes = [];
    if (codes.has("FORBIDDEN_TAG") || codes.has("FORBIDDEN_TERM") || codes.has("UNKNOWN_TAG")) {
      const alternative = MOCK_CATALOG.find(
        (idea) => !idea.tags.some((t) => forbiddenTags.has(t)) && !forbiddenTerms.some((term) => idea.name.includes(term) || idea.description.includes(term)),
      );
      if (alternative) {
        revised.name = alternative.name;
        revised.description = alternative.description;
        revised.tags = [...alternative.tags];
        revised.reason = `据首次检查反馈调整：${alternative.reason}`;
        revised.estimated_total = alternative.estimated_total;
        revised.estimated_preparation_days = alternative.estimated_preparation_days;
        revised._mock_source = alternative.key;
        notes.push("移除触发明确禁忌的类别与字面词");
      }
    }
    if (codes.has("OVER_BUDGET") && budgetCents !== null) {
      const target = (budgetCents * 8n) / 10n; // 留出 20% 余量
      revised.estimated_total = `${target / 100n}.${String(target % 100n).padStart(2, "0")}`;
      revised.name = `${revised.name}（改小规格）`;
      revised.reason = `${revised.reason}（据首次检查反馈改为更小规格以符合预算上限）`;
      notes.push("改为更小规格以符合预算上限");
    }
    if (codes.has("PREPARATION_TOO_LONG") || codes.has("INVALID_TYPE")) {
      if (availableDays !== null) {
        revised.estimated_preparation_days = availableDays;
        revised.name = `${revised.name}（改为现货速购）`;
        revised.reason = `${revised.reason}（据首次检查反馈改为现货速购以符合可用天数）`;
        notes.push("改为现货速购以符合可用天数");
      }
    }
    changed.push({ id: candidate.id, notes });
    return revised;
  });
  return {
    candidates: next,
    candidates_json: dump({ candidates: next }),
    changed,
    notice: "一次自动修订（模拟）：只调整未通过项，已通过项保持不变。",
    mock: true,
  };
}

/* ------------------------------------------------------ 呈现阶段（选择后） */

function relationFlavor(relationId) {
  const table = {
    pursuit: {
      card_text: "生日快乐！看到合适的小东西就顺手带了一份，希望新的一岁顺顺利利，做想做的事。",
      timing: "挑对方方便、环境轻松的时候单独送出，简单聊几句就结束，不安排需要回应的话题。",
      wording: "这是顺手准备的一点生日心意，祝你生日快乐，别有负担。",
      cautions: ["不暗示双方已确定关系", "不默认告白或要求回应", "避免在公开场合制造回应压力"],
    },
    partner: {
      card_text: "生日快乐！又一岁和你一起过，愿你喜欢的都慢慢实现，也谢谢你一直在。",
      timing: "在你们习惯的相处时段单独送出，可以一起吃饭、散步或看电影时交给对方。",
      wording: "亲爱的，生日快乐，陪你过这一天我很开心。",
      cautions: ["可以表达亲密，但不承诺对方反应或关系结果"],
    },
    friend: {
      card_text: "生日快乐！祝新的一岁顺顺利利，改天一起吃个饭。",
      timing: "聚会或约饭时当面送出，语气轻松即可。",
      wording: "给你带了个小东西，生日快乐！",
      cautions: ["避免过度亲密表达"],
    },
    family: {
      card_text: "生日快乐！家里一切都好，希望你照顾好自己。",
      timing: "家人聚餐或通电话时送出，可以顺带说几句近况。",
      wording: "生日快乐，给你准备了一点实用的东西。",
      cautions: ["以实用与陪伴为主，不做关系推断"],
    },
    classmate: {
      card_text: "生日快乐！祝学业顺利，也祝你想做的事都能开始。",
      timing: "课间或宿舍附近交接，避免当众制造压力。",
      wording: "生日快乐，一点小心意。",
      cautions: ["避免把同学关系读成更亲密的关系"],
    },
    mentor: {
      card_text: "谢谢您一直以来的指导，祝您一切顺利。",
      timing: "办公时间或课后简短交接，不占用对方私人时间。",
      wording: "老师，一点心意，谢谢您的指导。",
      cautions: ["师生关系分寸优先，不私人化过强"],
    },
    client_partner: {
      card_text: "感谢一路支持，祝愿合作顺利。",
      timing: "工作场合交接，避免在私人时间或私下场合单独赠送。",
      wording: "感谢您的支持，一点心意，合作愉快。",
      cautions: ["商务场合得体为先，避免私人化表达"],
    },
    other: {
      card_text: "生日快乐！一点心意，祝一切顺利。",
      timing: "在对方方便的时间与场合交接即可。",
      wording: "给你带了一点小心意，祝你生日快乐。",
      cautions: ["关系信息有限，保持中性表达"],
    },
  };
  return table[relationId] || table.other;
}

/**
 * 生成呈现内容（模拟）。attempt=1 表示首次；attempt=2 表示复核失败后的一次修订。
 */
export function buildMockPresentation(request, candidate, options = {}) {
  const attempt = options.attempt === 2 ? 2 : 1;
  const forceOverBudgetFirst = options.forceOverBudgetFirst === true;
  const relationId = request.recipient_relation_id || "other";
  const flavor = relationFlavor(relationId);
  const closeness = CLOSENESS_TABLE[request.closeness] || "未提供";
  const isPursuit = relationId === "pursuit";

  const baseMaterials = ["素色包装纸", "纸质贺卡", "棉质束带"];
  const materials = attempt === 2 ? ["原盒", "纸质贺卡"] : baseMaterials;
  const originalCents = centsOf(candidate.estimated_total) ?? 0n;
  // 演示开关：把新增费用算成「刚好超预算一分钱」，保证首次复核必然失败且失败原因可解释。
  const budgetCents = centsOf(request.budget_amount);
  const forced =
    attempt === 1 && forceOverBudgetFirst && budgetCents !== null && originalCents !== null
      ? budgetCents - originalCents + 1n > 0n
        ? budgetCents - originalCents + 1n
        : 1n
      : 0n;
  const additionalCost = textOf(forced);
  const totalCents = originalCents + forced;
  const total = textOf(totalCents);

  const presentation = {
    selected_candidate_id: candidate.id,
    packaging: {
      materials,
      steps:
        attempt === 2
          ? ["使用原盒固定礼物", "放入纸质贺卡后合上盒盖"]
          : ["用素色包装纸包裹礼物并压平边角", "棉质束带绑一道活结，避免压到物品", "把贺卡放在包装上层，避免折痕"],
      color_palette: attempt === 2 ? ["原色", "米白"] : ["米白", "浅木色", "雾霾蓝"],
      material_tags: ["other"],
    },
    card_text: flavor.card_text,
    giving_advice: {
      timing: flavor.timing,
      wording: flavor.wording,
      relationship_cautions: flavor.cautions,
    },
    decorative_advice: isPursuit
      ? ["不使用玫瑰等强表白含义的花材", "如需搭配，用一支尤加利叶或干花点缀即可"]
      : ["可搭配一小束花或干花，避免遮挡贺卡文字"],
    additional_cost: additionalCost,
    revised_estimated_total: total,
    currency: "CNY",
    revised_estimated_preparation_days: candidate.estimated_preparation_days,
    unknowns: [
      "实际价格、库存、配送时效均未核实",
      `关系熟悉程度记录为「${closeness}」，未据此推断对方偏好`,
      ...(isPursuit ? ["对方是否接受此类表达方式未知，不承诺结果"] : []),
    ],
    _mock_revised: attempt === 2,
    _mock_notice: MOCK_PRESENTATION_NOTICE,
  };
  return { presentation, presentation_json: dump(presentation), notice: MOCK_PRESENTATION_NOTICE, mock: true };
}

/** 模拟模型故障：返回损坏 JSON，用于验证「失败不伪装为完成」。 */
export function buildBrokenModelOutput() {
  return {
    candidates: undefined,
    candidates_json: '{"candidates":[{"id":"c1","name":"示例",',
    notice: "模拟模型输出损坏的 JSON，用于验证失败路径。",
    mock: true,
  };
}

/**
 * 模拟「模型输出了自动修订也修不好的候选」：第二个候选把用户从未提供的一条兴趣当成已确认事实引用。
 * UNKNOWN_FACT_REF 不在自动修订的可修集合里（修订只处理超预算、超天数、触犯禁忌），
 * 因此可以稳定演示「部分通过」状态：失败项不可选、系统不自动替选、修订额度用掉后如实报告。
 */
export function buildMockPartialFailure(request) {
  const built = buildMockCandidates(request);
  const candidates = JSON.parse(JSON.stringify(built.candidates));
  if (candidates.length >= 2) {
    candidates[1].fact_refs = ["interest:not_provided_by_user"];
    candidates[1].reason = "（模拟模型失控）把一条用户从未提供的兴趣当成已确认事实来引用。";
  }
  return {
    candidates,
    candidates_json: dump({ candidates }),
    notice: "模拟模型输出了一条引用不存在事实的候选；自动修订无法修复它，用于验证「部分通过、失败项不可选」。",
    mock: true,
  };
}

/* ----------------------------------------------------- 最坏情况文案（破版自查用） */

/**
 * 压力文案：真实模型输出可能很长、夹 emoji、含不可断行的连续字符（长 URL、长英文词）。
 * 这类内容不该撑破卡片或产生横向滚动。仅用于 `?demo=stress` 的前端自查，
 * 不参与正常演示路径，也不会被当成真实模型输出。
 */
const UNBREAKABLE = "https://example.com/%E8%B6%85%E9%95%BF%E9%93%BE%E6%8E%A5Supercalifragilisticexpialidocious";
const LONG_ZH =
  "这一段是故意写得极长的说明，用来验证窄屏下中文长句能否正常换行、不撑破卡片边界、不与右侧动作条重叠。" +
  "它还包含标点密集片段：「一号、二号（三号）／四号——五号；六号、七号」，以及全角空格　和半角空格混合排版。";
const LONG_EMOJI = "🎁 表情符号夹在中文里不应打断换行 🎀✨🧦☕️🌱 也来一串家族 emoji 👨‍👩‍👧‍ 和地区旗 🇨🇳🇯🇵🇫🇷 与变体 ❤️︎➡️⬆️";

export function buildMockStressCandidates(request) {
  const built = buildMockCandidates(request);
  const candidates = JSON.parse(JSON.stringify(built.candidates));
  candidates.forEach((candidate, index) => {
    candidate.name = `第 ${index + 1} 个思路的名字也被刻意拉长：${UNBREAKABLE} ${LONG_EMOJI}`;
    candidate.description = `${LONG_ZH}${LONG_EMOJI}`;
    candidate.reason = `${candidate.reason} ${LONG_ZH}`;
    candidate.inferences = [`${candidate.inferences[0]} ${LONG_ZH}`, `不可断行长串：${UNBREAKABLE}${UNBREAKABLE}`];
    candidate.unknowns = [`${candidate.unknowns[0]}（后续追加极长说明以检查列表项换行）${LONG_ZH}`, `emoji 计数：${"🎁".repeat(40)}`];
  });
  return {
    candidates,
    candidates_json: dump({ candidates }),
    notice: "压力演示：候选文案被刻意拉长并夹入 emoji 与不可断行长串，仅用于前端破版自查，不是真实模型输出。",
    mock: true,
  };
}

/** 呈现阶段的压力文案：同一份呈现结构，字段全部换成极端长度。 */
export function stressifyPresentation(presentation) {
  const long = (text) => `${text} ${LONG_ZH}${LONG_EMOJI}`;
  return {
    ...presentation,
    packaging: {
      ...presentation.packaging,
      materials: presentation.packaging.materials.map((m) => `${m}（${UNBREAKABLE}）`),
      steps: presentation.packaging.steps.map(long),
      color_palette: [...presentation.packaging.color_palette, "极长配色名：暖白偏米色调第 13 号色卡", `🎨️🪵${LONG_EMOJI}`],
    },
    card_text: long(presentation.card_text),
    decorative_advice: presentation.decorative_advice.map(long),
    giving_advice: {
      ...presentation.giving_advice,
      timing: long(presentation.giving_advice.timing),
      wording: long(presentation.giving_advice.wording),
      relationship_cautions: [...presentation.giving_advice.relationship_cautions, long("追加一条超长关系提示")],
    },
    unknowns: [...presentation.unknowns, `不可断行长串：${UNBREAKABLE}${UNBREAKABLE}${UNBREAKABLE}`],
  };
}
