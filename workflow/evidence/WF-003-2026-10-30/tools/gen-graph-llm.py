"""把已跑通的占位图（tmp/graph.json）转成真实 LLM 节点图。

读 workflow/prompts/generate.md 与 repair.md 的正文，替换 N2/N5 为 type=llm 节点，
移除 Start 的 inject_* 注入变量，并把下游选择器从 candidates_json 改绑到 text。
不调用任何模型，只生成待 POST 的图与提交脚本。
"""
import json
import re
import sys
import uuid
from pathlib import Path

# 固定命名空间：由仓库 URL 派生（uuid5 本身确定性），用于生成可复现的 prompt_template id。
UUID_NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/sunnyyang0822-stack/GiftWise-AI/workflow")

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
TMP = BUILD
LIB = BUILD / "lib"
TMP.mkdir(parents=True, exist_ok=True)
LIB.mkdir(parents=True, exist_ok=True)

ID_N2 = "1793400000001"
ID_N5 = "1793400000004"
ID_N1 = "1793357958534"
ID_START = "1793273634593"

PROVIDER = "langgenius/deepseek/deepseek"
MODEL = "deepseek-v4-flash"
# 参数依据 GET /console/api/workspaces/current/model-providers/langgenius/deepseek/deepseek/models/parameter-rules?model=deepseek-v4-flash
# （2026-10-30 21:16 只读实读，见 evidence）：
#   thinking         boolean 默认 true —— 必须关掉，否则 <think> 混入 text 且 max_tokens 被推理耗尽
#   max_tokens       int 默认 4096，包含思考内容，最大 393216
#   temperature      float 0..2，仅在非思考模式生效
#   response_format  string 可选 text|json_object —— 选用 json_object 满足严格 JSON 下游
# 注意：frequency_penalty / presence_penalty 不在该模型的参数规则内，故不设置。
COMPLETION_PARAMS = {"temperature": 0.2, "max_tokens": 16384, "top_p": 1, "thinking": False, "response_format": "json_object"}


def split_prompt(path: Path, user_marker: str):
    """按 `# X 用户消息模板` 把提示词文件切成系统段与用户段。"""
    text = path.read_text(encoding="utf-8")
    idx = text.index(user_marker)
    system = text[:idx].strip()
    # 去掉标题行的 `# N2 系统提示词`
    system = re.sub(r"^#\s*N\d\s*系统提示词\s*\n+", "", system).strip()
    user = text[idx + len(user_marker):].strip()
    # 去掉模板尾部的说明段（不是模板正文）
    for stop in ("\n生产中用 Dify 变量选择器", "\n四项使用 Dify 变量选择器"):
        if stop in user:
            user = user[: user.index(stop)].strip()
    return system, user


def bind(text: str, mapping: dict) -> str:
    """把 {{var}} 换成 Dify 变量引用语法 {{#nodeId.var#}}。"""
    def rep(m):
        name = m.group(1)
        if name not in mapping:
            raise SystemExit(f"提示词中的变量未给出绑定：{name}")
        return "{{#" + mapping[name] + "#}}"
    out = re.sub(r"\{\{(\w+)\}\}", rep, text)
    # Dify 变量引用语法是 {{#nodeId.var#}}，故只检查残留的 {{word}} 形式
    left = re.search(r"\{\{(?!\#)", out)
    if left:
        raise SystemExit("仍有未替换的 {{ }}：" + out[left.start():left.start() + 80])
    return out


def llm_node(node: dict, title: str, desc: str, system: str, user: str, height: int) -> dict:
    node = json.loads(json.dumps(node))  # 深拷贝包装
    nid = node["id"]
    node["data"] = {
        "context": {"enabled": False, "variable_selector": []},
        "model": {
            "completion_params": COMPLETION_PARAMS,
            "mode": "chat",
            "name": MODEL,
            "provider": PROVIDER,
        },
        # 用 uuid5（固定命名空间 + 节点标识 + 角色）替代原来的 uuid4 随机值，
        # 使同一份源码反复生成的图**逐字节相同**（Dify 只把 id 当元素标识，不要求随机）。
        "prompt_template": [
            {"id": str(uuid.uuid5(UUID_NS, nid + ":system")), "role": "system", "text": system},
            {"id": str(uuid.uuid5(UUID_NS, nid + ":user")), "role": "user", "text": user},
        ],
        "selected": False,
        "title": title,
        "desc": desc,
        "type": "llm",
        "vision": {"enabled": False},
    }
    node["height"] = height
    return node


