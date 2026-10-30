# -*- coding: utf-8 -*-
"""生成沙箱变体与补丁（绝不改动生产文件）。

做法：读取冻结的 validator/rules.py，**精确替换两个文本块**生成变体，
并用 difflib 直接产出 git 可用的 diff —— 这样补丁与变体必然一致，
不存在"手抄导致的差异"。

用法： python rulefix/make_variant.py
产物：
  rulefix/variant/rules_negfix.py
  rulefix/negation-fix.diff
"""
import difflib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "validator" / "rules.py"
OUT_VARIANT = ROOT / "rulefix" / "variant" / "rules_negfix.py"
OUT_DIFF = ROOT / "rulefix" / "negation-fix.diff"

# ---------------------------------------------------------------- 插入的辅助块
HELPER_ANCHOR = "def _candidate(candidate, index, context):"

HELPER_BLOCK = '''\
# ---------------------------------------------------------------------------
# 否定语境识别（规则门语义修复的最小实现）
#
# 目的：把「声明不含禁忌词」的表述视为**未命中**，消除"规则门奖励隐瞒、惩罚披露"。
# 边界：只做确定性的字面模式识别；**不做语义理解、不调用模型、不新增依赖**。
# 已知不可覆盖：中文无词边界，词条会命中更长词内部的子串（如词条「酒」命中「啤酒/饮酒」）。
# ---------------------------------------------------------------------------
_NEG_MARKERS = (
    "不含有", "不含任何", "不含", "未含有", "未含", "没有", "绝无", "无", "零",
    "不添加", "未添加", "不加", "不掺入", "不掺", "不使用", "不采用", "不涉及",
    "不带有", "不带", "不饮", "拒绝", "排除", "避免", "规避", "远离", "非",
    # 场景线建议清单里明确点名、且实测确有触发的一类（「用户明确不要酒」）
    "不要", "不想要", "无需", "无须",
)
_NEG_FILLERS = (
    "任何", "所有", "一切", "各种", "各类", "种类", "物质", "成分", "配料",
    "含量", "材料", "元素", "产品", "添加物", "的", "类",
)
_NEG_VERBS = ("含有", "包含", "使用", "添加", "掺入", "带有", "涉及", "采用", "含", "带")
_NEG_OF_NEG = ("不是", "并非", "不代表", "不意味", "谈不上", "不能说", "绝非", "不算")


def _alternation(values):
    """长词优先，避免「不含」被「不」抢先匹配。"""
    return "|".join(re.escape(v) for v in sorted(values, key=len, reverse=True))


# 否定前缀与具体词条无关 → 在模块级只拼装一次，避免每次调用重复构造（性能关键）。
# 词条部分交给 re 自身的编译缓存；**不引入任何自建缓存或共享可变状态**。
_NEG_PREFIX = ("(?:" + _alternation(_NEG_MARKERS) + ")"
               "(?:(?:" + _alternation(_NEG_FILLERS) + ")|(?:" + _alternation(_NEG_VERBS) + ")){0,2}")


def _negation_pattern(term):
    return re.compile(_NEG_PREFIX + "(?P<t>" + re.escape(term) + ")")


def _term_occurrences(text, term):
    """返回 (未被否定的出现次数, 被否定的出现次数)；纯字面模式识别。"""
    if term not in text:
        return 0, 0  # 快速路径：文本里根本没有该词条，无需跑正则（多数 (文本,词条) 组合走这条）
    negated = []
    for match in _negation_pattern(term).finditer(text):
        head = text[max(0, match.start() - 5):match.start()]
        if any(marker in head for marker in _NEG_OF_NEG):
            continue  # 双重否定：「并非不含X」的语义回到「含X」，不得视为声明不含
        negated.append((match.start("t"), match.end("t")))
    hits = negated_count = 0
    position = 0
    while True:
        index = text.find(term, position)
        if index < 0:
            break
        if (index, index + len(term)) in negated:
            negated_count += 1
        else:
            hits += 1
        position = index + 1
    return hits, negated_count


'''

# ---------------------------------------------------------------- 替换的判定循环
ORIG_BLOCK = '''\
        for text_path, text in texts:
            if any(term in _norm(text) for term in context["forbidden_terms"]):
                _error(errors, "FORBIDDEN_TERM", text_path, "文本包含明确禁止的字面词")'''

NEW_BLOCK = '''\
        for text_path, text in texts:
            normalized = _norm(text)
            hits = 0
            for term in context["forbidden_terms"]:
                if not term:
                    continue  # 防御性：空串在 _request 阶段已被拒绝，正常不可达
                hits += _term_occurrences(normalized, term)[0]
            if hits:
                _error(errors, "FORBIDDEN_TERM", text_path, "文本包含明确禁止的字面词")'''


def main():
    original = SRC.read_text(encoding="utf-8")

    for label, needle in (("HELPER_ANCHOR", HELPER_ANCHOR), ("ORIG_BLOCK", ORIG_BLOCK)):
        count = original.count(needle)
        if count != 1:
            print(f"✗ 定位失败：{label} 出现 {count} 次（应为 1 次）——拒绝生成，避免误改")
            return 1

    patched = original.replace(HELPER_ANCHOR, HELPER_BLOCK + HELPER_ANCHOR, 1)
    patched = patched.replace(ORIG_BLOCK, NEW_BLOCK, 1)
    if patched == original:
        print("✗ 未产生任何变化")
        return 1

    OUT_VARIANT.parent.mkdir(parents=True, exist_ok=True)
    OUT_VARIANT.write_text(patched, encoding="utf-8")

    diff = difflib.unified_diff(
        original.splitlines(keepends=True),
        patched.splitlines(keepends=True),
        fromfile="a/validator/rules.py",
        tofile="b/validator/rules.py",
        n=3,
    )
    diff_text = "diff --git a/validator/rules.py b/validator/rules.py\n" + "".join(diff)
    OUT_DIFF.write_text(diff_text, encoding="utf-8")

    added = sum(1 for line in diff_text.splitlines() if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_text.splitlines() if line.startswith("-") and not line.startswith("---"))
    print(f"✓ 变体已生成：{OUT_VARIANT.relative_to(ROOT)}  ({len(patched)} 字符, {patched.count(chr(10)) + 1} 行)")
    print(f"✓ 补丁已生成：{OUT_DIFF.relative_to(ROOT)}   +{added} / -{removed} 行")
    print(f"  生产文件未改动：{SRC.relative_to(ROOT)} 原文 {len(original)} 字符")
    return 0


if __name__ == "__main__":
    sys.exit(main())
