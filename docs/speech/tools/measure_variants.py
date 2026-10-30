#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""应急版本（4 分钟 / 6 分钟）计时测量（讲稿与计时线，docs/speech 独占）。

与 measure_speech.py 同一套方法：edge-tts 合成 → 自写 MP3 帧解析测真实时长。
只测"设计中心语速"（-10%）一档，因为应急版只用于现场实际讲的那一遍。

用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/measure_variants.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_speech import _fmt, mp3_duration, synth, spoken_chars  # noqa: E402

SPEECH = Path(__file__).resolve().parents[1]
CENTER = "-10%"          # 设计中心语速（现场正常语速）
CACHE = SPEECH / ".cache-variants"
CENTER_CPS = 4.05        # 实测得到的该档字/秒，用于换算


async def run(json_name: str) -> tuple[list, float, int]:
    segs = json.loads((SPEECH / json_name).read_text(encoding="utf-8"))["段"]
    outdir = CACHE / json_name.replace(".json", "")
    outdir.mkdir(parents=True, exist_ok=True)
    rows, total, chars = [], 0.0, 0
    for s in segs:
        out = outdir / f"{s['id']}.mp3"
        if not (out.exists() and out.stat().st_size > 1000):
            if not await synth(s["text"], CENTER, out):
                rows.append((s, spoken_chars(s["text"]), None))
                continue
            await asyncio.sleep(0.4)
        dur, _, _ = mp3_duration(out.read_bytes())
        ch = spoken_chars(s["text"])
        total += dur
        chars += ch
        rows.append((s, ch, dur))
    return rows, total, chars


def table(rows, base_total: float | None = None) -> str:
    out, t = [], 0.0
    for s, ch, dur in rows:
        if dur is None:
            out.append(f"| {s['id']} | {s['page']} | {s['title']} | {ch} | 合成失败 | — |")
            continue
        start = t
        t += dur
        mark = ""
        if base_total is not None:
            mark = "（新增）" if s["id"].startswith("A") else ""
        out.append(f"| {s['id']}{mark} | {s['page']} | {s['title']} | {ch} | **{dur:.1f}** | `{_fmt(start)} – {_fmt(t)}` |")
    return "\n".join(out)


