"""QA-001 深水区探针：范围校验之外（组合、优先级、静默分支、解析器异常）。

动机（我自查出的未验证缺口）：
  1. `_amount` 对 **>1000 码点**且格式合法的金额**静默返回 None**（不报错），
     而范围检查写作 `if budget is not None` —— 范围检查会被**跳过**。是否会漏过越界值？
  2. Python 3.11+ 默认把 int↔str 转换限制在 4300 位。若请求含超长整数字面量，
     `json.loads` 抛 `ValueError`（**不是** `JSONDecodeError`）。解析器若只捕后者，
     异常会落到顶层兜底 → **`INTERNAL_ERROR`**，而非契约要求的 `INVALID_JSON`。
     我曾断言"`INTERNAL_ERROR` 只能由内部故障触发"——**本探针专门尝试推翻我自己**。
  3. 多个范围错误并存时的报码数量与路径（是否被去重/合并）。
  4. 范围错误与类型/币种错误的优先级（JSON 数字型金额是否只报类型错）。

**全部用原始 JSON 字符串构造**，避免 Python 侧序列化掩盖问题。不修改任何被测文件。

运行： python tests/acceptance/boundary/probe_deep_edges.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate  # noqa: E402

# 命名占位符，避免 % 与 {} 互相干扰；%(b)s=预算字面量、%(d)s=天数字面量。
# 注意末尾必须闭合外层对象。
TMPL = (
    '{"recipient_relation":"\u670b\u53cb","recipient_relation_id":"friend",'
    '"occasion":"\u751f\u65e5","budget_amount":%(b)s,"currency":%(c)s,"available_days":%(d)s,'
    '"facts":[{"id":"f1","text":"x"}],"forbidden_tags":[],"forbidden_terms":[],"notes":"",'
    '"closeness":"unknown","preference_inferences":[],"gift_styles":[],'
    '"hard_exclusions_original":{"tags":[],"terms":[],"unresolved":[]}}'
)

DROP_BUDGET = TMPL.replace('"budget_amount":%(b)s,', "")
DROP_DAYS = TMPL.replace(',"available_days":%(d)s', "")


def raw(b='"200.00"', d="3", c='"CNY"'):
    return TMPL % {"b": b, "d": d, "c": c}


def req_json(**overrides):
    base = {
        "recipient_relation": "朋友", "recipient_relation_id": "friend", "occasion": "生日",
        "budget_amount": "200.00", "currency": "CNY", "available_days": 3,
        "facts": [{"id": "f1", "text": "对方喜欢手冲咖啡"}],
        "forbidden_tags": [], "forbidden_terms": [], "notes": "",
        "closeness": "unknown", "preference_inferences": [], "gift_styles": [],
        "hard_exclusions_original": {"tags": [], "terms": [], "unresolved": []},
    }
    base.update(overrides)
    return json.dumps(base, ensure_ascii=False)


def _one(i, name, total_literal, days_literal):
    # 候选用字符串拼接，便于注入超长整数字面量
    return ('{"id":"%s","name":"%s","description":"虚构方案说明","estimated_total":%s,'
            '"currency":"CNY","estimated_preparation_days":%s,"tags":["other"],'
            '"reason":"匹配用户已确认的偏好与预算上限","fact_refs":["f1"],'
            '"inferences":["可能偏好实用礼物"],"unknowns":["实际价格以商家为准"],'
            '"presentation":"简要呈现"}' % (i, name, total_literal, days_literal))


def cand_json(total='"150.00"', days="1"):
    body = ",".join([_one("c1", "手冲咖啡礼盒", total, days),
                     _one("c2", "陶瓷马克杯", '"120.00"', "2"),
                     _one("c3", "咖啡豆订阅卡", '"80.00"', "3")])
    return '{"candidates":[' + body + "]}"


def collect(result):
    rows = []
    for e in result.get("errors") or []:
        rows.append(("顶层", e["code"], e["path"], e.get("message", "")))
    for i, item in enumerate(result.get("candidate_results") or []):
        for e in item.get("errors") or []:
            rows.append((f"候选[{i}]", e["code"], e["path"], e.get("message", "")))
    return rows


FINDINGS = []


def show(label, request_json, candidates_json=None):
    result = validate(request_json, candidates_json if candidates_json is not None else cand_json())
    rows = collect(result)
    print(f"\n--- {label}")
    print(f"    status={result['status']}  all_passed={result['all_passed']}  "
          f"bdv={result.get('business_data_verification')}")
    if not rows:
        print("    codes=(无)")
    for scope, code, path, msg in rows:
        print(f"    {scope:<8} {code:<20} {path:<30} {msg}")
    return {"label": label, "status": result["status"], "all_passed": result["all_passed"],
            "codes": [[s, c, p, m] for s, c, p, m in rows]}


print("=" * 100)
print("前置自检：模板必须是合法 JSON（上次探针因漏闭合括号全部误报 INVALID_JSON）")
print("=" * 100)
_ok = True
for name, s in [("TMPL 基线", raw()), ("DROP_BUDGET", DROP_BUDGET % {"d": "3", "c": '"CNY"'}),
                ("DROP_DAYS", DROP_DAYS % {"b": '"200.00"', "c": '"CNY"'}),
                ("cand_json", cand_json())]:
    try:
        json.loads(s)
        print(f"  OK   {name}")
    except Exception as e:
        _ok = False
        print(f"  BAD  {name}: {type(e).__name__} {e}")
if not _ok:
    print("\n模板自检失败，终止（避免再次产出假结论）。")
    sys.exit(2)
print("  → 模板自检通过")

results = []
print()
print("=" * 100)
print("A 组：_amount 静默 None 分支（>1000 码点、格式合法的金额）是否绕过范围校验")
print("=" * 100)
results.append(show('budget="1"*1000（恰好 1000 码点，数值巨大、越界）', raw('"' + "1" * 1000 + '"')))
results.append(show('budget="1"*1001（1001 码点 → _amount 静默 None）', raw('"' + "1" * 1001 + '"')))
results.append(show('budget="9"*999（999 码点，越界）', raw('"' + "9" * 999 + '"')))
results.append(show('budget="11"（对照：在范围内，只应报候选 OVER_BUDGET）', raw('"11"')))

print()
print("=" * 100)
print("B 组：超长整数字面量是否让 json 解析异常落到 INTERNAL_ERROR")
print("=" * 100)
for digits in (4299, 4300, 4301, 5000, 20000):
    results.append(show(f"available_days = {digits} 位整数字面量", raw(d="9" * digits)))
results.append(show("候选 estimated_preparation_days = 5000 位整数字面量",
                    req_json(), cand_json(days="9" * 5000)))

print()
print("=" * 100)
print("C 组：多个范围错误 / 范围×类型 / 范围×币种 的组合与优先级")
print("=" * 100)
results.append(show("budget=0 且 days=366（两个范围错误并存）", raw('"0"', "366")))
results.append(show("budget=0 且 days=-1（范围 + 类型）", raw('"0"', "-1")))
results.append(show("budget=0 且 currency=USD（范围 + 币种）", raw('"0"', "3", '"USD"')))
results.append(show("budget_amount=20000（JSON 数字，非字符串）", raw("20000")))
results.append(show("budget_amount=0（JSON 数字，非字符串）", raw("0")))
results.append(show("budget_amount 字段缺失", DROP_BUDGET % {"d": "3", "c": '"CNY"'}))
results.append(show("available_days 字段缺失", DROP_DAYS % {"b": '"200.00"', "c": '"CNY"'}))
results.append(show("days=1e400（JSON → float inf）", raw(d="1e400")))
results.append(show("days=0.0（JSON float）", raw(d="0.0")))
results.append(show("days=true（JSON 布尔）", raw(d="true")))
results.append(show("days=-1 且 budget=0 且 currency=USD（三个错并存）", raw('"0"', "-1", '"USD"')))

print()
print("=" * 100)
print("D 组：候选侧是否被请求侧范围污染（反向断言加强）")
print("=" * 100)
results.append(show("候选 estimated_total=0 且 prep=0（**字符串** \"0\"，须通过）",
                    req_json(), cand_json(total='"0"', days="0")))
results.append(show("⚠️ 探针自身 bug 对照：候选 estimated_total=0（**JSON 数字**，应报 INVALID_TYPE）",
                    req_json(), cand_json(total="0", days="0")))
results.append(show("候选 estimated_total 为 1001 码点合法金额串", req_json(),
                    cand_json(total='"' + "1" * 1001 + '"')))
results.append(show("候选 prep = 5000 位整数", req_json(), cand_json(days="9" * 5000)))
results.append(show("候选 estimated_total='9'*999（越界，须只报 OVER_BUDGET）", req_json(),
                    cand_json(total='"' + "9" * 999 + '"')))

print()
print("=" * 100)
print("E 组：请求 JSON 本身畸形")
print("=" * 100)
results.append(show("request_json 为空字符串", ""))
results.append(show("request_json = 'null'", "null"))
results.append(show("request_json 根为数组", "[]"))
results.append(show("request_json 含重复键 budget_amount", raw().replace(
    '"budget_amount":"200.00"', '"budget_amount":"200.00","budget_amount":"0"')))

out = ROOT / "docs/test-reports/boundary-001/evidence/deep-edges.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"probe": "deep-edges", "python": sys.version, "results": results},
                          ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print()
print("=" * 100)
print("F 组：4301 位阈值到底是「设计规则」还是「解释器限制」？决定性实验")
print("=" * 100)
_default_limit = sys.get_int_max_str_digits()
print(f"  当前 sys.get_int_max_str_digits() = {_default_limit}（CPython 3.11+ 默认 4300）")
print("  假设：阈值来自 CPython 的 int↔str 转换上限，而非被测代码的规则。")
print("  做法：把上限临时改为 0（= 关闭该保护），重放同一条 5000 位整数请求。")
print("        若结果为 LIMIT_EXCEEDED（范围错）而非 INVALID_JSON，则假设成立。")
try:
    sys.set_int_max_str_digits(0)
    print(f"  已关闭上限：sys.get_int_max_str_digits() = {sys.get_int_max_str_digits()}")
    r_disabled = show("available_days = 5000 位整数（**已关闭**解释器上限）", raw(d="9" * 5000))
finally:
    sys.set_int_max_str_digits(_default_limit)
    print(f"  已还原上限：sys.get_int_max_str_digits() = {sys.get_int_max_str_digits()}")
r_default = [x for x in results if "5000 位整数字面量" in x["label"]][0]
verdict = (r_disabled["status"] == "needs_input"
           and any(c[1] == "LIMIT_EXCEEDED" for c in r_disabled["codes"])
           and r_default["status"] == "error")
print(f"\n  关闭上限后：status={r_disabled['status']} codes="
      f"{[[c[1], c[2]] for c in r_disabled['codes']]}")
print(f"  默认上限时：status={r_default['status']} codes="
      f"{[[c[1], c[2]] for c in r_default['codes']]}")
print(f"\n  结论：{'假设成立 —— 阈值来自解释器，不是设计规则' if verdict else '假设不成立，需重新分析'}")
_evidence = json.loads(out.read_text(encoding="utf-8"))
_evidence["int_digit_limit_experiment"] = {
    "default_limit": _default_limit, "disabled_result": r_disabled,
    "default_result": r_default, "hypothesis_holds": verdict}
out.write_text(json.dumps(_evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"\n完成。结构化结果 → {out}")
