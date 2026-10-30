"""执行独立套件，写全新证据目录，不覆盖先前运行。"""

from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
import unittest
from uuid import uuid4

import test_validator_acceptance as acceptance


ROOT = acceptance.ROOT
TZ = timezone(timedelta(hours=8))


def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in acceptance.EXPECTED_HASHES}


class RecordingResult(unittest.TextTestResult):
    def startTest(self, test):
        super().startTest(test)
        self.started = time.perf_counter()

    def record(self, test, status, detail=None):
        self.records.append({"test_id": test.id(), "status": status, "detail": detail,
                             "elapsed_seconds": time.perf_counter() - self.started,
                             "observation": acceptance.OBSERVATIONS.get(test.id())})

    def addSuccess(self, test):
        super().addSuccess(test)
        self.record(test, "passed")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.record(test, "failed", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self.record(test, "error", self._exc_info_to_string(err, test))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.record(test, "skipped", reason)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.records = []


def main():
    now = datetime.now(TZ)
    evidence = ROOT / "docs/test-reports/stage-b" / (now.strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:8])
    evidence.mkdir(parents=True, exist_ok=False)
    before = hashes()
    commands = []
    for command in ([sys.executable, "--version"], ["git", "rev-parse", "HEAD"],
                    ["git", "branch", "--show-current"], ["git", "status", "--short"], ["git", "diff", "--check"]):
        process = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        commands.append({"argv": command, "exit_code": process.returncode, "stdout": process.stdout, "stderr": process.stderr})
    stream = io.StringIO()
    runner = unittest.TextTestRunner(stream=stream, verbosity=2, resultclass=RecordingResult)
    result = runner.run(unittest.defaultTestLoader.loadTestsFromModule(acceptance))
    after = hashes()
    tests_stable = before == after
    review_matched = before == acceptance.EXPECTED_HASHES
    exit_code = 0 if result.wasSuccessful() and tests_stable and review_matched else 1
    summary = {"started_at": now.isoformat(), "finished_at": datetime.now(TZ).isoformat(),
               "timezone": "Asia/Shanghai", "cwd": str(ROOT), "python": sys.version,
               "executable": sys.executable, "platform": platform.platform(),
               "command": "python tests/acceptance/stage_b/run_acceptance.py",
               "commands": commands, "review": str(acceptance.REVIEW), "baseline": str(acceptance.BASELINE),
               "expected_sha256": acceptance.EXPECTED_HASHES, "before_sha256": before, "after_sha256": after,
               "hashes_match_review": review_matched, "delivered_files_unchanged": tests_stable,
               "case_count": len(acceptance.CASES), "tests_run": result.testsRun,
               "counts": dict(Counter(r["status"] for r in result.records)),
               "exit_code": exit_code, "group_counts": dict(Counter(c["group"] for c in acceptance.CASES)),
               "test_asset_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                                     for p in Path(__file__).parent.iterdir() if p.is_file()},
               "independence_limit": "另建契约用例与断言，不读取开发 fixture；本聊天此前参与开发，并非人员隔离验收。",
               "scope": "仅本地离线校验；不证明 Dify、真实模型修订、前端、包装或云部署。"}
    (evidence / "unittest.txt").write_text(stream.getvalue(), encoding="utf-8")
    (evidence / "results.json").write_text(json.dumps(result.records, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    (evidence / "summary.json").write_text(json.dumps(summary, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"evidence": str(evidence), "tests": result.testsRun, "counts": summary["counts"],
                      "exit_code": exit_code, "hashes_match_review": review_matched, "unchanged": tests_stable}))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
