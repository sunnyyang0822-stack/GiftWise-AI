// 抓取运行记录与追踪接口的真实返回（只看状态，不读取凭证）。
(async () => {
  const id = '5abdb13c-a633-4a9c-96c3-dabd44072511';
  const out = {};
  const r1 = await fetch('/console/api/apps/' + id + '/workflow-runs?page=1&limit=5', { cache: 'no-store' });
  const t1 = await r1.text();
  out.workflowRuns = { url: r1.url, status: r1.status, body: t1.slice(0, 9000) };
  let runIds = [];
  try {
    const j = JSON.parse(t1);
    runIds = (j.data || []).map((x) => x.id);
  } catch (e) {
    out.parseError = String(e).slice(0, 200);
  }
  out.runIds = runIds;
  out.traces = [];
  for (const rid of runIds.slice(0, 2)) {
    try {
      const r2 = await fetch('/console/api/apps/' + id + '/trace-runs/workflow/' + rid, { cache: 'no-store' });
      out.traces.push({ runId: rid, status: r2.status, body: (await r2.text()).slice(0, 3000) });
    } catch (e) {
      out.traces.push({ runId: rid, error: String(e).slice(0, 200) });
    }
  }
  try {
    const r3 = await fetch('/console/api/version?current_version=1.18.0', { cache: 'no-store' });
    out.version = { status: r3.status, body: (await r3.text()).slice(0, 800) };
  } catch (e) {
    out.version = { error: String(e).slice(0, 200) };
  }
  return out;
})()
