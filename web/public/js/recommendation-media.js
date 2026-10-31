import { candidateMedia, localMediaUrl } from "./media-view.js";

// 推荐文字已完成；这里只读同一运行的参考图快照，不创建检索或图片任务。
export function createRecommendationMedia(ctx) {
  const { state, el, apiFetch } = ctx;
  const schedule = ctx.setTimeout || setTimeout, cancel = ctx.clearTimeout || clearTimeout;
  // 覆盖后台180秒有界补图，窗口末尾再只读一次；耗尽不改服务端pending。
  const delays = [1000, 2000, 4000, ...Array(21).fill(8000), 5000];
  const polls = new WeakMap();
  let active = null;
  const ids = report => (report.candidates || []).map(c => c.id);
  const hasPending = report => (report.media?.candidates || []).some(slot => slot.status === "pending");
  const visible = report => state.report === report && !state.presentation && state.inFlow !== false && !state.busy && !state.encourage && !state.error && !state.timeout;
  const current = (poll, epoch) => active === poll && poll.epoch === epoch && visible(poll.report)
    && state.requestVersion === poll.version && poll.report.recommendation_run_id === poll.runId && JSON.stringify(ids(poll.report)) === poll.idsKey;

  function stopRecommendationMediaPoll() {
    if (!active) return;
    if (active.timer !== null) cancel(active.timer);
    active.timer = null;
    active.epoch++;
    active.inFlight = false;
    active.slots.clear();
    active = null;
  }

  function begin(report) {
    if (active && (active.report !== report || active.version !== state.requestVersion || active.runId !== report.recommendation_run_id || active.idsKey !== JSON.stringify(ids(report)))) stopRecommendationMediaPoll();
  }

  function queue(poll) {
    const epoch = poll.epoch;
    poll.timer = schedule(() => {
      poll.timer = null;
      if (current(poll, epoch)) void read(poll);
    }, delays[poll.attempt]);
  }

  function ensure(report) {
    if (typeof report.recommendation_run_id !== "string" || !report.recommendation_run_id || typeof apiFetch !== "function") return null;
    let poll = polls.get(report);
    const idsKey = JSON.stringify(ids(report));
    if (!poll || poll.runId !== report.recommendation_run_id || poll.version !== state.requestVersion || poll.idsKey !== idsKey) {
      poll = { report, runId: report.recommendation_run_id, idsKey, version: state.requestVersion, slots: new Map(), epoch: 0, timer: null, attempt: 0, inFlight: false, stopped: false, note: "", gone: false };
      polls.set(report, poll);
    }
    if (active !== poll) { stopRecommendationMediaPoll(); active = poll; }
    if (hasPending(report) && poll.attempt >= delays.length && !poll.inFlight) { poll.stopped = true; poll.note ||= "配图还在准备"; }
    if (visible(report) && hasPending(report) && !poll.stopped && !poll.inFlight && poll.timer === null) queue(poll);
    return poll;
  }

  function validSnapshot(data, poll) {
    if (data?.recommendation_run_id !== poll.runId || !Array.isArray(data.retrieval?.references) || !Array.isArray(data.media?.candidates)) return false;
    const slots = data.media.candidates, expected = JSON.parse(poll.idsKey);
    if (slots.length !== expected.length || new Set(expected).size !== expected.length || expected.some(id => slots.filter(s => s?.candidate_id === id).length !== 1)) return false;
    return slots.every(slot => {
      if (!["pending", "ready", "unavailable"].includes(slot.status)) return false;
      if (slot.status !== "ready") return slot.image === null;
      const image = slot.image;
      const refs = data.retrieval.references.filter(ref => ref && ref.reference_id === slot.reference_id);
      return typeof slot.reference_id === "string" && Boolean(slot.reference_id.trim()) && refs.length === 1
        && image?.kind === "reference_image" && typeof image.id === "string" && Boolean(image.id.trim()) && localMediaUrl(image.url)
        && refs[0].image_id === image.id && refs[0].image_kind === "reference_image" && refs[0].image_validation?.ok === true;
    });
  }

  async function read(poll, manual = false) {
    const epoch = poll.epoch;
    if (!current(poll, epoch) || poll.inFlight || poll.gone) return;
    poll.inFlight = true;
    if (!manual) poll.attempt++;
    refresh(poll);
    let response;
    try { response = await apiFetch(`/api/runs/${encodeURIComponent(poll.runId)}`, null, { timeoutMs: 10000, track: false }); } catch { response = null; }
    if (!current(poll, epoch)) return;
    poll.inFlight = false;
    if (!response?.ok || !validSnapshot(response.data, poll)) {
      poll.stopped = true;
      poll.gone = [401, 403, 404, 410].includes(response?.status);
      poll.note = "暂时无法更新配图";
    } else {
      // 冻结文字、候选与服务端可选性，只合并图片字段；不覆盖选后媒体或全局状态。
      poll.report.retrieval = { ...poll.report.retrieval, references: response.data.retrieval.references };
      poll.report.media = { ...poll.report.media, candidates: response.data.media.candidates };
      if (manual) poll.attempt = 0;
      poll.stopped = !hasPending(poll.report) || poll.attempt >= delays.length;
      poll.note = hasPending(poll.report) && poll.stopped ? "配图还在准备" : "";
    }
    refresh(poll);
    if (!poll.stopped && hasPending(poll.report)) queue(poll);
  }

  function refresh(poll) {
    for (const slot of poll.slots.values()) if (slot.node.isConnected) slot.update();
  }

  function candidateSlot(report, candidate) {
    const poll = ensure(report);
    const slot = el("div", { class: "candidate-media-slot" });
    let signature;
    const update = () => {
      const bindings = (report.media?.candidates || []).filter(b => b.candidate_id === candidate.id);
      const binding = bindings.length === 1 ? bindings[0] : null;
      const pending = binding?.status === "pending";
      const references = (report.retrieval?.references || []).filter(ref => ref && ref.reference_id === binding?.reference_id);
      const next = JSON.stringify([bindings, references, pending ? [poll?.note, poll?.inFlight, poll?.gone] : null]);
      if (next === signature) return;
      signature = next;
      const figure = candidateMedia(report, candidate), content = [];
      if (figure.dataset.imageId !== "missing") content.push(figure);
      else if (pending) {
        content.push(el("p", { class: "candidate-image-status", role: "status", "aria-live": "polite", text: poll?.note || "配图准备中" }));
        if (poll?.stopped && !poll.gone) content.push(el("button", { class: "btn media-retry", type: "button", disabled: poll.inFlight, text: poll.inFlight ? "正在更新配图" : "刷新配图", onclick: () => { void read(poll, true); } }));
      }
      slot.hidden = content.length === 0;
      slot.replaceChildren(...content);
    };
    if (poll) poll.slots.set(candidate.id, { node: slot, update });
    update();
    return slot;
  }
  return { begin, candidateSlot, stopRecommendationMediaPoll };
}
