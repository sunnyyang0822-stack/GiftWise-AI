#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""追平 PM 修订版 PPTX（讲稿与计时线，docs/speech 独占）。

背景：`docs/competition/答辩PPT-GiftWise-修订版-2026-10-31.pptx` 已由 PM 把屏幕侧
7 处过期项全部改掉，而 `docs/speech/**` 的讲稿与注记仍停在「屏幕上写错了」的旧状态。
照旧稿念就会**当众与屏幕自相矛盾**（比数字旧更危险）。本脚本把口播稿侧追平：
只改 `screen` / `claim` 注记与一处口播句，**不改结构与语气**。

每条替换都带断言（必须恰好命中 1 次），避免静默改错。
**不联网、不合成音频。**

用法（仓库根目录）：
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" docs/speech/tools/apply_pptx_revision_alignment.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SPEECH = Path(__file__).resolve().parents[1]

REVISED = "docs/competition/答辩PPT-GiftWise-修订版-2026-10-31.pptx"
ORIGINAL = "docs/competition/答辩PPT-GiftWise.pptx"

# ---------------------------------------------------------------- 主稿（segments.json）
# 1) 第 2 页：修订版整表重写 —— A 5 条 = SC-2/3/7/8/9、B 4 条 = SC-1/4/5/6，备注页写明 SC-8 升 A。
S2_SCREEN_OLD = ("第 2 页 · 02 / 问题与目标：五个痛点 P-1…P-5 + SC-1…SC-9 状态表"
                 "（屏幕写「达成 5 条 / 未达成 4 条」）")
S2_SCREEN_NEW = ("第 2 页 · 02 / 问题与目标：五个痛点 P-1…P-5 + SC-1…SC-9 状态表"
                 "（屏幕写「达成 5 条 / 未达成 4 条」，A 5 条 = SC-2/3/7/8/9、B 4 条 = SC-1/4/5/6；"
                 "备注页写明 SC-8 已由 100 项浏览器验收升为 A）")

# 2) 第 4 页：架构图标注换成修订版真实标注；B 组编号由 B5/B6/B7/B8/B9/B1 换成 B1-1…B4-15 体系。
S4_SCREEN_OLD = ("第 4 页 · 04 / 核心实现：架构图 1680×1170（图片 5.80×4.04 in）+ 11 节点 11 边 + "
                 "A 组 5 条 / B 组 6 条（B5 trace、B6 N4 ELSE、B7 无自然证据、B8 修订路径、"
                 "B9 Dify 呈现、B1 云）")
S4_SCREEN_NEW = ("第 4 页 · 04 / 核心实现：架构图 1680×1170 · 74 组版（2026-10-31）+ 11 节点 11 边 + "
                 "A 组 5 条 / B 组 6 条（B2-5 trace、B2-6 N4 ELSE、B2-7 无自然证据、"
                 "B2-8 修订路径、B2-9 Dify 呈现、B1-1 云）")

# 3) 第 5 页口播：修订版 B4-15 已写「越界网格已覆盖，唯一残差 1 例（两侧都拒绝）」，
#    而原口播还在说「样例集里没有越界数值，正在补」——那是**已过期的自我贬低**，必须追平。
#    ⚠️ 同时删掉口语引导词「补一句限定：」（6 字）作为等字数补偿，
#       使 S5 字数保持 126 → 全文 1127 字不变 → 计时线（4:10.2 / 4:37.9 / 4:54.3）一个字都不用重算。
S5_TAIL_OLD = "补一句限定：接入层与规则层的一致性是样例级，样例集里没有越界数值，正在补。"
S5_TAIL_NEW = "接入层与规则层的一致性是样例级；越界网格已覆盖，仅剩一例残差、两侧都拒绝。"

# 4) 第 6 页：修订版徽标写「6 条未完成」，缺口编号换成 B2-5/B2-6/B2-7/B4-13/B4-14/B4-15。
S6_SCREEN_OLD = ("第 6 页 · 06 / 工程化设计：可复现性 + 异常处理（规则码 19 个 / 关系 8 个 / "
                 "亲密度 5 档）+ 可靠性可观测性 + 本段缺口 B5/B6/B7/B13/B14/B15")
S6_SCREEN_NEW = ("第 6 页 · 06 / 工程化设计：可复现性 + 异常处理（规则码 19 个 / 关系 8 个 / "
                 "亲密度 5 档）+ 可靠性可观测性 + 本段缺口 6 条（B2-5 trace / B2-6 N4 ELSE / "
                 "B2-7 无自然证据 / B4-13 可观测入口非默认 / B4-14 前端 100 项浏览器验收 / "
                 "B4-15 parity 残差 1 例），页首徽标「6 条未完成」")

