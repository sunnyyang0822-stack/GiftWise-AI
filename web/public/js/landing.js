/* 首屏六屏（hero / how / after / faq / theme / privacy）只负责锚点体验与「是否还停在首屏」的判定；
   流程入口与数据来源文案由 app.js 独占绑定与写入，这里不覆盖任何流程文案。 */
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

for (const link of document.querySelectorAll('.site-nav a[href^="#"], .gw-scroll-link, [data-anchor-link]')) {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "start" });
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    history.replaceState(null, "", link.getAttribute("href"));
  });
}

// 只要用户还停在首屏任意一屏上，就收起底部固定的流程动作条（避免盖住品牌与说明）。
// 进入流程挂载区（#badges / #steps / #view）后动作条恢复。
const visibleLandingSections = new Set();
const landingObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) visibleLandingSections.add(entry.target);
    else visibleLandingSections.delete(entry.target);
  }
  document.body.classList.toggle("gw-on-landing", visibleLandingSections.size > 0);
});
for (const section of document.querySelectorAll("[data-landing]")) landingObserver.observe(section);
