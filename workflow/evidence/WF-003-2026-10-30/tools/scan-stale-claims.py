#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""扫描材料中「未发布 / 未创建版本 / 版本 #1」类表述，输出带行号与原句的清单。"""
import collections
import pathlib
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

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

OUT_REL = "workflow/evidence/WF-003-2026-10-31-publish-v2/materials-stale-publish-claims.md"

PAT = re.compile(r"未发布|未创建版本|版本 #1|版本#1|无版本|尚无版本|没有版本|未上线|未创建任何版本")
SKIP = ("node_modules", ".git/", ".tmp/", "WF-003-2026-10-31-publish-v2")
EXT = (".md", ".txt", ".py", ".json", ".html", ".css", ".mjs", ".cjs", ".ts", ".tsx", ".jsx")

hits = collections.OrderedDict()
for p in sorted(ROOT.rglob("*")):
    if not p.is_file():
        continue
    s = str(p.relative_to(ROOT)).replace("\\", "/")
    if any(k in s for k in SKIP):
        continue
    if p.suffix.lower() not in EXT:
        continue
    try:
        lines = p.read_text(encoding="utf-8", errors="replace").split("\n")
    except Exception:
        continue
    for i, l in enumerate(lines, 1):
        if PAT.search(l):
            hits.setdefault(s, []).append((i, l.strip()))

total = sum(len(v) for v in hits.values())
print("命中文件数:", len(hits), "命中行数:", total)

out = ROOT / OUT_REL
parts = [
    "# 材料中「未发布 / 未创建版本 / 版本 #1」类表述清单",
    "",
    "扫描时间：2026-10-31 00:3x（**版本 #2 已发布之后**）",
    "",
    "匹配模式：`未发布|未创建版本|版本 #1|版本#1|无版本|尚无版本|没有版本|未上线|未创建任何版本`",
    "",
    "排除：`node_modules/`、`.git/`、`.tmp/`、本目录自身。",
    "",
    f"共 **{len(hits)} 个文件 / {total} 处**。",
    "",
    "> 这是**扫描原始结果**，未替 PM 判断哪些该改。第 3 节给出我的分类建议。",
    "",
    "## 1. 原始清单（文件:行号 + 原句）",
    "",
]
for f, ls in hits.items():
    parts.append(f"### `{f}`（{len(ls)} 处）")
    for i, l in ls:
        q = l if len(l) <= 320 else l[:320] + "…"
        parts.append(f"- **{f}:{i}** — {q}")
    parts.append("")
out.write_text("\n".join(parts) + "\n", encoding="utf-8", newline="\n")
print("已写", out)
for f, ls in hits.items():
    print("  %-72s %d" % (f, len(ls)))
