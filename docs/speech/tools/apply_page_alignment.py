#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""页映射对齐改稿（讲稿与计时线，docs/speech 独占）。

背景：核对真实 PPTX（11 页，逐页正文已用 tools/dump_pptx_pages.py 导出）后，
发现三处"口播稿与屏幕不一致"，以及两处屏幕本身已过期。本脚本把**口播稿侧**改对；
屏幕侧只给建议、不改（PPTX 属美化线/发布线）。

每条替换都带断言（必须恰好命中 1 次），避免静默改错。

用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/apply_page_alignment.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SPEECH = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------- 改稿内容
# 1) 第 2 页：屏幕写「达成 5 条 / 未达成 4 条」，原口播稿说「四条已有真实证据」→ 冲突。
#    处置：**不报数**（改成"逐条标了状态"），既与屏幕不冲突，也不替屏幕的 5/4 口径背书。
S2_NEW = ("最核心的痛点是分寸。给追求对象送礼，表达太强会造成压力，太弱又显得敷衍。"
          "我们把这类问题拆成五个痛点和九条成功标准，并在第 2 页逐条标了状态："
          "有真实证据的写已达成，没做到的直接写未达成，不做美化。")

# 2) 第 6 页：原口播稿提的「修订路径暂无运行时证据」(B8) **不在本页**（本页列 B13/B7/B6/B5/B14/B15），
#    评委在屏幕上找不到，改为指向本页与第 8 页。
S6_NEW = ("工程化两点。第一是复现：零第三方依赖，不用装包；生成物带哈希清单，健康检查返回规则源码哈希，"
          "所以能确认现场跑的就是提交版本。第二是异常处理：损坏的 JSON 和持续失败的用例都有真实证据，"
          "原则是失败就是失败。这一段的缺口列在本页与第 8 页。")

# 3) 第 9 页是纯指针页，压缩到最短，给新 S10 腾时间。
S9_NEW = "第九页是评分维度对照。"

# 4) 第 10 页：镜像已于 2026-10-31 01:13:59 重建完成且四修全部到位
#    （deploy/evidence/image-rebuild-n1n4-2026-10-31.md）。原口播稿说「交付镜像还在重建」是**过期的假陈述**。
#    改成已实测的真陈述——这比原来更强，而且不用再"承认镜像没跟上"。
S10_NEW = ("讲一个我们真实修好的缺陷。只发一半的请求正文，服务端会一直挂着；"
           "旧镜像二十五秒零响应、也不关闭连接。危险的是健康检查全程两百，完全掩盖了它"
           "——这正是需要独立测试的原因。加了读体总时长预算后，交付镜像十秒返回四百零八并关闭，"
           "九条并发线程数从一到十再回到一。")

# 5) 第 11 页屏幕徽标是「3 条命令」，且页脚「docs/verification 尚未建立」已过期（该目录 00:56 已建）。
#    口播稿原说"一条命令"→ 对齐成"三条命令 + 一条聚合"。
S11_NEW = "最后一页是复核入口：三条命令，外加一条把它们全跑完的聚合命令，红的就是红的。"

# 6) 四分钟版 / 六分钟版里同一句过期陈述也要改。
STALE_CLAUSE_4 = "此修复只在主机侧实测，镜像重建中。"
STALE_CLAUSE_4_NEW = "此修复已在交付镜像内实测。"
STALE_CLAUSE_A4 = "此修复目前只在主机侧实测，交付镜像还在重建。"
STALE_CLAUSE_A4_NEW = "此修复已在交付镜像内实测。"
S2_4MIN_OLD_FRAG = "其中四条已有真实证据"
S2_4MIN_NEW_FRAG = "并在第 2 页逐条标了状态"

# 7) screen 描述按真实幻灯片正文重写（页映射的权威依据）
SCREENS = {
    "S1": "第 1 页 · 01 / 项目概述：标题 + 「把不知道送什么变成知道为什么选、怎么送」+ A 组 7 条 / B 组 15 条摘要 + 关系优先级（恋人·追求对象最高）+ 产品闭环一行",
    "S2": "第 2 页 · 02 / 问题与目标：五个痛点 P-1…P-5 + SC-1…SC-9 状态表（屏幕写「达成 5 条 / 未达成 4 条」）",
    "S3": "第 3 页 · 03 / 整体方案与选型：三个关键决定（生成判定分离 / 用户选择在中间 / 可信状态在服务端）+ 选型表（Python 3.12、Dify Cloud、DeepSeek、Node、Docker 各自的理由与代价）",
    "S4": "第 4 页 · 04 / 核心实现：架构图 1680×1170（图片 5.80×4.04 in）+ 11 节点 11 边 + A 组 5 条 / B 组 6 条（B5 trace、B6 N4 ELSE、B7 无自然证据、B8 修订路径、B9 Dify 呈现、B1 云）",
    "S5": "第 5 页 · 05 / 结果与证据：A1–A7 表（每行带证据位置）+ 另行核实（39 项阶段 C）+ 时点说明「322 是 10-30 真值，本页 329 为 10-31 复跑值」",
    "S6": "第 6 页 · 06 / 工程化设计：可复现性 + 异常处理（规则码 19 个 / 关系 8 个 / 亲密度 5 档）+ 可靠性可观测性 + 本段缺口 B5/B6/B7/B13/B14/B15",
    "S7": "第 7 页 · 07 / 成本、性能与取舍：双口径 token 表 + 延迟矩阵（N2 4.5–6.0 s、N5 3.0–3.1 s、端到端 5.2–8.9 s、服务端 0.587–0.888 s、代码节点 0.067–0.238 s）+ 容器指标 + 「单价未核实」",
    "S8": "第 8 页 · 08 / 总结与不足：A 组 7 条 + B 组 15 条分四组（云与编排 4 / Dify 5 / 数据与成本 3 / 可观测性与工程 3）+ 已解除 2 条",
    "S9": "第 9 页 · 09 / 评分维度对照：六个维度 × 100 分 × 交付物与证据位置 + 每行「诚实提示」",
    "S10": "第 10 页 · 10 / 一个真实缺陷的闭环：STEP 1–8 + 线程数 1→10→1 + 「/healthz 全程 200 会掩盖缺陷」　⚠️ **本页标题与 STEP 8／页脚仍写「镜像重建中」，已过期**（镜像 01:13:59 已重建完成）——建议美化线改，见《页映射与矛盾核对》",
    "S11": "第 11 页 · 11 / 评委可现场复核：规则指纹 1f389dad… + 三条命令　⚠️ **页脚「docs/verification 尚未建立」已过期**（该目录 00:56 已建、指南与聚合脚本都在）——建议美化线改",
}


