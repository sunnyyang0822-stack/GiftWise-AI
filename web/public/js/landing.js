/* 首屏只负责锚点体验与数据来源说明；流程入口由 app.js 独占绑定。 */
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
document.querySelectorAll('.site-nav a[href^="#"], .gw-scroll-link').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "start" });
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    history.replaceState(null, "", link.getAttribute("href"));
  });
});

// 接入脚本的历史说明含已过时的 Dify 发布判断；首屏只披露当前界面的数据来源。
const heroFlag = document.getElementById("hero-flag");
const mockDisclosure = "当前为模拟数据演示；方案与呈现内容并非真实模型输出，价格、库存及送达未核实。";
function normalizeDisclosure() {
  if (heroFlag && !heroFlag.hidden && heroFlag.textContent.includes("模拟数据") && heroFlag.textContent !== mockDisclosure) {
    heroFlag.textContent = mockDisclosure;
  }
}
if (heroFlag) new MutationObserver(normalizeDisclosure).observe(heroFlag, { childList: true, characterData: true, subtree: true });
normalizeDisclosure();

// 品牌与流程说明区域不展示旧流程动作条；进入流程挂载区后恢复。
const visibleLandingSections = new Set();
const landingObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) visibleLandingSections.add(entry.target);
    else visibleLandingSections.delete(entry.target);
  }
  document.body.classList.toggle("gw-on-landing", visibleLandingSections.size > 0);
});
for (const section of document.querySelectorAll("#hero, #how")) landingObserver.observe(section);
