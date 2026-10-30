#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""只读导出答辩 PPTX 的逐页文字与图片位置（讲稿与计时线，docs/speech 独占）。

用途：核对我方 5 分钟讲稿的**页映射**是否与真实幻灯片语义一致，
并找出"口播稿说 A、屏幕上写 B"这类**当场会被评委看穿的矛盾**。
本脚本**只读** PPTX，绝不修改（PPTX 属美化线/发布线）。

用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/dump_pptx_pages.py
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from pptx import Presentation
from pptx.util import Emu

ROOT = Path(__file__).resolve().parents[3]
PPTX = ROOT / "docs" / "competition" / "答辩PPT-GiftWise.pptx"


def main() -> int:
    raw = PPTX.read_bytes()
    print(f"文件：{PPTX.relative_to(ROOT)}")
    print(f"字节：{len(raw)}  sha256：{hashlib.sha256(raw).hexdigest()}")
    print(f"页数：{len(Presentation(str(PPTX)).slides)}")
    print("=" * 100)
    prs = Presentation(str(PPTX))
    for i, slide in enumerate(prs.slides, start=1):
        texts, pics = [], []
        for sh in slide.shapes:
            if sh.shape_type == 13 or sh.__class__.__name__ == "Picture":  # PICTURE
                try:
                    pics.append(f"{sh.name} {Emu(sh.width).inches:.2f}×{Emu(sh.height).inches:.2f}in")
                except Exception:  # noqa: BLE001
                    pics.append(sh.name)
                continue
            if sh.has_text_frame and sh.text_frame.text.strip():
                texts.append(sh.text_frame.text.strip())
            if getattr(sh, "has_table", False) and sh.has_table:
                for r in sh.table.rows:
                    row = " | ".join(c.text.strip().replace("\n", " ") for c in r.cells)
                    if row.strip(" |"):
                        texts.append("  表:" + row)
        print(f"\n### 第 {i} 页" + (f"　【图片：{'; '.join(pics)}】" if pics else ""))
        for t in texts:
            for line in t.splitlines():
                if line.strip():
                    print("   " + line.strip()[:150])
    return 0


if __name__ == "__main__":
    sys.exit(main())
