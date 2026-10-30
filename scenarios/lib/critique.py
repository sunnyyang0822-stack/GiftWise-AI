# -*- coding: utf-8 -*-
"""规则层的产品级质疑探针。

目的不是挑刺，而是找出**规则门可能误杀好方案、或漏放坏方案**的情形，
每条都给可复现用例 + 真实规则层输出。全部只读调用 `validator/rules.py`，不修改规则。

探针清单
--------
Q1  极小预算（1 元，合法下限）下的可选方案数
Q2  0 天准备期（今天就要）下的可选方案数
Q3  喜好与禁忌直接冲突时的表现（适配层是否交叉检查）
Q4  候选侧允许 estimated_total = 0，请求侧禁止 0 —— 两侧不对称
Q5  关系枚举里没有“职场上司”（产品定位与机器值不一致）
Q6  request 侧未知字段：字符串静默通过，对象报 INVALID_TYPE
Q7  禁忌标签绕过：语义属酒精、但不打 alcohol 标签且文本无字面词 → 可通过
Q8  **否定式表述被误杀**：“无酒精 / 不含酒精”因含字面词被拒
Q9  禁忌词扫描字段过宽：仅 `reason` 里出现字面词也会被拒
"""

import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scenario_support import build_request, call_validate, cand, batch, INTAKE_BASE  # noqa: E402

UNK_STD = ["实际价格、库存与送达均未核实；估算含基础包装、贺卡与配送"]

PROBES = []


def _req(**over):
    data = dict(INTAKE_BASE)
    data.update(over)
    return build_request(data)


def probe(qid, question, finding, risk, repro, raw):
    PROBES.append({
        "id": qid, "question": question, "finding": finding,
        "risk": risk, "reproduce": repro, "raw_output": raw,
    })


def _clean(*cands):
    return batch(*cands)


# ------------------------------------------------------------------ Q1 / Q2
def q1():
    request_json, adapted = _req(budget_amount="1")
    out = call_validate(request_json, _clean(
        cand("c1", "手写贺卡", "以纯手写卡片为方向。", "1.00", 0, ["other"], "时间替代金额。", unk=UNK_STD),
        cand("c2", "便利店小零食", "以便利店可购小食为方向。", "12.00", 0, ["food"], "随手可买。", unk=UNK_STD),
        cand("c3", "一小束鲜花", "以单支花束为方向。", "35.00", 1, ["plant"], "常见小礼物。", unk=UNK_STD),
    ))
    probe(
        "Q1",
        "预算取合法下限 1 元时，还能剩下几个可选方案？",
        "实测：**恰好 1 个**（1.00 元的手写卡通过；12 元与 35 元方案因 OVER_BUDGET 被拒）。"
        "并非“0 个方案”的死路 —— 该假设不成立，此处据实更正。",
        "产品承诺“恰好 3 个方案”。在极小预算下，规则门会把方案数压到 1 个。"
        "规则判断本身是对的（12 元确实超预算），但**校验之后没有补位机制**："
        "用户会看到 1 个方案而不是 3 个，且没有解释“为什么只有 1 个”。",
        'intake 里 budget_amount="1"（合法）→ 真实适配层 + 真实规则层',
        out,
    )


def q2():
    request_json, adapted = _req(deadline_days=0, budget_amount="300.00",
                                interests=["coffee_food"],
                                interest_confidence={"coffee_food": "confirmed"})
    out = call_validate(request_json, _clean(
        cand("c1", "亲手做的晚餐", "以时间投入替代金额。", "120.00", 0, ["food"],
             "准备期为 0 天可行。", refs=["interest:coffee_food"], unk=UNK_STD),
        cand("c2", "当日自提蛋糕", "以线下当日可取蛋糕为方向。", "200.00", 0, ["food"], "当日可取。", unk=UNK_STD),
        cand("c3", "定制纪念相册", "以定制相册为方向。", "260.00", 3, ["other"], "纪念感强。", unk=UNK_STD),
    ))
    probe(
        "Q2",
        "`deadline_days=0`（今天就要，合法值）时，还能剩下几个可选方案？",
        "实测：**2 个**（两个 0 天方案通过；3 天定制方案因 PREPARATION_TOO_LONG 被拒）。"
        "只要候选里存在 0 天方案，最急场景不会落入“无方案”。",
        "剩余风险不在规则层，而在**模型是否愿意给出 0 天方案**：若模型习惯性写 1–2 天准备期，"
        "最急的用户会拿到 0 个方案。这属于提示词/契约约束，规则层无法补救。",
        'intake 里 deadline_days=0（合法）→ 0 天与 3 天方案分别是否可通过',
        out,
    )


