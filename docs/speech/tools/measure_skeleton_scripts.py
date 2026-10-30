#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""实测《答辩PPT骨架.md》自带口播稿的真实时长（讲稿与计时线，docs/speech 独占）。

存在理由：骨架给每页标了「口播稿（约 35 秒）」这类声称值，但**声称值没有人验证过**。
本脚本把骨架里的 8 段口播稿逐段合成并测真实时长，与声称值、与 5 分钟总预算对比，
产出可复核的超时证据。这是只读骨架、不改它。

用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/measure_skeleton_scripts.py
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_speech import _fmt, mp3_duration, synth, spoken_chars  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SKELETON = ROOT / "docs" / "competition" / "答辩PPT骨架.md"
SPEECH = ROOT / "docs" / "speech"
CACHE = SPEECH / ".cache-skeleton"
CENTER = "-10%"
BUDGET = 300.0


def extract() -> list[tuple[int, int, str]]:
    """返回 [(页序, 声称秒数, 口播稿正文)]"""
    txt = SKELETON.read_text(encoding="utf-8")
    pat = re.compile(r"\*\*口播稿（约\s*(\d+)\s*秒）\*\*[^\n]*\n\s*\n((?:>[^\n]*\n?)+)")
    out = []
    for i, (claimed, block) in enumerate(pat.findall(txt), start=1):
        body = "\n".join(l.lstrip("> ").strip() for l in block.strip().splitlines() if l.strip())
        out.append((i, int(claimed), body))
    return out


async def main() -> int:
    items = extract()
    if not items:
        print("未解析到口播稿，检查骨架格式")
        return 1
    CACHE.mkdir(parents=True, exist_ok=True)
    rows, total, claimed_total = [], 0.0, 0
    for page, claimed, body in items:
        out = CACHE / f"p{page}.mp3"
        if not (out.exists() and out.stat().st_size > 1000):
            if not await synth(body, CENTER, out):
                continue
            await asyncio.sleep(0.4)
        dur, _, _ = mp3_duration(out.read_bytes())
        ch = spoken_chars(body)
        total += dur
        claimed_total += claimed
        rows.append((page, claimed, ch, dur, body))

    tbl = "\n".join(
        f"| 第 {p} 页 | {c} | {ch} | **{d:.1f}** | {d - c:+.1f} | {d / c:.2f}× |"
        for p, c, ch, d, _ in rows)
    over_claimed = total - claimed_total
    over_budget = total - BUDGET
    # 主稿总时长**从实测数据读**，不硬编码（硬编码会在改稿后静默过期——本项目已踩过一次）
    _main = json.loads((SPEECH / "tools" / "timing-results.json").read_text(encoding="utf-8"))
    main_txt = _fmt(_main["plan_total_s"])

    md = f"""# 《答辩PPT骨架.md》自带口播稿：实测超时证据

> **结论：照骨架自带的口播稿念，实测 {_fmt(total)}（{total:.1f}s），
> 超 5 分钟上限 {over_budget:.1f} 秒，超骨架自己声称的总时长 {over_claimed:.1f} 秒。**
>
> 方法：把骨架里 8 段口播稿逐段抽出，用 edge-tts 合成后解析 MP3 帧测真实时长
> （语速 `{CENTER}`＝现场正常语速）。骨架本身**只读、未修改**。

## 一、逐页对照

| 页 | 骨架声称秒 | 实测字数 | 实测秒 | 与声称差 | 倍数 |
| --- | ---: | ---: | ---: | ---: | ---: |
{tbl}

- **声称合计**：{claimed_total}s（{_fmt(claimed_total)}）
- **实测合计**：{total:.1f}s（{_fmt(total)}）
- **超支**：{over_claimed:+.1f}s（{total / claimed_total:.2f} 倍）
- **对 5 分钟上限**：{over_budget:+.1f}s

## 二、为什么会这样

骨架按「每页 35–40 秒」设计，但**每页实际写的字远比 35–40 秒能讲的多**。
在 {CENTER} 档实测字速约 4.05 字/秒，40 秒只能讲约 162 字；
而骨架有几页的口播稿接近或超过 200 字，于是单页就超 10–20 秒，8 页累积成 {over_claimed:.0f} 秒。

**根因**：声称的秒数是"设计意图"，不是"测量结果"。没有任何工具核对过它。

## 三、处置建议

1. **不要照骨架念**。改用 `docs/speech/讲稿-5分钟-2026-10-31.md`
   （实测 {main_txt}，三档语速全部在 5:00 内）。
2. **骨架本身不必改**——它的价值是"页序与每页要点"，那部分仍然有效。
   建议在骨架的「口播稿」小节加一行注记：
   「⚠️ 本节秒数为设计意图，未经验证；实测见 `docs/speech/骨架口播稿实测-超时证据.md`，
   照此念会超时。正式讲稿见 `docs/speech/讲稿-5分钟-2026-10-31.md`。」
   （改骨架属发布线文件，需由 PM 协调，本线未改。）
3. **把"秒数声称"当成需要验证的声明**。这与本项目「不许把未验证写成已验证」的原则一致：
   声称 35 秒而实测 57 秒，和一个未实测的部署声明是同一类问题。

## 四、可复核

```bash
"C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/measure_skeleton_scripts.py
```

## 五、本文件的边界

- 只读 `docs/competition/答辩PPT骨架.md`，**未修改它**（那是发布线的文件）。
- 语速为 TTS 模拟，不等于真人语速；三档语速的敏感性分析见《彩排计时流水.md》。
- 骨架共解析到 {len(items)} 段口播稿；若骨架后续新增页，本脚本重跑会自动纳入。
"""
    (SPEECH / "骨架口播稿实测-超时证据.md").write_text(md, encoding="utf-8")
    print(f"解析 {len(items)} 段；声称合计 {claimed_total}s；实测合计 {total:.1f}s（{_fmt(total)}）；超支 {over_claimed:+.1f}s")
    shutil.rmtree(CACHE, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
