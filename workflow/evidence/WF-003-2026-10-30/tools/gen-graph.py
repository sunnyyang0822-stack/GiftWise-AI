"""生成把 N1–N7 + 双 End 写入 Dify 草稿的浏览器动作脚本（不手改生成物，只读取）。"""
import hashlib
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
GEN = ROOT / "workflow/generated"
LIB = BUILD / "lib"
LIB.mkdir(parents=True, exist_ok=True)
APP_ID = "5abdb13c-a633-4a9c-96c3-dabd44072511"

ID_START = "1793273634593"
ID_N1 = "1793357958534"
ID_N2 = "1793400000001"
ID_N3 = "1793400000002"
ID_N4 = "1793400000003"
ID_N5 = "1793400000004"
ID_N6 = "1793400000005"
ID_N7A = "1793400000006"
ID_N7B = "1793400000007"
ID_END_A = "1793400000008"
ID_END_B = "1793400000009"

CODE_NODE_OUTPUT_TYPES = {
    "request_json": "string", "errors_json": "string", "status": "string",
    "candidates_json": "string", "placeholder": "boolean", "model_called": "boolean",
    "candidate_ids": "string",
    "envelope_json": "string", "all_passed": "boolean", "repairable": "boolean",
    "repair_count": "number", "validation_json": "string", "preserved_candidates_json": "string",
    "report_text": "string",
}


def read_source(name):
    return (GEN / name).read_text(encoding="utf-8")


def py_string_literal(text):
    """json.dumps 的转义是 Python 字符串字面量的子集，可安全内嵌。"""
    return json.dumps(text, ensure_ascii=True)


def placeholder_n2(snapshot_json):
    return (
        "# N2 占位节点：未接任何模型，不产生真实候选。\n"
        "# 目的：在模型授权前把 N1-N7 接线跑通，并让五类用例可注入固定快照。\n"
        "# 授权后必须用真正的 LLM 节点替换本节点，并把 Start 的 inject_* 变量一并移除。\n"
        "import json\n\n"
        "_FIXED_SNAPSHOT = " + py_string_literal(snapshot_json) + "\n\n"
        "def main(request_json: str, inject_candidates_json: str) -> dict:\n"
        "    injected = bool(inject_candidates_json)\n"
        "    text = inject_candidates_json if injected else _FIXED_SNAPSHOT\n"
        "    try:\n"
        "        batch = json.loads(text)\n"
        "        items = batch.get('candidates', []) if isinstance(batch, dict) else []\n"
        "        ids = [c.get('id') for c in items if isinstance(c, dict)]\n"
        "        status = 'placeholder_injected' if injected else 'placeholder_fixed_snapshot'\n"
        "    except Exception:\n"
        "        ids = []\n"
        "        status = 'placeholder_invalid_snapshot'\n"
        "    return {'candidates_json': text, 'status': status, 'placeholder': True,\n"
        "            'model_called': False, 'candidate_ids': json.dumps(ids, ensure_ascii=False)}\n"
    )


def placeholder_n5():
    head = (
        "# N5 占位节点：未接任何模型，不做真实修订。\n"
        "# 目的：模型授权前验证 If/Else 分支、一次额度、N6 重检与已通过项保护。\n"
        "# 授权后必须用真正的 LLM 节点替换本节点，并把 Start 的 inject_* 变量一并移除。\n"
        "import json\n\n"
        "def main(request_json: str, previous_candidates_json: str, validation_json: str,\n"
        "         preserved_candidates_json: str, inject_repair_json: str) -> dict:\n"
        "    injected = bool(inject_repair_json)\n"
        "    text = inject_repair_json if injected else ''\n"
        "    if not text:\n"
        "        return {'candidates_json': '', "
        "'status': 'placeholder_no_repair_configured', 'placeholder': True, 'model_called': False}\n"
        "    return {'candidates_json': text, "
        "'status': 'placeholder_injected', 'placeholder': True, 'model_called': False}\n"
    )
    return head


def code_node(node_id, title, code, variables, outputs, desc):
    return {
        "id": node_id, "type": "custom", "position": {"x": 0, "y": 0},
        "width": 242, "height": 100, "sourcePosition": "right", "targetPosition": "left",
        "data": {
            "code": code, "code_language": "python3", "variables": variables,
            "outputs": {k: {"type": CODE_NODE_OUTPUT_TYPES[k], "children": None} for k in outputs},
            "type": "code", "title": title, "desc": desc, "selected": False,
        },
    }


def sel(name, node_id, source_variable, value_type):
    """name 是本 Code 节点 main() 的形参名；source_variable 是上游节点声明的输出名。"""
    return {"variable": name, "value_selector": [node_id, source_variable], "value_type": value_type}