# ------------------------------------------------------------------ Q3
def q3():
    request_json, adapted = _req(interests=["coffee_food"],
                                interest_confidence={"coffee_food": "confirmed"},
                                hard_exclusions={"tags": ["food"], "terms": [], "unresolved": []})
    out = call_validate(request_json, _clean(
        cand("c1", "手冲咖啡器具", "以冲煮器具为方向，器具本身不是食品。", "180.00", 2, ["other"],
             "咖啡是确认兴趣，器具可绕开不吃食品的限制。", refs=["interest:coffee_food"], unk=UNK_STD),
        cand("c2", "精品咖啡豆礼盒", "以咖啡豆为方向。", "160.00", 2, ["food"],
             "咖啡是确认兴趣。", refs=["interest:coffee_food"], unk=UNK_STD),
        cand("c3", "咖啡风味甜点礼盒", "以咖啡风味点心为方向。", "140.00", 3, ["food"],
             "贴合确认兴趣。", unk=UNK_STD),
    ))
    probe(
        "Q3",
        "用户同时勾选“喜欢咖啡与美食”和“禁止一切食品”时，适配层会不会提示冲突？",
        "实测：适配层**不报任何冲突**，request 正常产出（`status=ready`）；冲突要到候选层才由 "
        "FORBIDDEN_TAG 逐条拒绝。结果：1 个方案可用（器具），2 个被拒。"
        "注意 c3 同时触发了 PREPARATION_TOO_LONG 与 FORBIDDEN_TAG —— 错误聚合是多条并列的。",
        "用户输入的矛盾不会被指出，被扣分的却是候选。若模型顺着“确认兴趣”给出三个食品类方案，"
        "用户会看到 0 个方案，且错误信息是候选级的，他无法判断是自己的输入矛盾。"
        "建议：适配层增加 `INTAKE_PREFERENCE_CONFLICT`（或至少返回一条提醒），把矛盾前移到输入层。",
        'intake 里 interests=["coffee_food"] 且 hard_exclusions.tags=["food"] → 三案结果',
        out,
    )


# ------------------------------------------------------------------ Q4
def q4():
    request_json, adapted = _req(budget_amount="200.00")
    out = call_validate(request_json, _clean(
        cand("c1", "零元占位方案", "以估算尚未确定为名填 0 的方案。", "0.00", 0, ["other"], "探针：候选金额填 0。", unk=UNK_STD),
        cand("c2", "正常方案甲", "以通用日常用品为方向。", "100.00", 1, ["other"], "正常。", unk=UNK_STD),
        cand("c3", "正常方案乙", "以通用消耗品为方向。", "120.00", 2, ["other"], "正常。", unk=UNK_STD),
    ))
    probe(
        "Q4",
        "候选把金额填成 0，规则层会拦住吗？",
        "实测：**不会**。`estimated_total=\"0.00\"` 的候选 `passed=True`（`0 <= budget`，不触发 OVER_BUDGET），"
        "整个批次返回 `status=passed`。而请求侧的 `budget_amount=0` 是会被 `LIMIT_EXCEEDED` 拒绝的。"
        "两侧对“0”的态度不对称。",
        "漏放坏方案：模型若不慎把尚未估算的候选填成 0，规则层会放行，用户会看到一个“0 元方案”并可能选中它。"
        "契约要求“不把未知价格填零”，但这条约定**只靠模型自觉，规则层没有兜底**。"
        "建议：候选侧对 `estimated_total=0` 给出明确处理（拒绝，或强制同时声明“价格未估算”并降级展示）。",
        '候选 estimated_total="0.00" → 是否 passed',
        out,
    )


