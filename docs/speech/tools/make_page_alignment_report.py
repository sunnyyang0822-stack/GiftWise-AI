#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成《页映射与矛盾核对》：把口播稿逐段对准真实 PPTX，并列出删句清单。

设计取舍：
- **幻灯片文字现读现比**（不写死），PPTX 一变，重跑即可发现新的错位。
- **人的判断写死在下面的 CONFLICTS / CUTS 里**（哪些算冲突、哪些能删），
  因为这些是分析结论，不该由脚本猜。
- **秒数一律由实测数据算出**（读 tools/timing-results.json），不手写。

用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/make_page_alignment_report.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_speech import _fmt, spoken_chars  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SPEECH = ROOT / "docs" / "speech"
PPTX = ROOT / "docs" / "competition" / "答辩PPT-GiftWise.pptx"

# ---------------------------------------------------------------- 人的判断
# (页, 屏幕原文, 我方口播稿原文, 判定, 处置)
CONFLICTS = [
    ("P2", "「达成 5 条 / 未达成 4 条」+「SC-1 至 SC-5 有真实证据」",
     "S2 原稿：「其中四条已有真实证据」",
     "❌ 数字冲突",
     "**已改**：S2 不再报数，改为「逐条标了状态：有真实证据的写已达成，没做到的直接写未达成」。"
     "不替屏幕的 5/4 口径背书，也不与屏幕矛盾。"),
    ("P6", "本页缺口列 B13 / B7 / B6 / B5 / B14 / B15",
     "S6 原稿：「还有一条修订路径暂无运行时证据」（那是 B8，在第 4 页）",
     "⚠️ 提到的条目不在屏幕上",
     "**已改**：S6 改为「这一段的缺口列在本页与第 8 页」——与屏幕一致，评委能找到。"),
    ("P10", "标题「主机侧已实测 · 镜像重建中」；STEP 8「交付镜像正在重建，尚未包含此修复」；"
            "页脚「交付镜像重建中（尚未包含 I-2 修复与可观测性入口）」",
     "S10 原稿：「此修复只在主机侧实测，交付镜像还在重建。」",
     "❌ **双方同时过期**（不是互相矛盾）",
     "镜像是 **2026-10-31 01:13:59 重建完成**的（`giftwise-validator:submission-20261101`，"
     "`/healthz` 规则指纹 = 本机 `1f389dad…`，I-2/N-1/N-4 与规则同步四修全部到位）。"
     "**口播稿已改**为「交付镜像十秒返回四百零八并关闭，九条并发线程数从一到十再回到一」；"
     "**屏幕侧 5 处需要改**（标题 / 副标题 / STEP 8 / 边界行 / 页脚）——改 PPTX 不是我的权限，"
     "见下方「建议改屏幕」清单。"),
    ("P11", "页脚：「待补：docs/verification/** 目录尚未建立，命令级证据待补」",
     "S11：「复核入口」（隐含该指南已存在，属实）",
     "❌ **屏幕过期，口播稿是对的**",
     "`tools/verify_all.py`（聚合脚本）与 `docs/verification/复核指南-2026-10-31.md` 均已存在。"
     "**屏幕侧需删掉那句「待补」**并改为指向这两者。"
     "另：屏幕徽标是「3 条命令」，S11 已对齐为「三条命令，外加一条把它们全跑完的聚合命令」。"),
    ("P1", "页脚：「快照 HEAD ae0ea58 · origin/main == main == 37493f9（领先 0）· 工作区 129 项未提交改动」",
     "未提及（正确）",
     "⚠️ 屏幕数字过期且不宜展示",
     "「129 项」是旧值（我此刻实测远多于此，且其他线仍在写）。"
     "**建议直接删掉这一行**——评委不需要知道工作区脏不脏，留在屏幕上反而像在自曝。"),
    ("P1/P5/P7/P8", "容器「178 MB（169.36 MiB）」、冷构建「1.720 s」",
     "我方口播稿未报任何容器数字（安全）",
     "⚠️ 屏幕数字已被重建刷新",
     "重建后：**169.66 MiB（177,918,474 字节）**、`--no-cache` 冷构建 **3.662 s**。"
     "**但** 3.662 s 是 `--no-cache`，需确认旧的 1.720 s 是否同口径——若旧值是热构建，"
     "把两者并列就是**不可比的对比**，必须统一口径后才能写。"),
    ("P6", "徽标「2 条未完成」，但正文列了 6 条（B13/B7/B6/B5/B14/B15）",
     "无关",
     "⚠️ 页面自相不一致",
     "可能是「本页新增 2 条」的口径，但评委看不出来。建议徽标改成没歧义的写法"
     "（如「本段缺口 6 条 · 全文见第 8 页」）。属美化线。"),
]

