// 把 <i data-icon="gift"> 换成产品同款线性图标；渲染页眉。
import { icon } from "./assets/icons.js";
const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" d="M23 2c2 13 6 17 20 20-14 3-18 7-20 23C20 29 16 25 2 22 16 19 20 15 23 2Z"/><path fill="#fbf9f7" d="m23 16 2 6-2 7-3-7Z"/><path fill="currentColor" d="m41 5 1.5 4.5L47 11l-4.5 1.5L41 17l-1.5-4.5L35 11l4.5-1.5Z"/></svg>';
export function hydrate() {
  document.querySelectorAll("[data-icon]").forEach(n => n.replaceWith(icon(n.dataset.icon, { size: +(n.dataset.size || 28) })));
  document.querySelectorAll("[data-logo]").forEach(n => { n.innerHTML = LOGO; });
  const chrome = document.querySelector(".chrome[data-page]");
  if (chrome) chrome.innerHTML = `<span class="brand">${LOGO}GIFTWISE AI</span><span class="pageno">${chrome.dataset.page}<small> / 08</small></span>`;
  return document.fonts.ready.then(() => { document.body.dataset.ready = "1"; });
}