# ------------------------------------------------------------------ Q5
def q5():
    sys.path.insert(0, _ROOT)
    from workflow import labels
    rel = dict(labels.RELATIONS)
    needle = ["上司", "领导", "老板", "上级", "主管"]
    hits = {k: v for k, v in rel.items() if any(n in v for n in needle)}
    out = {
        "relation_enum_count": len(rel),
        "relation_enum": rel,
        "boss_like_values": hits,
        "product_positioning_groups": [
            "第一优先级：恋人 partner / 追求对象 pursuit",
            "第二优先级：朋友 friend",
            "第三优先级：职场上司、亲戚家人、同学、老师/导师、客户/合作伙伴",
        ],
        "conclusion": (
            "枚举里没有任何值表示“职场上司”（mentor 是老师/导师，client_partner 是客户/合作伙伴）。"
            "产品定位把“职场上司”列为第三优先级关系，但机器值层面无法表达它 —— 只能落到 other（其他），"
            "于是“关系优先级”这条产品规则在代码里对这一档失去依据。"
        ),
    }
    probe(
        "Q5",
        "产品定位里的“职场上司”，在机器枚举里对应哪个值？",
        "实测：**没有对应值**。`labels.RELATIONS` 共 10 个值，含“上司/领导/老板/上级/主管”字样的为 0 个。",
        "契约缺口（跨层）：前端无法提交一个语义正确的值；任何按 `recipient_relation_id` 分流的产品逻辑"
        "（优先级排序、语气、得体度约束）对“给上司送礼”都不生效。"
        "需要产品负责人裁决：新增 `boss`/`supervisor` 值，还是明确“上司”并入某个既有值的语义范围"
        "（并在契约里写清并入理由）。",
        "遍历 `workflow/labels.py` 的 RELATIONS 找出含“上司/领导/老板/上级/主管”的值",
        out,
    )


# ------------------------------------------------------------------ Q6
def q6():
    request_json, adapted = _req()
    obj = json.loads(request_json)
    obj["recipient_relation_id"] = "INJECTED"
    obj["unexpected_field"] = "silently accepted?"
    obj["another_note"] = "x"
    c1 = cand("c1", "方案甲", "以通用用品为方向。", "100.00", 1, ["other"], "正常。", unk=UNK_STD)
    c2 = cand("c2", "方案乙", "以通用消耗品为方向。", "110.00", 1, ["other"], "正常。", unk=UNK_STD)
    c3 = cand("c3", "方案丙", "以通用日用品为方向。", "120.00", 1, ["other"], "正常。", unk=UNK_STD)

    out_a = call_validate(json.dumps(obj, ensure_ascii=False), _clean(c1, c2, c3))

    obj2 = json.loads(request_json)
    obj2["facts"] = {"hacked": True}
    out_b = call_validate(json.dumps(obj2, ensure_ascii=False), _clean(c1, c2, c3))

    probe(
        "Q6",
        "`request` 里塞入未声明字段会怎样？（intake 侧对未知字段是直接报错的）",
        "实测分两种，**并非“完全无检查”**（此处更正我先前的假设）：\n"
        "（a）**字符串型**未知字段（`recipient_relation_id` / `unexpected_field` / `another_note`）"
        f"→ 静默通过，错误列表为空（status={out_a.get('status')}，"
        f"errors={[e['code'] for e in out_a.get('errors', [])]}）；\n"
        "（b）**对象型**未知字段（`facts`）→ 报 `INVALID_TYPE request.facts`"
        f"（status={out_b.get('status')}）。\n"
        "即：request 侧没有字段白名单，只有一层按值类型递归的扫描。",
        "防护强度不对称：intake 侧 11 字段白名单会挡住前端注入（`INTAKE_UNKNOWN_FIELD`），"
        "但 request 侧对未知**字符串**字段是静默接受的。只要有人直接构造 request_json"
        "（其它服务、测试工具、未来第二个前端），就能把未契约化的字段带进规则层而不被察觉。"
        "契约文档里“`recipient_relation_id` 由服务端产出”这条**没有代码层强制**。",
        "构造含 3 个字符串型未知字段的 request_json；再单独构造含对象型未知字段的 request_json",
        {"string_fields_only": out_a, "object_field": out_b},
    )