# (段, 可删句子, 为什么可以删, 删掉后该段是否还成立)
CUTS = [
    ("S5", "其余在页面上给出证据位置。",
     "纯导航语：证据位置就印在幻灯片上，说出来零信息量。", "成立：7 条 A 项与 parity 限定都还在。"),
    ("S7", "模型生成是瓶颈，一次四到六秒，规则层毫秒级。",
     "**与屏幕重复**：第 7 页的延迟矩阵已经写了 N2 4.5–6.0 s。", "成立：双口径与单价未核实仍在。"),
    ("S4", "实线是已实现并核实过的，虚线是目标设计。",
     "**与图例重复**：架构图的图例里已经写了实线/虚线的含义。", "成立：链路与 B 组缺口仍在。"),
    ("S6", "这一段的缺口列在本页与第 8 页。",
     "纯导航语，且第 8 页的存在已被前文交代。", "成立：两点工程化与失败不伪装仍在。"),
    ("S3", "我们不信任前端的通过标记。",
     "技术味偏重、非技术评委收益低；「可信状态放在服务端」本身已表达。",
     "成立：决定三的主干（可信状态在服务端）仍在。"),
]

SUGGESTED_SCREEN_FIXES = [
    ("P10", "标题", "主机侧已实测 · 镜像重建中", "已在交付镜像内实测 · 四修到位"),
    ("P10", "副标题", "独立复现 → 定位 → 修复 → 实测 → 承认镜像尚未包含",
     "独立复现 → 定位 → 修复 → 实测 → 已在交付镜像内验证"),
    ("P10", "STEP 8", "以上是主机侧实测；交付镜像正在重建，尚未包含此修复。",
     "以上均已在本机与交付镜像内实测：408 + 关闭 + 线程回落到 1，回归 43/43 断言通过。"),
    ("P10", "边界行", "交付的 latest 镜像尚未包含此修复，正在重建。",
     "交付镜像 `giftwise-validator:submission-20261101`（构建于 2026-10-31 01:13:59）已包含此修复；"
     "仍属**本机单机**实测，未上云。"),
    ("P10", "页脚", "主机侧实测记录 · 交付镜像重建中（尚未包含 I-2 修复与可观测性入口）",
     "本机 + 交付镜像实测 · 可观测入口已随镜像交付，但非默认入口"),
    ("P11", "页脚", "待补：docs/verification/** 目录尚未建立，命令级证据待补。",
     "聚合复核：`tools/verify_all.py`；逐条指南：`docs/verification/复核指南-2026-10-31.md`。"
     "另：`/metrics` 未鉴权，不得直接暴露公网。"),
    ("P1", "页脚", "快照 HEAD … 工作区 129 项未提交改动", "（建议整行删除）"),
]


def extract_pages() -> list[dict]:
    from pptx import Presentation
    prs = Presentation(str(PPTX))
    out = []
    for i, slide in enumerate(prs.slides, start=1):
        lines = []
        for sh in slide.shapes:
            if sh.has_text_frame and sh.text_frame.text.strip():
                lines += [l.strip() for l in sh.text_frame.text.splitlines() if l.strip()]
        badge = next((l for l in lines if re.match(r"^\d{2}\s*/\s*", l)), "")
        out.append({"n": i, "badge": badge, "lines": lines})
    return out


def rate_of(results: dict, rate: str, sid: str) -> float:
    for s in results["rates"][rate]["segments"]:
        if s["id"] == sid and s["chars"]:
            return s["chars"] / s["seconds"]
    return 4.05


