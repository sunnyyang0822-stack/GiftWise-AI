// 安装 fetch 响应钩子，捕获 Dify 自己发出的运行/追踪接口真实响应体。
// 只记录 Dify 应用自身请求的 URL、状态与响应体；不读取 Cookie、令牌或任何凭证。
(() => {
  if (window.__gwQaHooked) return 'already-hooked';
  window.__gwQaHooked = true;
  window.__gwQa = [];
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const u = String(args[0] && args[0].url ? args[0].url : args[0]);
    const res = await orig(...args);
    try {
      if (/\/last-run|\/trace-runs\/|\/workflow-runs|\/draft\/run/.test(u)) {
        const clone = res.clone();
        const t = await clone.text();
        window.__gwQa.push({ url: u, status: res.status, body: t.slice(0, 20000), at: new Date().toISOString() });
      }
    } catch (e) {
      window.__gwQa.push({ url: u, hookError: String(e).slice(0, 200) });
    }
    return res;
  };
  return 'installed';
})()
