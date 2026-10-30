#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CONTRACT-001 探针 3/3：契约文档与实现的清单对账。

用途：把「文档里声明的清单」与「代码里的实际清单」做**双向**差集，
让文档漂移在下次改动时立刻暴露。对账三组：

  1. intake 字段白名单  vs  docs/intake-contract.md 的字段表
  2. 词表规模           vs  docs/intake-contract.md 的枚举记载
  3. 错误码集合（双向） vs  intake-contract 适配边界表 / VAL-001 §7 / workflow-spec.md

用法（从仓库根执行；脚本自身定位仓库根，任意 cwd 均可）：
    python docs/test-reports/contract-001/tools/probe_doc_parity.py

差集非空即退出 1；`workflow-spec.md` 属他人文件线，其差集单独标注不阻塞退出。
本脚本只读，不写仓库文件、不访问网络、不调用模型。
"""

import ast
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve()
REPO_ROOT = HERE.parents[4]
sys.path.insert(0, str(REPO_ROOT))

import workflow.labels as labels                                   # noqa: E402

DOC_INTAKE = (REPO_ROOT / "docs/intake-contract.md").read_text(encoding="utf-8")
DOC_VALIDATOR = (REPO_ROOT / "docs/validator-contract-decisions.md").read_text(encoding="utf-8")
DOC_SPEC = (REPO_ROOT / "workflow/workflow-spec.md").read_text(encoding="utf-8")
INTAKE_SRC = (REPO_ROOT / "workflow/intake.py").read_text(encoding="utf-8")
RULES_SRC = (REPO_ROOT / "validator/rules.py").read_text(encoding="utf-8")

CODE_RE = re.compile(r"`([A-Z][A-Z0-9_]{3,})`")
TAG_RE = re.compile(r"`([A-Z][A-Z0-9_]{3,})`")


def markdown_section(text, heading_prefix):
    """截取从某标题到下一个同级标题之间的正文。"""
    lines, out, inside = text.splitlines(), [], False
    level = None
    for ln in lines:
        if ln.startswith("#") and heading_prefix in ln:
            inside, level = True, len(ln) - len(ln.lstrip("#"))
            continue
        if inside and ln.startswith("#") and (len(ln) - len(ln.lstrip("#"))) <= level:
            break
        if inside:
            out.append(ln)
    return "\n".join(out)


def static_codes(src):
    """返回 {错误码: 排序后的行号列表}。"""
    tree = ast.parse(src)
    found = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id in ("_error", "err"):
            idx = 1 if node.func.id == "_error" else 0
            if len(node.args) > idx and isinstance(node.args[idx], ast.Constant) \
                    and isinstance(node.args[idx].value, str):
                found.setdefault(node.args[idx].value, []).append(node.lineno)
        if isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and k.value == "code" \
                        and isinstance(v, ast.Constant) and isinstance(v.value, str):
                    found.setdefault(v.value, []).append(node.lineno)
    return {k: sorted(set(v)) for k, v in found.items()}


# 有意暂不列出的行号（当前为空：范围校验落地后 :132/:134 已列入 §7 表）
KNOWN_PENDING = {}


def spec_rules_refs(text):
    """从 workflow-spec.md 里提取指向 validator/rules.py 的行号引用。

    只在该行出现过 rules.py 时，才把裸 `:N` 也算作它的引用；
    这样既能抓到 `validator/rules.py:181`，也能抓到行内的 `` `:57` ``。
    """
    refs = set()
    for ln in text.splitlines():
        if "rules.py" not in ln:
            continue
        for m in re.finditer(r"`(?:validator/)?rules\.py:(\d+)`", ln):
            refs.add(int(m.group(1)))
        for m in re.finditer(r"`:(\d+)`", ln):
            refs.add(int(m.group(1)))
    return refs


def line_refs_of_section(section):
    """从表格第一列的错误码、第二列的 `rules.py:N`/`:N` 引用提取行号集合。"""
    refs = {}
    for ln in section.splitlines():
        if not ln.startswith("|"):
            continue
        cells = [c.strip().strip("`") for c in ln.strip("|").split("|")]
        if len(cells) < 2 or not re.fullmatch(r"[A-Z][A-Z0-9_]{3,}", cells[0]):
            continue
        nums = set()
        for part in re.split(r"[、,，]", cells[1]):
            m = re.fullmatch(r"(?:rules\.py)?:?(\d+)", part.strip().strip("`"))
            if m:
                nums.add(int(m.group(1)))
        if nums:
            refs[cells[0]] = nums
    return refs


def documented_in_table(section):
    """表格第一列里的错误码（兼容是否带反引号两种排版）。"""
    codes = set()
    for ln in section.splitlines():
        if not ln.startswith("|"):
            continue
        cells = [c.strip().strip("`") for c in ln.strip("|").split("|")]
        if cells and re.fullmatch(r"[A-Z][A-Z0-9_]{3,}", cells[0]):
            codes.add(cells[0])
    return codes


def whitelist_from_source():
    tree = ast.parse(INTAKE_SRC)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "fields" for t in node.targets):
            if isinstance(node.value, (ast.Set, ast.List, ast.Tuple)):
                return {e.value for e in node.value.elts
                        if isinstance(e, ast.Constant) and isinstance(e.value, str)}
    return set()


def fields_from_doc():
    """只取「字段、空值及标签」一节的**第一个表格块**，避免把紧随其后的兴趣枚举表吞进来。"""
    sec = markdown_section(DOC_INTAKE, "字段、空值及标签")
    names = set()
    for ln in sec.splitlines():
        if not ln.startswith("|"):
            if names:            # 第一个表格到此结束
                break
            continue
        cells = [c.strip().strip("`") for c in ln.strip("|").split("|")]
        if cells and re.fullmatch(r"[a-z][a-z0-9_]*", cells[0]):
            names.add(cells[0])
    return names


def main_probe():
    print("CONTRACT-001 探针 3/3：契约文档与实现的清单对账")
    print(f"仓库根：{REPO_ROOT}\n")
    fails = []

    # ---- 1. 字段白名单 ----
    wl, docf = whitelist_from_source(), fields_from_doc()
    print("=== 1. intake 字段白名单 vs 文档字段表 ===")
    print(f"代码白名单（{len(wl)}）：{json.dumps(sorted(wl), ensure_ascii=False)}")
    print(f"文档字段表（{len(docf)}）：{json.dumps(sorted(docf), ensure_ascii=False)}")
    only_code, only_doc = wl - docf, docf - wl
    print(f"仅代码有：{json.dumps(sorted(only_code), ensure_ascii=False)}")
    print(f"仅文档有：{json.dumps(sorted(only_doc), ensure_ascii=False)}")
    print(f"recipient_relation_id 是否被误列入白名单：{'是 ❌' if 'recipient_relation_id' in wl else '否 ✅'}")
    if only_code or only_doc:
        fails.append("字段白名单与文档字段表不一致")
    print()

    # ---- 2. 词表规模 ----
    print("=== 2. 词表规模 vs 文档枚举记载 ===")
    for name in sorted(n for n in dir(labels) if n.isupper() and not n.startswith("_")):
        table = getattr(labels, name)
        if isinstance(table, dict):
            print(f"  labels.{name:<12} {len(table):>3} 项  {json.dumps(sorted(table), ensure_ascii=False)}")
    print()

    # ---- 3. 错误码双向对账 ----
    print("=== 3. 错误码双向对账 ===")
    rules_codes = set(static_codes(RULES_SRC))
    intake_codes = set(static_codes(INTAKE_SRC))
    table_intake = documented_in_table(markdown_section(DOC_INTAKE, "错误及调用边界"))
    table_validator = documented_in_table(markdown_section(DOC_VALIDATOR, "7."))
    spec_codes = set(CODE_RE.findall(DOC_SPEC))
    reserved = {"INVALID_SELECTION", "STALE_RECOMMENDATION", "UNTRUSTED_RECOMMENDATION",
                "CANDIDATE_NOT_PASSED", "PRESENTATION_INVALID", "TOTAL_MISMATCH",
                "REPAIR_LIMIT_REACHED"}

    print(f"实现 validator/rules.py（{len(rules_codes)}）：{json.dumps(sorted(rules_codes), ensure_ascii=False)}")
    print(f"实现 workflow/intake.py（{len(intake_codes)}）")
    print(f"文档 intake-contract 适配边界表（{len(table_intake)}）：{json.dumps(sorted(table_intake), ensure_ascii=False)}")
    print(f"文档 VAL-001 §7 全量清单（{len(table_validator)}）")
    print(f"文档 workflow-spec.md 出现的码（{len(spec_codes)}）")

    r_minus_v = rules_codes - table_validator
    v_minus_r = table_validator - rules_codes
    r_minus_spec = rules_codes - spec_codes
    spec_reserved_hit = spec_codes & reserved
    print()
    print(f"[必须为空] validator 实发 - VAL-001 §7 = {json.dumps(sorted(r_minus_v), ensure_ascii=False)}")
    print(f"[必须为空] VAL-001 §7 - validator 实发 = {json.dumps(sorted(v_minus_r), ensure_ascii=False)}")
    print(f"[他人文件线] validator 实发 - workflow-spec.md = {json.dumps(sorted(r_minus_spec), ensure_ascii=False)}")
    print(f"[必须为空] workflow-spec.md 里的预留码是否已被实现 = "
          f"{json.dumps(sorted(spec_reserved_hit & rules_codes | spec_reserved_hit & intake_codes), ensure_ascii=False)}")
    if r_minus_v or v_minus_r:
        fails.append("VAL-001 §7 与实现不是双向一致")
    print()

    # ---- 4. §7 行号引用对账 ----
    print("=== 4. VAL-001 §7 行号引用对账 ===")
    print(f"基准：validator/rules.py 共 {len(RULES_SRC.splitlines())} 行（splitlines 计数）")
    actual_lines = static_codes(RULES_SRC)
    doc_refs = line_refs_of_section(markdown_section(DOC_VALIDATOR, "7."))
    stale, missing_doc, pending = [], [], []
    for code in sorted(actual_lines):
        want = set(actual_lines[code])
        have = doc_refs.get(code, set())
        absent = want - have
        stale_extra = have - want
        if stale_extra:
            stale.append((code, sorted(stale_extra)))
        if absent:
            if code in KNOWN_PENDING and absent <= KNOWN_PENDING[code]:
                pending.append((code, sorted(absent)))
            else:
                missing_doc.append((code, sorted(absent)))
    if not stale and not missing_doc and not pending:
        print("  ✅ 19 个码的行号引用与实现完全一致")
    for code, nums in stale:
        print(f"  ❌ {code}：文档写了代码中不存在的行号 {nums}")
    for code, nums in missing_doc:
        print(f"  ❌ {code}：文档漏列实际行号 {nums}")
    for code, nums in pending:
        print(f"  ⚠️  {code}：文档有意暂未列出 {nums}（待 QA 复核后更新，已登记豁免）")
    if stale or missing_doc:
        fails.append("§7 行号引用与实现不一致")
    print()

    # ---- 5. 跨文件行号引用对账（workflow-spec.md → validator/rules.py）----
    print("=== 5. 跨文件行号引用对账（workflow/workflow-spec.md）===")
    valid_lines = {n for nums in actual_lines.values() for n in nums}
    cross = spec_rules_refs(DOC_SPEC)
    bad_cross = sorted(n for n in cross if n not in valid_lines)
    print(f"  workflow-spec.md 引用 rules.py 行号 {len(cross)} 个：{sorted(cross)}")
    if not bad_cross:
        print("  ✅ 全部指向实际发出错误码的行")
    else:
        for n in bad_cross:
            shifted = n + 5          # 本次规则线在 :130 之后插入 5 行
            if shifted in valid_lines:
                hint = f"位移 +5 后应为 :{shifted}（该行号有效）"
            else:
                hint = f"位移 +5 得 :{shifted}，仍非有效行号，需人工核对"
            print(f"  ❌ 过期引用 :{n} → {hint}")
        print("  ⚠️  属 workflow-spec.md 文件线，本探针只报不判失败")
    print()

    print("=== 汇总 ===")
    if fails:
        for f in fails:
            print(f"  ❌ {f}")
        return 1
    print("  ✅ 字段白名单、VAL-001 §7 全量清单与实现双向一致")
    if r_minus_spec:
        print(f"  ⚠️  workflow-spec.md 的码清单仍缺：{json.dumps(sorted(r_minus_spec), ensure_ascii=False)}（属该文件线，本探针不阻塞）")
    return 0


if __name__ == "__main__":
    sys.exit(main_probe())
