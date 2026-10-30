# -*- coding: utf-8 -*-
"""落地件 ④：把契约段（contract-section.md）追加到 docs/validator-contract-decisions.md 末尾。

为什么插在文件**末尾**而不是 §7 表格里：这份文档的 §7 用 `rules.py:NNN` 引用实现行号，
由 `docs/test-reports/contract-001/tools/probe_doc_parity.py` 逐条对账。补丁本身会让
`:165` 之后的 18 处引用位移（+61/+67），插在中间会再叠一次位移，把行号对账彻底搅乱。
追加为独立的 §9 段落 → 既有内容零位移，行号漂移只由补丁引起，来源单一、可一次算清。

写入前校验：文档开工前字节哈希、§8 存在、§9 尚不存在、contract-section.md 自身哈希。
写入后校验：文档字节哈希 == manifest.post_state。

用法：
  python rulefix/apply-package/apply_contract.py --dry-run
  python rulefix/apply-package/apply_contract.py
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DOC_REL = "docs/validator-contract-decisions.md"
MANIFEST = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
SECTION_FILE = HERE / "contract-section.md"
SECTION = SECTION_FILE.read_bytes()
HEADING = "## 9. 字面匹配的定位与责任划分".encode("utf-8")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    declared_section = MANIFEST.get("contract_section_sha256")
    actual_section = sha256(SECTION)
    if declared_section not in (None, "PENDING") and actual_section != declared_section:
        print(f"❌ contract-section.md 自身哈希与 manifest 不符，中止\n"
              f"  声明 {declared_section}\n  实际 {actual_section}")
        return 2
    print(f"✅ 契约段字节哈希：contract-section.md = {actual_section}")

    doc = ROOT / DOC_REL
    raw = doc.read_bytes()
    actual_pre = sha256(raw)
    expected_pre = MANIFEST["pre_state"][DOC_REL]
    if actual_pre != expected_pre:
        print(f"❌ 开工前哈希不符，中止（未写盘）\n  期望 {expected_pre}\n  实际 {actual_pre}")
        return 2
    print(f"✅ 开工前哈希一致：{DOC_REL} = {actual_pre}")

    if b"\r\n" in raw:
        print("❌ 该文档当前是 CRLF，与审计假设（LF）不符，中止")
        return 2
    if not raw.endswith(b"\n"):
        print("❌ 该文档末尾没有换行，中止")
        return 2
    if HEADING in raw:
        print("❌ 该文档已含 §9 标题，疑似重复落地，中止")
        return 2
    if b"## 8." not in raw:
        print("❌ 该文档找不到 §8，锚点不符，中止")
        return 2
    print(f"   锚点检查通过：LF、末尾有换行、无 §9、§8 存在（当前 {len(raw.splitlines())} 行）")

    body = raw + b"\n" + SECTION
    actual_post = sha256(body)
    expected_post = MANIFEST["post_state"][DOC_REL]
    print(f"   追加 {len(SECTION.splitlines())} 行 → 共 {len(body.splitlines())} 行；"
          f"落地后哈希 = {actual_post}")
    if expected_post is not None and actual_post != expected_post:
        print(f"❌ 落地后哈希与 manifest 声明不符，中止（未写盘）\n"
              f"  声明 {expected_post}\n  实际 {actual_post}")
        return 2
    if args.dry_run:
        print(f"\n[dry-run] 未写盘。manifest.post_state['{DOC_REL}'] 应为：\n  {actual_post}")
        return 0

    doc.write_bytes(body)
    written = sha256(doc.read_bytes())
    if written != actual_post:
        print(f"❌ 写盘后复核失败：{written} != {actual_post}")
        return 3
    print(f"✅ 已写入 {DOC_REL}（+§9，字节哈希 {written}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
