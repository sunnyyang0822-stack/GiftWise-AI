/* 结果页视图：三个礼物思路 → 选定后的包装、贺卡、赠送方式与礼物账单 → 收束页。
   只负责渲染；选择、重置等动作由 app.js 通过 ctx 传入，业务状态与契约不在这里改。
   所有服务端/用户文本一律以 textContent 渲染。 */
import { icon } from "./icons.js";
import { candidateMedia, packagingMedia } from "./media-view.js";

export function createResultViews(ctx) {
  const { el, state, selectCandidate, resetToForm, backToEncourage, backToHome, errorBox, stateView, render } = ctx;
  const withIcon = (name, text, cls = "") => el("span", { class: cls }, [icon(name, { size: 18 }), text]);
  const money = (v, cur = "CNY") => (cur === "CNY" ? `¥${v}` : `${v} ${cur}`);

  function requestChips(request) {
    if (!request) return null;
    const range = request.budget_range ? (request.budget_range.max === "0" ? "不花钱的心意" : `${request.budget_range.min}–${request.budget_range.max} 元`) : null;
    return el("div", { class: "result-chips", "aria-label": "你的需求" }, [
      request.recipient_relation ? el("span", { class: "result-chip" }, [icon("heart", { size: 16 }), request.recipient_relation]) : null,
      request.occasion ? el("span", { class: "result-chip" }, [icon("calendar", { size: 16 }), request.occasion]) : null,
      range ? el("span", { class: "result-chip" }, [icon("wallet", { size: 16 }), range]) : null,
      Number.isFinite(request.available_days) ? el("span", { class: "result-chip" }, [icon("clock", { size: 16 }), `${request.available_days} 天内`]) : null,
    ]);
  }

  function evidenceList(items, empty) {
    return items && items.length ? el("ul", { class: "list" }, items.map(x => el("li", { text: x }))) : el("p", { class: "field__hint", text: empty });
  }

  /* ---------------------------------------------------- 三个礼物思路 */
  function renderRecommendation() {
    const report = state.report;
    const body = [];
    const facts = new Map((report.request.facts || []).map(f => [f.id, f.text]));
    const results = new Map((report.validation.candidate_results || []).map(r => [r.id, r]));
    const selectable = new Set(report.selectable_candidate_ids || []);

    if ((report.candidates || []).length === 0) {
      return stateView("这次没有找到合适的思路", ["换个说法或放宽一点条件，我们再试一次。"], [
        el("button", { class: "btn btn--primary", type: "button", onclick: () => resetToForm() }, [icon("refresh", { size: 18 }), "重新聊一次"]),
      ]);
    }

    body.push(el("header", { class: "result-head" }, [
      el("div", {}, [
        el("h1", { text: "三个思路，挑一个最像你们的。" }),
        requestChips(report.request),
      ]),
      el("p", { class: "hand-note", "aria-hidden": "true", text: "慢慢看，不着急～" }),
    ]));

    const grid = el("div", { class: "candidate-grid", "aria-label": "三个礼物思路" });
    report.candidates.forEach((candidate, index) => {
      const result = results.get(candidate.id) || { passed: false, errors: [{ code: "MISSING_RESULT", message: "缺少检查结果，暂不可选" }] };
      const canSelect = selectable.has(candidate.id) && result.passed === true;
      const card = el("article", { class: `card gift-choice ${canSelect ? "" : "card--fail"}`, "data-candidate-id": candidate.id, "aria-labelledby": `gift-title-${index}` }, [
        el("div", { class: "gift-choice__index" }, [
          el("span", { class: "gift-choice__no", "aria-hidden": "true", text: ["壹", "贰", "叁"][index] || String(index + 1) }),
          el("span", { class: "sr-only", text: `方案 ${index + 1}` }),
        ]),
        candidateMedia(report, candidate),
        el("div", { class: "gift-choice-heading" }, [
          el("h2", { class: "card__title", id: `gift-title-${index}`, text: candidate.name }),
          el("span", { class: "gift-choice-price", text: `参考 ${money(candidate.estimated_total, candidate.currency)}`, "aria-label": `参考价 ${candidate.estimated_total} 元` }),
        ]),
        el("p", { class: "card__lead", text: candidate.description }),
        el("ul", { class: "gift-facts" }, [
          el("li", {}, [icon("clock", { size: 16 }), `准备约 ${candidate.estimated_preparation_days} 天`]),
          ...(result.warnings || []).map(w => el("li", {}, [icon("lightbulb", { size: 16 }), w.message])),
        ]),
        el("p", { class: "gift-choice-status" }, canSelect ? [icon("shield", { size: 18 }), "预算、时间、避开项都符合"] : [icon("ban", { size: 18 }), "有条件不符合，暂不可选"]),
        el("details", { class: "candidate-evidence" }, [
          el("summary", {}, [icon("search", { size: 18 }), "为什么推荐它"]),
          el("dl", { class: "kv" }, [
            el("dt", { text: "推荐理由" }), el("dd", { text: candidate.reason }),
            el("dt", { text: "你告诉我的" }),
            el("dd", {}, [evidenceList((candidate.fact_refs || []).map(ref => facts.get(ref)).filter(Boolean), "暂无")]),
            el("dt", { text: "我的推断" }), el("dd", {}, [evidenceList(candidate.inferences, "无")]),
            el("dt", { text: "还不确定的" }), el("dd", {}, [evidenceList(candidate.unknowns, "暂无")]),
            ...(result.errors && result.errors.length ? [el("dt", { text: "哪里不符合" }), el("dd", {}, [evidenceList(result.errors.map(e => e.message), "")])] : []),
          ]),
        ]),
        el("div", { class: "suggest-row" }, [
          canSelect
            ? el("button", { class: "btn btn--primary", type: "button", disabled: state.busy, onclick: () => selectCandidate(candidate.id) }, [icon("gift", { size: 18 }), state.busy ? "正在准备…" : "就选它"])
            : el("button", { class: "btn btn--ghost", type: "button", disabled: true, text: "暂不可选" }),
        ]),
      ]);
      // 图片来源收进“为什么推荐它”，卡片正面保持干净。
      const provenance = card.querySelector(".media-source");
      if (provenance) card.querySelector(".candidate-evidence").append(provenance);
      grid.append(card);
    });
    body.push(grid);

    if ((report.request.preference_inferences || []).length > 0) {
      body.push(el("section", { class: "card" }, [
        el("h2", { class: "card__title" }, [icon("lightbulb"), "我从你的回答里推断"]),
        evidenceList(report.request.preference_inferences.map(x => x.text), ""),
      ]));
    }
    if (report.workflow_errors?.length) body.push(errorBox(report.workflow_errors, "生成时遇到的问题"));
    if (report.validation.errors?.length) body.push(errorBox(report.validation.errors, "检查时遇到的问题"));
    if (selectable.size === 0) body.push(el("p", { class: "field__hint", text: "这次三个思路都和你的要求有冲突，改改需求再试一次吧。" }));

    return {
      body,
      actions: [el("button", { class: `btn ${selectable.size ? "btn--ghost" : "btn--primary"}`, type: "button", onclick: () => resetToForm() }, [icon("refresh", { size: 18 }), "重新聊一次"])],
    };
  }

  /* ------------------------------------------------- 选定之后的呈现 */
  const SECTION_ICONS = [["包装", "gift"], ["配色", "palette"], ["贺卡", "card"], ["赠送", "hand"]];
  const sectionIcon = title => (SECTION_ICONS.find(([k]) => title.includes(k)) || [null, "sparkles"])[1];
  const cleanTitle = title => title.replace(/^[①②③④⑤⑥\d.\s、]+/, "");

  function renderPresentation() {
    const view = state.presentation;
    const failed = view.status === "presentation_failed";
    const s = view.recheck_summary || {};
    const body = [];

    body.push(el("header", { class: "result-head" }, [
      el("div", {}, [
        el("h1", { text: failed ? "这份方案还没准备好" : `就是它了：${view.candidate?.name || "你选的礼物"}` }),
        failed ? null : el("div", { class: "result-chips" }, [
          s.gift_estimated_total !== undefined ? el("span", { class: "result-chip" }, [icon("coins", { size: 16 }), `参考 ${money(s.gift_estimated_total, s.currency)}`]) : null,
          Number.isFinite(s.revised_estimated_preparation_days) ? el("span", { class: "result-chip" }, [icon("clock", { size: 16 }), `准备约 ${s.revised_estimated_preparation_days} 天`]) : null,
        ]),
      ]),
      failed ? null : el("p", { class: "hand-note", "aria-hidden": "true", text: "好好送出去吧" }),
    ]));

    if (failed) {
      body.push(el("section", { class: "card card--fail" }, [errorBox(view.presentation_check?.errors, "没通过的原因")]));
    } else {
      body.push(packagingMedia(view));
      const sections = view.sections || [];
      const card = sections.find(sec => sec.title.includes("贺卡"));
      const others = sections.filter(sec => sec !== card);
      if (card) {
        body.push(el("article", { class: "greeting-card", "aria-label": "贺卡" }, [
          el("p", { class: "greeting-card__eyebrow" }, [icon("card", { size: 18 }), "贺卡"]),
          ...card.items.map(text => el("p", { class: "greeting-card__body", text })),
          el("p", { class: "greeting-card__sign", text: "—— 写给 TA" }),
        ]));
      }
      body.push(el("div", { class: "present-grid" }, others.map(sec => el("section", { class: "card present-card" }, [
        el("h2", { class: "card__title" }, [icon(sectionIcon(sec.title)), cleanTitle(sec.title)]),
        el("ul", { class: "list" }, sec.items.filter(Boolean).map(item => el("li", { text: item }))),
      ]))));
    }

    if (view.revised_once && view.repaired_checks?.length) body.push(errorBox(view.repaired_checks, "第一次检查发现的问题（已自动修订一次）"));

    const tags = (s.forbidden_tags || []).join("、");
    const terms = (s.forbidden_terms || []).join("、");
    const row = (iconName, term, detail, cls = "") => el("div", { class: `bill__row ${cls}` }, [icon(iconName, { size: 20 }), el("dt", { text: term }), el("dd", {}, [].concat(detail))]);
    body.push(el("section", { class: `card ${s.passed ? "card--ok" : "card--fail"}`, "aria-labelledby": "bill-title" }, [
      el("h2", { class: "card__title", id: "bill-title" }, [icon("wallet"), "礼物账单"]),
      el("dl", { class: "bill" }, [
        row("gift", view.candidate?.name || "所选礼物", s.gift_estimated_total !== undefined ? `参考 ${money(s.gift_estimated_total, s.currency)}` : "—", "bill__total"),
        row("coins", "你的预算", s.budget_range ? `${s.budget_range.min}–${s.budget_range.max} 元` : "—"),
        row("ribbon", "包装与贺卡", "风格与色调建议"),
        row("clock", "准备时间", Number.isFinite(s.revised_estimated_preparation_days) ? `约 ${s.revised_estimated_preparation_days} 天 / 可用 ${s.available_days} 天` : "—"),
        tags || terms ? row("ban", "已避开", [tags, terms].filter(Boolean).join("、")) : null,
        row("shield", "符合你的要求", el("span", { class: `bill-status ${s.passed ? "" : "bill-status--fail"}` }, [icon(s.passed ? "check" : "x", { size: 16 }), s.passed ? "都符合" : "有不符合"])),
      ]),
    ]));

    return {
      body,
      actions: [
        failed ? null : el("button", { class: "btn btn--primary", type: "button", onclick: () => backToEncourage() }, [icon("sparkles", { size: 18 }), "完成"]),
        el("button", { class: "btn", type: "button", onclick: () => { state.presentation = null; render(); } }, [icon("arrow-left", { size: 18 }), "换一个思路"]),
        el("button", { class: "btn btn--ghost", type: "button", onclick: () => resetToForm() }, [icon("refresh", { size: 18 }), "重新开始"]),
      ],
    };
  }

  /* ---------------------------------------------------------- 收束页 */
  function renderEncourage() {
    const request = state.report?.request;
    const view = state.presentation;
    const summary = view?.recheck_summary;
    const stat = (iconName, term, detail) => el("div", { class: "encourage__stat" }, [el("dt", {}, [icon(iconName, { size: 16 }), term]), el("dd", { text: detail })]);
    return {
      body: [
        el("article", { class: "greeting-card" }, [
          el("p", { class: "encourage__eyebrow", text: "写给认真准备的你" }),
          el("h2", { class: "encourage__title", text: "心意已经想清楚了。" }),
          el("p", { class: "encourage__lead", text: "你不是不知道送什么，你只是想把这件事做对——这本身就是礼物里最珍贵的部分。剩下的，只是把它包起来、写下来、递出去。" }),
          el("div", { class: "encourage__rule", "aria-hidden": "true" }),
          el("dl", { class: "encourage__stats" }, [
            stat("heart", "为谁准备", request ? `${request.recipient_relation} · ${request.occasion}` : "—"),
            stat("gift", "选定的礼物", view?.candidate?.name || "—"),
            stat("coins", "参考价", summary?.gift_estimated_total !== undefined ? money(summary.gift_estimated_total, summary.currency) : "—"),
          ]),
          el("p", { class: "greeting-card__sign", text: "—— GiftWise" }),
        ]),
      ],
      actions: [
        el("button", { class: "btn btn--primary", type: "button", onclick: () => backToHome() }, [icon("home", { size: 18 }), "回到首页"]),
        el("button", { class: "btn", type: "button", onclick: () => { state.encourage = false; render(); } }, [icon("arrow-left", { size: 18 }), "再看一遍"]),
      ],
    };
  }

  return { renderRecommendation, renderPresentation, renderEncourage, withIcon };
}
