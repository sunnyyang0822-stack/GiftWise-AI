# -*- coding: utf-8 -*-
"""落地件 ②：重钉 tests/acceptance/stage_b/pinned_hashes.json。

字段结构**逐键照抄** QA 线 2026-10-31 01:20 的版本（notice / baseline_date / pinned_at /
baseline_owner / approved_by / reason / why_not_edit_review / superseded_review /
superseded_sha256 / changed_since_review / files），只更新该更新的三个：

  * `files`              —— 指向落地后的真实字节哈希（关键：不重钉则 `test_hash_1` 必红）
  * `changed_since_review` —— 相对 2026-10-29 评审的**累计**变更（不是只写本批次）
  * `pinned_at` / `approved_by` / `reason` —— 记录本次重钉的时刻与授权

**刻意不动** `superseded_review` 与 `superseded_sha256`：stage_b 的
`test_review_manifest_has_four_files` 会断言 `superseded_sha256` 与
`docs/pm-reviews/val-001-rereview-2026-10-29.md` 逐条相等，把它改成「上一版基线」会让该断言失败，
而且那是 B 类历史记录，不得改写。详见 repin-plan.md「为什么 superseded_sha256 一个字都不能动」。

`pinned_at` 是落地时刻 → 真实字节哈希不确定；故 manifest.post_state 钉的是
`canonical_pinned_at` 下的规范化哈希，本脚本写盘后按 canonical 复算并比对。

用法：
  python rulefix/apply-package/repin.py --dry-run [--pinned-at ISO8601]
  python rulefix/apply-package/repin.py [--pinned-at ISO8601]
"""
import argparse
import hashlib
import json
import sys
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TARGET_REL = "tests/acceptance/stage_b/pinned_hashes.json"
MANIFEST = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
CN = timezone(timedelta(hours=8))

PINNED_FILES = ["validator/__init__.py", "validator/rules.py",
                "tests/test_validator.py", "tests/test_cases.json"]
# 未参与本批次、也不应漂移的两个文件（QA 线 01:20 钉住值）；漂移即中止。
UNTOUCHED_EXPECTED = {
    "validator/__init__.py": "f94446ea4292f37bfb11d9db94f7ef6fc1c5823d00ab5a631a36c6126fb50bc5",
    "tests/test_validator.py": "9c83a4c6c6341ed54c724498ca4d1bab6c196071c7809c6d144696d2339c601e",
}

REASON = ("规则门否定语义修复落地（validator/rules.py +69/−2：否定语境识别；"
          "同批次 +6 条回归用例）后，规则源码与用例集发生经 PM 早间决策「同意落地」授权的合法变更，"
          "导致 2026-10-31 01:20 的钉住值过时。")

APPROVED_BY = ("PM（2026-10-31 早间决策「同意落地」四项条件之第 1 项：同一批次重钉本基线；"
               "由规则门修复线执行）")

CHANGED = OrderedDict([
    ("validator/__init__.py", "未变（自 2026-10-29 评审以来未改动）"),
    ("validator/rules.py",
     "累计 +74/−2：先 +5 行请求侧范围校验（2026-10-30），再 +69/−2 否定语境识别"
     "（2026-10-31，rulefix/negation-fix.diff）；278 行 → 345 行"),
    ("tests/test_validator.py",
     "累计 +6/−2（2026-10-30）：test_decimal_boundary_ignores_context_rounding 改用 "
     "10000 / 10000.00 / 10000.01（超上界会先被 LIMIT_EXCEEDED 拦下，测不到候选侧）"),
    ("tests/test_cases.json",
     "累计 313 → 326 条（+13/−0）：2026-10-30 新增 7 条请求侧范围用例；2026-10-31 新增 6 条"
     "否定路径与真阳性用例（RF01–RF06，其中 RF04 是断言「仍被拒」的已知限制固定夹具）"),
])


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha(rel: str) -> str:
    return sha256((ROOT / rel).read_bytes())


