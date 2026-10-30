"""QA-001 阶段 C 证据生成器。

运行 `tests/acceptance/stage_c/test_stage_c_workflow.py` 的全部用例，把逐例输入／预期／实际／判定
写入 `docs/test-reports/stage-c/<时间戳>/`，并附带环境、命令、Git SHA、时区时间与原始证据副本。
失败时返回非零退出码。不覆盖已有证据目录（使用独占创建）。

同时真实测量一次完整离线链路（intake→check→recheck→report）的耗时，并给出
“调用次数／延迟／成本”记录方案的实际取值：model_calls 必须为 0，cost 记为 not_measured。

用法：
    python tests/acceptance/stage_c/run_stage_c.py
"""

import datetime
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests" / "acceptance" / "stage_c"))

TZ = datetime.timezone(datetime.timedelta(hours=8))
SUITE_DIR = ROOT / "tests" / "acceptance" / "stage_c"
REPORTS = ROOT / "docs" / "test-reports" / "stage-c"
RAW_EVIDENCE = REPORTS / "evidence"


def git_head():
    """不用管道读取 git SHA（受限沙箱下匿名管道可能被拒）。"""
    with tempfile.TemporaryFile() as sink:
        proc = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, stdout=sink, stderr=subprocess.DEVNULL)
        if proc.returncode != 0:
            return None
        sink.seek(0)
        return sink.read().decode("utf-8").strip()


def git_dirty_summary():
    with tempfile.TemporaryFile() as sink:
        proc = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, stdout=sink, stderr=subprocess.DEVNULL)
        sink.seek(0)
        lines = sink.read().decode("utf-8", "replace").strip().splitlines()
    return {"command": "git status --porcelain", "returncode": proc.returncode,
            "changed_count": len(lines), "entries": lines[:80]}