def main():
    graph = json.loads((TMP / "graph.json").read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in graph["nodes"]}

    gen_sys, gen_user = split_prompt(ROOT / "workflow/prompts/generate.md", "# N2 用户消息模板")
    rep_sys, rep_user = split_prompt(ROOT / "workflow/prompts/repair.md", "# N5 用户消息模板")

    gen_user = bind(gen_user, {"request_json": f"{ID_N1}.request_json"})
    rep_user = bind(rep_user, {
        "request_json": f"{ID_N1}.request_json",
        "candidates_json": f"{ID_N2}.text",
        "validation_json": "1793400000002.validation_json",
        "preserved_candidates_json": "1793400000002.preserved_candidates_json",
    })

    nodes[ID_N2] = llm_node(
        nodes[ID_N2],
        "N2 需求分析与三候选（真实 LLM）",
        "真实调用模型；原始 text 即为 candidates_json，不剥围栏、不自动修 JSON。",
        gen_sys, gen_user, 130)
    nodes[ID_N5] = llm_node(
        nodes[ID_N5],
        "N5 一次修订（真实 LLM）",
        "真实调用模型；全局最多一次自动修订，失败不重发。",
        rep_sys, rep_user, 130)

    # N2 不再需要注入变量；N5 的 4 个输入沿用原选择器
    for nid in (ID_N2, ID_N5):
        nodes[nid]["data"].setdefault("variables", [])

    # 移除 Start 的测试注入通道
    start = nodes[ID_START]
    before = [v["variable"] for v in start["data"]["variables"]]
    start["data"]["variables"] = [v for v in start["data"]["variables"] if not v["variable"].startswith("inject_")]
    after = [v["variable"] for v in start["data"]["variables"]]

    # 下游选择器：candidates_json -> text
    redirects = []
    for nid, varname in ((ID_N5, "previous_candidates_json"), ("1793400000002", "candidates_json"),
                         ("1793400000005", "previous_candidates_json"), ("1793400000005", "candidates_json")):
        for v in nodes[nid]["data"].get("variables", []):
            if v["variable"] != varname:
                continue
            src, name = v["value_selector"]
            if name == "candidates_json":
                v["value_selector"] = [src, "text"]
                v["value_type"] = "string"
                redirects.append(f'{nodes[nid]["data"]["title"].split()[0]}.{varname}: [{src},candidates_json] -> [{src},text]')

    # 输入数校验：N5 只剩 4 个输入；N2 的输入（request_json）由 LLM 节点变量承载
    graph["nodes"] = [nodes[n["id"]] for n in graph["nodes"]]
    (TMP / "graph-llm.json").write_text(json.dumps(graph, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    lib_src = LIB / "post-graph.js"
    payload = json.dumps(graph, ensure_ascii=False)
    lib_src.write_text(
        "(async () => {\n"
        "  // 由 workflow/tools/gen-graph-llm.py 生成，请勿手改\n"
        "  const id = '5abdb13c-a633-4a9c-96c3-dabd44072511';\n"
        "  const readCookie = (n) => { const h = document.cookie.split('; ').find(r => r.startsWith(n + '=')); return h ? decodeURIComponent(h.slice(n.length + 1)) : ''; };\n"
        "  const csrf = readCookie('__Host-csrf_token');\n"
        "  const headers = { 'Content-Type': 'application/json' };\n"
        "  if (csrf) headers['X-CSRF-Token'] = csrf;\n"
        "  const cur = await (await fetch('/console/api/apps/' + id + '/workflows/draft', { cache: 'no-store' })).json();\n"
        "  const before = { hash: cur.hash, updatedAt: cur.updated_at, nodes: (cur.graph.nodes || []).length, edges: (cur.graph.edges || []).length, types: (cur.graph.nodes || []).map(n => (n.data || {}).type).join(',') };\n"
        "  const graph = " + payload + ";\n"
        "  const body = { graph, features: cur.features, hash: cur.hash };\n"
        "  const r = await fetch('/console/api/apps/' + id + '/workflows/draft', { method: 'POST', headers, body: JSON.stringify(body) });\n"
        "  const t = await r.text();\n"
        "  await new Promise(s => setTimeout(s, 2500));\n"
        "  const after = await (await fetch('/console/api/apps/' + id + '/workflows/draft', { cache: 'no-store' })).json();\n"
        "  const shape = (after.graph.nodes || []).map(n => {\n"
        "    const d = n.data || {};\n"
        "    const o = { id: n.id, type: d.type, title: d.title };\n"
        "    if (d.type === 'llm') {\n"
        "      o.model = d.model && (d.model.provider + '/' + d.model.name + '/' + d.model.mode + ' ' + JSON.stringify(d.model.completion_params));\n"
        "      o.promptRoles = (d.prompt_template || []).map(p => p.role);\n"
        "      o.promptHasVarRef = (d.prompt_template || []).map(p => /\\{\\{#/.test(p.text || ''));\n"
        "      o.systemChars = (d.prompt_template || []).filter(p => p.role === 'system').reduce((a, p) => a + (p.text || '').length, 0);\n"
        "      o.userChars = (d.prompt_template || []).filter(p => p.role === 'user').reduce((a, p) => a + (p.text || '').length, 0);\n"
        "      o.extraKeys = Object.keys(d).filter(k => !['context','model','prompt_template','selected','title','desc','type','vision','variables'].includes(k));\n"
        "    }\n"
        "    if (d.type === 'code') { o.vars = (d.variables || []).map(v => v.variable + '<=' + JSON.stringify(v.value_selector) + '[' + v.value_type + ']'); o.codeLen = (d.code || '').length; }\n"
        "    if (d.type === 'start') { o.vars = (d.variables || []).map(v => v.variable + ':' + v.type); }\n"
        "    if (d.type === 'end') { o.outs = (d.outputs || []).map(x => x.variable + '<=' + JSON.stringify(x.value_selector) + '[' + x.value_type + ']'); }\n"
        "    if (d.type === 'if-else') { o.cases = (d.cases || []).map(c => c.case_id + ':' + JSON.stringify(c.conditions)); }\n"
        "    return o;\n"
        "  });\n"
        "  return { before, postStatus: r.status, postBody: t.slice(0, 400), afterUpdatedAt: after.updated_at, afterHash: after.hash, toolPublished: after.tool_published, shape };\n"
        "})()\n",
        encoding="utf-8")
    print("wrote lib/post-graph.js (%d chars)  model=%s/%s" % (lib_src.stat().st_size, PROVIDER, MODEL))
    print("start vars: %s -> %s" % (before, after))
    print("selectors redirected (%d):" % len(redirects))
    for r in redirects:
        print("   " + r)
    print("llm prompt sizes: N2 system=%d user=%d | N5 system=%d user=%d"
          % (len(gen_sys), len(gen_user), len(rep_sys), len(rep_user)))
    print("--- N2 user message ---")
    print(gen_user)
    print("--- N5 user message ---")
    print(rep_user)


if __name__ == "__main__":
    main()
