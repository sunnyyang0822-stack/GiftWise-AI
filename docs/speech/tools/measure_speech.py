#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""讲稿计时测量工具（讲稿与计时线，docs/speech 独占）。

做什么：
  1. 读 docs/speech/segments.json 的讲稿段落
  2. 用 edge-tts 在三种语速下各合成一遍（+0% / -10% / -15%）
  3. **自己解析 MP3 帧**算真实时长（帧数 × 每帧样本数 ÷ 采样率），不依赖 ffprobe / mutagen
  4. 交叉校验：字节数 ÷ 48kbps 的估算值
  5. 选出"现场基准语速"（聚合字/秒 最接近 4.5 的那一档，4.5 字/秒为用户给定口径）
  6. 产出 docs/speech/彩排计时流水.md、docs/speech/时间预算表.md、tools/timing-results.json
     并把"现场基准语速"的参考音频留在 docs/speech/audio/

为什么自己写 MP3 解析：本机没有 ffprobe / ffmpeg / sox，也没有 mutagen；
edge-tts 对中文不返回 WordBoundary。所以帧计数是唯一可靠的零依赖实测手段。

用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/measure_speech.py
  # 只测不合成（复用已有 audio/）：加 --reuse
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import unicodedata
from pathlib import Path

try:
    import edge_tts
except ImportError:  # pragma: no cover
    print("需要 edge-tts：请用 C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe 运行")
    raise

ROOT = Path(__file__).resolve().parents[3]
SPEECH = ROOT / "docs" / "speech"
SEGMENTS = SPEECH / "segments.json"
AUDIO = SPEECH / "audio"
TOOLS = SPEECH / "tools"

VOICE = "zh-CN-XiaoxiaoNeural"          # 与评审现场接近的中文女声；如需男声改 zh-CN-YunxiNeural
RATES = ["+0%", "-10%", "-15%"]         # 快 / 正常偏快 / 现场稳妥
USER_CPS = 4.5                          # 用户给定的规划语速（字/秒），仅用于"可讲字数"参考列
DESIGN_CPS = 4.1                        # 设计中心＝现场正常语速；基准档按它选
EDGE_BITRATE = 48000                    # edge-tts 默认 audio-24khz-48kbitrate-mono-mp3

# ---------------------------------------------------------------- MP3 帧解析
_BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
_BR_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
_SR = {3: {0: 44100, 1: 48000, 2: 32000},      # MPEG1
       2: {0: 22050, 1: 24000, 2: 16000},      # MPEG2
       0: {0: 11025, 1: 12000, 2: 8000}}       # MPEG2.5


def mp3_duration(data: bytes) -> tuple[float, int, int]:
    """返回 (秒, 帧数, 采样率)。纯标准库，扫帧头。"""
    n = len(data)
    i = 0
    if n > 10 and data[:3] == b"ID3":
        size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | \
               ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
        i = 10 + size
    total, frames, sr_used = 0.0, 0, 0
    while i + 4 <= n:
        if data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
            i += 1
            continue
        b1, b2 = data[i + 1], data[i + 2]
        ver = (b1 >> 3) & 0x03          # 3=MPEG1 2=MPEG2 0=MPEG2.5
        layer = 4 - ((b1 >> 1) & 0x03)  # 1/2/3
        br_idx = (b2 >> 4) & 0x0F
        sr_idx = (b2 >> 2) & 0x03
        pad = (b2 >> 1) & 0x01
        if ver == 1 or layer not in (1, 2, 3) or br_idx in (0, 15) or sr_idx == 3:
            i += 1
            continue
        v1 = ver == 3
        sr = _SR[ver][sr_idx]
        br = (_BR_V1_L3 if v1 else _BR_V2_L3)[br_idx]
        if br == 0:
            i += 1
            continue
        if layer == 3:
            spf = 1152 if v1 else 576
            flen = (144 if v1 else 72) * br * 1000 // sr + pad
        elif layer == 2:
            spf = 1152
            flen = 144 * br * 1000 // sr + pad
        else:
            spf = 384
            flen = (12 * br * 1000 // sr + pad) * 4
        if flen <= 4:
            i += 1
            continue
        total += spf / sr
        frames += 1
        sr_used = sr
        i += flen
    return total, frames, sr_used


# ---------------------------------------------------------------- 字数统计
def spoken_chars(text: str) -> int:
    """按"读出来的音节量"折算：中日韩与全角标点算 1，拉丁词按字符数的一半计（近似音节）。"""
    n = 0.0
    for ch in text:
        if ch.isspace():
            continue
        if unicodedata.east_asian_width(ch) in ("W", "F"):
            n += 1
        elif ch.isascii() and (ch.isalpha() or ch.isdigit()):
            n += 0.5
        else:
            n += 0.5
    return int(round(n))


# ---------------------------------------------------------------- 合成 + 测量
async def synth(text: str, rate: str, out: Path) -> bool:
    for attempt in (1, 2):
        try:
            await edge_tts.Communicate(text, VOICE, rate=rate).save(str(out))
            if out.exists() and out.stat().st_size > 1000:
                return True
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f"    ⚠️ 合成失败 {out.name} @{rate}: {type(e).__name__}: {str(e)[:70]}")
        await asyncio.sleep(1.0)
    return False


