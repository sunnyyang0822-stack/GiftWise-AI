# -*- coding: utf-8 -*-
"""沙箱证明：对比"冻结版"与"否定语义修复版"，不修改任何生产文件。

对比对象（都按文件路径加载，保证比的是真实文件）：
  A 冻结版  validator/rules.py
  B 修复版  rulefix/variant/rules_negfix.py

证明内容：
  §1 Q8 救回：否定式合规表述，修复后不再命中
  §2 Q7 绕过：修复后是否仍可绕过（不美化，仍可绕过就写"未解决"）
  §3 官方样例回归：workflow/examples/ 的配对，修复前后判定一致
  §4 真阳性仍被拒：真含禁忌且未声明不含的，修复后必须仍被拒
  §5 全量回归：tests/test_cases.json 全部用例逐条对比，并验证"只放宽、不收紧"不变量
  §6 残留假阳性：修复救不了的那一类，如实列出

用法： python rulefix/prove.py
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "rulefix" / "evidence"
EVIDENCE.mkdir(parents=True, exist_ok=True)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FROZEN = load(ROOT / "validator" / "rules.py", "rules_frozen")
FIXED = load(ROOT / "rulefix" / "variant" / "rules_negfix.py", "rules_negfix")


def verdict(mod, request, candidates):
    out = mod.validate(json.dumps(request, ensure_ascii=False),
                       json.dumps({"candidates": candidates}, ensure_ascii=False))
    codes = sorted({e["code"] for e in out["errors"]}
                   | {e["code"] for c in out["candidate_results"] for e in c["errors"]})
    passed = [c["id"] for c in out["candidate_results"] if c["passed"]]
    return {"status": out["status"], "all_passed": out["all_passed"],
            "codes": codes, "passed": passed, "raw": out}


def compare(label, request, candidates, expect):
    a = verdict(FROZEN, request, candidates)
    b = verdict(FIXED, request, candidates)

    def hit_paths(out):
        return sorted(e["path"] for c in out["raw"]["candidate_results"] for e in c["errors"]
                      if e["code"] == "FORBIDDEN_TERM")

    hit_a, hit_b = "FORBIDDEN_TERM" in a["codes"], "FORBIDDEN_TERM" in b["codes"]
    print(f"  {label}")
    print(f"      冻结版: status={a['status']:<9} 禁忌={'命中' if hit_a else '未命中':<3} 通过={a['passed']}"
          + (f"  命中字段={hit_paths(a)}" if hit_a else ""))
    print(f"      修复版: status={b['status']:<9} 禁忌={'命中' if hit_b else '未命中':<3} 通过={b['passed']}"
          + (f"  命中字段={hit_paths(b)}" if hit_b else ""))
    print(f"      期望: {expect}")
    return {"label": label, "before_hit": hit_a, "after_hit": hit_b,
            "before_paths": hit_paths(a), "after_paths": hit_paths(b),
            "before": {k: a[k] for k in ("status", "all_passed", "codes", "passed")},
            "after": {k: b[k] for k in ("status", "all_passed", "codes", "passed")}}


# ------------------------------------------------------------------ 基础夹具
BASE_REQUEST = {
    "recipient_relation": "pursuit", "closeness": "limited", "occasion": "birthday",
    "budget_amount": "200.00", "currency": "CNY", "available_days": 2,
    "forbidden_tags": ["alcohol"], "forbidden_terms": ["酒"],
}
CLEAN = "以日常饮用器具为方向，温和不张扬，适合低压力表达。"


def mk(cid, **over):
    c = {"id": cid, "name": "简洁杯具与杯垫", "description": CLEAN,
         "estimated_total": "150.00", "currency": "CNY", "estimated_preparation_days": 1,
         "tags": ["other"], "reason": "回应送礼者希望实用、精致但不张扬的要求。",
         "fact_refs": [], "inferences": ["日常用品可能较便于表达低压力祝福。"],
         "unknowns": ["实际价格、库存和送达均未核实。"]}
    c.update(over)
    return c


def three(**over):
    return [mk("c1", **over), mk("c2", name="空白便笺与书写笔"), mk("c3", name="极简桌面收纳托盘")]


report = {"sections": {}}

# ============================================================ §1 Q8 救回
print("=" * 80)
print("§1 Q8 救回：否定式合规表述（4 个场景同源用例 + 场景线原用例）")
print("=" * 80)
q8 = []
q8.append(compare("S01｜名称含「无酒」",
                  BASE_REQUEST, three(name="单一产地挂耳咖啡礼盒（无酒）"),
                  "应被救回：修复后不再命中"))
q8.append(compare("S03｜描述含「不含酒精」",
                  BASE_REQUEST, three(description="冬季热饮粉与马克杯组合，不含酒精，适合不饮酒的人。"),
                  "应被救回"))
q8.append(compare("S12｜描述含「不含酒类」",
                  BASE_REQUEST, three(description="商务茶具与办公桌面摆件，不含酒类，稳重得体。"),
                  "应被救回"))
q8.append(compare("S13｜描述含「不含酒类」",
                  BASE_REQUEST, three(description="办公室绿植与素色陶盆，不含酒类。"),
                  "应被救回"))
# 场景线 scenarios/lib/critique.py 的 Q8 原用例（四处否定）
q8.append(compare("场景线原用例 c1「无酒精饮品组合」（name+description+reason+inferences 四处否定）",
                  BASE_REQUEST,
                  [mk("c1", name="无酒精饮品组合", description="本品不含酒精，也不需要冷藏。",
                      estimated_total="120.00",
                      reason="用户明确不要酒，因此选择不含酒精的方向。",
                      inferences=["无酒类成分，适合不饮酒的收礼人。"]),
                   mk("c2", name="通用马克杯"), mk("c3", name="中性办公摆件")],
                  "应被救回：修复后 4 条 FORBIDDEN_TERM 全部消失"))
report["sections"]["Q8_救回"] = q8

# ============================================================ §2 Q7 绕过
print()
print("=" * 80)
print("§2 Q7 绕过：语义属酒精、但避字面词 + tags=['other']")
print("=" * 80)
q7 = compare("F｜名称/描述用「陈年佳酿」等避开字面词",
             BASE_REQUEST, three(name="精选陈年佳酿礼盒", description="风味醇厚的陈年佳酿，适合小酌。"),
             "本轮修复不针对此路径 → 预期仍【未解决】")
report["sections"]["Q7_绕过"] = q7

# ============================================================ §3 官方样例回归
print()
print("=" * 80)
print("§3 官方样例回归：workflow/examples/ 配对（修复前后判定必须一致）")
print("=" * 80)


def to_rules_request(intake):
    """intake（工作流契约）→ 规则层请求契约的显式映射。

    intake.hard_exclusions.tags/terms  → forbidden_tags / forbidden_terms
    intake.deadline_days               → available_days
    intake.interests[k]                → facts[{id: "interest:<k>", text: <k>}]
    （映射由本脚本显式声明；规则层接口见 validator/rules.py:124）
    """
    ex = intake.get("hard_exclusions") or {}
    return {
        "recipient_relation": intake.get("recipient_relation", ""),
        "occasion": intake.get("occasion", ""),
        "budget_amount": intake.get("budget_amount", ""),
        "currency": intake.get("currency", "CNY"),
        "available_days": intake.get("deadline_days", intake.get("available_days", 0)),
        "facts": [{"id": f"interest:{k}", "text": k} for k in intake.get("interests", [])],
        "forbidden_tags": ex.get("tags", []),
        "forbidden_terms": ex.get("terms", []),
        "notes": intake.get("additional_context", ""),
    }


EX = ROOT / "workflow" / "examples"
pairs = [
    ("intake.json + candidates.json", "intake.json", "candidates.json"),
    ("demo-intake-judge-forbidden-term.json + demo-candidates-clean.json",
     "demo-intake-judge-forbidden-term.json", "demo-candidates-clean.json"),
    ("demo-intake-judge-forbidden-term.json + demo-candidates-violating.json",
     "demo-intake-judge-forbidden-term.json", "demo-candidates-violating.json"),
    ("intake-colleague.json + candidates.json", "intake-colleague.json", "candidates.json"),
]
official = []
for label, intake_file, cand_file in pairs:
    intake = json.loads((EX / intake_file).read_text(encoding="utf-8"))
    cands = json.loads((EX / cand_file).read_text(encoding="utf-8"))["candidates"]
    req = to_rules_request(intake)
    row = compare(label, req, cands, "修复前后判定应完全一致（回归）")
    row["same"] = row["before"] == row["after"]
    print(f"      修复前后是否一致: {'✅ 一致' if row['same'] else '❌ 不一致'}")
    official.append(row)
print()
print("  映射说明（本脚本显式声明）：hard_exclusions.tags/terms → forbidden_tags/forbidden_terms；"
      "deadline_days → available_days；interests[k] → facts[{id:'interest:<k>'}]")
report["sections"]["官方样例回归"] = official

# ============================================================ §4 真阳性仍被拒
print()
print("=" * 80)
print("§4 真阳性仍被拒：真含禁忌且未声明不含的，修复后必须仍命中")
print("=" * 80)
positives = [
    ("礼盒内含一瓶红酒", "description", "未否定的字面命中"),
    ("茅台酒礼盒", "name", "未否定的字面命中"),
    ("含酒精饮品组合", "description", "未否定的字面命中"),
    ("酒精浓度 12% 的佐餐饮品", "description", "未否定的字面命中"),
    ("因为对方喜欢喝酒，所以选它", "reason", "解释性字段里的正向提及"),
    ("该酒类礼盒可能受欢迎", "inferences", "解释性字段里的正向提及"),
    ("呈现时会强调酒庄故事", "presentation", "presentation 里的正向提及"),
    ("不含酒精，但另配一瓶米酒", "description", "混合：第二次出现未被否定"),
    ("并非不含酒精", "description", "双重否定，语义回到含忌"),
    ("无酒精的周边，另附红酒一支", "description", "混合：第二次出现未被否定"),
]
truepos = []
for value, field, note in positives:
    if field == "inferences":
        cands = three(inferences=[value])
    else:
        cands = three(**{field: value})
    row = compare(f"{field} = 「{value}」", BASE_REQUEST, cands, f"修复后仍须命中（{note}）")
    row["still_rejected"] = row["after_hit"]
    truepos.append(row)
still = sum(1 for r in truepos if r["still_rejected"])
print()
print(f"  真阳性仍被拒：{still}/{len(truepos)}")
report["sections"]["真阳性仍被拒"] = truepos

# ============================================================ §5 全量回归
print()
print("=" * 80)
print("§5 全量回归：tests/test_cases.json 全部用例，逐条对比两个实现")
print("=" * 80)
data = json.loads((ROOT / "tests" / "test_cases.json").read_text(encoding="utf-8"))
cases = data["cases"]
diffs = []
new_errors = []
checked = 0
for case in cases:
    request = case.get("request_raw", json.dumps(case.get("request"), ensure_ascii=False))
    candidates = case.get("candidate_raw", json.dumps(case.get("candidate_batch"), ensure_ascii=False))
    request = case.get("request_argument", request)
    candidates = case.get("candidate_argument", candidates)
    try:
        a = FROZEN.validate(request, candidates)
        b = FIXED.validate(request, candidates)
    except Exception as exc:  # noqa: BLE001
        new_errors.append({"id": case["id"], "exception": repr(exc)})
        continue
    checked += 1

    def sig(out):
        return (
            out["status"], out["all_passed"],
            tuple(c["passed"] for c in out["candidate_results"]),
            tuple(sorted((e["code"], e["path"]) for e in out["errors"])),
            tuple(sorted((e["code"], e["path"]) for c in out["candidate_results"] for e in c["errors"])),
        )

    sa, sb = sig(a), sig(b)
    if sa != sb:
        before_codes = sorted({e["code"] for e in a["errors"]}
                              | {e["code"] for c in a["candidate_results"] for e in c["errors"]})
        after_codes = sorted({e["code"] for e in b["errors"]}
                             | {e["code"] for c in b["candidate_results"] for e in c["errors"]})
        only_removed = set(after_codes) <= set(before_codes)
        diffs.append({"id": case["id"], "before": sa[:2] + (sa[2],), "after": sb[:2] + (sb[2],),
                      "before_codes": before_codes, "after_codes": after_codes,
                      "only_removed": only_removed,
                      "removed": sorted(set(before_codes) - set(after_codes)),
                      "added": sorted(set(after_codes) - set(before_codes))})

    # 不变量：修复版不得产生冻结版没有的错误（只放宽、不收紧）
    def all_err(out):
        return {(e["code"], e["path"]) for e in out["errors"]} | \
               {(e["code"], e["path"]) for c in out["candidate_results"] for e in c["errors"]}

    extra = all_err(b) - all_err(a)
    if extra:
        new_errors.append({"id": case["id"], "new_errors": sorted(extra)})

print(f"  用例总数: {len(cases)}；成功对比: {checked}")
print(f"  判定发生变化的用例数: {len(diffs)}")
for d in diffs:
    tag = "（仅放宽 ✅）" if d["only_removed"] else "（⚠️ 出现新增错误码）"
    print(f"    - {d['id']}: {d['before']} → {d['after']}  去掉={d['removed']} 新增={d['added']} {tag}")
print(f"  ⚠️ 修复版引入的新错误（应为 0）: {len(new_errors)}")
for item in new_errors[:20]:
    print(f"    - {item}")
print()
print("  不变量「只放宽、不收紧」："
      f"{'✅ 成立（修复版未产生任何冻结版没有的错误）' if not new_errors else '❌ 不成立'}")
report["sections"]["全量回归"] = {"total": len(cases), "compared": checked,
                                  "changed": diffs, "new_errors": new_errors}

# ============================================================ §6 残留假阳性
print()
print("=" * 80)
print("§6 残留假阳性：本轮修复救不了的那一类（如实披露）")
print("=" * 80)
residual = []
residual.append(compare("I｜「无酒精啤酒，适合不饮酒的人」",
                        BASE_REQUEST, three(description="无酒精啤酒，适合不饮酒的人。"),
                        "仍会被拒：词条「酒」命中「啤酒」的子串，与否定语义无关"))
residual.append(compare("I2｜「本店招牌无醇饮品」",
                        BASE_REQUEST, three(description="本店招牌无醇饮品，不含酒精。"),
                        "含「不含酒精」→ 应被救回（对照）"))
report["sections"]["残留假阳性"] = residual

# ------------------------------------------------------------------ 汇总
print()
print("=" * 80)
print("汇总")
print("=" * 80)
rescued = sum(1 for r in report["sections"]["Q8_救回"] if r["before_hit"] and not r["after_hit"])
total_q8 = len(report["sections"]["Q8_救回"])
print(f"  §1 Q8 救回: {rescued}/{total_q8}")
print(f"  §2 Q7 绕过: {'仍可绕过（未解决）' if not report['sections']['Q7_绕过']['after_hit'] else '已挡住'}")
print(f"  §3 官方样例回归: {sum(1 for r in official if r['same'])}/{len(official)} 判定一致")
print(f"  §4 真阳性仍被拒: {still}/{len(truepos)}")
print(f"  §5 全量回归: {len(cases)} 条中 {len(diffs)} 条变化，新增错误 {len(new_errors)} 条")
print(f"  §6 残留假阳性: {sum(1 for r in residual if r['after_hit'])}/{len(residual)} 仍被误杀")

(EVIDENCE / "prove-result.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print()
print(f"  结构化结果已写入: {(EVIDENCE / 'prove-result.json').relative_to(ROOT)}")