# 5) 第 6 页唯一主张：修订版 B4-13 的真实口径是「已随镜像交付但非默认（/metrics 默认 404、未鉴权）」。
S6_CLAIM_OLD = "零依赖可复现，失败就是失败；可观测入口已实现但未进默认镜像。"
S6_CLAIM_NEW = ("零依赖可复现，失败就是失败；可观测入口已随镜像交付但非默认"
                "（/metrics 默认 404、未鉴权）、未实测。")

# 6) 第 10 页：屏幕侧已落地（徽标「镜像 01:13:59 已重建」+ STEP 8 容器内 10.01 s 返 408 并关闭）。
S10_SCREEN_OLD = ("第 10 页 · 10 / 一个真实缺陷的闭环：STEP 1–8 + 线程数 1→10→1 + "
                  "「/healthz 全程 200 会掩盖缺陷」　⚠️ **本页标题与 STEP 8／页脚仍写「镜像重建中」，"
                  "已过期**（镜像 01:13:59 已重建完成）——建议美化线改，见《页映射与矛盾核对》")
S10_SCREEN_NEW = ("第 10 页 · 10 / 一个真实缺陷的闭环：STEP 1–8 + 线程数 1→10→1 + "
                  "「/healthz 全程 200 会掩盖缺陷」+ 页首徽标「镜像 01:13:59 已重建」+ "
                  "STEP 8 与页脚「交付镜像 01:13:59 已重建、容器内同样 10.01 s 返 408 并关闭连接」")

# 7) 第 11 页：屏幕侧页脚已改为「已建立」。
S11_SCREEN_OLD = ("第 11 页 · 11 / 评委可现场复核：规则指纹 1f389dad… + 三条命令　"
                  "⚠️ **页脚「docs/verification 尚未建立」已过期**（该目录 00:56 已建、"
                  "指南与聚合脚本都在）——建议美化线改")
S11_SCREEN_NEW = ("第 11 页 · 11 / 评委可现场复核：规则指纹 1f389dad… + 三条命令 + 页脚"
                  "「docs/verification/** 已建立（复核指南 + tools/verify_all.py 聚合脚本）。"
                  "/metrics 目前未鉴权，不得直接暴露到公网」")

VERSION_OLD = "2026-10-31 讲稿与计时线（独立线）v3（三档语速全部收紧到 5:00 内）"
VERSION_NEW = ("2026-10-31 讲稿与计时线（独立线）v4（追平 PM 修订版 PPTX：屏幕注记与 S5 parity 句对齐；"
               "总字数仍 1127、三档计时线不变）")

CROSSCHECK_OLD = ("2026-10-31 对照真实 PPTX（11 页）逐页正文核对；屏幕侧过期项见 "
                  "docs/speech/页映射与矛盾核对-2026-10-31.md")
CROSSCHECK_NEW = (f"2026-10-31 对照 {REVISED}（11 页）逐页正文核对；原件 {ORIGINAL} 未动。"
                  "屏幕侧原有的 7 处过期项已由 PM 修订版全部落地，本文件与讲稿已追平。"
                  "详见 docs/speech/页映射与矛盾核对-2026-10-31.md")

ALIGN_NOTE = {
    "_追平说明": (
        "2026-10-31 追平 PM 修订版 PPTX（原件未动，修订版另存 "
        f"{REVISED}）：① S4 架构图标注改为「74 组版（2026-10-31）」；"
        "② B 组编号由旧的 B1…B15 换成屏幕现行的 B1-1…B4-15 体系（S4/S6）；"
        "③ S6 主张改为「可观测入口已随镜像交付但非默认（/metrics 默认 404、未鉴权）、未实测」；"
        "④ S5 口播「样例集里没有越界数值，正在补」→「越界网格已覆盖，仅剩一例残差、两侧都拒绝」，"
        "同时删掉口语引导词「补一句限定：」作等字数补偿，S5 仍 126 字、全文仍 1127 字；"
        "⑤ S10/S11 的「屏幕尚未改」注记已过时，改成修订版真实屏幕文字。"
    ),
    "_冷构建口径": (
        "投影第 7 页写冷构建 1.720 s（10-30 构建基线），10-31 重建版 --no-cache 实测 3,662 ms。"
        "两次测量条件不同、口径未并轨 ⇒ **只报两个数，不宣称变快或变慢**。"
        "现场口播按投影说 1.720 s，被追问才补 3,662 ms 并说明两口径不可比。"
    ),
}

# ---------------------------------------------------------------- 4 / 6 分钟版
S10_4MIN_SCREEN_OLD = "第 10 页：25 秒零响应 → 10 秒 408；「主机侧已实测，镜像重建中」"
S10_4MIN_SCREEN_NEW = ("第 10 页：25 秒零响应 → 10 秒 408；页首徽标「镜像 01:13:59 已重建」；"
                       "「容器内同样 10.01 s 返 408 并关闭」")


