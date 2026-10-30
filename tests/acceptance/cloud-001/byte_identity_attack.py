"""CLOUD-001 攻击实验：为"容器 /validate 与本机 validate() 逐字节一致"寻找反例。

**为什么要做这个**：如果比较方法只是"同一个 JSON 被序列化两次"，那么该结论毫无信息量。
因此这里主动构造**可能让两侧分歧**的输入，逐例双跑比对：

    A 侧 = 容器 HTTP 响应体字节（raw）
    B 侧 = 本机进程内 validator.rules.validate() 用同一序列化口径得到的字节

分歧判定（任一成立即为反例）：
    1. 容器 200 但本机抛异常
    2. 容器 200 且字节与 B 侧不同
    3. 容器 500 但本机正常返回（说明容器侧环境导致失败）
    4. 容器 400 但本机认为请求合法

覆盖的分歧来源：Python 补丁版本（3.12.12 vs 3.12.16）、哈希随机化、Unicode 版本（两侧均 15.0.0）、
locale／编码、decimal 语义、递归深度、超长字段、代理对与孤立代理、全角／emoji／组合字符、
数值边界（0／负／超大／指数／负零）、重复键、非法 UTF-8、BOM、未知关系值等。

用法：
    python tests/acceptance/cloud-001/byte_identity_attack.py <base_url> <out_json>
"""

import json
import socket
import json as _json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from validator.rules import validate  # noqa: E402


def dump(v):
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def base_pair():
    cases = {c["id"]: c for c in _json.loads((ROOT / "tests/test_cases.json").read_text(encoding="utf-8"))["cases"]}
    t01 = cases["T01_normal"]
    return _json.loads(_json.dumps(t01["request"])), _json.loads(_json.dumps(t01["candidate_batch"]))


