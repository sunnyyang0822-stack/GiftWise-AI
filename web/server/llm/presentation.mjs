/**
 * 呈现阶段的**本地**实现（选择后）：包装 / 配色 / 贺卡 / 赠送 四段 + 账单。
 *
 * 为什么在本地实现：Dify 侧本轮从未实现呈现阶段（workflow/dify-setup.md 第 65 行
 * 明确「本轮不实现……包装阶段」），所以这一阶段由接入层自己产出。
 * 结构与 web/server/mock-model.mjs 的 buildMockPresentation **同构**，
 * 因此既有的 checkPresentation 复核与 buildSections 渲染无需改动即可复用。
 *
 * 两条契约分支（与 checker.mjs 一致）：
 *   - contract_version === "giftwise-20261031-v2"：根恰好 8 个键，
 *     packaging 支持 color_palette、materials、steps、description；本地示例明确标注来源。
 *     不得出现 additional_cost / revised_estimated_total / material_tags 或包装报价。
 *   - 旧契约：packaging 需 materials/steps/color_palette，并带
 *     additional_cost 与 revised_estimated_total（两者和必须等于候选原估算）。
 *
 * 纪律：不使用 forbidden_tags / forbidden_terms 命中的字面词；追求对象用低压力表达，
 * 不假定互有好感或既有恋爱关系；不声称核实了实时价格、库存或送达。
 */

import { dump } from "../jsonstrict.mjs";
import { packagingSections } from "../presentation-packaging.mjs";
import { norm } from "../checker.mjs";
import { CLOSENESS_TABLE } from "../labels.mjs";

/** 本地呈现的关系语气表（与 mock 同规则、不同措辞，便于区分来源）。 */
function flavor(relationId) {
  const table = {
    pursuit: {
      style: "低压力、干净利落",
      card_text: "生日快乐！路过时看到合适的就带了一份，新的一岁顺顺利利，想做的事都能推进一点。",
      timing: "挑对方方便、环境轻松的时段单独交接，聊几句就收尾，不安排需要对方回应的话题。",
      wording: "顺手准备的一点生日心意，祝你生日快乐，别有负担。",
      cautions: ["不暗示双方已确定关系", "不默认告白或索要回应", "不在公开场合制造回应压力"],
    },
    partner: {
      style: "温和、生活感",
      card_text: "生日快乐！新的一岁也一起走，想做的事慢慢都实现，谢谢你一直在。",
      timing: "在你们习惯的相处时段单独送出，吃饭、散步或在家都可以。",
      wording: "亲爱的，生日快乐，陪你过这一天我很开心。",
      cautions: ["可以表达亲密，但不承诺对方的反应或关系结果"],
    },
    friend: {
      style: "轻松、日常",
      card_text: "生日快乐！新的一岁顺顺利利，有空一起吃个饭。",
      timing: "聚会或约饭时当面送出，语气放松即可。",
      wording: "给你带了个小东西，生日快乐！",
      cautions: ["避免过度亲密的表达"],
    },
    family: {
      style: "朴素、实用",
      card_text: "生日快乐！家里都好，记得照顾好自己。",
      timing: "家人聚餐或通电话时送出，可以顺带聊几句近况。",
      wording: "生日快乐，给你准备了一点实用的东西。",
      cautions: ["以实用与陪伴为主，不做关系推断"],
    },
    classmate: {
      style: "简洁、中性",
      card_text: "生日快乐！祝学业顺利，想做的事都能开个头。",
      timing: "课间或宿舍附近交接，避免当众制造压力。",
      wording: "生日快乐，一点小心意。",
      cautions: ["不把同学关系读成更亲密的关系"],
    },
    mentor: {
      style: "端正、克制",
      card_text: "谢谢您一直以来的指导，祝您一切顺利。",
      timing: "办公时间或课后简短交接，不占用对方私人时间。",
      wording: "老师，一点心意，谢谢您的指导。",
      cautions: ["师生关系分寸优先，不做过强的私人化表达"],
    },
    client_partner: {
      style: "商务、得体",
      card_text: "感谢一路支持，祝愿合作顺利。",
      timing: "工作场合交接，避免在私人时间或私下场合单独赠送。",
      wording: "感谢您的支持，一点心意，合作愉快。",
      cautions: ["商务场合得体为先，避免私人化表达"],
    },
    other: {
      style: "中性、克制",
      card_text: "生日快乐！一点心意，祝一切顺利。",
      timing: "在对方方便的时间与场合交接即可。",
      wording: "给你带了一点小心意，祝你生日快乐。",
      cautions: ["关系信息有限，保持中性表达"],
    },
  };
  return table[relationId] || table.other;
}

function paletteFor(isPursuit, attempt) {
  if (attempt === 2) return ["原色", "米白"];
  if (isPursuit) return ["米白", "浅灰", "雾蓝"];
  return ["米白", "原木色", "浅灰蓝"];
}

const NEUTRAL_CARD = "一点心意，祝你一切顺利。";
const NEUTRAL_TIMING = "在对方方便的时间与场合交接即可。";
const NEUTRAL_WORDING = "给你带了一点小心意。";

/** 命中禁忌字面词就换成中性文本，绝不用改写规避真实禁忌。 */
function safeText(value, forbiddenTerms, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const folded = norm(value);
  return forbiddenTerms.some((term) => folded.includes(term)) ? fallback : value;
}

function forbiddenOf(request) {
  return (Array.isArray(request?.forbidden_terms) ? request.forbidden_terms : [])
    .filter((term) => typeof term === "string" && term.trim())
    .map(norm);
}

/**
 * 产出呈现对象（与 buildMockPresentation 同构）。
 * @returns {{presentation: object, presentation_json: string, sections: Array, bill: object, notices: string[], local: true}}
 */
