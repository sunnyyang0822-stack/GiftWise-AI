// Controlled monotonic clock/DOM harness. It measures API snapshot adoption, never browser image decode.
export class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.isConnected = true; this.style = { setProperty() {} }; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === "class") this.className = String(value); if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  addEventListener(key, fn) { this.events[key] = fn; }
  append(...children) { this.children.push(...children.filter(x => x != null && x !== false)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map(x => typeof x === "string" ? x : x.textContent).join(""); }
  querySelectorAll(selector) { const match = node => selector.startsWith(".") ? (node.className || "").split(/\s+/).includes(selector.slice(1)) : node.tagName === selector; return this.children.flatMap(child => child instanceof Element ? [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const el = (tag, props = {}, children = []) => { const node = new Element(tag); for (const [key, value] of Object.entries(props)) { if (value == null || value === false) continue; if (key === "text") node.textContent = value; else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value === true ? "" : value); } node.append(...[].concat(children)); return node; };
export const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
export function fixture(ready = false) {
  const ids = ["c1", "c2", "c3"];
  return { recommendation_run_id: "clock-run", candidates: ids.map(id => ({ id })), retrieval: { references: ready ? ids.map((id, i) => ({ reference_id: `ref_${id}`, image_id: String(i + 1).repeat(32), image_kind: "reference_image", image_validation: { ok: true } })) : [] }, media: { status: "unavailable", selected: null, candidates: ids.map((candidate_id, i) => ({ candidate_id, status: ready ? "ready" : "pending", reference_id: ready ? `ref_${candidate_id}` : null, image: ready ? { id: String(i + 1).repeat(32), kind: "reference_image", url: `/api/reference/images/${String(i + 1).repeat(32)}` } : null })) } };
}
export function setup(create, { initial = fixture(), snapshot = fixture(true), readyAt = Infinity, latency = 0, fetcher } = {}) {
  globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  globalThis.location = { origin: "http://127.0.0.1:8911" };
  let time = 0, sequence = 0, inFlight = 0, maxInFlight = 0;
  const timers = new Map(), calls = [], state = { report: structuredClone(initial), inFlow: true, requestVersion: 1 };
  const ctx = { el, state, now: () => time, setTimeout: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, due: time + delay }); return id; }, clearTimeout: id => timers.delete(id), apiFetch: async (...args) => {
    const startedAt = time, record = { startedAt, args }; calls.push(record); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (fetcher) return await fetcher({ startedAt, advance: ms => { time += ms; }, calls });
      const data = structuredClone(startedAt >= readyAt ? snapshot : initial);
      time += latency; return { ok: true, status: 200, data };
    } finally { record.finishedAt = time; inFlight--; }
  } };
  const control = create(ctx), root = el("main");
  const mount = () => root.replaceChildren(...state.report.candidates.map(candidate => control.candidateSlot(state.report, candidate)));
  mount();
  return { state, root, control, calls, timers, mount, get now() { return time; }, get maxInFlight() { return maxInFlight; }, advance: ms => { time += ms; }, async next() { const entry = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0]; if (!entry) return; timers.delete(entry[0]); time = Math.max(time, entry[1].due); entry[1].fn(); await flush(); } };
}
