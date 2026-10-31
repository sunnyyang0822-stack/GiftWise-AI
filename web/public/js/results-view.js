/* 结果页视图：三个礼物思路 → 选定后的包装、贺卡、赠送方式与礼物账单 → 收束页。
   只负责渲染；选择、重置等动作由 app.js 通过 ctx 传入，业务状态与契约不在这里改。
   所有服务端/用户文本一律以 textContent 渲染。 */
import { icon } from "./icons.js";
import { candidateMedia, packagingMedia } from "./media-view.js";
import { friendlyMessages, cardWarnings } from "./friendly.js";

export function createResultViews(ctx) {
  const { el, state, selectCandidate, resetToForm, backToEncourage, backToHome, errorBox, stateView, render, apiFetch } = ctx;
  const withIcon = (name, text, cls = "") => el("span", { class: cls }, [icon(name, { size: 18 }), text]);
  const money = (v, cur = "CNY") => (cur === "CNY" ? `¥${v}` : `${v} ${cur}`);

  /* ------------------------------------------ 图片任务轮询（/api/media/tasks/<id>） */
  // 只读取既有任务；轮询与手动刷新均不创建/重试生图。离开时令在途响应失效。
  const MEDIA_TASK_ID_RE = /^[a-f0-9]{64}$/;
  const MEDIA_POLL_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000];
  const MEDIA_POLL_TIMEOUT_MS = 10000;
  const MEDIA_TERMINAL = new Set(["ready", "failed", "unavailable"]);
  const schedule = ctx.setTimeout || setTimeout;
  const cancel = ctx.clearTimeout || clearTimeout;
  const polls = new WeakMap();
  let activePoll = null;
  const visible = view => state.presentation === view && state.inFlow !== false && !state.busy && !state.encourage && !state.error && !state.timeout;
  const pending = view => view.media?.status === "pending" && view.media?.selected?.status === "pending";
  const current = (poll, epoch) => activePoll === poll && poll.epoch === epoch && visible(poll.view) && state.requestVersion === poll.version
    && poll.view.selected_candidate_id === poll.candidateId && poll.view.media?.selected?.candidate_id === poll.candidateId && poll.view.media?.selected?.task_id === poll.taskId;

  function stopMediaPoll() {
    if (!activePoll) return;
    if (activePoll.timer !== null) cancel(activePoll.timer);
    activePoll.timer = null;
    activePoll.inFlight = false;
    activePoll.update = null;
    activePoll.epoch += 1;
    activePoll = null;
  }

  function ensureMediaPoll(view, update) {
    const selected = view.media?.selected;
    if (view.status === "presentation_failed" || selected?.candidate_id !== view.selected_candidate_id || !MEDIA_TASK_ID_RE.test(String(selected?.task_id || ""))) {
      stopMediaPoll();
      return null;
    }
    let poll = polls.get(view);
    if (!poll || poll.taskId !== selected.task_id || poll.candidateId !== selected.candidate_id || poll.version !== state.requestVersion) {
      poll = { view, taskId: selected.task_id, candidateId: selected.candidate_id, version: state.requestVersion, timer: null, attempt: 0, epoch: 0, inFlight: false, stopped: false, note: "", update };
      polls.set(view, poll);
    }
    if (activePoll !== poll) { stopMediaPoll(); activePoll = poll; }
    poll.update = update;
    if (pending(view) && !poll.stopped && poll.timer === null && !poll.inFlight) tickMediaPoll(poll);
    return poll;
  }

  function tickMediaPoll(poll) {
    const epoch = poll.epoch;
    poll.timer = schedule(() => {
      poll.timer = null;
      if (current(poll, epoch)) void runMediaPoll(poll);
    }, MEDIA_POLL_DELAYS_MS[poll.attempt]);
  }

  async function runMediaPoll(poll, manual = false) {
    const epoch = poll.epoch;
    if (!current(poll, epoch) || poll.inFlight) return;
    poll.inFlight = true;
    if (!manual) poll.attempt += 1;
    poll.update?.();
    let data = null;
    try {
      const response = await apiFetch(`/api/media/tasks/${poll.taskId}`, null, { timeoutMs: MEDIA_POLL_TIMEOUT_MS, track: false });
      data = response.ok ? response.data : null;
    } catch {
      data = null;
    }
    if (!current(poll, epoch)) return;
    poll.inFlight = false;
    if (!data || !["pending", ...MEDIA_TERMINAL].includes(data.status) || data.selected?.task_id !== poll.taskId || data.selected?.candidate_id !== poll.candidateId || data.selected?.status !== data.status) {
      poll.note = "暂时无法更新图片";
      poll.stopped = true;
    } else {
      poll.view.media = data;
      poll.note = data.status === "failed" ? "效果图生成未成功" : data.status === "unavailable" ? "暂时没有效果图" : "";
      if (manual) poll.attempt = 0;
      poll.stopped = MEDIA_TERMINAL.has(data.status) || poll.attempt >= MEDIA_POLL_DELAYS_MS.length;
      if (data.status === "pending" && poll.stopped) poll.note = "效果图还在生成";
    }
    poll.update?.();
    if (!poll.stopped && pending(poll.view)) tickMediaPoll(poll);
  }

  function mediaOptions(view, poll) {
    const isPending = Boolean(poll && pending(view));
    return {
      pending: isPending && !poll.note,
      message: poll?.note || (isPending ? "效果图生成中" : view.media?.status === "failed" ? "效果图生成未成功" : "暂时没有效果图"),
      refreshing: Boolean(poll?.inFlight),
      onRefresh: poll && view.media?.status !== "unavailable" && (poll.note || view.media?.status === "failed") ? () => { void runMediaPoll(poll, true); } : null,
    };
  }

  function requestChips(request) {
    if (!request) return null;
    const range = request.budget_range ? (String(request.budget_range.max) === "0" ? "预算 0 元" : `${request.budget_range.min}–${request.budget_range.max} 元`) : null;
    return el("div", { class: "result-chips", "aria-label": "你的需求" }, [
      request.recipient_relation ? el("span", { class: "result-chip" }, [icon("heart", { size: 16 }), request.recipient_relation]) : null,
      request.occasion ? el("span", { class: "result-chip" }, [icon("calendar", { size: 16 }), request.occasion]) : null,
      range ? el("span", { class: "result-chip" }, [icon("wallet", { size: 16 }), range]) : null,
      Number.isFinite(request.available_days) ? el("span", { class: "result-chip" }, [icon("clock", { size: 16 }), `时间参考：${request.available_days} 天`]) : null,
    ]);
  }

  function evidenceList(items, empty) {
    return items && items.length ? el("ul", { class: "list" }, items.map(x => el("li", { text: x }))) : el("p", { class: "field__hint", text: empty });
  }

  /* ---------------------------------------------------- 三个礼物思路 */
  function renderRecommendation() {
    const report = state.report;
    const body = [];
    const facts = new Map((report.request?.facts || []).map(f => [f.id, f.text]));
    const results = new Map((report.validation?.candidate_results || []).map(r => [r.id, r]));
    const selectable = new Set(report.selectable_candidate_ids || []);
    // 只交付服务端真正允许继续的建议，不把失败卡当最终结果，也不改写校验或补候选。
    const candidates = (report.candidates || []).filter(candidate => selectable.has(candidate.id) && results.get(candidate.id)?.passed === true);

    if (candidates.length === 0) {
      return stateView("这次还没生成合适的建议", ["可以返回需求小结，再试一次。"], [
        el("button", { class: "btn btn--primary", type: "button", onclick: () => resetToForm() }, [icon("refresh", { size: 18 }), "返回需求并重试"]),
      ]);
    }

    body.push(el("header", { class: "result-head" }, [
      el("div", {}, [
        el("h1", { text: candidates.length === 3 ? "三个思路，挑一个最像你们的。" : candidates.length === 2 ? "两个思路，看看更喜欢哪个。" : "这个思路，看看喜不喜欢。" }),
        requestChips(report.request),
      ]),
      el("p", { class: "hand-note", "aria-hidden": "true", text: "慢慢看，不着急～" }),
    ]));

    const grid = el("div", { class: "candidate-grid", "aria-label": `${candidates.length} 个礼物思路` });
    candidates.forEach((candidate, index) => {
      const result = results.get(candidate.id);
      const messages = friendlyMessages(result.errors);
      const hasPrice = (typeof candidate.estimated_total === "string" && /^\d+(?:\.\d{1,2})?$/.test(candidate.estimated_total))
        || (typeof candidate.estimated_total === "number" && Number.isFinite(candidate.estimated_total) && candidate.estimated_total >= 0);
      const price = hasPrice ? `参考 ${money(candidate.estimated_total, candidate.currency)}` : "价格待了解";
      const card = el("article", { class: "card gift-choice", "data-candidate-id": candidate.id, "aria-labelledby": `gift-title-${index}` }, [
        el("div", { class: "gift-choice__index" }, [
          el("span", { class: "gift-choice__no", "aria-hidden": "true", text: ["壹", "贰", "叁"][index] || String(index + 1) }),
          el("span", { class: "sr-only", text: `方案 ${index + 1}` }),
        ]),
        (() => { const figure = candidateMedia(report, candidate); return figure.dataset.imageId === "missing" ? null : figure; })(),
        el("div", { class: "gift-choice-heading" }, [
          el("h2", { class: "card__title", id: `gift-title-${index}`, text: candidate.name }),
          el("span", { class: "gift-choice-price", text: price }),
        ]),
        el("p", { class: "card__lead", text: candidate.description }),
        el("ul", { class: "gift-facts" }, [
          Number.isFinite(candidate.estimated_preparation_days) ? el("li", {}, [icon("clock", { size: 16 }), `准备约 ${candidate.estimated_preparation_days} 天`]) : null,
          ...cardWarnings(result.warnings).map(text => el("li", {}, [icon("lightbulb", { size: 16 }), text])),
        ]),
        el("details", { class: "candidate-evidence" }, [
          el("summary", {}, [icon("search", { size: 18 }), "为什么推荐它"]),
          el("dl", { class: "kv" }, [
            el("dt", { text: "推荐理由" }), el("dd", { text: candidate.reason }),
            el("dt", { text: "你告诉我的" }),
            el("dd", {}, [evidenceList((candidate.fact_refs || []).map(ref => facts.get(ref)).filter(Boolean), "暂无")]),
            el("dt", { text: "我的推断" }), el("dd", {}, [evidenceList(candidate.inferences, "无")]),
            el("dt", { text: "还不确定的" }), el("dd", {}, [evidenceList(candidate.unknowns, "暂无")]),
            ...(messages.length ? [el("dt", { text: "补充说明" }), el("dd", {}, [evidenceList(messages, "")])] : []),
          ]),
        ]),
        el("div", { class: "suggest-row" }, [
          el("button", { class: "btn btn--primary", type: "button", disabled: state.busy, onclick: () => selectCandidate(candidate.id) }, state.busy ? [el("span", { class: "gw-dots", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]), el("span", { class: "sr-only", text: "加载中" })] : [icon("gift", { size: 18 }), "就选它"]),
        ]),
      ]);
      // 图片来源收进“为什么推荐它”，卡片正面保持干净。
      const provenance = card.querySelector(".media-source");
      if (provenance) card.querySelector(".candidate-evidence").append(provenance);
      grid.append(card);
    });
    body.push(grid);

    if ((report.request?.preference_inferences || []).length > 0) {
      body.push(el("section", { class: "card" }, [
        el("h2", { class: "card__title" }, [icon("lightbulb"), "我从你的回答里推断"]),
        evidenceList(report.request.preference_inferences.map(x => x.text), ""),
      ]));
    }

    return {
      body,
      actions: [el("button", { class: "btn btn--ghost", type: "button", onclick: () => resetToForm() }, [icon("refresh", { size: 18 }), "重新聊一次"])],
    };
  }

  /* ------------------------------------------------- 选定之后的呈现 */
  const SECTION_ICONS = [["包装", "gift"], ["配色", "palette"], ["贺卡", "card"], ["赠送", "hand"]];
  const sectionIcon = title => (SECTION_ICONS.find(([k]) => title.includes(k)) || [null, "sparkles"])[1];
  const cleanTitle = title => title.replace(/^[①②③④⑤⑥\d.\s、]+/, "");

  function renderPresentation() {
    const view = state.presentation;
    const failed = view.status === "presentation_failed";
    if (failed) stopMediaPoll();
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
      let mediaSlot;
      const poll = ensureMediaPoll(view, () => {
        if (!visible(view) || !mediaSlot?.isConnected) return;
        const next = packagingMedia(view, mediaOptions(view, poll));
        mediaSlot.replaceWith(next);
        mediaSlot = next;
      });
      mediaSlot = packagingMedia(view, mediaOptions(view, poll));
      body.push(mediaSlot);
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
        Number.isFinite(s.revised_estimated_preparation_days) ? row("clock", "准备时间", `约 ${s.revised_estimated_preparation_days} 天${Number.isFinite(s.available_days) ? ` / 可用 ${s.available_days} 天` : ""}`) : null,
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

  return { renderRecommendation, renderPresentation, renderEncourage, withIcon, stopMediaPoll };
}
