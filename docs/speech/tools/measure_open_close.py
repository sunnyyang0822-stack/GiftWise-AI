#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""开场 15 秒 / 收尾 15 秒候选的计时测量（讲稿与计时线，docs/speech 独占）。

同 measure_speech.py 的方法：edge-tts 合成 → 自写 MP3 帧解析测真实时长。
用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/measure_open_close.py
"""
from __future__ import annotations

import asyncio
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_speech import _fmt, mp3_duration, synth, spoken_chars  # noqa: E402

SPEECH = Path(__file__).resolve().parents[1]
CENTER = "-10%"
CACHE = SPEECH / ".cache-oc"
TARGET = 15.0

OPENINGS = [
    ("O1", "直击痛点型",
     "各位评委好。送礼物最难的不是想不到，而是拿不准——怕送错，更怕分寸过了。GiftWise 就是来解决这一步的。",
     "最直接。适合评委已经看过项目简介、想马上听结论的场合。"),
    ("O2", "反常识型",
     "各位评委好。我们做了一件看起来很小的事：不让模型自己说「我选得对」。GiftWise 是送礼决策助手，判定权在独立代码手里。",
     "最强钩子，直接抛出差异化。适合评委注意力还没集中时开场。"),
    ("O3", "场景代入型",
     "各位评委好。给正在追求的人送礼物，送贵了像施压，送便宜了像敷衍。这个分寸，就是 GiftWise 要解决的问题。",
     "最有画面感。适合非技术评委居多、需要先建立共情的场合。"),
]

CLOSINGS = [
    ("C1", "诚实收束型",
     "我们做了七件事，也明确有十五件没做，两栏都写在最后一页。一条命令就能复核全部声明。谢谢各位。",
     "把「诚实」变成最后一句记忆点，同时候补了复核入口。"),
    ("C2", "主张回扣型",
     "回到开头那句话：我们交付的不是点子，是一段能核对的决定过程。七条已实测、十五条未完成，都在页面上。谢谢。",
     "首尾呼应，结构最完整。适合时间充裕、评委认真在听的场合。"),
    ("C3", "邀请验证型",
     "我们没有把没做的事说成做了。最后一页是一条命令，跑一次就能看到每条声明的结果。欢迎各位现场验证，谢谢。",
     "最自信，把「可复核」变成行动邀请。适合有现场 Demo 环节、评委可上手时。"),
]


async def measure_one(kind: str, cid: str, text: str):
    outdir = CACHE / kind
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / f"{cid}.mp3"
    if not (out.exists() and out.stat().st_size > 1000):
        if not await synth(text, CENTER, out):
            return None
        await asyncio.sleep(0.4)
    dur, _, _ = mp3_duration(out.read_bytes())
    return dur


async def main() -> int:
    res = {}
    for kind, items in (("openings", OPENINGS), ("closings", CLOSINGS)):
        for cid, name, text, note in items:
            res[cid] = await measure_one(kind, cid, text)
    def block(items, kind_name):
        lines = []
        for cid, name, text, note in items:
            d = res[cid]
            sec = f"**{d:.1f}s**" if d else "合成失败"
            # 固定 15 秒槽位：装得下且留有余量才是好；偏短不算缺陷
            if d and d <= TARGET:
                flag = f"✅ 装得下，留 {TARGET - d:.1f}s 呼吸"
            elif d and d <= TARGET + 2.5:
                flag = f"⚠️ 略超 {d - TARGET:.1f}s，可删一句"
            elif d:
                flag = f"❌ 超 {d - TARGET:.1f}s，必须删句"
            else:
                flag = "—"
            delta = f"{d - TARGET:+.1f}s" if d else "—"
            lines.append(f"""### {cid} · {name}

- **实测时长**：{sec}（对 15 秒 {delta}）{flag}
- **字数**：{spoken_chars(text)}

**讲稿**

> {text}

- **怎么选**：{note}
""")
        return "\n".join(lines)

    md = f"""# 开场 15 秒与收尾 15 秒：候选定稿

> 这两段最值得打磨：开场决定评委前 15 秒的注意力，收尾决定他们走出会场时记得什么。
> 时长同主稿方法实测（edge-tts 合成 → MP3 帧解析，语速 `{CENTER}`）。
> **选型标准：能装进 15 秒、并留 1.5 秒以上呼吸**（固定槽位里讲满反而危险——掌声、
> 翻页、口误都会吃掉时间，本组实测全部落在 11.8–13.5 秒，是刻意的留白）。

## 一、开场 15 秒（三选一）

{block(OPENINGS, '开场')}
**开场统一纪律**：
1. **不要念标题**。评委自己看得到「GiftWise AI — 青年送礼决策 Agent」。
2. **不要报流水账数字**。开场 15 秒里出现超过两个数字，评委就记不住任何一个。
3. **第一句必须是人话**（"拿不准""像施压"），不是技术词（"确定性校验""分层架构"）。
4. 如果现场设备/代码与提交版本不同，**在这 15 秒里主动说明**（评分规则 1.4 要求）。

## 二、收尾 15 秒（三选一）

{block(CLOSINGS, '收尾')}
**收尾统一纪律**：
1. **收尾必须出现「未完成」**。这是本项目最特殊的地方——诚实本身就是得分项，不要在最后一句把缺口抹掉。
2. **不要用「谢谢聆听」之外的客套**（"恳请各位批评指正""不足之处敬请谅解"）——浪费时间且不增加信息。
3. **最后一句要短**。长了会被掌声打断，收不干净。
4. 收尾**不要再说新数字**。收尾只做一件事：把最想让他们记住的那一个印象钉住。

## 三、推荐组合

| 场合 | 推荐 | 理由 |
| --- | --- | --- |
| 非技术评委居多 | `O3` + `C1` | 先共情、后诚实，最容易被打分记住 |
| 技术评委居多 | `O2` + `C3` | 直接抛差异化，再用"可复核"收尾 |
| 时间被压缩（4 分钟版） | `O1` + `C1` | 两段都最短最直接，合计省下约 5 秒 |
| 允许加时（6 分钟版） | `O2` + `C2` | 钩子强、首尾呼应，撑得起更长的结构 |
"""
    (SPEECH / "开场与收尾候选.md").write_text(md, encoding="utf-8")
    for cid in ("O1", "O2", "O3", "C1", "C2", "C3"):
        d = res[cid]
        print(f"  {cid}: {d:.1f}s" if d else f"  {cid}: 失败")
    shutil.rmtree(CACHE, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