def patch(path: Path, edits: list[tuple[str, str]], as_json: bool = True) -> int:
    raw = path.read_text(encoding="utf-8")
    n = 0
    for old, new in edits:
        hits = raw.count(old)
        assert hits == 1, f"{path.name}: 期望命中 1 次，实际 {hits} 次 → {old[:40]!r}"
        raw = raw.replace(old, new)
        n += 1
    if as_json:
        json.loads(raw)  # 语法自检：不合格就抛错，不落盘
    path.write_text(raw, encoding="utf-8")
    return n


def bump(mapping: dict, key: str, old: str, new: str) -> None:
    assert mapping[key] == old, f"{key} 实际是 {mapping[key]!r}"
    mapping[key] = new


def main() -> int:
    # ---- 主稿：先按 id 定位段，再改 screen / claim（避免整文件字符串替换误伤）
    p_main = SPEECH / "segments.json"
    d = json.loads(p_main.read_text(encoding="utf-8"))
    seg = {s["id"]: s for s in d["段"]}
    assert len(seg) == 11, f"主稿应为 11 段，实际 {len(seg)}"

    for sid, field, old, new in (
        ("S2", "screen", S2_SCREEN_OLD, S2_SCREEN_NEW),
        ("S4", "screen", S4_SCREEN_OLD, S4_SCREEN_NEW),
        ("S6", "screen", S6_SCREEN_OLD, S6_SCREEN_NEW),
        ("S6", "claim", S6_CLAIM_OLD, S6_CLAIM_NEW),
        ("S10", "screen", S10_SCREEN_OLD, S10_SCREEN_NEW),
        ("S11", "screen", S11_SCREEN_OLD, S11_SCREEN_NEW),
    ):
        assert seg[sid][field] == old, f"segments.json {sid}.{field} 与预期不符"
        seg[sid][field] = new
        print(f"  ✅ segments.json {sid}.{field} 已追平")

    assert seg["S5"]["text"].endswith(S5_TAIL_OLD), "segments.json S5 结尾与预期不符"
    seg["S5"]["text"] = seg["S5"]["text"][: -len(S5_TAIL_OLD)] + S5_TAIL_NEW
    print("  ✅ segments.json S5.text 末尾已追平（parity 已覆盖越界网格）")

    bump(d, "_版本", VERSION_OLD, VERSION_NEW)
    bump(d, "_页映射已核对", CROSSCHECK_OLD, CROSSCHECK_NEW)
    for k, v in ALIGN_NOTE.items():
        assert k not in d, f"segments.json 已存在 {k}"
        d[k] = v
    print("  ✅ segments.json 注释键已更新（_版本 / _页映射已核对 / +2 条口径说明）")
    p_main.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- 4 分钟版
    p4 = SPEECH / "segments-4min.json"
    d4 = json.loads(p4.read_text(encoding="utf-8"))
    s4 = {s["id"]: s for s in d4["段"]}
    assert s4["S5"]["text"].endswith(S5_TAIL_OLD), "4 分钟版 S5 结尾与预期不符"
    s4["S5"]["text"] = s4["S5"]["text"][: -len(S5_TAIL_OLD)] + S5_TAIL_NEW
    assert s4["S10"]["screen"] == S10_4MIN_SCREEN_OLD, "4 分钟版 S10.screen 与预期不符"
    s4["S10"]["screen"] = S10_4MIN_SCREEN_NEW
    p4.write_text(json.dumps(d4, ensure_ascii=False, indent=2), encoding="utf-8")
    print("  ✅ segments-4min.json S5.text + S10.screen 已追平")

    # ---- 6 分钟版
    p6 = SPEECH / "segments-6min.json"
    d6 = json.loads(p6.read_text(encoding="utf-8"))
    s6 = {s["id"]: s for s in d6["段"]}
    assert s6["S5"]["text"].endswith(S5_TAIL_OLD), "6 分钟版 S5 结尾与预期不符"
    s6["S5"]["text"] = s6["S5"]["text"][: -len(S5_TAIL_OLD)] + S5_TAIL_NEW
    p6.write_text(json.dumps(d6, ensure_ascii=False, indent=2), encoding="utf-8")
    print("  ✅ segments-6min.json S5.text 已追平")

    # ---- 字数复核（等字数补偿是否成立）
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from measure_speech import spoken_chars  # noqa: E402

    for path, name in ((p_main, "主稿"), (p4, "4 分钟版"), (p6, "6 分钟版")):
        dd = json.loads(path.read_text(encoding="utf-8"))
        total = sum(spoken_chars(s["text"]) for s in dd["段"])
        print(f"  · {name}：{total} 字")

    print("\n追平完成（未联网、未重新合成音频）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
