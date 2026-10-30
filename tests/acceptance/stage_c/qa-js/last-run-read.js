// 读取"上次运行"标签页的真实面板内容（节点级运行结果）。
(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => ({
    name: (t.innerText || '').trim(),
    ariaSelected: t.getAttribute('aria-selected'),
    id: t.id
  }));
  const panels = [...document.querySelectorAll('[role="tabpanel"]')].map((p) => ({
    labelledby: p.getAttribute('aria-labelledby'),
    id: p.id,
    text: (p.innerText || '').slice(0, 8000)
  }));
  const visiblePre = [...document.querySelectorAll('pre, code')]
    .filter((e) => e.offsetWidth || e.offsetHeight)
    .map((e) => (e.innerText || '').slice(0, 4000));
  // 尝试结构化提取 JSON 代码块内容
  const jsonish = visiblePre.filter((t) => /[{\[]/.test(t) && /[}\]]/.test(t));
  return { tabs, panels, visiblePreCount: visiblePre.length, visiblePre, jsonish };
})()
