"""真实模型调用脚本生成器。

R1：常规虚构请求（200.00 CNY，追求对象）→ 期望 N2 真实生成后全通过 → N7a。1 次模型调用。
R2：同一请求但预算压到 1.00 CNY → 期望真实生成超预算 → N5 真实修订 → N6。2 次模型调用。

不使用任何注入通道（Start 的 inject_* 已移除）：R2 的修订由真实预算约束触发。
"""
import json
from pathlib import Path

import os as _os
_ROOT_PROBE = Path(__file__).resolve().parent
while not (_ROOT_PROBE / "workflow" / "verify_local.py").exists():
    if _ROOT_PROBE.parent == _ROOT_PROBE:
        raise RuntimeError("找不到仓库根目录（未找到 workflow/verify_local.py）")
    _ROOT_PROBE = _ROOT_PROBE.parent
ROOT = _ROOT_PROBE
_SELF = Path(__file__).resolve().parent
INPUTS = Path(_os.environ["WF003_INPUTS"]) if _os.environ.get("WF003_INPUTS") else _SELF / "inputs"
BUILD = _SELF / "build"
OUTDIR = _SELF / "outputs"
# ↑ 本文件是 workflow/tools/<同名>.py 的可入库副本，由 workflow/tools/gen-includable-tools.py 生成。
TOOLS = BUILD
TMP = TOOLS / "tmp"
LIB = TOOLS / "lib"
TMP.mkdir(parents=True, exist_ok=True)
LIB.mkdir(parents=True, exist_ok=True)
APP_ID = "5abdb13c-a633-4a9c-96c3-dabd44072511"


def build_cases():
    base = json.loads((ROOT / "workflow/examples/intake.json").read_text(encoding="utf-8"))
    r1 = dict(base)
    r2 = dict(base)
    r2["budget_amount"] = "1.00"
    return [
        {"label": "real1_normal_200", "expect": "N2 真实生成 → N3 通过 → N4[true] → N7a → End A",
         "inputs": {"intake_json": json.dumps(r1, ensure_ascii=False, indent=2), "trusted_repair_count": 0}},
        {"label": "real2_budget_1_repair", "expect": "N2 真实生成超预算 → N4[repairable] → N5 真实修订 → N6 → N7b → End B",
         "inputs": {"intake_json": json.dumps(r2, ensure_ascii=False, indent=2), "trusted_repair_count": 0}},
    ]


JS = """(async () => {
  const id = '%(app_id)s';
  const base = '/console/api/apps/' + id + '/workflows/';
  const CASES = %(cases)s;
  const readCookie = (name) => {
    const hit = document.cookie.split('; ').find((row) => row.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
  };
  const token = readCookie('__Host-csrf_token');
  const runOnce = async (inputs) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-CSRF-Token'] = token;
    const r = await fetch(base + 'draft/run', {
      method: 'POST', headers, body: JSON.stringify({ inputs, files: [] })
    });
    const text = await r.text();
    return { status: r.status, contentType: r.headers.get('content-type') || '', text };
  };
  const out = [];
  for (const c of CASES) {
    const entry = { label: c.label, expect: c.expect, startedAtLocal: new Date().toISOString() };
    const t0 = Date.now();
    try {
      const res = await runOnce(c.inputs);
      entry.httpStatus = res.status;
      entry.contentType = res.contentType;
      entry.elapsedMs = Date.now() - t0;
      entry.sseChars = res.text.length;
      entry.sse = res.text.slice(0, 400000);
      if (res.status !== 200) entry.lastError = res.text.slice(0, 500);
    } catch (error) {
      entry.error = String(error).slice(0, 400);
    }
    out.push(entry);
  }
  return { meta: { csrfPresent: !!token, csrfCookieName: token ? '__Host-csrf_token' : null }, runs: out };
})()
"""


def main():
    cases = build_cases()
    (TMP / "run-real-cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    src = JS % {"app_id": APP_ID, "cases": json.dumps(cases, ensure_ascii=False)}
    (LIB / "run-real.js").write_text(src, encoding="utf-8")
    print("wrote lib/run-real.js (%d chars), cases=%s" % (len(src), [c["label"] for c in cases]))
    print("预计模型调用次数：%d（R1=1，R2=2）" % 3)


if __name__ == "__main__":
    main()
