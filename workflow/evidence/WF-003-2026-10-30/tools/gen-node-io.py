"""从 run-parsed.json 生成节点级输入输出原文附录（逐字，不手抄）。"""
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
TMP = INPUTS
OUT = _SELF.parent

ORDER = ["用户输入", "N1 用户输入与确定性适配", "N2 需求分析与三候选（占位·未接模型）",
         "N3 Code 首次校验", "N4 校验结果分支", "N5 一次修订（占位·未接模型）", "N6 Code 再校验",
         "N7a 未修订报告", "N7b 修订后报告", "End A 未修订输出", "End B 修订后输出"]


def main():
    recs = json.loads((TMP / "run-demo-parsed.json").read_text(encoding="utf-8"))
    for rec in recs:
        lines = [f"# 节点级输入输出原文 · {rec['label']}", "",
                 f"- 发起时间（浏览器本地，UTC）：`{rec['startedAtLocal']}`",
                 f"- HTTP：`{rec['httpStatus']}`　Content-Type：`{rec['contentType']}`",
                 f"- 端到端耗时：`{rec['elapsedMs']} ms`",
                 f"- 预期路径：{rec['expect']}", "",
                 "> 数据来源：`POST /console/api/apps/5abdb13c-a633-4a9c-96c3-dabd44072511/workflows/draft/run`",
                 "> 返回的 SSE 流，逐字记录，未做改写。`placeholder: true` 与 `model_called: false` 表示该节点未调用模型。", ""]
        for title in ORDER:
            starts = [e for e in rec["events"] if e["event"] == "node_started" and e["node"] == title]
            fins = [e for e in rec["events"] if e["event"] == "node_finished" and e["node"] == title]
            if not starts and not fins:
                continue
            lines.append(f"## {title}")
            lines.append("")
            for f in fins:
                lines.append(f"- 节点 ID：`{f['node_id']}`　状态：`{f['status']}`　节点耗时：`{f.get('elapsed')} s`　时间戳：`{f.get('created_at')}`")
                lines.append("")
                lines.append("**输入（Dify 服务端回传的节点 inputs）**")
                lines.append("")
                lines.append("```json")
                lines.append(json.dumps(f.get("inputs"), ensure_ascii=False, indent=2))
                lines.append("```")
                lines.append("")
                lines.append("**输出（Dify 服务端回传的节点 outputs）**")
                lines.append("")
                lines.append("```json")
                lines.append(json.dumps(f.get("outputs"), ensure_ascii=False, indent=2))
                lines.append("```")
                lines.append("")
                if f.get("error"):
                    lines.append("**节点错误**")
                    lines.append("")
                    lines.append("```json")
                    lines.append(json.dumps(f["error"], ensure_ascii=False, indent=2))
                    lines.append("```")
                    lines.append("")
        wf = rec.get("workflow")
        lines.append("## 工作流级输出（workflow_finished）")
        lines.append("")
        lines.append("```json")
        lines.append(json.dumps(wf, ensure_ascii=False, indent=2))
        lines.append("```")
        lines.append("")
        (OUT / f"dify-node-io-{rec['label']}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("wrote", f"dify-node-io-{rec['label']}.md", len("\n".join(lines)), "chars")


if __name__ == "__main__":
    main()
