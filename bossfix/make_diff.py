# -*- coding: utf-8 -*-
"""生成 bossfix/boss-relation.diff（git diff 格式，针对生产文件）。

只生成，不应用；不写入 workflow/**、web/**、tests/**、docs/** 的任何文件。
基线取 bossfix/orig/ 下的只读副本，改动取 bossfix/variant/ 下的副本，
两侧都与仓库当前生产文件一致（脚本会先校验这一点）。

用法： python bossfix/make_diff.py
"""
import difflib
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "bossfix" / "boss-relation.diff"

PAIRS = [
    ("workflow/labels.py", ROOT / "bossfix" / "orig" / "workflow" / "labels.py",
     ROOT / "bossfix" / "variant" / "labels.py"),
    ("web/server/labels.mjs", ROOT / "bossfix" / "orig" / "web" / "server" / "labels.mjs",
     ROOT / "bossfix" / "variant" / "labels.mjs"),
]


def blob(path):
    return path.read_text(encoding="utf-8").splitlines(keepends=True)


def main():
    chunks = []
    for prod_rel, orig_path, variant_path in PAIRS:
        # 基线必须等于仓库当前生产文件，否则 diff 会打在错误的基线上。
        prod = ROOT / prod_rel
        a = prod.read_bytes()
        b = orig_path.read_bytes()
        if a != b:
            print(f"基线不一致：{prod_rel} 与 {orig_path} 不同，终止", file=sys.stderr)
            return 1

        before = blob(orig_path)
        after = blob(variant_path)
        old_sha = hashlib.sha1("".join(before).encode("utf-8")).hexdigest()[:7]
        new_sha = hashlib.sha1("".join(after).encode("utf-8")).hexdigest()[:7]

        diff = list(difflib.unified_diff(
            before, after,
            fromfile=f"a/{prod_rel}", tofile=f"b/{prod_rel}", n=3,
        ))
        if not diff:
            print(f"无差异：{prod_rel}", file=sys.stderr)
            continue

        chunks.append(f"diff --git a/{prod_rel} b/{prod_rel}\n")
        chunks.append(f"index {old_sha}..{new_sha} 100644\n")
        # difflib 的 ---/+++ 行已含 a/ b/ 前缀；补上换行
        for line in diff:
            chunks.append(line if line.endswith("\n") else line + "\n")
            if line.startswith("+++ "):
                pass

    OUT.write_text("".join(chunks), encoding="utf-8", newline="\n")
    added = sum(1 for line in "".join(chunks).splitlines()
                if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in "".join(chunks).splitlines()
                  if line.startswith("-") and not line.startswith("---"))
    print(f"已生成 {OUT}")
    print(f"  文件数 = {len(PAIRS)}   新增行 = {added}   删除行 = {removed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
