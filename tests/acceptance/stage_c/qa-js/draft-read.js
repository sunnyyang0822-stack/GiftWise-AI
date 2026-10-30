// 服务端实读草稿：以 GET /console/api/apps/<app_id>/workflows/draft 的原始返回为准。
(async () => {
  const base = '/console/api/apps/5abdb13c-a633-4a9c-96c3-dabd44072511/workflows/';
  const url = base + 'draft?_ts=' + Date.now();
  const r = await fetch(url, { cache: 'no-store' });
  const raw = await r.text();
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    return { httpStatus: r.status, parseError: String(e).slice(0, 200), bodyHead: raw.slice(0, 300) };
  }
  const g = d.graph || {};
  const nodes = (g.nodes || []).map((n) => {
    const dd = n.data || {};
    return {
      id: n.id,
      type: dd.type,
      title: dd.title,
      variables: dd.variables,
      variableCount: Array.isArray(dd.variables) ? dd.variables.length : null,
      outputs: dd.outputs,
      codeLanguage: dd.code_language,
      codeLen: typeof dd.code === 'string' ? dd.code.length : null,
      codeLineCount: typeof dd.code === 'string' ? dd.code.split('\n').length : null,
      codeFirstLineRepr: typeof dd.code === 'string' ? JSON.stringify(dd.code.split('\n')[0]) : null,
      codeHasLeadingWhitespace: typeof dd.code === 'string' ? /^\s/.test(dd.code) : null,
      code: typeof dd.code === 'string' ? dd.code : null
    };
  });
  const edges = (g.edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle
  }));
  return {
    httpStatus: r.status,
    updatedAt: d.updated_at,
    updatedAtLocal: new Date((d.updated_at || 0) * 1000).toISOString(),
    toolPublished: d.tool_published,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    hasEndNode: nodes.some((n) => n.type === 'end'),
    nodeSummary: nodes.map((n) => ({ id: n.id, type: n.type, title: n.title })),
    nodes,
    edges,
    environment: d.environment,
    features: d.features
  };
})()