def post(base, body_bytes, timeout=20):
    req = urllib.request.Request(base + "/validate", data=body_bytes, method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Content-Length": str(len(body_bytes))})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception as err:
        return None, f"{type(err).__name__}: {err}".encode()


def local(request_json, candidates_json):
    """返回 (kind, payload)：kind 为 'ok' 或 'raise'。"""
    try:
        return "ok", dump(validate(request_json, candidates_json)).encode("utf-8")
    except Exception as err:
        return "raise", f"{type(err).__name__}: {err}".encode("utf-8")


def scenario_defs():
    """构造 (编号, 说明, request_obj, candidates_obj 或 原始字符串, 是否原始字节) 清单。"""
    req, cand = base_pair()
    out = []

    def add(cid, desc, r, c):
        out.append((cid, desc, r, c, False))

    add("N01", "基线（追求对象，全部通过）", req, cand)

    # --- 关系 ID 全量 ---
    for rid in ["partner", "pursuit", "friend", "family", "classmate", "mentor",
                "client_partner", "other", "colleague", "unknown", "不存在的关系", ""]:
        r = dict(req, recipient_relation=rid)
        add(f"REL-{rid or 'EMPTY'}", f"关系值={rid!r}", r, cand)

    # --- 预算边界 ---
    for amt in ["0", "0.00", "-1", "-0.01", "200.00", "200.01", "999999999999999999999999",
                "1e3", "nan", "Infinity", "  200.00  ", "２００"]:
        c = json.loads(json.dumps(cand))
        c["candidates"][0]["estimated_total"] = amt
        add(f"BUD-{amt!r}", f"候选金额={amt!r}", req, c)

    # --- 期限边界（请求侧）---
    for days in [0, 1, 2, 365, -1, 100000]:
        r = dict(req, available_days=days)
        add(f"DL-{days}", f"available_days={days}", r, cand)

    # --- 期限边界（候选侧）---
    for days in [0, 1, 3, 365]:
        c = json.loads(json.dumps(cand))
        c["candidates"][0]["estimated_preparation_days"] = days
        add(f"CPREP-{days}", f"候选准备天数={days}", req, c)

    # --- 兴趣与事实 ---
    r = dict(req, interests=[], interest_confidence={})
    add("INT-EMPTY", "空 interests（未知偏好，应可继续）", r, cand)
    r = dict(req, interests=["unknown"], interest_confidence={"unknown": "confirmed"})
    add("INT-UNKNOWN", "interests=['unknown']", r, cand)
    r = dict(req, interest_confidence={"coffee_food": "unknown"})
    add("CONF-UNKNOWN", "interest_confidence=unknown", r, cand)
    r = dict(req, facts=[])
    add("FACTS-EMPTY", "facts=[]", r, cand)
    c = json.loads(json.dumps(cand))
    c["candidates"][0]["fact_refs"] = ["f99"]
    add("FACT-REF-99", "fact_refs=['f99']", req, c)

    # --- Unicode 攻击面 ---
    unicode_probes = {
        "FULLWIDTH-DIGIT": "２００",                 # 全角数字
        "FULLWIDTH-ALNUM": "ＡＬＣＯＨＯＬ",          # 全角字母（NFKC→ALCOHOL）
        "TURKISH-I": "İstanbul ıı",                 # 带点大写 I 与无点小写 i（大小写映射差异区）
        "GERMAN-SS": "Straße STRASSE",              # ß 与 SS（casefold 差异区）
        "LIGATURE": "ﬀ ﬂ ﬃ",                        # NFKC 连字
        "CIRCLED": "Ⓐ Ⓑ ①",                         # NFKC 圈号
        "COMBINING": "e\u0301 a\u0300 o\u0308",     # 组合字符（NFC/NFD 差异区）
        "EMOJI-ZWJ": "👩‍💻 🎁👨‍👩‍👧",                  # ZWJ 序列
        "EMOJI-SKIN": "👍🏽 🎁🏿",                     # 肤色修饰符
        "RTL": "مرحبا שלום",                        # 双向文本
        "ZWSP": "酒\u200b类",                        # 零宽空格插在禁忌词中间
        "NBSP": "酒\u00a0类",                        # 不换行空格
        "NUL": "a\u0000b",                          # NUL 字符
        "BOM": "\ufeff前缀",                          # BOM
    }
    for tag, text in unicode_probes.items():
        c = json.loads(json.dumps(cand))
        c["candidates"][0]["description"] = text
        add(f"UNI-{tag}", f"描述注入 {tag}", req, c)

    # --- 禁忌词/标签匹配 ---
    c = json.loads(json.dumps(cand))
    c["candidates"][0]["tags"] = [" Alcohol "]
    add("TAG-CASE", "tags=[' Alcohol ']", req, c)
    c = json.loads(json.dumps(cand))
    c["candidates"][0]["tags"] = ["ＡＬＣＯＨＯＬ"]
    add("TAG-FULLWIDTH", "tags=['ＡＬＣＯＨＯＬ']", req, c)
    c = json.loads(json.dumps(cand))
    c["candidates"][0]["tags"] = ["alcohol", "alcohol"]
    add("TAG-DUP", "tags 重复", req, c)

    # --- 结构异常 ---
    add("STRUCT-NULL-ROOT", "candidates 根为 null", req, None)
    add("STRUCT-ARR-ROOT", "candidates 根为数组", req, [])
    add("STRUCT-NO-CAND", "candidates 缺 candidates 键", req, {})
    add("STRUCT-2-CAND", "只有两个候选", req, {"candidates": cand["candidates"][:2]})
    add("STRUCT-4-CAND", "四个候选", req, {"candidates": cand["candidates"] + [cand["candidates"][0]]})
    c = json.loads(json.dumps(cand))
    c["candidates"][1]["id"] = "c1"
    add("STRUCT-DUP-ID", "候选 ID 重复", req, c)

    # --- 超长字段 ---
    c = json.loads(json.dumps(cand))
    c["candidates"][0]["description"] = "长" * 20000
    add("LONG-DESC-20K", "候选描述 2 万字符", req, c)
    c = json.loads(json.dumps(cand))
    c["candidates"][0]["description"] = "a" * 70000
    add("LONG-DESC-70K", "候选描述 7 万字符", req, c)

    # --- 深度嵌套 ---
    deep = {"candidates": cand["candidates"]}
    node = deep
    for _ in range(120):
        node["x"] = {}
        node = node["x"]
    add("DEEP-120", "额外嵌套 120 层", req, deep)

    # --- 数值类型异常 ---
    for val, name in [(True, "BOOL"), (None, "NULL"), ([], "ARRAY"), ({}, "OBJECT")]:
        c = json.loads(json.dumps(cand))
        c["candidates"][0]["estimated_total"] = val
        add(f"TYPE-{name}", f"金额类型={name}", req, c)

    # --- 原始字节层（非对象、非法 UTF-8、BOM、重复键）---
    out.append(("RAW-TRUNCATED", "截断的 JSON 文本", None, '{"request_json": "', True))
    out.append(("RAW-DUP-KEY", "重复键 request_json", None,
                '{"request_json":"%s","request_json":"%s"}' % (dump({"recipient_relation": "pursuit"}),
                                                               dump(req).replace('"', '\\"')), True))
    out.append(("RAW-BOM", "body 带 UTF-8 BOM", None,
                ('\ufeff' + dump({"request_json": dump(req), "candidates_json": dump(cand)})), True))
    out.append(("RAW-BADUTF8", "body 含非法 UTF-8 字节", None, b"{\xff\xfe}", True))
    out.append(("RAW-ARRAY-TOP", "顶层为数组", None, "[]", True))
    out.append(("RAW-NAN-LITERAL", "JSON 字面量 NaN", None,
                '{"request_json":"{}","candidates_json":"{\\"candidates\\":[{\\"id\\":\\"c1\\",\\"estimated_total\\":NaN}]}"}', True))
    # 孤立代理：必须用 JSON 转义（\ud800）表示，直接编码该字符会 UnicodeEncodeError。
    # 这是有价值的探针：两侧都可能因无法把孤立代理编码成 UTF-8 而失败，需要看失败方式是否一致。
    lone_cand = json.loads(json.dumps(cand))
    lone_cand["candidates"][0]["description"] = "x\ud800y"
    lone_body = json.dumps(
        {"request_json": json.dumps(req, ensure_ascii=True),
         "candidates_json": json.dumps(lone_cand, ensure_ascii=True)},
        ensure_ascii=True, separators=(",", ":"))
    out.append(("RAW-LONE-SURROGATE", "孤立代理 \\ud800（JSON 转义）", None, lone_body, True))
    # 同一内容的"纯 ASCII 请求"对照：请求侧无代理，仅候选侧有
    out.append(("RAW-ASCII-ESCAPED", "全 ASCII 转义请求（对照，应 200 且可比对）", None,
                json.dumps({"request_json": json.dumps(req, ensure_ascii=True),
                            "candidates_json": json.dumps(cand, ensure_ascii=True)},
                           ensure_ascii=True, separators=(",", ":")), True))
    return out


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18000"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs/test-reports/cloud-001/evidence/byte-identity-attack.json"
    results = []
    divergences = []

    for cid, desc, r_obj, c_obj, raw in scenario_defs():
        if raw:
            if isinstance(c_obj, bytes):
                body = c_obj
            else:
                body = c_obj.encode("utf-8", "surrogatepass")
            lkind, lpayload = "n/a(raw)", b""
            rjson = cjson = None
        else:
            rjson = dump(r_obj)
            cjson = dump(c_obj)
            body = dump({"request_json": rjson, "candidates_json": cjson}).encode("utf-8")
            lkind, lpayload = local(rjson, cjson)

        status, sbody = post(base, body)
        # 原始字节用例若本身是合法的 {request_json, candidates_json} 包装，就照样做逐字节比对，
        # 只有无法解析时才退化为"是否受控拒绝"检查。
        if raw:
            try:
                # 用 utf-8-sig 解码：服务端 json.loads(bytes) 会自动识别并剥离 UTF-8 BOM，
                # 我方也必须同样处理，否则会把"服务端正确接受 BOM"误判为分歧。
                wrapper = json.loads(body.decode("utf-8-sig"))
                rjson = wrapper["request_json"]
                cjson = wrapper["candidates_json"]
                lkind, lpayload = local(rjson, cjson)
                raw = False
            except Exception:
                raw = True

        entry = {
            "id": cid, "desc": desc, "request_bytes": len(body),
            "server_status": status, "server_bytes": len(sbody),
            "local_kind": lkind, "local_bytes": len(lpayload),
            "identical": None, "verdict": "",
        }
        if raw:
            entry["verdict"] = "原始字节用例：仅核对服务端是否受控拒绝"
            entry["server_body"] = sbody[:200].decode("utf-8", "replace")
            entry["divergent"] = not (status in (400, 413, 500) and len(sbody) < 400)
        elif status == 200 and lkind == "ok":
            entry["identical"] = sbody == lpayload
            entry["verdict"] = "逐字节一致" if entry["identical"] else "字节不一致"
            entry["divergent"] = not entry["identical"]
            if not entry["identical"]:
                entry["server_body"] = sbody[:300].decode("utf-8", "replace")
                entry["local_body"] = lpayload[:300].decode("utf-8", "replace")
        elif status == 200 and lkind == "raise":
            entry["verdict"] = "容器返回 200 但本机抛异常（分歧）"
            entry["divergent"] = True
            entry["local_error"] = lpayload.decode("utf-8", "replace")
            entry["server_body"] = sbody[:300].decode("utf-8", "replace")
        elif status == 500:
            same = lkind == "raise"
            entry["verdict"] = ("两侧均失败（一致：本机抛异常/容器 500）" if same
                                else "仅容器 500，本机正常（分歧）")
            entry["divergent"] = not same
            entry["local_error"] = lpayload.decode("utf-8", "replace") if lkind == "raise" else None
            entry["server_body"] = sbody[:200].decode("utf-8", "replace")
        elif status in (400, 413):
            entry["verdict"] = "服务端受控拒绝（请求层）"
            entry["divergent"] = False
            entry["server_body"] = sbody[:200].decode("utf-8", "replace")
        else:
            entry["verdict"] = f"未预期状态 {status}"
            entry["divergent"] = True
            entry["server_body"] = sbody[:200].decode("utf-8", "replace")

        if entry.get("divergent"):
            divergences.append(cid)
        results.append(entry)

    ok_pairs = [e for e in results if e["server_status"] == 200 and e["local_kind"] == "ok"]
    doc = {
        "suite": "CLOUD-001 攻击实验：逐字节一致的寻找反例",
        "base_url": base,
        "method": ("A=容器 HTTP 响应体原始字节；B=本机 validator.rules.validate() 以 "
                   "json.dumps(ensure_ascii=False, separators=(',',':')) 编码的字节；逐例比对。"),
        "cases": len(results),
        "comparable_200_pairs": len(ok_pairs),
        "all_200_pairs_identical": all(e["identical"] for e in ok_pairs),
        "divergences": divergences,
        "results": results,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"cases={doc['cases']} 双侧均 200 的可比对数={doc['comparable_200_pairs']} "
          f"全部逐字节一致={doc['all_200_pairs_identical']}")
    print("分歧用例:", divergences or "无")
    for e in results:
        print(f"  {e['id']:<22} 容器={e['server_status']} 本机={e['local_kind']:<6} {e['verdict']}")
    print("evidence:", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
