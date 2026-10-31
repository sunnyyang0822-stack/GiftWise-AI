/* 落地页交互：图标注入、锚点平滑滚动、滚动显现、首屏视差，以及「是否还停在首屏」的判定。
   流程入口按钮由 app.js 独占绑定，这里不处理。 */
import { hydrateIcons } from "./icons.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
hydrateIcons(document);

for (const link of document.querySelectorAll('a[data-anchor-link][href^="#"], .lp-nav a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target || target.hidden) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "start" });
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    history.replaceState(null, "", link.getAttribute("href"));
  });
}

// 滚动显现：脚本可用时才启用初始隐藏态（.lp-js），同组元素依次错开。
const reveals = [...document.querySelectorAll(".lp-reveal")];
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  document.documentElement.classList.add("lp-js");
  for (const group of document.querySelectorAll(".lp-steps, .lp-bento")) {
    [...group.querySelectorAll(".lp-reveal")].forEach((item, i) => item.style.setProperty("--lp-delay", `${i * 90}ms`));
  }
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      revealObserver.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  reveals.forEach((item) => revealObserver.observe(item));
  // 兜底：部分环境（截图工具、节能后台页）不派发观察回调，按位置直接判定。
  const sweep = () => {
    for (const item of reveals) {
      if (item.classList.contains("is-in")) continue;
      const box = item.getBoundingClientRect();
      if (box.top < window.innerHeight * 0.94) item.classList.add("is-in");
    }
  };
  setTimeout(sweep, 120);
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    setTimeout(() => { ticking = false; sweep(); }, 100);
  }, { passive: true });
} else {
  reveals.forEach((item) => item.classList.add("is-in"));
}

// 首屏礼盒随指针轻微视差（仅精确指针设备）。
const art = document.querySelector(".lp-hero__art");
if (art && !reducedMotion.matches && window.matchMedia("(pointer: fine)").matches) {
  const layers = [...art.querySelectorAll(".lp-sticker, .lp-note")];
  let frame = 0;
  art.closest(".lp-hero")?.addEventListener("pointermove", (event) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const box = art.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      layers.forEach((layer, i) => {
        const depth = (i % 3 + 1) * 6;
        layer.style.translate = `${(-x * depth).toFixed(1)}px ${(-y * depth).toFixed(1)}px`;
      });
    });
  });
}

// 只要用户还停在首屏任意一屏上，就收起底部固定的流程动作条（避免盖住品牌与说明）。
const visibleLandingSections = new Set();
const landingObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) visibleLandingSections.add(entry.target);
    else visibleLandingSections.delete(entry.target);
  }
  document.body.classList.toggle("gw-on-landing", visibleLandingSections.size > 0);
});
for (const section of document.querySelectorAll("[data-landing]")) landingObserver.observe(section);