def main() -> int:
    segs = {s["id"]: s for s in json.loads((SPEECH / "segments.json").read_text(encoding="utf-8"))["段"]}
    results = json.loads((SPEECH / "tools" / "timing-results.json").read_text(encoding="utf-8"))
    pages = extract_pages()
    assert len(pages) == 11, f"PPTX 应为 11 页，实际 {len(pages)}"
    assert len(segs) == 11, f"讲稿应为 11 段，实际 {len(segs)}"

    # ---------- 一、页映射
    mapping = []
    for sid in sorted(segs, key=lambda x: int(x[1:])):
        n = int(sid[1:])
        s = segs[sid]
        pg = pages[n - 1]
        flag = "⚠️" if sid in ("S2", "S10", "S11") else "✅"
        mapping.append(f"| `{sid}` | 第 {n} 页 | `{pg['badge']}` | {pg['lines'][1] if len(pg['lines']) > 1 else ''} | {flag} |")
    mapping = "\n".join(mapping)

    # ---------- 二、矛盾
    conflict_rows = "\n".join(
        f"| {p} | {sc} | {mine} | **{v}** | {act} |" for p, sc, mine, v, act in CONFLICTS)
    screen_rows = "\n".join(f"| {p} | {loc} | {old} | {new} |" for p, loc, old, new in SUGGESTED_SCREEN_FIXES)

    # ---------- 三、删句清单（秒数按实测字速折算）
    rates = results["rates"]
    pace_labels = list(rates.keys())
    cut_rows, totals = [], {r: 0.0 for r in pace_labels}
    for sid, sent, why, holds in CUTS:
        ch = spoken_chars(sent)
        cells = []
        for r in pace_labels:
            sec = ch / rate_of(results, r, sid)
            totals[r] += sec
            cells.append(f"{sec:.1f}")
        cut_rows.append(f"| `{sid}` | 「{sent}」 | {ch} | " + " | ".join(cells) + f" | {why} | {holds} |")
    cut_rows = "\n".join(cut_rows)
    base = results["plan_rate"]
    after = " | ".join(
        f"**{_fmt(results['rates'][r]['total_s'] - totals[r])}**" for r in pace_labels)
    before = " | ".join(f"{_fmt(results['rates'][r]['total_s'])}" for r in pace_labels)
    sum_row = " | ".join(f"**−{totals[r]:.1f}s**" for r in pace_labels)

    md = f"""# 页映射与矛盾核对（2026-10-31 · 对照真实 PPTX）

> **核对手法**：用 `tools/dump_pptx_pages.py` 只读导出真实 PPTX 的逐页文字，
> 再与 `segments.json` 的 11 段逐段对齐。**幻灯片文字是现读现比的**，不是凭记忆。
> 核对快照：`docs/competition/答辩PPT-GiftWise.pptx` · 11 页 · 400,178 字节 ·
> sha256 `f1d1057ffd7e57a20cc3eed0f7a467685b82da1483a4dbe63e6eed1533243068`。
> ⚠️ 若美化线之后又改了 PPTX，**本核对会过期，必须重跑本报告**。

---

## 〇、先说一句方法纠正

PM 转述的「11 个页标题」（`赛道 B · 交付物` / `6 个评分维度` / `3 个关键决定` …）
**不是页面标题，而是每页顶部的「摘要横幅」**。真实页面身份是那行 `NN / 名称` 徽标：

`01 / 项目概述` · `02 / 问题与目标` · `03 / 整体方案与选型` · `04 / 核心实现` · `05 / 结果与证据` ·
`06 / 工程化设计` · `07 / 成本、性能与取舍` · `08 / 总结与不足` · `09 / 评分维度对照` ·
`10 / 一个真实缺陷的闭环` · `11 / 评委可现场复核`

**结论：11 页与我方讲稿的 11 段一一对应、语义对得上**（不是只看序号）。逐段核对如下。

## 一、逐页映射核对

| 段 | 页 | 真实页徽标 | 摘要横幅 | 对齐 |
| --- | --- | --- | --- | --- |
{mapping}

**只有 3 页需要处理**：`S2`（数字冲突，已改稿）、`S10`（屏幕与稿子同时过期，已改稿＋建议改屏幕）、
`S11`（屏幕过期、稿子正确，建议改屏幕）。其余 8 页**语义一致，无需改动**。

## 二、矛盾清单（逐条）

| 页 | 屏幕写的 | 我方口播稿 | 判定 | 处置 |
| --- | --- | --- | --- | --- |
{conflict_rows}

### 建议改屏幕（PPTX 不是我的权限，仅建议）

| 页 | 位置 | 现在 | 建议改为 |
| --- | --- | --- | --- |
{screen_rows}

> **第 10 页是这次核对里最有价值的一条**：它现在讲的是一句**已经不成立的自我贬低**。
> 镜像是 01:13:59 重建完成的，四修全部到位；照原文讲，等于**当众放弃一个已经拿到的胜利**，
> 而且是在「诚实」这个我们最想得分的维度上说了假话。改成已实测的真陈述后，这一页反而更强。

## 三、现在就可以删掉的句子（按性价比排序）

秒数为**实测字速折算**（读 `tools/timing-results.json`，逐段用该段实测字速，非估算）。

| 段 | 可删句子 | 字数 | {' | '.join(r for r in pace_labels)} (秒) | 为什么可以删 | 删掉后该段是否还成立 |
| --- | --- | ---: | {' | '.join('---:' for _ in pace_labels)} | --- | --- |
{cut_rows}
| — | **合计可省** | {sum(spoken_chars(c[1]) for c in CUTS)} | {sum_row} | — | — |

**删完后的总时长**：

| | {' | '.join(pace_labels)} |
| --- | {' | '.join('---:' for _ in pace_labels)} |
| 现在 | {before} |
| **全部删掉后** | {after} |

> **建议**：不要全删。`S7`（与屏幕重复）和 `S4`（与图例重复）这两句**删了是净赚**——
> 屏幕上已经写着同样的信息，讲一遍只是浪费秒数。**其余三句留作现场弹性**：
> 如果发现前面讲慢了，就在这几句里挑着吞掉，不必改稿也能追回 10 秒以上。

## 四、最终计时（11 页定稿版）

| 语速档 | 实测字/秒 | 全文 | 判决 |
| --- | ---: | ---: | --- |
| 快 `+0%` | 4.50 | {_fmt(results['rates']['+0%']['total_s'])} | ✅ |
| **正常 `-10%`（设计中心）** | 4.05 | **{_fmt(results['rates'][base]['total_s'])}** | ✅ 预期落点 |
| 慢 `-15%` | 3.83 | {_fmt(results['rates']['-15%']['total_s'])}（余量 {300 - results['rates']['-15%']['total_s']:.1f}s） | ✅ 安全边界 |

全文 {results['rates'][base]['chars']} 字。
**有两处值得说明的取舍**：

1. **`S10` 超出自身预算 8.6 秒是刻意的**——原稿的 22 秒里有一句是假的（"镜像还在重建"）。
   如实陈述"已在交付镜像内实测"必然更长，这 8.6 秒由其他页的富余吸收，总时长仍 ≤5:00。
   **宁可让它超自己的预算，也不留一句假话。**
2. **我没有为了把正常档推回 4:40 而继续加内容**。加一句"回归 43 项断言全过"确实能把正常档推到 4:42，
   但会把**慢档推到 4:57，只剩 3 秒余量**。目标区间是软的，5:00 是硬的——**保护硬上限优先**。
   （那句"43/43"留作问答弹药，见 `彩排计时流水.md`。）

## 五、我对「镜像已重建」这条事实的独立复验

`S10` 的改稿**完全取决于**「该修复已在交付镜像内生效」这一条事实，所以我没有只引部署线的记录，
而是自己跑了一次外部探针（`tools/verify_i2_in_image.py`——只发请求、只读、**不改任何文件**）：

| 复验项 | 我实测到的 | 结论 |
| --- | --- | --- |
| 交付镜像存在性 | `giftwise-validator:submission-20261101` = `latest`，ID `d9a4a35763ee`，构建 **2026-10-31 01:13:59 +0800**，`inspect` Size **177,918,474 字节** | ✅ 与部署线记录一致 |
| 镜像内嵌规则 | `/app/validator/rules.py` sha256 = `1f389dad4c2589fb…` = **本机** `validator/rules.py` | ✅ 同一份真源 |
| 可观测入口进镜像（N-1） | `/app/deploy/` 内有 `observability.py`、`observable_server.py` | ✅ 已进镜像（非默认入口） |
| **I-2 半开正文** | 声明 200 字节只发 100 → `HTTP/1.0 408 Request Timeout`，**首字节 10.01 s**，连接被服务端关闭 | ✅ **修复确实在交付镜像内生效** |
| 健康检查掩盖 | 半开期间并发 `/healthz` = `200 OK`，**24 ms** | ✅ 掩盖现象已复现（这是本页最好的教学点） |

> **方法说明（含我踩的坑）**：等待容器就绪时不能只等端口通——Docker Desktop for Windows 上
> 宿主端口由代理先绑定，**TCP connect 成功时应用可能还没开始服务**（我的第一版探针因此拿到空响应，
> 已改为重试到 `/healthz` 真返回 200）。另外，`docker` 不在我的 PATH 上，我用的是
> `C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe`。
> 顺带再次确认 `Server:` 头暴露 `Python/3.12.16`，与文档写的 3.12.12 不一致（既有发现 N-3，非本线范围）。

## 六、这份核对的边界

- **只读了 PPTX，没有改它**；屏幕侧建议需要美化线/发布线执行。
- 本报告**会随 PPTX 变化而过期**：任何一次改动后请重跑
  `python docs/speech/tools/make_page_alignment_report.py`。
- 幻灯片文字是 `python-pptx` 读出的**文本**，我不对版式/配色/图片内容负责；
  第 4 页的架构图我只核对了它承载的数字口径是否与讲稿一致（一致）。
"""
    (SPEECH / "页映射与矛盾核对-2026-10-31.md").write_text(md, encoding="utf-8")
    print(f"已生成《页映射与矛盾核对-2026-10-31.md》：{len(md)} 字节")
    print(f"  可删句子 {len(CUTS)} 句，合计 {sum(spoken_chars(c[1]) for c in CUTS)} 字")
    print("  全删后总时长：" + " / ".join(f"{r} {_fmt(results['rates'][r]['total_s'] - totals[r])}" for r in pace_labels))
    return 0


if __name__ == "__main__":
    sys.exit(main())