# ------------------------------------------------------------------ Q7
def q7():
    request_json, adapted = _req(hard_exclusions={"tags": ["alcohol"], "terms": ["酒"], "unresolved": []})
    out = call_validate(request_json, _clean(
        cand("c1", "通用马克杯", "以日常饮具为方向。", "100.00", 1, ["other"], "通用方向。", unk=UNK_STD),
        cand("c2", "精酿礼品组合",
             "以麦芽发酵饮品为核心的组合礼盒为方向。", "180.00", 2, ["other"],
             "按对方日常饮用习惯选择的方向。",
             inf=["可能与常见饮品搭配。"], unk=UNK_STD),
        cand("c3", "中性办公摆件", "以桌面摆件为方向。", "150.00", 2, ["other"], "通用方向。", unk=UNK_STD),
    ))
    probe(
        "Q7",
        "一个语义上属于酒精类的礼物，若不声明 alcohol 标签、且所有文本都不出现用户给的字面词，会被拦住吗？",
        "实测：**拦不住**。c2 的 `passed=True` —— 标签是 `other`（`FORBIDDEN_TAG` 不触发），"
        "全部文本均不含“酒”字（`FORBIDDEN_TERM` 不触发），于是它进入了用户的可选集合。"
        "（上一版探针里我自己的 `reason` 写了“酒”字导致误判，此处已把全部文本清干净后重测。）",
        "**漏放坏方案**（最高风险项，且不依赖恶意构造）：禁忌拦截只有两条路 —— 候选**自己声明的 tags**，"
        "以及**字面串匹配**，两者都不做语义判断。用户明确说了“不要酒”，却可能被推荐并选中酒精类礼物。"
        "本题与 Q8 合起来是一个恶性组合，见 Q8 的结论。",
        'intake 里 tags=["alcohol"] 且 terms=["酒"]；候选 tags=["other"]、全部文本无“酒”字 → 是否 passed',
        out,
    )


# ------------------------------------------------------------------ Q8（新）
def q8():
    request_json, adapted = _req(hard_exclusions={"tags": ["alcohol"], "terms": ["酒"], "unresolved": []})
    out = call_validate(request_json, _clean(
        cand("c1", "无酒精饮品组合",
             "本品不含酒精，也不需要冷藏。", "120.00", 1, ["other"],
             "用户明确不要酒，因此选择不含酒精的方向。",
             inf=["无酒类成分，适合不饮酒的收礼人。"], unk=UNK_STD),
        cand("c2", "通用马克杯", "以日常饮具为方向。", "100.00", 1, ["other"], "通用方向。", unk=UNK_STD),
        cand("c3", "中性办公摆件", "以桌面摆件为方向。", "150.00", 2, ["other"], "通用方向。", unk=UNK_STD),
    ))
    probe(
        "Q8",
        "一个**明确声明“不含酒精/无酒”**的合规方案，会被禁忌检查拦住吗？",
        "实测：**会被拦住，且触发多条错误**。c1 因提供方文本中出现“酒”字，"
        "在 `name` / `description` / `reason` / `inferences` 等字段上各触发一条 `FORBIDDEN_TERM`，"
        "`passed=False`；而两个完全中性的对照方案正常通过。\n"
        "**这是本线发现的最严重缺陷：规则层没有否定语义处理，惩罚的是“老实声明合规”的方案。**",
        "**误杀好方案，并制造反向激励**：模型越是主动声明“不含酒精”“无酒”，越容易被拒；"
        "而把字藏起来（Q7）反而能通过。也就是说，规则门在事实上奖励**隐瞒**、惩罚**披露**。"
        "在 13 个场景里这条路被触发 4 次（S01 / S03 / S12 / S13），全部是我按正常写法写的方案，"
        "**不需要任何刻意构造**。\n"
        "可行动的修法（三选一或组合）：\n"
        "（1）对 `terms` 命中做**否定式上下文识别**（命中词前出现“不含/无/不要/忌/免/非”等否定词时不计命中）；\n"
        "（2）把字面词检查**只作用于候选的名称与描述**，不作用于 `reason` / `inferences` / `unknowns` 这类**解释性文本**（见 Q9）；\n"
        "（3）把 `terms` 的语义交给模型判断，规则层只做**兜底**并明确标注“兜底不完整”。",
        'intake 里 terms=["酒"]；c1 显式写“不含酒精/无酒”，c2/c3 为中性对照 → 三案结果',
        out,
    )


