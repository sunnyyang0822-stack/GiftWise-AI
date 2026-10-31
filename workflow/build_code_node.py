"""从单一规则源码生成 Code 源码；生成物不是 Dify DSL。"""

import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ["validator/rules.py", "workflow/labels.py", "workflow/intake.py", "workflow/runtime.py"]

ENTRYPOINTS = {
    "intake_node.py": '''
_dispatch = main
def main(intake_json: str) -> dict:
    value = adapt_intake(intake_json)
    return {"request_json": value["request_json"] or "", "errors_json": dump(value["errors"]), "status": value["status"]}
''',
    "check_node.py": '''
_dispatch = main
def main(request_json: str, candidates_json: str, repair_count: int) -> dict:
    output = _dispatch("check", dump({"request_json": request_json, "candidates_json": candidates_json, "repair_count": repair_count}))
    value = json.loads(output["envelope_json"])
    output["validation_json"] = dump(value.get("validation", {}))
    output["preserved_candidates_json"] = dump(preserved_candidates(value)) if "validation" in value else "{}"
    return output
''',
    "recheck_node.py": '''
_dispatch = main
def main(request_json: str, previous_candidates_json: str, candidates_json: str, repair_count: int) -> dict:
    return _dispatch("recheck", dump({"request_json": request_json, "previous_candidates_json": previous_candidates_json, "candidates_json": candidates_json, "repair_count": repair_count}))
''',
    "report_node.py": '''
_dispatch = main
def main(state_json: str) -> dict:
    try:
        output = _dispatch("report", dump({"state": strict_load(state_json, max_bytes=262144)}))
        value = json.loads(output["envelope_json"])
        output["report_text"] = value.get("report_text", "暂时无法完成检查，未放行候选。")
        return output
    except Exception:
        return {"envelope_json": "{}", "status": "error", "all_passed": False, "repairable": False, "repair_count": 1, "report_text": "工作流记录无效，未放行候选。"}
'''
}


def build():
    parts, hashes = [], {}
    for name in SOURCES:
        raw = (ROOT / name).read_bytes()
        hashes[name] = hashlib.sha256(raw).hexdigest()
        # 摘要绑定原始源码字节；代码拼接统一 LF。validator 保持既有 -text。
        source = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
        lines = source.splitlines(keepends=True)
        for node in ast.parse(source).body:
            if isinstance(node, ast.ImportFrom) and node.module in {"validator.rules", "workflow.labels", "workflow.intake"}:
                for index in range(node.lineno - 1, node.end_lineno):
                    lines[index] = "\n"
        parts.append("# SOURCE: " + name + "\n" + "".join(lines))
    code = "# 自动生成，请修改原文件后重新构建；不要在 Dify 手工维护分叉。\n" + "\n".join(parts)
    ast.parse(code)
    output = ROOT / "workflow/generated"
    output.mkdir(exist_ok=True)
    (output / "code_node.py").write_text(code, encoding="utf-8", newline="\n")
    artifacts = {"code_node.py": hashlib.sha256(code.encode("utf-8")).hexdigest()}
    for filename, entry in ENTRYPOINTS.items():
        node_code = code + "\n" + entry
        ast.parse(node_code)
        (output / filename).write_text(node_code, encoding="utf-8", newline="\n")
        artifacts[filename] = hashlib.sha256(node_code.encode("utf-8")).hexdigest()
    manifest = {"sources_sha256": hashes, "artifacts_sha256": artifacts, "format": "python-source-not-dsl", "cloud_verified": False}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(manifest, ensure_ascii=False))
    return code, manifest


if __name__ == "__main__":
    build()
