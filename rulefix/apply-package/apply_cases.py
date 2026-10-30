# -*- coding: utf-8 -*-
"""落地件 ③：把 6 条回归用例追加进 tests/test_cases.json。

设计要点（为什么不是 `git apply` 一个 diff）：
  * `tests/test_cases.json` 在 `.gitattributes` 里是 `-text` —— 工作区是 **CRLF**，且
    阶段 B 按**原始字节** sha256 核对。文本 diff 一旦被任何工具做过换行规范化就会失配。
  * 因此这里做「序列化确定性」等价物：先校验开工前字节哈希，再按原换行风格重建整份文件，
    最后校验落地后字节哈希。哈希对不上就中止（fail-closed），不做部分写入。
  * 落点理由见同目录 `new-regression-cases.md`：追加到数组末尾，零行位移，
    `tests/test_validator.py` 会为每条自动生成一个 fixture 测试，无需改任何生产测试文件。

用法：
  python rulefix/apply-package/apply_cases.py --dry-run   # 只算哈希，不写盘，并跑实现自检
  python rulefix/apply-package/apply_cases.py             # 真正写入（写入前仍会跑实现自检）
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TARGET_REL = "tests/test_cases.json"
MANIFEST = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
NEW = json.loads((HERE / "regression-cases.json").read_text(encoding="utf-8"))
REQUIRED = ("id", "request", "candidate_batch", "expected")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build(data: dict, cases: list, crlf: bool) -> bytes:
    merged = dict(data)
    merged["cases"] = list(data["cases"]) + list(cases)
    body = json.dumps(merged, ensure_ascii=False, indent=2).encode("utf-8")
    if crlf:
        body = body.replace(b"\n", b"\r\n")
    return body + (b"\r\n" if crlf else b"\n")


def verify_against_implementation(cases: list) -> None:
    """在写盘前用**当前已打补丁的** validator 复核 6 条用例，逐条比对 expected。

    这是本脚本最有价值的一道闸：它让「用例原文」与「真实实现行为」在落地前对上，
    而不是等 335 项套件跑完才发现某条 case 写错了断言。
    """
    sys.path.insert(0, str(ROOT))
    from validator import validate  # noqa: E402

    failures = []
    for case in cases:
        out = validate(json.dumps(case["request"], ensure_ascii=False),
                       json.dumps(case["candidate_batch"], ensure_ascii=False))
        errs = out["errors"] + [e for c in out["candidate_results"] for e in c["errors"]]
        exp = case["expected"]
        problems = []
        if out["status"] != exp["status"]:
            problems.append(f"status {out['status']!r} != {exp['status']!r}")
        if out["all_passed"] != exp["all_passed"]:
            problems.append(f"all_passed {out['all_passed']} != {exp['all_passed']}")
        if "candidate_passed" in exp:
            got = [c["passed"] for c in out["candidate_results"]]
            if got != exp["candidate_passed"]:
                problems.append(f"candidate_passed {got} != {exp['candidate_passed']}")
        if "code" in exp:
            hit = [e for e in errs if e["code"] == exp["code"]
                   and e["path"] == exp.get("path")]
            if not hit:
                problems.append(f"缺少 {exp['code']}@{exp.get('path')}，实际 "
                                f"{[(e['code'], e['path']) for e in errs]}")
        print(f"  [{'OK ' if not problems else 'BAD'}] {case['id']:<52} "
              f"status={out['status']:<7} all_passed={out['all_passed']}")
        for p in problems:
            print(f"        ↳ {p}")
        failures += problems
    if failures:
        raise SystemExit(f"❌ 实现自检失败：{len(failures)} 处与 expected 不符，未写盘")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只计算与自检，不写文件")
    ap.add_argument("--no-verify", action="store_true", help="跳过实现自检（仅用于诊断）")
    args = ap.parse_args()

    target = ROOT / TARGET_REL
    raw = target.read_bytes()
    actual_pre = sha256(raw)
    expected_pre = MANIFEST["pre_state"][TARGET_REL]
    if actual_pre != expected_pre:
        print(f"❌ 开工前哈希不符，中止（未写盘）\n  期望 {expected_pre}\n  实际 {actual_pre}")
        return 2
    print(f"✅ 开工前哈希一致：{TARGET_REL} = {actual_pre}")

    crlf = b"\r\n" in raw
    data = json.loads(raw.decode("utf-8"))
    print(f"   换行风格 = {'CRLF' if crlf else 'LF'}；当前用例数 = {len(data['cases'])}")

    ids = [c["id"] for c in NEW]
    if len(set(ids)) != len(ids):
        print("❌ regression-cases.json 内部 ID 重复")
        return 2
    overlap = set(ids) & {c["id"] for c in data["cases"]}
    if overlap:
        print(f"❌ 以下用例 ID 已存在于 {TARGET_REL}，疑似重复落地：{sorted(overlap)}")
        return 2
    for case in NEW:
        missing = [k for k in REQUIRED if k not in case]
        if missing:
            print(f"❌ 用例 {case.get('id')} 缺字段 {missing}")
            return 2

    if not args.no_verify:
        print("   —— 写盘前实现自检（对当前 validator 逐条复核 expected）——")
        verify_against_implementation(NEW)

    body = build(data, NEW, crlf)
    actual_post = sha256(body)
    expected_post = MANIFEST["post_state"][TARGET_REL]
    print(f"   落地后用例数 = {len(data['cases']) + len(NEW)}；"
          f"落地后哈希 = {actual_post}")
    if expected_post is not None and actual_post != expected_post:
        print(f"❌ 落地后哈希与 manifest 声明不符，中止（未写盘）\n"
              f"  声明 {expected_post}\n  实际 {actual_post}")
        return 2
    if args.dry_run:
        print(f"\n[dry-run] 未写盘。manifest.post_state['{TARGET_REL}'] 应为：\n  {actual_post}")
        return 0

    target.write_bytes(body)
    written = sha256(target.read_bytes())
    if written != actual_post:
        print(f"❌ 写盘后复核失败：{written} != {actual_post}")
        return 3
    print(f"✅ 已写入 {TARGET_REL}（+{len(NEW)} 条用例，字节哈希 {written}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