def measure_offline_pipeline():
    """真实测量一次完整离线链路的延迟；不调用模型。"""
    from workflow import runtime
    from workflow.intake import adapt_intake

    intake_data = json.loads((SUITE_DIR / "cases.json").read_text(encoding="utf-8"))["baseline_intake"]
    batch = json.loads((SUITE_DIR / "cases.json").read_text(encoding="utf-8"))["baseline_candidates"]
    over = json.loads(json.dumps(batch))
    over["candidates"][0]["estimated_total"] = "250.00"

    dump = lambda v: json.dumps(v, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    stages = []
    t0 = time.monotonic()
    result = adapt_intake(dump(intake_data))
    stages.append({"stage": "intake", "seconds": round(time.monotonic() - t0, 6), "ok": result["status"] == "ready"})
    request_json = result["request_json"]
    t1 = time.monotonic()
    state = runtime.check(request_json, dump(over), 0)
    stages.append({"stage": "check_first", "seconds": round(time.monotonic() - t1, 6), "ok": state["repairable"] is True})
    t2 = time.monotonic()
    state = runtime.recheck(request_json, dump(over), dump(batch), 0)
    stages.append({"stage": "recheck", "seconds": round(time.monotonic() - t2, 6),
                   "ok": state["validation"]["all_passed"] is True and state["repair_count"] == 1})
    t3 = time.monotonic()
    report = runtime.report(state)
    stages.append({"stage": "report", "seconds": round(time.monotonic() - t3, 6),
                   "ok": report["selected_candidate_id"] is None and report["selectable_candidate_ids"] == ["c1", "c2", "c3"]})
    return {
        "mode": "offline-fixed-snapshots-no-model",
        "model_calls": 0,
        "cost": "not_measured",
        "cost_note": "无模型调用即无计费；未取得任何费率依据，缺数据记 not_measured，不填 0",
        "cloud_verified": False,
        "latency_clock": "time.monotonic",
        "stages": stages,
        "total_seconds": round(sum(s["seconds"] for s in stages), 6),
        "dify_real_run_latency": _dify_latency(),
    }


def _dify_latency():
    path = RAW_EVIDENCE / "dify-run-evidence.json"
    if not path.exists():
        return {"available": False, "note": "未找到独立 Dify 证据文件；不在报告中给出任何 Dify 延迟数字"}
    ev = json.loads(path.read_text(encoding="utf-8"))
    run = ((ev.get("run_sse") or {}).get("parsed")) or {}
    code_node = next((n for n in run.get("nodes", []) if n.get("node_type") == "code"), None)
    return {
        "available": True,
        "source": "docs/test-reports/stage-c/evidence/dify-run-evidence.json",
        "workflow_run_id": run.get("workflow_run_id"),
        "code_node_elapsed_time_seconds": (code_node or {}).get("elapsed_time"),
        "workflow_elapsed_time_seconds": run.get("workflow_elapsed_time"),
        "total_tokens": run.get("total_tokens"),
        "note": "无模型调用的探针耗时，不可当作业务延迟",
    }


def main():
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=str(SUITE_DIR), pattern="test_*.py")
    started = datetime.datetime.now(TZ)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    finished = datetime.datetime.now(TZ)

    import test_stage_c_workflow as suite_module
    observations = sorted(suite_module.OBSERVATIONS.values(), key=lambda o: o["id"])

    stamp = started.strftime("%Y%m%d-%H%M%S")
    out_dir = REPORTS / stamp
    try:
        out_dir.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        print("证据目录已存在，未覆盖：", out_dir, file=sys.stderr)
        return 2

    failed = [o for o in observations if not o["passed"]]
    record = {
        "suite": "QA-001 阶段 C：工作流层独立验收",
        "role": "GiftWise｜测试验收 Agent（独立复核，不采信开发方声明）",
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "timezone": "Asia/Shanghai (+08:00)",
        "command": "python tests/acceptance/stage_c/run_stage_c.py",
        "git_head": git_head(),
        "git_worktree": git_dirty_summary(),
        "environment": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
        },
        "totals": {
            "cases_recorded": len(observations),
            "unittest_run": result.testsRun,
            "passed": len(observations) - len(failed),
            "failed": len(failed),
            "errors": len(result.errors),
            "unittest_failures": len(result.failures),
        },
        "model_calls": 0,
        "cloud_model_calls": 0,
        "cloud_verified": False,
        "metrics": measure_offline_pipeline(),
        "results": observations,
        "raw_dify_evidence": "docs/test-reports/stage-c/evidence/dify-run-evidence.json",
    }

    (out_dir / "stage-c-results.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# 阶段 C 逐例证据（QA-001 独立复核）",
        "",
        f"- 运行时间：{record['started_at']} → {record['finished_at']}（Asia/Shanghai）",
        f"- 命令：`{record['command']}`",
        f"- Git HEAD：`{record['git_head']}`（工作区有 {record['git_worktree']['changed_count']} 项未提交改动，逐项见 JSON）",
        f"- Python：{record['environment']['python']}；平台：{record['environment']['platform']}",
        f"- 用例：{record['totals']['cases_recorded']} 项，通过 {record['totals']['passed']}，失败 {record['totals']['failed']}",
        f"- 模型调用：{record['model_calls']}（真实未调用）；cloud_verified：{record['cloud_verified']}",
        "",
        "| 编号 | 分组 | 用例 | 预期 | 实际（摘要） | 判定 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for o in observations:
        actual = json.dumps(o["actual"], ensure_ascii=False)
        if len(actual) > 220:
            actual = actual[:217] + "…"
        lines.append(f"| {o['id']} | {o['group']} | {o['title']} | {o['expected']} | `{actual}` | "
                     f"{'通过' if o['passed'] else '**失败**'} |")
    lines += [
        "",
        "## 延迟与调用记录（实际测量）",
        "",
        "| 阶段 | 秒 | 说明 |",
        "| --- | ---: | --- |",
    ]
    for s in record["metrics"]["stages"]:
        lines.append(f"| {s['stage']} | {s['seconds']} | 离线固定快照，无模型调用 |")
    lines.append(f"| 合计 | {record['metrics']['total_seconds']} | 单调时钟 time.monotonic |")
    lat = record["metrics"]["dify_real_run_latency"]
    lines += ["", "Dify 真实运行（只有 Code 节点，无模型）：", "",
              f"- run id：`{lat.get('workflow_run_id')}`",
              f"- Code 节点耗时：{lat.get('code_node_elapsed_time_seconds')} s",
              f"- 工作流耗时：{lat.get('workflow_elapsed_time_seconds')} s",
              f"- token：{lat.get('total_tokens')}",
              f"- 注：{lat.get('note')}", ""]
    lines += ["## 完整输入与输出", ""]
    for o in observations:
        lines += [f"### {o['id']}｜{o['title']}", "",
                  "```json", json.dumps({"input": o["input"], "expected": o["expected"], "actual": o["actual"]},
                                        ensure_ascii=False, indent=2), "```", ""]
    (out_dir / "case-results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"cases: {len(observations)} passed: {len(observations) - len(failed)} failed: {len(failed)}")
    print("evidence:", out_dir.relative_to(ROOT))
    print("unittest:", "OK" if result.wasSuccessful() else "FAILED")
    return 0 if result.wasSuccessful() and not failed else 1


if __name__ == "__main__":
    sys.exit(main())
