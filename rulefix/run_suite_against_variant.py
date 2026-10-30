# -*- coding: utf-8 -*-
"""用**真实的测试套件**跑沙箱变体（不修改任何生产文件）。

做法：先把变体模块冒充成 `validator.rules` 注入 sys.modules，
再让 unittest 去 discover 真实测试。这样跑的是真套件、真断言，不是数据回放。

用法： python rulefix/run_suite_against_variant.py
"""
import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# ---- 1) 先把变体装成 validator.rules（在任何测试模块 import 之前）----
spec = importlib.util.spec_from_file_location(
    "validator.rules", ROOT / "rulefix" / "variant" / "rules_negfix.py")
variant = importlib.util.module_from_spec(spec)
spec.loader.exec_module(variant)

import validator  # noqa: E402

sys.modules["validator.rules"] = variant
validator.rules = variant
validator.validate = variant.validate

print("已完成注入：validator.rules → rulefix/variant/rules_negfix.py")
print(f"  variant.validate 指纹 = {variant.validate.__module__}")
print(f"  validator.validate 现指向 = {validator.validate.__module__}")
print()

TARGETS = [
    ("tests（主套件，即对外口径的 329）", "tests", "test_validator.py"),
    ("tests/acceptance/stage_b（275）", "tests/acceptance/stage_b", "test_*.py"),
    ("tests/acceptance/stage_c（39）", "tests/acceptance/stage_c", "test_*.py"),
    ("tests/acceptance/boundary（45）", "tests/acceptance/boundary", "test_*.py"),
]

summary = []
for label, start, pattern in TARGETS:
    loader = unittest.TestLoader()
    try:
        suite = loader.discover(start, pattern=pattern)
    except Exception as exc:  # noqa: BLE001
        print(f"--- {label}: discover 失败 {exc!r}")
        summary.append((label, None, None, None))
        continue
    buffer = io.StringIO()
    with redirect_stdout(buffer), redirect_stderr(buffer):
        result = unittest.TextTestRunner(verbosity=0, stream=buffer).run(suite)
    print(f"--- {label}")
    print(f"    Ran {result.testsRun}  failures={len(result.failures)}  errors={len(result.errors)}"
          f"  → {'OK' if result.wasSuccessful() else 'FAILED'}")
    for case, _tb in result.failures[:5]:
        print(f"      FAIL {case}")
    for case, _tb in result.errors[:5]:
        print(f"      ERROR {case}")
    summary.append((label, result.testsRun, len(result.failures), len(result.errors)))

print()
print("=" * 70)
print("汇总（变体注入后）")
print("=" * 70)
for label, ran, fails, errs in summary:
    if ran is None:
        print(f"  {label}: discover 失败")
    else:
        print(f"  {label}: Ran {ran}, failures={fails}, errors={errs}, "
              f"{'OK' if not fails and not errs else 'FAILED'}")
print()
print("说明：stage_b 的失败项若仍是 test_hash_1/2/3，那是**钉住的是生产文件哈希**，")
print("      与本次变体无关（生产文件未被本脚本改动）。")