async def main() -> int:
    r4, t4, c4 = await run("segments-4min.json")
    r6, t6, c6 = await run("segments-6min.json")

    # 主稿总时长**从实测数据读**，不硬编码（硬编码会在改稿后静默过期——本项目已踩过一次）
    _main = json.loads((SPEECH / "tools" / "timing-results.json").read_text(encoding="utf-8"))
    main_txt = _fmt(_main["plan_total_s"])

    verdict4 = "✅ 达标（≤4:10）" if t4 <= 250 else "⚠️ 仍偏长" if t4 <= 265 else "❌ 不是 4 分钟版"
    verdict6 = "✅ 达标（≤6:10）" if t6 <= 370 else "❌ 超出 6 分钟太多"

    md = f"""# 应急版本：4 分钟版与 6 分钟版（实测）

> 与主稿同一套方法：**edge-tts 合成 → 自写 MP3 帧解析测真实时长**，只测设计中心语速 `{CENTER}`。
> 主稿（11 段）在同一语速下实测 **{main_txt}**（见《彩排计时流水.md》）。
> 本文件的两套版本是**真实测量结果**，不是按字数估算。

---

## 一、4 分钟版：删哪几段、保留哪些数字

**触发条件**：主持人临时压缩到 4 分钟，或前面的人超时挤占了时间。

### 删/改决策表

| 处置 | 段 | 动作 | 省下 |
| --- | --- | --- | ---: |
| **整段删** | `S9` 评分维度对照 | 纯指针页，不讲；页面留着，问答时用 | ≈5.5s |
| **整段删** | `S11` 现场可复核 | 内容压成一句并入 `S8` 结尾（"复核入口在最后一页，一条命令"） | ≈6s（净） |
| **压缩** | `S7` 成本与性能 | 只留双口径数字 + "单价未核实"；**删掉**容器体积/冷构建/单机基线三句 | ≈12s |
| **压缩** | `S10` 真实缺陷 | 只留"缺陷 → 修复 → 范围限定"；删掉"旧镜像实测"的细节复述 | ≈5s |
| **压缩** | `S6` 工程化 | 两句合一；**删掉**"还有一条修订路径暂无运行时证据"（**该条仍在第 8 页 B 组幻灯片上，未隐藏**） | ≈4s |
| **压缩** | `S5` 结果与证据 | 删掉"其余在页面上给出证据位置"这句导航语 | ≈2.5s |

**保留的数字（一个都不能少）**：`329`、`13 次 / 38,326 tokens`、`14 项`、`11 节点 11 边`、
`19 个错误码`、`15 条未完成`、`25 秒 → 10 秒`。
**主动放弃的数字（留在页面上）**：容器体积与冷构建（⚠️ 屏幕现写 169.36 MiB / 冷构建 1.720 s，
**已被 01:13:59 的重建刷新为 169.66 MiB / 3.662 s**——引用前必须统一口径，见
《页映射与矛盾核对-2026-10-31.md》）、单机内存区间、
`39` 阶段 C、`46` 探针、`59` HTTP 冒烟、`55` 样例级一致、`45` 边界套件。

### 实测结果

| 段 | 页 | 内容 | 字数 | 实测秒 | 累计时间码 |
| --- | --- | --- | ---: | ---: | --- |
{table(r4)}

**4 分钟版合计：{_fmt(t4)}（{t4:.1f}s），{c4} 字，{verdict4}**
（对 4:00 的超出部分是刻意保留的缓冲；若必须严格 4:00，再删 `S6` 整段 ≈29s）

---

## 二、6 分钟版：补哪几段

**触发条件**：主持人明确说"可以讲到 6 分钟"，或答辩现场允许加时。

### 增补决策表

| 增补段 | 插在哪 | 补什么 | 为什么值得补 |
| --- | --- | --- | --- |
| `A1` | `S1` 之后 | 与"再给几个点子"的礼物助手做对比 | 一句话讲清差异化，是评委判断"场景价值"的关键 |
| `A2` | `S2` 之后 | 追求对象场景的硬约束（不假定双向好感、不用玫瑰） | 产品的最高优先场景，也是最有说服力的细节 |
| `A3` | `S4` 之后 | 选后四段呈现的设计（配色/包装/贺卡/赠送时机） | 说明"选完才生成"的完整产品闭环，**并明确它尚未实现** |
| `A5` | `S5` 之后 | 边界 45 项独立套件 + 一条命令的复核入口 | 直接对应"工程完成度"评分维度 |
| `A6` | `S7` 之后 | 上云的路线与边界（路线 C：未采购、未上传） | 把"为什么没上云"从缺口讲成主动的边界选择 |
| `A4` | 替换 `S10` | 完整版缺陷闭环，含"健康检查一直 200 掩盖了缺陷" | 这是"为什么需要独立测试"最有说服力的例证 |

**注意**：6 分钟版**不是**把 5 分钟版注水，而是**加信息密度**。所有增补内容都来自
仓库里已有的证据或已在幻灯片上披露的条目，**没有新增任何未验证的声明**。

### 实测结果

| 段 | 页 | 内容 | 字数 | 实测秒 | 累计时间码 |
| --- | --- | --- | ---: | ---: | --- |
{table(r6)}

**6 分钟版合计：{_fmt(t6)}（{t6:.1f}s），{c6} 字，{verdict6}**

---

## 三、最该砍掉的一句话（只有一句）

**`S5` 的「其余在页面上给出证据位置。」**

理由：这是纯导航语——证据位置就印在幻灯片上，评委自己看得到，说出来不增加任何信息，
却要花约 2.5 秒。**任何需要压缩的场合，先删这一句。**
（次选：`S3` 的「我们不信任前端的通过标记。」——它有价值但技术味偏重，约 2 秒；
在非技术评委占多数时也可以先删。）

## 四、两套版本的取舍原则

1. **删修饰，不删数字**。数字是评分证据；形容词、举例、导航语才是可裁的部分。
2. **删口头补充，不删幻灯片披露**。凡是"未完成"条目，即使口头不讲，**必须仍在页面上**。
   第 8 页的 15 条一条都不能因为时间紧就从幻灯片上消失。
3. **压缩段优先于压缩语速**。压语速会让评委听不清，比少讲一句更亏。
4. **不要在台上现场决定删什么**。上台前就把 4 分钟版的段落标记好（或直接准备两份 PPT 页码）。
"""
    (SPEECH / "应急版本-4分钟-6分钟.md").write_text(md, encoding="utf-8")

    print(f"4 分钟版：{_fmt(t4)}（{t4:.1f}s）  {c4} 字  {verdict4}")
    print(f"6 分钟版：{_fmt(t6)}（{t6:.1f}s）  {c6} 字  {verdict6}")
    import shutil
    shutil.rmtree(CACHE, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