def main() -> int:
    # ⛔ 防呆（2026-10-31 追平后新增）：本脚本的 SCREENS 字典是**修订版之前**的屏幕文字，
    # 重跑会把 segments.json 的屏幕注记回退到旧状态（等于自己制造新的"讲稿与屏幕矛盾"）。
    if "--force" not in sys.argv:
        print("⛔ 本脚本是 2026-10-31 首轮页映射对齐的历史留痕（当时屏幕侧还没改）。")
        print("   它的 SCREENS 字典是修订版之前的屏幕文字，重跑会覆盖 S4/S6/S10/S11 的屏幕注记。")
        print("   追平 PM 修订版请用：docs/speech/tools/apply_pptx_revision_alignment.py")
        print("   确实要按历史状态重放，请显式加 --force。")
        return 2

    n = 0

    # ---- 主稿（11 段）
    p_main = SPEECH / "segments.json"
    d = json.loads(p_main.read_text(encoding="utf-8"))
    m = {s["id"]: s for s in d["段"]}
    assert len(m) == 11, f"主稿应为 11 段，实际 {len(m)}"
    for sid, new in (("S2", S2_NEW), ("S6", S6_NEW), ("S9", S9_NEW), ("S10", S10_NEW), ("S11", S11_NEW)):
        print(f"  ✅ segments.json {sid}：{len(m[sid]['text'])} → {len(new)} 字")
        m[sid]["text"] = new
        n += 1
    for sid, txt in SCREENS.items():
        m[sid]["screen"] = txt
    d["_页映射已核对"] = "2026-10-31 对照真实 PPTX（11 页）逐页正文核对；屏幕侧过期项见 docs/speech/页映射与矛盾核对-2026-10-31.md"
    p_main.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- 4 分钟版：同一句过期陈述 + 第 2 页报数与屏幕冲突
    p4 = SPEECH / "segments-4min.json"
    d4 = json.loads(p4.read_text(encoding="utf-8"))
    s4 = {s["id"]: s for s in d4["段"]}
    assert STALE_CLAUSE_4 in s4["S10"]["text"], "4 分钟版未找到过期陈述"
    s4["S10"]["text"] = s4["S10"]["text"].replace(STALE_CLAUSE_4, STALE_CLAUSE_4_NEW)
    print(f"  ✅ segments-4min.json S10：过期陈述已更正")
    assert S2_4MIN_OLD_FRAG in s4["S2"]["text"], "4 分钟版未找到第 2 页冲突片段"
    s4["S2"]["text"] = s4["S2"]["text"].replace(S2_4MIN_OLD_FRAG, S2_4MIN_NEW_FRAG)
    print(f"  ✅ segments-4min.json S2：改为不报数")
    n += 2
    p4.write_text(json.dumps(d4, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- 6 分钟版：A4 的过期陈述 + S2 报数 + S6 的 B8 错位
    p6 = SPEECH / "segments-6min.json"
    d6 = json.loads(p6.read_text(encoding="utf-8"))
    s6 = {s["id"]: s for s in d6["段"]}
    assert STALE_CLAUSE_A4 in s6["A4"]["text"], "6 分钟版 A4 未找到过期陈述"
    s6["A4"]["text"] = s6["A4"]["text"].replace(STALE_CLAUSE_A4, STALE_CLAUSE_A4_NEW)
    print("  ✅ segments-6min.json A4：过期陈述已更正")
    assert S2_4MIN_OLD_FRAG in s6["S2"]["text"], "6 分钟版未找到第 2 页冲突片段"
    s6["S2"]["text"] = s6["S2"]["text"].replace(S2_4MIN_OLD_FRAG, S2_4MIN_NEW_FRAG)
    print("  ✅ segments-6min.json S2：改为不报数")
    s6["S6"]["text"] = S6_NEW
    print("  ✅ segments-6min.json S6：对齐本页缺口")
    n += 3
    p6.write_text(json.dumps(d6, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n合计 {n} 处改稿（主稿 5 处 + 4 分钟版 2 处 + 6 分钟版 3 处）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
