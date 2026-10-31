/* GiftWise 线性图标（24×24，圆头描边，本项目自绘，无外部依赖）。
   用法：icon("heart") 返回 <svg>；静态 HTML 写 <i data-icon="heart"></i>，再调用 hydrateIcons()。 */
const P = {
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z"/>',
  "heart-spark": '<path d="M11 20s-7-4.2-7-9.4A3.9 3.9 0 0 1 11 8.3a3.9 3.9 0 0 1 7 2.3"/><path d="M18.5 13.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9Z"/>',
  hearts: '<path d="M9 18s-5.5-3.3-5.5-7.4A3.2 3.2 0 0 1 9 8.7a3.2 3.2 0 0 1 5.5 1.9c0 4.1-5.5 7.4-5.5 7.4Z"/><path d="M15.5 6.2A2.6 2.6 0 0 1 20.5 7.6c0 2.4-2.4 4.4-3.6 5.3"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2"/><path d="M9 9.8h.01M15 9.8h.01"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.6.6 2.7 2.2 3 4.7"/>',
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-4.5h4V19"/>',
  book: '<path d="M4 5.5c2.8-.8 5.4-.5 8 1.2 2.6-1.7 5.2-2 8-1.2v13c-2.8-.8-5.4-.5-8 1.2-2.6-1.7-5.2-2-8-1.2Z"/><path d="M12 6.7v13"/>',
  cap: '<path d="M2.5 9.5 12 5l9.5 4.5L12 14Z"/><path d="M6.5 11.5V16c1.6 1.4 3.4 2 5.5 2s3.9-.6 5.5-2v-4.5"/><path d="M21.5 9.5v5"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  cake: '<path d="M4.5 20.5v-7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7"/><path d="M4.5 15.5c1.2 1 2.5 1 3.7 0s2.5-1 3.8 0 2.5 1 3.8 0 2.5-1 3.7 0"/><path d="M3 20.5h18M12 11.5V8.5"/><path d="M12 6.5c-.9-.6-.9-1.8 0-3 .9 1.2.9 2.4 0 3Z"/>',
  lantern: '<path d="M12 3v2M9 5h6"/><path d="M7 7.5C7 6.1 8.1 5 9.5 5h5C15.9 5 17 6.1 17 7.5v7c0 1.4-1.1 2.5-2.5 2.5h-5A2.5 2.5 0 0 1 7 14.5Z"/><path d="M12 5v12M9 17l-.5 2.5M15 17l.5 2.5M12 17v4"/>',
  flower: '<circle cx="12" cy="9" r="2"/><path d="M12 7c-1.5-3 1.5-4.5 2.5-2.5S14 7 12 7Zm2 2c3-1.5 4.5 1.5 2.5 2.5S14 11 14 9Zm-4 0c-3-1.5-4.5 1.5-2.5 2.5S10 11 10 9Zm2 2c-1.5 3 1.5 4.5 2.5 2.5"/><path d="M12 11v10M12 17c-2-2.5-4.5-2.5-6-1.5M12 19c1.6-2 3.8-2.4 5.5-1.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M12 18s-3-1.8-3-3.9a1.6 1.6 0 0 1 3-.9 1.6 1.6 0 0 1 3 .9c0 2.1-3 3.9-3 3.9Z"/>',
  trophy: '<path d="M7.5 4.5h9v4a4.5 4.5 0 0 1-9 0Z"/><path d="M7.5 6.5H5a2.5 2.5 0 0 0 2.6 3.5M16.5 6.5H19a2.5 2.5 0 0 1-2.6 3.5"/><path d="M12 13v3.5M8.5 20h7l-.7-3.5H9.2Z"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-1 1.4-2.1-.6-1.2.2-2.4 1.5-2.4h1.7a3.9 3.9 0 0 0 3.9-3.9C20.5 7 16.7 3.5 12 3.5Z"/><circle cx="7.8" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="8" r="1"/>',
  coffee: '<path d="M4.5 9h12v5.5A4.5 4.5 0 0 1 12 19H9a4.5 4.5 0 0 1-4.5-4.5Z"/><path d="M16.5 10.5h1.2a2.3 2.3 0 0 1 0 4.6h-1.5"/><path d="M8 3.5c-.8 1 .8 2-.1 3M11.5 3.5c-.8 1 .8 2-.1 3"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.8"/><path d="M2.5 19h19l-1.5-4H4Z"/>',
  mountain: '<path d="M2.5 19.5 9 8.5l4 6.5 2.5-3.5 6 8Z"/><path d="M7.2 11.5 9 12.8l1.6-1.4"/><circle cx="17.5" cy="6" r="1.8"/>',
  music: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.8" cy="17.5" r="2.3"/><circle cx="16.8" cy="15.5" r="2.3"/><path d="M9 9.5l10-2"/>',
  gamepad: '<path d="M7 8h10a4.5 4.5 0 0 1 4.4 5.4l-.6 3a2.4 2.4 0 0 1-4.1 1.2L15 16H9l-1.7 1.6a2.4 2.4 0 0 1-4.1-1.2l-.6-3A4.5 4.5 0 0 1 7 8Z"/><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>',
  plane: '<path d="M21 4.5 3.5 11l6.5 2.5L12.5 20Z"/><path d="M10 13.5 21 4.5"/>',
  sofa: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3.5 12.5a1.8 1.8 0 0 1 3.5 0V14h10v-1.5a1.8 1.8 0 0 1 3.5 0V18h-17Z"/><path d="M5.5 18v2M18.5 18v2"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 15-14 .2 9.5-5.5 14.5-13 14"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>',
  shirt: '<path d="M8.5 4 12 6l3.5-2 5 3-2 3.5-2-1V20h-9V9.5l-2 1-2-3.5Z"/>',
  ticket: '<path d="M3.5 8a2 2 0 0 0 0 4v4.5h17V12a2 2 0 0 1 0-4V3.5h-17Z" transform="translate(0 2)"/><path d="M14 5.5v13" stroke-dasharray="2 2.2"/>',
  wand: '<path d="M4 20 15 9"/><path d="m13.5 10.5 2 2"/><path d="M17 3.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7ZM20 10l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4ZM10 3l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4Z"/>',
  tool: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3Z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
  pen: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5Z"/><path d="M13.5 7l3 3M4 20h6"/>',
  party: '<path d="M4 20 8.5 7.5l8 8Z"/><path d="M7 12.5l4.5 4.5M14 4.5c.5 1.3 0 2.3-1 3M19.5 10c-1.3-.5-2.3 0-3 1M17 3.5h.01M20.5 6.5h.01M20 14.5h.01"/>',
  camera: '<path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  feather: '<path d="M19.5 4.5c-6 0-11 4-11 10.5v4.5h4.5c6.5 0 6.5-9 6.5-15Z"/><path d="M4.5 20.5 15 10M8.5 15h6"/>',
  wine: '<path d="M7.5 3.5h9l-.5 5a4 4 0 0 1-8 0Z"/><path d="M12 12.5v7M8.5 20.5h7M7.8 7h8.4"/>',
  cookie: '<path d="M20.4 12.5A8.5 8.5 0 1 1 11.5 3.6a3 3 0 0 0 4 4 3 3 0 0 0 4.9 4.9Z"/><path d="M8.5 9h.01M9 15h.01M14 15.5h.01M12 12h.01"/>',
  perfume: '<rect x="5.5" y="9.5" width="13" height="11" rx="3"/><path d="M9.5 9.5v-3h5v3M10.5 6.5V4h3v2.5M16.5 4.5h3"/><circle cx="12" cy="15" r="2"/>',
  gem: '<path d="M6.5 4.5h11l3.5 5L12 20 3 9.5Z"/><path d="M3 9.5h18M9.5 4.5 8 9.5l4 10.5 4-10.5-1.5-5"/>',
  sprout: '<path d="M12 20.5v-8"/><path d="M12 12.5c0-4-2.5-6.5-7-6.5 0 4.5 2.5 6.5 7 6.5ZM12 10.5c0-3.5 2.2-6 6.5-6 0 4-2.2 6-6.5 6Z"/><path d="M7.5 20.5h9"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M8 3.5c0 4.5 4 5 4 8.5s-4 4-4 8.5M16 3.5c0 4.5-4 5-4 8.5s4 4 4 8.5"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11v3"/><rect x="4" y="8" width="16.5" height="11.5" rx="2.5"/><path d="M16 13.8h.01"/>',
  coins: '<ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"/><path d="M10 15.6c.9 1.1 2.9 1.9 5 1.9 2.8 0 5-1.1 5-2.5v-4c0-1.2-1.6-2.2-3.8-2.4M20 15v4c0 1.4-2.2 2.5-5 2.5s-5-1.1-5-2.5v-3.5"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12"/><path d="M12 8.5C10.5 5 7.5 4.5 7 6.3 6.6 7.8 9 8.5 12 8.5Zm0 0c1.5-3.5 4.5-4 5-2.2.4 1.5-2 2.2-5 2.2Z"/>',
  ribbon: '<path d="M12 9.5C9.5 5 5 4.5 5 7.5s4.5 3 7 2Zm0 0c2.5-4.5 7-5 7-2s-4.5 3-7 2Z"/><path d="m11 10.5-3.5 9 2.5-.8 1.5 2 1-9.5M13 10.5l3.5 9-2.5-.8-1.5 2"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  hand: '<path d="M3 14.5h3l3.5 2.5h4a1.5 1.5 0 0 0 0-3H11"/><path d="M6 20.5H3v-8h3"/><path d="M13.5 14h4.8l2.2-1.2a1.4 1.4 0 0 1 1.5 2.3L17 18.5a4 4 0 0 1-2.3.7H9"/><path d="M14.5 9.5s-3-1.8-3-3.9a1.6 1.6 0 0 1 3-.9 1.6 1.6 0 0 1 3 .9c0 2.1-3 3.9-3 3.9Z"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  scale: '<path d="M12 4v16.5M7.5 20.5h9M5 7.5h14"/><path d="M5 7.5 2.5 13a2.5 2.5 0 0 0 5 0Zm14 0L16.5 13a2.5 2.5 0 0 0 5 0Z"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5Z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>',
  send: '<path d="M4 12 20 4.5l-4.5 15-4-6.5Z"/><path d="m11.5 13 8.5-8.5"/>',
  "arrow-right": '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  "arrow-left": '<path d="M19.5 12h-15M10.5 6l-6 6 6 6"/>',
  "arrow-down": '<path d="M12 4.5v15M6 13.5l6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4.5 19.5h4L19 9a2.8 2.8 0 0 0-4-4L4.5 15.5Z"/><path d="m13.5 6.5 4 4"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 5.6 7M4 12.5A8 8 0 0 0 18.4 17"/><path d="M5 3.5V7.5h4M19 20.5v-4h-4"/>',
  skip: '<path d="M5 6l7 6-7 6ZM12 6l7 6-7 6Z"/>',
  sparkles: '<path d="M10 3.5 11.6 8 16 9.5l-4.4 1.6L10 15.5l-1.6-4.4L4 9.5 8.4 8Z"/><path d="M17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5M12 17h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  lightbulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.4.3.5.7.5 1.1v.5h6v-.5c0-.4.2-.8.5-1.1A6 6 0 0 0 12 3.5Z"/>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.7.4l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  handshake: '<path d="m11 7.5-2-1.5H6.5L3 9.5v5l2 1.5"/><path d="m13 7.5 2-1.5h2.5L21 9.5v5l-3.5 3"/><path d="M8.5 12.5 12 9l2.5 2a1.5 1.5 0 0 0 2-2.2L13 6.5h-1.5L8 10M10 14.5l1.8 1.8a1.4 1.4 0 0 0 2-2M8 16.5l1.6 1.6a1.4 1.4 0 0 0 2-2M12.8 13.3l1.7 1.7a1.4 1.4 0 0 0 2-2l-1.5-1.5"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>',
  shrug: '<circle cx="12" cy="7" r="3"/><path d="M12 10v5M9 20l3-5 3 5M3.5 9.5l2.5 3 4-1.5M20.5 9.5l-2.5 3-4-1.5"/>',
  infinity: '<path d="M7.5 8.5c-2 0-3.5 1.6-3.5 3.5s1.5 3.5 3.5 3.5c3.5 0 5.5-7 9-7 2 0 3.5 1.6 3.5 3.5s-1.5 3.5-3.5 3.5c-3.5 0-5.5-7-9-7Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>',
  bag: '<path d="M5.5 8h13l-1 12.5h-11Z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
};