def render(meta: dict, pinned_at: str) -> bytes:
    out = OrderedDict()
    out["notice"] = meta["notice"]
    out["baseline_date"] = meta["baseline_date"]
    out["pinned_at"] = pinned_at
    out["baseline_owner"] = meta["baseline_owner"]
    out["approved_by"] = APPROVED_BY
    out["reason"] = REASON
    out["why_not_edit_review"] = meta["why_not_edit_review"]
    out["superseded_review"] = meta["superseded_review"]
    out["superseded_sha256"] = meta["superseded_sha256"]      # 一个字都不动
    out["changed_since_review"] = dict(CHANGED)
    out["files"] = {name: file_sha(name) for name in PINNED_FILES}
    return (json.dumps(out, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--pinned-at", default=None,
                    help="ISO8601（含 +08:00）；缺省 = 本机当前 +08:00 时刻")
    args = ap.parse_args()

    target = ROOT / TARGET_REL
    raw = target.read_bytes()
    actual_pre = sha256(raw)
    expected_pre = MANIFEST["pre_state"][TARGET_REL]
    if actual_pre != expected_pre:
        print(f"❌ 开工前哈希不符，中止（未写盘）\n  期望 {expected_pre}\n  实际 {actual_pre}")
        return 2
    print(f"✅ 开工前哈希一致：{TARGET_REL} = {actual_pre}")

    meta = json.loads(raw.decode("utf-8"), object_pairs_hook=OrderedDict)
    if list(meta.keys()) != ["notice", "baseline_date", "pinned_at", "baseline_owner",
                             "approved_by", "reason", "why_not_edit_review",
                             "superseded_review", "superseded_sha256",
                             "changed_since_review", "files"]:
        print(f"❌ 键结构或顺序与 QA 线版本不一致，中止：{list(meta.keys())}")
        return 2
    if set(meta["files"]) != set(PINNED_FILES):
        print(f"❌ 钉住的文件集合与预期不符，中止：{sorted(meta['files'])}")
        return 2

    # 前置：补丁与用例必须已落地，且两个未参与本批次的文件不得漂移
    problems = []
    for rel in ("validator/rules.py", "tests/test_cases.json"):
        got = file_sha(rel)
        want = MANIFEST["post_state"][rel]
        if want is not None and got != want:
            problems.append(f"{rel} 落地后哈希不符：{got}（应为 {want}）")
    for rel, want in UNTOUCHED_EXPECTED.items():
        got = file_sha(rel)
        if got != want:
            problems.append(f"{rel} 不应变化，实际 {got}（QA 线钉住值 {want}）")
    if problems:
        print("❌ 前置条件不满足，中止（未写盘）：")
        for p in problems:
            print(f"   - {p}")
        return 2
    print("✅ 前置通过：rules.py 与 test_cases.json 已是落地后哈希，两个未参与文件未漂移")

    pinned_at = args.pinned_at or datetime.now(CN).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    if args.pinned_at is None and not args.dry_run:
        print(f"   本次 pinned_at = {pinned_at}（本机 +08:00 时刻）")

    body = render(meta, pinned_at)
    print("   files 将写为：")
    for name, digest in json.loads(body.decode("utf-8"))["files"].items():
        print(f"     {name:<28} {digest}")
    print(f"   superseded_sha256 保持不动（{len(meta['superseded_sha256'])} 条，"
          f"与 2026-10-29 评审逐条一致）")
    print(f"   落地后哈希（{pinned_at}）= {sha256(body)}")

    # canonical 复算：证明结构与内容与审计一致，与落地时刻无关
    canonical_at = MANIFEST["canonical_pinned_at"]
    canonical_hash = sha256(render(meta, canonical_at))
    expected_post = MANIFEST["post_state"][TARGET_REL]
    print(f"   canonical 复算（{canonical_at}）= {canonical_hash}")
    if expected_post is not None and canonical_hash != expected_post:
        print(f"❌ canonical 哈希与 manifest 声明不符，中止（未写盘）\n"
              f"  声明 {expected_post}\n  实际 {canonical_hash}")
        return 2

    if args.dry_run:
        print(f"\n[dry-run] 未写盘。manifest.post_state['{TARGET_REL}']（canonical）= \n"
              f"  {canonical_hash}")
        return 0

    target.write_bytes(body)
    written = json.loads(target.read_text(encoding="utf-8"))
    if written["files"] != json.loads(body.decode("utf-8"))["files"]:
        print("❌ 写盘后复核失败：files 不一致")
        return 3
    if sha256(render(meta, canonical_at)) != canonical_hash:
        print("❌ 写盘后 canonical 复算失败")
        return 3
    print(f"✅ 已写入 {TARGET_REL}（pinned_at={pinned_at}，字节哈希 {sha256(target.read_bytes())}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