def edge(source, target, source_type, target_type, source_handle="source", target_handle="target"):
    eid = source + "-" + source_handle + "--" + target + "-" + target_handle
    return {
        "id": eid, "type": "custom", "source": source, "sourceHandle": source_handle,
        "target": target, "targetHandle": target_handle,
        "data": {"sourceType": source_type, "targetType": target_type,
                 "isInIteration": False, "isInLoop": False},
        "zIndex": 0,
    }


def build_graph():
    snapshot = (ROOT / "workflow/examples/candidates.json").read_text(encoding="utf-8")
    start = {
        "id": ID_START, "type": "custom", "position": {"x": 80, "y": 400},
        "width": 242, "height": 73, "sourcePosition": "right", "targetPosition": "left",
        "data": {
            "variables": [
                {"variable": "intake_json", "label": "intake_json", "type": "text-input",
                 "required": True, "max_length": 32768, "options": []},
                {"variable": "trusted_repair_count", "label": "trusted_repair_count", "type": "number",
                 "required": True, "options": []},
                {"variable": "inject_candidates_json", "label": "inject_candidates_json", "type": "text-input",
                 "required": False, "max_length": 32768, "options": []},
                {"variable": "inject_repair_json", "label": "inject_repair_json", "type": "text-input",
                 "required": False, "max_length": 32768, "options": []},
            ],
            "type": "start", "title": "用户输入", "selected": False,
        },
    }

    n1 = code_node(ID_N1, "N1 用户输入与确定性适配", read_source("intake_node.py"),
                   [sel("intake_json", ID_START, "intake_json", "string")],
                   ["request_json", "errors_json", "status"],
                   "generated/intake_node.py 原样上云；status=ready 才继续。零模型调用。")
    n1["position"] = {"x": 380, "y": 400}

    n2 = code_node(ID_N2, "N2 需求分析与三候选（占位·未接模型）", placeholder_n2(snapshot),
                   [sel("request_json", ID_N1, "request_json", "string"),
                    sel("inject_candidates_json", ID_START, "inject_candidates_json", "string")],
                   ["candidates_json", "status", "placeholder", "model_called", "candidate_ids"],
                   "占位节点：不做真实生成。inject_candidates_json 非空时原样透出，用于五类用例注入。")
    n2["position"] = {"x": 700, "y": 400}

    n3 = code_node(ID_N3, "N3 Code 首次校验", read_source("check_node.py"),
                   [sel("request_json", ID_N1, "request_json", "string"),
                    sel("candidates_json", ID_N2, "candidates_json", "string"),
                    sel("repair_count", ID_START, "trusted_repair_count", "number")],
                   ["envelope_json", "status", "all_passed", "repairable", "repair_count",
                    "validation_json", "preserved_candidates_json"],
                   "generated/check_node.py 原样上云；规则完全独立于模型。")
    n3["position"] = {"x": 1050, "y": 400}

    n4 = {
        "id": ID_N4, "type": "custom", "position": {"x": 1400, "y": 400},
        "width": 242, "height": 100, "sourcePosition": "right", "targetPosition": "left",
        "data": {
            "type": "if-else", "title": "N4 校验结果分支",
            "desc": "all_passed→N7a；repairable→N5；其余→N7a。",
            "selected": False,
            "logical_operator": "and",
            "conditions": [],
            "cases": [
                {"case_id": "true", "logical_operator": "and",
                 "conditions": [{"id": "n4-all-passed", "comparison_operator": "is",
                                 "value": "true", "varType": "boolean",
                                 "variable_selector": [ID_N3, "all_passed"]}]},
                {"case_id": "repairable", "logical_operator": "and",
                 "conditions": [{"id": "n4-repairable", "comparison_operator": "is",
                                 "value": "true", "varType": "boolean",
                                 "variable_selector": [ID_N3, "repairable"]}]},
                {"case_id": "false", "logical_operator": "and",
                 "conditions": [{"id": "n4-else", "comparison_operator": "is",
                                 "value": "false", "varType": "boolean",
                                 "variable_selector": [ID_N3, "all_passed"]}]},
            ],
        },
    }

    n5 = code_node(ID_N5, "N5 一次修订（占位·未接模型）", placeholder_n5(),
                   [sel("request_json", ID_N1, "request_json", "string"),
                    sel("previous_candidates_json", ID_N2, "candidates_json", "string"),
                    sel("validation_json", ID_N3, "validation_json", "string"),
                    sel("preserved_candidates_json", ID_N3, "preserved_candidates_json", "string"),
                    sel("inject_repair_json", ID_START, "inject_repair_json", "string")],
                   ["candidates_json", "status", "placeholder", "model_called"],
                   "占位节点：不做真实修订。进入本节点即视为已占用全局唯一一次修订额度。")
    n5["position"] = {"x": 1050, "y": 700}

    n6 = code_node(ID_N6, "N6 Code 再校验", read_source("recheck_node.py"),
                   [sel("request_json", ID_N1, "request_json", "string"),
                    sel("previous_candidates_json", ID_N2, "candidates_json", "string"),
                    sel("candidates_json", ID_N5, "candidates_json", "string"),
                    sel("repair_count", ID_N3, "repair_count", "number")],
                   ["envelope_json", "status", "all_passed", "repairable", "repair_count"],
                   "generated/recheck_node.py 原样上云；repair_count 取 N3 原计数。")
    n6["position"] = {"x": 1400, "y": 700}

    n7a = code_node(ID_N7A, "N7a 未修订报告", read_source("report_node.py"),
                    [sel("state_json", ID_N3, "envelope_json", "string")],
                    ["envelope_json", "status", "all_passed", "repairable", "repair_count", "report_text"],
                    "generated/report_node.py 原样上云；只渲染代码产出的真实结果。")
    n7a["position"] = {"x": 1750, "y": 250}

    n7b = code_node(ID_N7B, "N7b 修订后报告", read_source("report_node.py"),
                    [sel("state_json", ID_N6, "envelope_json", "string")],
                    ["envelope_json", "status", "all_passed", "repairable", "repair_count", "report_text"],
                    "generated/report_node.py 原样上云；独立分支，避免引用未执行节点。")
    n7b["position"] = {"x": 1750, "y": 700}

    def end_node(node_id, title, source_id, desc, prefix=""):
        # Dify 要求「应用级输出变量名全局唯一」：本应用有两个 End 节点，
        # 若两者都用 status/all_passed/... 会被发布前检查清单判为重复并阻止发布。
        # 因此 End B 的输出统一加 revised_ 前缀；End A 保持原名不变。
        outs = [("status", "status", "string"), ("all_passed", "all_passed", "boolean"),
                ("repair_count", "repair_count", "number"),
                ("report_json", "envelope_json", "string"), ("report_text", "report_text", "string")]
        return {
            "id": node_id, "type": "custom", "position": {"x": 2100, "y": 250 if source_id == ID_N7A else 700},
            "width": 242, "height": 120, "sourcePosition": "right", "targetPosition": "left",
            "data": {
                "type": "end", "title": title, "desc": desc, "selected": False,
                "outputs": [{"variable": prefix + name, "value_selector": [source_id, source_var], "value_type": t}
                            for name, source_var, t in outs],
            },
        }

    end_a = end_node(ID_END_A, "End A 未修订输出", ID_N7A,
                     "工作流级输出：未走修订的报告。selected_candidate_id 恒为 null。")
    end_b = end_node(ID_END_B, "End B 修订后输出", ID_N7B,
                     "工作流级输出：走过一次修订后的报告。selected_candidate_id 恒为 null。"
                     "因 Dify 要求应用级输出变量名全局唯一，本节点输出统一加 revised_ 前缀。",
                     prefix="revised_")

    edges = [
        edge(ID_START, ID_N1, "start", "code"),
        edge(ID_N1, ID_N2, "code", "code"),
        edge(ID_N2, ID_N3, "code", "code"),
        edge(ID_N3, ID_N4, "code", "if-else"),
        edge(ID_N4, ID_N7A, "if-else", "code", source_handle="true"),
        edge(ID_N4, ID_N5, "if-else", "code", source_handle="repairable"),
        edge(ID_N4, ID_N7A, "if-else", "code", source_handle="false"),
        edge(ID_N5, ID_N6, "code", "code"),
        edge(ID_N6, ID_N7B, "code", "code"),
        edge(ID_N7A, ID_END_A, "code", "end"),
        edge(ID_N7B, ID_END_B, "code", "end"),
    ]
    return {"nodes": [start, n1, n2, n3, n4, n5, n6, n7a, n7b, end_a, end_b],
            "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 0.55}}


JS_TEMPLATE = """(async () => {
  const id = '%(app_id)s';
  const base = '/console/api/apps/' + id + '/workflows/';
  const GRAPH = %(graph)s;
  const sha = async (s) => { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
  const before = await (await fetch(base + 'draft', { cache: 'no-store' })).json();
  const r = await fetch(base + 'draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph: GRAPH, features: before.features, hash: before.hash })
  });
  const postText = await r.text();
  const after = await (await fetch(base + 'draft', { cache: 'no-store' })).json();
  const g = after.graph || {};
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
  const rawNodes = g.nodes || [];
  const nodes = [];
  for (const n of rawNodes) {
    const dd = n.data || {};
    const code = typeof dd.code === 'string' ? dd.code : null;
    const isEnd = dd.type === 'end';
    nodes.push({
      id: n.id, type: dd.type, title: dd.title, desc: dd.desc,
      codeLen: code ? code.length : null, codeFnv: code ? fnv(code) : null,
      codeSha256: code ? await sha(code) : null,
      startVariables: dd.type === 'start' ? dd.variables : null,
      firstLine: code ? code.split('\\n')[0].slice(0, 60) : null,
      lastLine: code ? code.split('\\n').slice(-1)[0].slice(0, 80) : null,
      varsIn: arr(dd.variables).map((v) => v.variable + ' <= ' + JSON.stringify(v.value_selector) + ' [' + (v.value_type || '?') + ']'),
      outs: Object.keys(dd.outputs || {}).map((k) => k + ':' + ((dd.outputs[k] || {}).type)),
      cases: dd.cases ? dd.cases.map((c) => ({ case_id: c.case_id, cond: (c.conditions || []).map((x) => JSON.stringify(x.variable_selector) + ' ' + x.comparison_operator + ' ' + x.value) })) : null,
      endOuts: isEnd ? arr(dd.outputs).map((o) => o.variable + ' <= ' + JSON.stringify(o.value_selector) + ' [' + (o.value_type || '?') + ']') : null
    });
  }
  return {
    serverReadAfterWrite: true,
    postStatus: r.status, postBody: postText.slice(0, 300),
    beforeUpdatedAt: before.updated_at, afterUpdatedAt: after.updated_at,
    afterHash: after.hash, toolPublished: after.tool_published,
    nodeCount: nodes.length, edgeCount: (g.edges || []).length,
    nodes, edges: (g.edges || []).map((e) => e.source + ' [' + e.sourceHandle + '] -> ' + e.target)
  };
})()
"""


def verify_signatures(graph):
    """提交前自检：每个 Code 节点 main() 的形参必须与声明的 variables 逐一同名同序；
    返回字典的每个键都必须已在 outputs 声明。（WF-002 的真实失败点）"""
    import ast as _ast
    problems = []
    for node in graph["nodes"]:
        data = node["data"]
        if data.get("type") != "code":
            continue
        tree = _ast.parse(data["code"])
        entry = [n for n in tree.body if isinstance(n, _ast.FunctionDef) and n.name == "main"]
        if not entry:
            problems.append((node["id"], "未找到 main() 定义"))
            continue
        # 生成物里 runtime.main(action, payload_json) 在前，入口 main(...) 在后（_dispatch = main 之后），
        # 真正被 Dify 调用的是最后一个定义。
        entry = [entry[-1]]
        params = [a.arg for a in entry[0].args.args]
        declared = [v["variable"] for v in data["variables"]]
        if params != declared:
            problems.append((node["id"], f"签名 {params} != variables {declared}"))
        declared_out = set(data["outputs"])
        returned = set()
        for sub in _ast.walk(entry[0]):
            if isinstance(sub, _ast.Return) and isinstance(sub.value, _ast.Dict):
                for k in sub.value.keys:
                    if isinstance(k, _ast.Constant) and isinstance(k.value, str):
                        returned.add(k.value)
        missing = returned - declared_out
        if missing:
            problems.append((node["id"], "返回键未在 outputs 声明: " + str(sorted(missing))))
    return problems


def main():
    graph = build_graph()
    problems = verify_signatures(graph)
    print("signature self-check:", "OK（0 处不一致）" if not problems else problems)
    if problems:
        raise SystemExit("签名/输出自检失败，拒绝写入 Dify")
    js = JS_TEMPLATE % {"app_id": APP_ID, "graph": json.dumps(graph, ensure_ascii=False, indent=1)}
    (LIB / "post-graph.js").write_text(js, encoding="utf-8", newline="\n")
    BUILD.mkdir(parents=True, exist_ok=True)
    (BUILD / "graph.json").write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote lib/post-graph.js", len(js), "chars")
    print("nodes:", [(n["id"], n["data"]["type"], n["data"]["title"]) for n in graph["nodes"]])
    print("edges:", len(graph["edges"]))
    for n in graph["nodes"]:
        dd = n["data"]
        if "code" in dd:
            print("  ", n["id"], dd["title"], "code_len=", len(dd["code"]),
                  "sha256=", hashlib.sha256(dd["code"].encode("utf-8")).hexdigest()[:16])


if __name__ == "__main__":
    main()