export const ICON_NAMES = Object.keys(P);

export function icon(name, { size = 22, className = "", label = "" } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", `gw-icon ${className}`.trim());
  if (label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label); }
  else { svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); }
  svg.innerHTML = P[name] || P.sparkles;
  return svg;
}

/** 把静态 HTML 中的 <i data-icon="name" data-size="28"></i> 替换为内联 SVG。 */
export function hydrateIcons(root = document) {
  for (const slot of root.querySelectorAll("i[data-icon]")) {
    const svg = icon(slot.dataset.icon, { size: Number(slot.dataset.size) || 22, className: slot.className });
    slot.replaceWith(svg);
  }
}

/** 业务选项 ID → 图标名。选项文案仍来自配置，这里只负责视觉。 */
export const OPTION_ICONS = {
  partner: "heart", pursuit: "heart-spark", friend: "smile", family: "home", classmate: "book",
  mentor: "cap", client_partner: "briefcase", other: "more",
  very_familiar: "hearts", familiar: "handshake", limited: "eye", unfamiliar: "question", unknown: "shrug",
  birthday: "cake", festival: "lantern", thanks: "flower", anniversary: "calendar", graduation_promotion: "trophy",
  design_art: "palette", coffee_food: "coffee", reading_learning: "book", tech_digital: "laptop", sports_outdoors: "mountain",
  music_movies: "music", games_anime: "gamepad", travel_exploration: "plane", home_living: "sofa", plants_nature: "leaf",
  fashion_accessories: "shirt", experiences_activities: "ticket",
  design: "wand", practical: "tool", personalized: "pen", surprising: "party", memorable: "camera", experiential: "compass", understated: "feather",
  alcohol: "wine", food: "cookie", fragrance: "perfume", jewelry: "gem", plant: "sprout",
};
export const DEADLINE_ICONS = { 1: "bolt", 5: "clock", 7: "calendar", 30: "hourglass", 90: "sun", 365: "infinity" };
