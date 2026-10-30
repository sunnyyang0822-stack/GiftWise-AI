# -*- coding: utf-8 -*-
"""把真实的 tests/acceptance/boundary/test_cross_layer_gate.py 跑在变体枚举上。

不修改任何生产文件、测试文件：
  - 只在内存里把 workflow.labels.RELATIONS 换成变体表（该测试在方法内部
    `from workflow.labels import RELATIONS`，因此能读到被替换的属性）；
  - 跑完立刻还原。

用法： python bossfix/run_real_assertions_against_variant.py
"""
import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stderr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from workflow import labels as labels_mod          # noqa: E402

VAR_LABELS = ROOT / "bossfix" / "variant" / "labels.py"
TEST_FILE = ROOT / "tests" / "acceptance" / "boundary" / "test_cross_layer_gate.py"
TARGET = "CrossLayerContractGate.test_relation_enum_has_exactly_the_frozen_membership"


def load_variant_relations():
    spec = importlib.util.spec_from_file_location("bossfix_var_labels_runner", VAR_LABELS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.RELATIONS


def load_test_module():
    spec = importlib.util.spec_from_file_location("bossfix_cross_layer_gate", TEST_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(relations_table, label):
    original = labels_mod.RELATIONS
    labels_mod.RELATIONS = relations_table
    try:
        module = load_test_module()
        suite = unittest.TestLoader().loadTestsFromName(TARGET, module)
        stream = io.StringIO()
        with redirect_stderr(stream):
            outcome = unittest.TextTestRunner(stream=stream, verbosity=0).run(suite)
        text = stream.getvalue()
        failed = len(outcome.failures) + len(outcome.errors)
        print(f"--- {label} ---")
        print(f"用例 {TARGET}")
        print(f"  运行 = {outcome.testsRun}  失败/错误 = {failed}")
        if outcome.failures:
            for _, tb in outcome.failures:
                print("  失败原文：")
                for line in tb.strip().splitlines():
                    print("    " + line)
        if outcome.errors:
            for _, tb in outcome.errors:
                print("  错误原文：")
                for line in tb.strip().splitlines():
                    print("    " + line)
        print()
        return {"label": label, "tests_run": outcome.testsRun, "failed": failed,
                "failures": [tb for _, tb in outcome.failures],
                "errors": [tb for _, tb in outcome.errors]}
    finally:
        labels_mod.RELATIONS = original


def main():
    print("=" * 78)
    print("把真实测试文件跑在变体枚举上（生产文件零改动）")
    print("=" * 78)
    print(f"测试文件：{TEST_FILE.relative_to(ROOT)}")
    print(f"变体枚举：{VAR_LABELS.relative_to(ROOT)}")
    print()

    frozen = run(dict(labels_mod.RELATIONS), "A 冻结版（10 键，= 仓库当前生产文件）")
    variant = run(load_variant_relations(), "B 变体版（11 键，含 boss）")

    print("=" * 78)
    print("结论")
    print("=" * 78)
    print(f"  冻结版：失败 {frozen['failed']} / 运行 {frozen['tests_run']}"
          f"  → {'该断言当前通过' if frozen['failed'] == 0 else '当前已失败'}")
    print(f"  变体版：失败 {variant['failed']} / 运行 {variant['tests_run']}"
          f"  → {'加 boss 后该断言失败' if variant['failed'] else '加 boss 后仍通过'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