export function buildLocalPresentation(request, candidate, options = {}) {
  const attempt = options.attempt === 2 ? 2 : 1;
  const relationId = request?.recipient_relation_id || "other";
  const isPursuit = relationId === "pursuit";
  const tone = flavor(relationId);
  const closeness = CLOSENESS_TABLE[request?.closeness] || "未提供";
  const forbidden = forbiddenOf(request);
  const cardText = safeText(tone.card_text, forbidden, NEUTRAL_CARD);
  const timing = safeText(tone.timing, forbidden, NEUTRAL_TIMING);
  const wording = safeText(tone.wording, forbidden, NEUTRAL_WORDING);
  const styleText = safeText(tone.style, forbidden, "简洁克制");
  const palette = paletteFor(isPursuit, attempt).filter((word) => !forbidden.some((term) => norm(word).includes(term)));
  const colorPalette = palette.length > 0 ? palette : ["米白"];
  const days = Number.isInteger(candidate?.estimated_preparation_days) ? candidate.estimated_preparation_days : 0;
  const cautions = tone.cautions.slice();

  const sharedUnknowns = [
    "实际价格、库存、配送时效均未核实",
    `关系熟悉程度记录为「${closeness}」，未据此推断对方偏好`,
    ...(isPursuit ? ["对方是否接受此类表达方式未知，不承诺结果"] : []),
  ];

  let presentation;
  if (request?.contract_version === "giftwise-20261031-v2") {
    presentation = {
      contract_version: "giftwise-20261031-v2",
      style: styleText,
      packaging: { color_palette: colorPalette },
      card_text: cardText,
      giving_advice: { timing, wording, relationship_cautions: cautions },
      unknowns: sharedUnknowns,
      currency: "CNY",
      revised_estimated_preparation_days: days,
    };
  } else {
    const materials = attempt === 2 ? ["原盒", "纸质贺卡"] : ["素色包装纸", "纸质贺卡", "棉质束带"];
    const steps =
      attempt === 2
        ? ["使用原盒固定礼物", "放入纸质贺卡后合上盒盖"]
        : ["用素色包装纸包好礼物并压平边角", "棉质束带绑一道活结，避免压到物品", "把贺卡放在包装上层，避免折痕"];
    const decorative = isPursuit
      ? ["不使用玫瑰等强表白含义的花材", "如需搭配，用一支尤加利叶或干花点缀即可"]
      : ["可搭配一小束花或干花，避免遮挡贺卡文字"];
    presentation = {
      selected_candidate_id: candidate?.id ?? null,
      packaging: {
        materials,
        steps,
        color_palette: colorPalette,
        material_tags: ["other"],
      },
      card_text: cardText,
      giving_advice: { timing, wording, relationship_cautions: cautions },
      decorative_advice: decorative,
      // 本地实现不新增支出：全量估算等于候选原估算，因此不会因包装费用超预算。
      additional_cost: "0.00",
      revised_estimated_total: typeof candidate?.estimated_total === "string" ? candidate.estimated_total : "0.00",
      currency: "CNY",
      revised_estimated_preparation_days: days,
      unknowns: sharedUnknowns,
    };
  }

  return {
    presentation,
    presentation_json: dump(presentation),
    sections: buildLocalSections(presentation, candidate, request, { cardText, timing, wording, cautions, colorPalette, styleText, isPursuit, attempt }),
    bill: buildLocalBill(request, candidate, presentation),
    notices: ["以下呈现内容由接入层本地生成（未调用外部平台），仍按相同规则复核。"],
    local: true,
  };
}

/** Actual content sections; packaging is optional and physical description-only content has its own title. */
function buildLocalSections(presentation, candidate, request, ctx) {
  const packaging = presentation.packaging || {};
  return [
    {
      key: "style",
      title: "① 风格与配色",
      items: [
        `配色：${ctx.colorPalette.join("、")}`,
        `风格取向：${ctx.styleText}`,
        `关系与场合：${request?.recipient_relation ?? "未提供"} · ${request?.occasion ?? "未提供"}`,
        `围绕方案：${candidate?.name ?? "未命名候选"}`,
      ],
    },
    ...packagingSections(packaging),
    {
      key: "card",
      title: "③ 贺卡正文与装饰物建议",
      items: [
        `贺卡正文：${ctx.cardText}`,
        ...(Array.isArray(presentation.decorative_advice) ? presentation.decorative_advice.map((d) => `装饰物：${d}`) : []),
      ],
    },
    {
      key: "giving",
      title: "④ 赠送时机、方式与话术",
      items: [`时机与方式：${ctx.timing}`, `话术：${ctx.wording}`, ...ctx.cautions.map((c) => `关系提示：${c}`)],
    },
  ];
}

/**
 * 账单：只列所选的这一个礼物，不把三候选相加。
 * 礼物估价从服务端冻结候选读取，不由模型产出。
 */
export function buildLocalBill(request, candidate, presentation) {
  return {
    selected_candidate_id: candidate?.id ?? null,
    gift_name: candidate?.name ?? null,
    gift_estimated_total: candidate?.estimated_total ?? null,
    currency: presentation?.currency ?? "CNY",
    packaging_additional_cost: presentation?.additional_cost ?? null,
    revised_estimated_total: presentation?.revised_estimated_total ?? candidate?.estimated_total ?? null,
    revised_estimated_preparation_days: presentation?.revised_estimated_preparation_days ?? null,
    budget_amount: request?.budget_amount ?? null,
    line_items: ["所选礼物 1 件"],
    note: "礼物估价取自服务端冻结候选；包装、贺卡、装饰与配送不计入礼物预算不等于免费，未核实项见 unknowns。",
  };
}