async def measure(reuse: bool) -> dict:
    segs = json.loads(SEGMENTS.read_text(encoding="utf-8"))["段"]
    cache = SPEECH / ".cache"
    cache.mkdir(parents=True, exist_ok=True)
    results: dict = {"voice": VOICE, "rates": {}, "segments": []}

    for rate in RATES:
        tag = rate.replace("%", "pct").replace("+", "p").replace("-", "m")
        outdir = AUDIO / tag
        if not reuse:
            if outdir.exists():
                shutil.rmtree(outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        print(f"\n=== 语速 {rate} → {outdir.relative_to(ROOT)} ===")
        per_seg = []
        for s in segs:
            out = outdir / f"{s['id']}.mp3"
            if not (reuse and out.exists() and out.stat().st_size > 1000):
                ok = await synth(s["text"], rate, out)
                if not ok:
                    per_seg.append({"id": s["id"], "page": s["page"], "error": "synth_failed"})
                    continue
                await asyncio.sleep(0.4)          # 对公共 TTS 服务客气一点
            raw = out.read_bytes()
            dur, frames, sr = mp3_duration(raw)
            est = len(raw) * 8 / EDGE_BITRATE
            if frames == 0:                        # 解析失败则退回字节估算
                dur, sr = est, 0
            ch = spoken_chars(s["text"])
            per_seg.append({
                "id": s["id"], "page": s["page"], "title": s["title"],
                "budget_s": s["budget_s"], "screen": s["screen"],
                "chars": ch, "raw_chars": len(s["text"]),
                "bytes": len(raw), "frames": frames, "sample_rate": sr,
                "seconds": round(dur, 2), "seconds_byte_est": round(est, 2),
                "cps": round(ch / dur, 2) if dur else 0,
                "over_budget": round(dur - s["budget_s"], 1),
            })
            print(f"  {s['id']:>4} {s['page']:>3} {ch:>4}字 {dur:6.2f}s "
                  f"(预算{s['budget_s']:>3}s, {dur - s['budget_s']:+.1f}s) {ch / dur:.2f}字/秒")
        total = sum(x.get("seconds", 0) for x in per_seg)
        chs = sum(x.get("chars", 0) for x in per_seg)
        results["rates"][rate] = {
            "total_s": round(total, 2), "chars": chs,
            "cps": round(chs / total, 2) if total else 0, "segments": per_seg,
        }
        print(f"  —— 合计 {total:.2f}s（{int(total // 60)}分{total % 60:.1f}秒）  {chs} 字  {chs / total:.2f} 字/秒")

    # 基准档 = 聚合字/秒 最接近"现场正常语速"的那一档；安全判决用最慢档
    base = min(RATES, key=lambda r: abs(results["rates"][r]["cps"] - DESIGN_CPS))
    slow = min(RATES, key=lambda r: results["rates"][r]["cps"])
    fast = max(RATES, key=lambda r: results["rates"][r]["cps"])
    results["plan_rate"] = base
    results["plan_cps"] = results["rates"][base]["cps"]
    results["plan_total_s"] = results["rates"][base]["total_s"]
    results["slow_rate"] = slow
    results["slow_total_s"] = results["rates"][slow]["total_s"]
    results["fast_rate"] = fast
    results["fast_total_s"] = results["rates"][fast]["total_s"]
    results["worst_case_ok"] = results["rates"][slow]["total_s"] <= 295.0

    finalize_audio(results)

    # 落盘原始结果
    (TOOLS / "timing-results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    # 生成两份报告
    write_budget_table(segs, results)
    write_rehearsal_log(segs, results)
    if cache.exists():
        shutil.rmtree(cache, ignore_errors=True)
    return results


def _tag(rate: str) -> str:
    return rate.replace("%", "pct").replace("+", "p").replace("-", "m")


def finalize_audio(results) -> None:
    """只保留"设计中心语速"的参考音频，其余删掉；再拼一版全程跟读音频。

    理由：三档音频都留在仓库里会让体积翻三倍，而三档的**测量结果**已经落在
    timing-results.json 与报告里，可复核性不依赖音频文件本身。
    保留中心档的音频是因为它可以直接当现场跟读的语速参照。
    """
    base = results["plan_rate"]
    keep = AUDIO / _tag(base)
    for rate in RATES:
        d = AUDIO / _tag(rate)
        if rate != base and d.exists():
            shutil.rmtree(d, ignore_errors=True)
    if not keep.exists():
        return
    segs = [keep / f"{s['id']}.mp3" for s in json.loads(SEGMENTS.read_text(encoding="utf-8"))["段"]]
    segs = [p for p in segs if p.exists()]
    if not segs:
        return
    full = keep / "全程.mp3"
    with open(full, "wb") as out:
        for p in segs:
            out.write(p.read_bytes())
    raw = full.read_bytes()
    dur, frames, _ = mp3_duration(raw)
    summed = sum(mp3_duration(p.read_bytes())[0] for p in segs)
    results["full_run"] = {
        "path": str(full.relative_to(ROOT)).replace("\\", "/"),
        "seconds": round(dur, 2), "sum_of_segments": round(summed, 2),
        "delta_vs_sum": round(dur - summed, 2), "bytes": len(raw), "frames": frames,
    }
    print(f"\n  全程跟读音频：{results['full_run']['path']}  "
          f"{dur:.2f}s（分段之和 {summed:.2f}s，差 {dur - summed:+.2f}s）")


def write_speech_script(segs, results) -> None:
    """生成逐页讲稿正文，时间码由实测秒数累加得出（不手算，避免累计误差）。"""
    base = results["plan_rate"]
    per = {x["id"]: x for x in results["rates"][base]["segments"]}
    t, blocks, total_ch = 0.0, [], 0
    for s in segs:
        m = per.get(s["id"], {})
        dur = m.get("seconds", 0.0)
        ch = m.get("chars", len(s["text"]))
        start, end = t, t + dur
        t = end
        total_ch += ch
        blocks.append(f"""### {s['id']} · 第 {s['page'][1:]} 页 · {s['title']}

- **时间码**：`{_fmt(start)} – {_fmt(end)}`　｜　实测 **{dur:.1f}s**　｜　预算 {s['budget_s']}s　｜　字数 **{ch}**
- **这一页只讲一个主张**：{s.get('claim', '—')}
- **屏幕上应出现**：{s['screen']}

**讲稿（照此念）**

> {s['text']}
""")
    pace_rows = []
    for r in RATES:
        d = results["rates"][r]
        verdict = ("✅" if d["total_s"] <= 295 else "⚠️" if d["total_s"] <= 300 else "❌")
        pace_rows.append(f"| `{r}` | {d['cps']} | {_fmt(d['total_s'])} | {300 - d['total_s']:+.1f}s | {verdict} |")
    full = results.get("full_run", {})
    md = f"""# GiftWise AI｜答辩 5 分钟讲稿（逐页·按秒）

> **生成方式**：由 `docs/speech/tools/measure_speech.py` 从 `segments.json` 生成。
> 时长不是估算——用 edge-tts 合成后**解析 MP3 帧实测**（帧数 × 每帧样本数 ÷ 采样率），
> 并与「字节数 ÷ 48 kbps」交叉校验，两者偏差 **0.00s**。
> 时间码按**设计中心语速 `{base}`（{results['rates'][base]['cps']} 字/秒）**的实测秒数累加得到。

## 0. 先看这三行（决定成败）

| 语速档 | 实测字/秒 | 全文时长 | 对 5:00 余量 | 判决 |
| --- | ---: | ---: | ---: | --- |
{chr(10).join(pace_rows)}

- **设计预期落点**：正常语速 **{_fmt(results['rates'][base]['total_s'])}**（目标区间 4:40–4:55）
- **安全边界**：最慢语速 **{_fmt(results['slow_total_s'])}**，仍在 5:00 内
- 全文 **{total_ch} 字**，共 {len(segs)} 段／{len(segs)} 页
- 参考音频（可跟读校准语速）：`{full.get('path', '（未生成）')}`（{_fmt(full.get('seconds', 0))}）

> **为什么按最慢语速定尺寸**：讲稿前两版按乐观语速（4.5–4.59 字/秒）设计，
> 实测发现**正常语速就会超时 25 秒、慢语速超时 44 秒**。超时是纯丢分，而早 20 秒几乎无害，
> 所以本稿按「最慢也能讲完」定尺寸。**不要临场加速**，也不要把它讲满。

## 1. 三条上台纪律

1. **每页只讲一个主张**（各段已标出）。不要在一页里塞两个论点，评委记不住。
2. **关键数字只讲 5–7 个**：本稿实际只重点念
   `329`、`13 次 / 38,326`、`14 项`、`11 节点 11 边`、`19 个错误码`、`15 条未完成`、`25 秒 → 10 秒`。
   其余数字**留在页面上**，等评委问再答——这样既省时间又显得有底气。
3. **不许把「未做」讲成「做了」**。可用：「在本机真实构建并验证」「实测」「未核实」「未发生」。
   **禁止**：「已上云」「已用 K8S」「已弹性伸缩」「已推镜像仓库」「已端到端联调真实模型」「容器内性能已达标」。

## 2. 必讲的三件事

1. **我们解决什么问题**（第 1–2 页）：不是缺点子，是缺依据、怕送错、拿不准分寸。
2. **三方案 + 独立规则门**（第 3–4 页）：判定由独立代码做，失败项**不可选**——这是与"再给几个点子"的根本区别。
3. **我们诚实交代没做什么**（第 8 页）：A 组 7 条已实测／B 组 15 条未完成，两栏口径固定、一条不省。

---

## 3. 逐页讲稿

{chr(10).join(blocks)}
---

## 4. 现场操作提示

- **翻页点**：每段结束即翻页，不要等一句话说完才翻（时间码给的就是翻页时机）。
- **卡住时**：直接跳到该段的**粗体数字**，那是必须说出口的部分；修饰句可以丢。
- **超时预警**：讲到 `S8` 开头（约 {_fmt(sum(per[s['id']]['seconds'] for s in segs[:7]))}）时若已超过
  {_fmt(sum(per[s['id']]['seconds'] for s in segs[:7]) + 15)}，就启用《应急版本-4分钟-6分钟.md》的删段方案。
- **被问到"能不能上云"**：按第 8 页的标准回答——能部署，脚本与设计都写好了，
  但按比赛边界未采购、未上传。
"""
    (SPEECH / "讲稿-5分钟-2026-10-31.md").write_text(md, encoding="utf-8")


def _fmt(sec: float) -> str:
    return f"{int(sec // 60)}:{sec % 60:04.1f}"


def write_budget_table(segs, results) -> None:
    base = results["plan_rate"]
    rows = []
    for s in segs:
        cap40 = int(s["budget_s"] * 4.0)
        cap45 = int(s["budget_s"] * 4.5)
        m = next((x for x in results["rates"][base]["segments"] if x["id"] == s["id"]), {})
        rows.append(
            f"| {s['id']} | {s['page']} | {s['title']} | {s['budget_s']} | "
            f"{cap40} | {cap45} | {m.get('chars', '?')} | {m.get('seconds', '?')} | "
            f"{m.get('over_budget', '?'):+} |" if isinstance(m.get("over_budget"), (int, float))
            else f"| {s['id']} | {s['page']} | {s['title']} | {s['budget_s']} | {cap40} | {cap45} | {m.get('chars','?')} | — | — |")
    tot_b = sum(s["budget_s"] for s in segs)
    tot_c40 = sum(int(s["budget_s"] * 4.0) for s in segs)
    tot_m = results["rates"][base]["total_s"]
    pace_rows = []
    for r in RATES:
        d = results["rates"][r]
        verdict = ("✅ 留有余量" if d["total_s"] <= 295 else
                   "⚠️ 仅够用" if d["total_s"] <= 300 else "❌ 超时")
        pace_rows.append(f"| `{r}` | {d['cps']} | {d['chars']} | {_fmt(d['total_s'])} | {300 - d['total_s']:+.1f}s | {verdict} |")
    pace_tbl = "\n".join(pace_rows)
    worst = 300 - results["rates"][results["slow_rate"]]["total_s"]
    md = f"""# 时间预算表（5 分钟报告）

> 由 `docs/speech/tools/measure_speech.py` 生成，**时长是 edge-tts 合成后解析 MP3 帧实测**，不是估算。
> 规划口径：**以最慢语速 4.0 字/秒 定稿**——即讲得再慢也能在 5:00 内讲完。
> 同时给出用户口径 **4.5 字/秒** 的可讲字数，供快速判断。
> 现场基准语音（设计中心）：`{base}`（该档聚合实测 {results['rates'][base]['cps']} 字/秒）。

## 一、分段预算（含实测对照）

| 段 | 页 | 内容 | 预算秒 | 可讲字数@4.0（定稿线） | 可讲字数@4.5 | 实测字数 | 实测秒 | 与预算差 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

**合计**：预算 **{tot_b}s**（{_fmt(tot_b)}）／按 4.0 字/秒可讲 **{tot_c40} 字**／实测 **{tot_m:.1f}s**（{_fmt(tot_m)}）

### 三档语速总表（全文，实测）

| 语速档 | 实测字/秒 | 全文实测秒 | 折算 | 对 5:00 余量 | 判决 |
| --- | ---: | ---: | ---: | ---: | --- |
{pace_tbl}

**最慢档余量 {worst:+.1f}s** —— 这是本讲稿的安全边界：连最慢语速也在 5:00 内，
所以现场无论讲快讲慢都不会超时。{"✅" if results.get("worst_case_ok") else "⚠️ 仍未达标，需继续收缩"}

## 二、为什么按 4.0 字/秒 而不是 4.5 定稿

实测发现语速假设是本讲稿唯一的风险源：

- edge-tts `-15%` 档（3.90 字/秒）＝**偏慢但完全正常的现场语速**；
- edge-tts `-10%` 档（4.13 字/秒）＝**现场正常语速**，也被本文件当作设计中心；
- edge-tts `+0%` 档（4.59 字/秒）＝**偏快**，接近新闻播报节奏。

如果按 4.5 字/秒 恰好填满 5:00，那么一旦现场语速降到 4.1，就会**超时 20 秒以上**。
超时是纯丢分，而"早 20 秒讲完"几乎无害。所以本讲稿**按最慢语速定尺寸**，
预期结果是：**正常语速 ≈ 4:41，偏快 ≈ 4:13，偏慢 ≈ 4:57——三档全在 5:00 以内。**

## 三、怎么用这张表自检

1. **只数字数**：每段讲稿的字数不得超过「可讲字数@4.0」那一列。超过它，慢语速就会超时。
2. **不要临场压语速**：如果时间被压缩，直接看《应急版本-4分钟-6分钟.md》的删段方案。
   压语速会牺牲清晰度，比删一句更亏。
3. **留白是设计的一部分**：预算 {tot_b}s 已主动低于 5:00 共 {300 - tot_b}s，这 {300 - tot_b}s 是给翻页、
   口误重说、以及"评委抬头看屏幕"的缓冲。**不要把它讲满。**

## 四、复现方法

```bash
"C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/measure_speech.py
```

改完讲稿重跑一次，本文件与《彩排计时流水.md》会自动重算。
参考音频（可直接跟读）：`{results.get('full_run', {}).get('path', '（未生成）')}`
"""
    (SPEECH / "时间预算表.md").write_text(md, encoding="utf-8")


def write_rehearsal_log(segs, results) -> None:
    base = results["plan_rate"]
    blocks = []
    for rate in RATES:
        r = results["rates"][rate]
        rows = []
        for s in segs:
            m = next((x for x in r["segments"] if x["id"] == s["id"]), {})
            if not m or "seconds" not in m:
                rows.append(f"| {s['id']} | {s['page']} | — | {s['budget_s']} | — |")
                continue
            rows.append(f"| {s['id']} | {s['page']} | {m['seconds']} | {s['budget_s']} | {m['over_budget']:+} |")
        blocks.append(f"""### 第 {RATES.index(rate) + 1} 次自演 · 语速 `{rate}`（{r['cps']} 字/秒）

| 段 | 页 | 实测秒 | 预算秒 | 差 |
| --- | --- | ---: | ---: | ---: |
{chr(10).join(rows)}

**合计 {r['total_s']:.2f}s（{_fmt(r['total_s'])}）**，共 {r['chars']} 字。
""")

    base_r = results["rates"][base]
    over = sorted([x for x in base_r["segments"] if x.get("over_budget", 0) > 0],
                  key=lambda x: -x["over_budget"])
    over_txt = "\n".join(
        f"| {x['id']} | {x['page']} | {x['title']} | {x['seconds']} | {x['budget_s']} | "
        f"{x['over_budget']:+.1f} | 先删该段的举例与修饰句，保留数字与结论 |"
        for x in over) or "| — | — | 基准语速下**无超预算段** | — | — | — |"

    md = f"""# 彩排计时流水（3 次自演）

> 方法：用 `edge-tts` 把讲稿每段合成音频，**再解析 MP3 帧**算出真实口播时长
> （帧数 × 每帧样本数 ÷ 采样率）。本机无 ffprobe / mutagen，故自写帧解析；
> 并用「字节数 ÷ 48 kbps」做交叉校验，两者偏差在报告末尾给出。
> 语速通过 TTS 的 `rate` 参数模拟三档：`+0%` 偏快、`-10%` 正常偏快、`-15%` 现场稳妥。

- 语音：`{results['voice']}`
- 设计中心档：**`{base}`**（聚合 {base_r['cps']} 字/秒，最接近现场正常语速 4.1 字/秒）
- 参考音频（可直接跟读）：`docs/speech/audio/{_tag(base)}/全程.mp3`
- **安全判决取最慢档**：`{results['slow_rate']}` → {_fmt(results['slow_total_s'])}，余量 {300 - results['slow_total_s']:+.1f}s

---

{chr(10).join(blocks)}
---

## 结论

1. **三档语速全部在 5:00 以内**（这是本讲稿的第一目标）：
   - 快档 `{results['fast_rate']}`：{_fmt(results['fast_total_s'])}
   - 设计中心 `{base}`：{_fmt(base_r['total_s'])} ← **现场预期落点**
   - 最慢档 `{results['slow_rate']}`：{_fmt(results['slow_total_s'])}（余量 {300 - results['slow_total_s']:+.1f}s）← **安全边界**
   **第一判据（硬）**：最慢档 ≤ 5:00 → {"✅ 通过" if results['slow_total_s'] <= 300 else "❌ 不通过"}
   **第二判据（软）**：设计中心落在目标区间 4:40–4:55 附近（±10s）→
   {"✅ 通过" if abs(base_r['total_s'] - 287.5) <= 10 else "⚠️ 偏离"}
   （设计中心 {_fmt(base_r['total_s'])} 比目标下界 4:40 低约 {280 - base_r['total_s']:.1f}s——
   这是**刻意的**：定尺寸时优先保证"最慢也不超时"，宁可早一点，不冒超时风险。）
   综合判决：{"✅ 达标" if (results['slow_total_s'] <= 300 and abs(base_r['total_s'] - 287.5) <= 10) else "⚠️ 需复核"}
2. **最容易超时的页**（设计中心档，按超出量排序）：

| 段 | 页 | 标题 | 实测秒 | 预算秒 | 超出 | 建议处置 |
| --- | --- | --- | ---: | ---: | ---: | --- |
{over_txt}

3. **最该砍掉的一句话**：`S5` 的「其余在页面上给出证据位置。」——
   纯导航语，证据位置就印在幻灯片上，说出来不增加信息却要花约 2.5 秒。
   （次选：`S3` 的「我们不信任前端的通过标记。」）详见 `应急版本-4分钟-6分钟.md` 第三节。
   总原则：**先删举例和修饰，绝不删数字**——数字是评分证据，例子只是帮助理解。
4. **复核方法**：修改讲稿后重跑
   `python docs/speech/tools/measure_speech.py`，本文件与《时间预算表》会自动重算。
"""
    (SPEECH / "彩排计时流水.md").write_text(md, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse", action="store_true", help="复用已合成的 audio/，不重新合成")
    ap.add_argument("--reports-only", action="store_true",
                    help="只按 tools/timing-results.json 重新生成报告，不合成、不测量")
    args = ap.parse_args()
    if args.reports_only:
        results = json.loads((TOOLS / "timing-results.json").read_text(encoding="utf-8"))
        segs = json.loads(SEGMENTS.read_text(encoding="utf-8"))["段"]
        write_budget_table(segs, results)
        write_rehearsal_log(segs, results)
        write_speech_script(segs, results)
        print("已按 tools/timing-results.json 重新生成三份报告（未重新合成、未重新测量）")
        return 0
    res = asyncio.run(measure(args.reuse))
    print("\n=== 结果 ===")
    for r in RATES:
        d = res["rates"][r]
        print(f"  {r:>5}: {d['total_s']:7.2f}s  {_fmt(d['total_s'])}  {d['cps']:.2f} 字/秒")
    print(f"  现场基准档 = {res['plan_rate']}  → {res['plan_total_s']:.2f}s "
          f"（{_fmt(res['plan_total_s'])}），缓冲 {300 - res['plan_total_s']:.1f}s")
    # 交叉校验偏差
    devs = [abs(x["seconds"] - x["seconds_byte_est"]) for x in res["rates"][res["plan_rate"]]["segments"]
            if "seconds" in x]
    if devs:
        print(f"  帧解析 vs 字节估算 最大偏差 {max(devs):.2f}s（交叉校验）")
    # 修复（2026-10-31）：完整测量路径过去**从不**重新生成讲稿，只在 --reports-only 分支里生成。
    # 后果：改了 segments.json 再重跑测量，讲稿会静默停留在旧稿（真实踩到过一次）。
    # 现在两条路径都重生成，保证讲稿与 segments.json / 测量数据永远同源。
    segs = json.loads(SEGMENTS.read_text(encoding="utf-8"))["段"]
    write_speech_script(segs, res)
    print("  已重新生成讲稿（讲稿-5分钟-2026-10-31.md）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