# ------------------------------------------------------------------ Q9（新）
def q9():
    request_json, adapted = _req(hard_exclusions={"tags": [], "terms": ["巧克力"], "unresolved": []})
    out = call_validate(request_json, _clean(
        cand("c1", "通用保温杯", "以日常饮水器具为方向。", "130.00", 1, ["other"],
             "本次临时指定的禁忌为巧克力，本方案不涉及该类别。", unk=UNK_STD),
        cand("c2", "中性桌面摆件", "以桌面摆件为方向。", "110.00", 1, ["other"], "通用方向。", unk=UNK_STD),
        cand("c3", "素色布艺收纳", "以布艺收纳为方向。", "90.00", 2, ["other"], "通用方向。", unk=UNK_STD),
    ))
    probe(
        "Q9",
        "字面词只出现在候选的**解释性文本**（`reason`）里，而礼物本身与禁忌无关，会被拦住吗？",
        "实测：**会被拦住**。c1 的名称与描述完全干净（保温杯），仅 `reason` 里为说明“本方案不涉及该类别”"
        "而提到了那个词，就触发 `FORBIDDEN_TERM candidates[0].reason`，`passed=False`。",
        "误杀好方案：`FORBIDDEN_TERM` 扫描范围包含 `reason` / `inferences` / `unknowns` 三类**解释性字段**，"
        "而这些字段的职责恰恰是**说明候选为何合规、以及还有哪些未知**。"
        "结果是候选越解释越容易被拒 —— 与 Q8 同源（缺乏否定语义 + 扫描面过宽）。"
        "建议把字面词检查收窄到 `name` / `description`，解释性文本改为**记录并提示**而非直接判死。",
        'intake 里 terms=["巧克力"]；c1 仅 reason 提及该词且明确说明不涉及 → 是否 passed',
        out,
    )


def run_all():
    for fn in (q1, q2, q3, q4, q5, q6, q7, q8, q9):
        fn()
    return PROBES


if __name__ == "__main__":
    for p in run_all():
        print("=" * 92)
        print(f"[{p['id']}] {p['question']}")
        raw = p["raw_output"]
        raws = raw if isinstance(raw, dict) and "candidate_results" not in raw else {"only": raw}
        for label, r in raws.items():
            if not isinstance(r, dict) or "status" not in r:
                continue
            print(f"  ({label}) status={r.get('status')} all_passed={r.get('all_passed')}")
            for e in r.get("errors", []):
                print(f"      top: {e['code']} {e['path']}")
            for c in r.get("candidate_results", []):
                print(f"      {c.get('id')} passed={c.get('passed')} "
                      f"errs={[(e['code'], e['path']) for e in c.get('errors', [])]}")
        if not any(isinstance(r, dict) and "status" in r for r in raws.values()):
            print("  " + json.dumps(raw, ensure_ascii=False)[:300])
