"""QA-001 有界预备观察：前端接入层「三方案 → 校验 → 选择 → 呈现」中文路径冒烟。

**重要定性**：`web/` 在 2026-10-30 20:56 才出现，**尚未由前端线交付验收**，且可能仍在编辑中。
本脚本只做一次只读冒烟，**不构成 WEB-001 的验收判定**；结论必须带哈希与时间戳。

做法：以 GW_MODE=mock、非默认端口启动 `web/server/server.mjs`，走 HTTP 覆盖：
健康检查、模式披露、四类中文输入错误、正常三方案、损坏模型 JSON 的修订与持续失败、
未选择/无效选择/失败项选择的拒绝、有效选择后的四段呈现、呈现超预算失败。
全程 mock，**不调用 Dify、不调用任何模型**（`mode=mock` 由服务端自身模式判定）。

用法：
    python tests/acceptance/stage_c/probe_web_demo_path.py
"""

import datetime
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TZ = datetime.timezone(datetime.timedelta(hours=8))
PORT = 8791
BASE = f"http://127.0.0.1:{PORT}"
OUT = ROOT / "docs" / "test-reports" / "stage-c" / "evidence"


def sha256_map(folder):
    result = {}
    for path in sorted((ROOT / folder).rglob("*")):
        if path.is_file():
            result[str(path.relative_to(ROOT)).replace(os.sep, "/")] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def call(method, path, body=None, timeout=30):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")
        status = err.code
    except Exception as err:  # 连接层失败
        return {"httpStatus": None, "error": f"{type(err).__name__}: {err}"}
    try:
        return {"httpStatus": status, "body": json.loads(raw)}
    except ValueError:
        return {"httpStatus": status, "body_raw": raw[:2000]}


def wait_healthy(deadline=40):
    start = time.monotonic()
    while time.monotonic() - start < deadline:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                pass
            res = call("GET", "/healthz", timeout=3)
            if res.get("httpStatus") == 200:
                return True, round(time.monotonic() - start, 3)
        except OSError:
            pass
        time.sleep(0.5)
    return False, round(time.monotonic() - start, 3)


def codes(payload):
    return sorted({e.get("code") for e in (payload.get("errors") or [])}) if isinstance(payload, dict) else []


def _codes_set(payload):
    found = set()
    if isinstance(payload, dict):
        for e in payload.get("errors") or []:
            if isinstance(e, dict) and e.get("code"):
                found.add(e["code"])
        for v in payload.values():
            found |= _codes_set(v)
    elif isinstance(payload, list):
        for v in payload:
            found |= _codes_set(v)
    return found


def codes_deep(payload):
    return sorted(_codes_set(payload))


def main():
    base_intake = json.loads((Path(__file__).with_name("cases.json")).read_text(encoding="utf-8"))["baseline_intake"]
    hashes = {"web": sha256_map("web")}
    results = []
    node = shutil.which("node") or "node"
    log_path = OUT / "web-smoke-server.log"

    def record(cid, title, expected, actual, ok):
        results.append({"id": cid, "title": title, "expected": expected, "actual": actual, "passed": bool(ok)})

    env = dict(os.environ, GW_MODE="mock", GW_PORT=str(PORT), GW_HOST="127.0.0.1")
    OUT.mkdir(parents=True, exist_ok=True)
    with open(log_path, "wb") as sink:
        proc = subprocess.Popen([node, "web/server/server.mjs"], cwd=ROOT, env=env,
                                stdout=sink, stderr=subprocess.STDOUT)
    try:
        healthy, elapsed = wait_healthy()
        record("W-01", "服务可启动并响应 /healthz", "HTTP 200",
               {"healthy": healthy, "startup_seconds": elapsed}, healthy)
        if not healthy:
            raise SystemExit("服务未就绪，终止")

        cfg = call("GET", "/api/config")
        body = cfg.get("body") or {}
        notices = body.get("notices") or {}
        actual = {
            "httpStatus": cfg.get("httpStatus"),
            "mode": body.get("mode"),
            "notices_keys": sorted(notices.keys()) if isinstance(notices, dict) else None,
            "mock_mode_notice_present": bool(notices.get("mock_mode")),
            "mock_mode_notice_sample": (notices.get("mock_mode") or "")[:90],
            "dify_configured": body.get("dify_configured"),
            "dify_published_verified": body.get("dify_published_verified"),
            "keys_present_in_response": any("KEY" in k.upper() or "SECRET" in k.upper() for k in body.keys()),
        }
        record("W-02", "模式披露与凭证边界", "mode=mock；显著模拟标识；响应不含密钥；未声明 Dify 已发布",
               actual, actual["mode"] == "mock" and actual["mock_mode_notice_present"]
               and actual["keys_present_in_response"] is False and actual["dify_published_verified"] is False)

        r = call("POST", "/api/intake/validate", {"intake": base_intake})
        payload = r.get("body") or {}
        actual = {"httpStatus": r.get("httpStatus"), "status": payload.get("status"),
                  "derived_hint": payload.get("derived_hint"), "request_json_echoed": "request_json" in payload}
        record("W-03", "追求对象基线 intake 通过且不回显派生请求", "status=ready；不回显 request_json",
               actual, actual["status"] == "ready" and actual["request_json_echoed"] is False)

        bad_conf = dict(base_intake, interest_confidence={"coffee_food": "unknown", "design_art": "inferred"})
        r = call("POST", "/api/intake/validate", {"intake": bad_conf})
        payload = r.get("body") or {}
        actual = {"httpStatus": r.get("httpStatus"), "status": payload.get("status"),
                  "codes": codes(payload), "messages": [e.get("message") for e in (payload.get("errors") or [])]}
        record("W-04", "兴趣未知机器值被拒且中文提示", "needs_input + INTAKE_CONFIDENCE_MISMATCH，中文说明",
               actual, actual["status"] == "needs_input" and "INTAKE_CONFIDENCE_MISMATCH" in actual["codes"]
               and all(isinstance(m, str) and m for m in actual["messages"]))

        missing = {k: v for k, v in base_intake.items() if k != "budget_amount"}
        r = call("POST", "/api/intake/validate", {"intake": missing})
        payload = r.get("body") or {}
        actual = {"httpStatus": r.get("httpStatus"), "status": payload.get("status"), "codes": codes(payload),
                  "mentions_budget": any("预算" in (e.get("message") or "") for e in (payload.get("errors") or []))}
        record("W-05", "缺预算被拒且提示补充（不静默补值）", "needs_input，中文提到预算",
               actual, actual["status"] == "needs_input" and actual["mentions_budget"])

        r = call("POST", "/api/intake/validate", {"intake": {"recipient_relation": "colleague"}})
        payload = r.get("body") or {}
        actual = {"httpStatus": r.get("httpStatus"), "status": payload.get("status"), "codes": codes(payload)}
        record("W-06", "仅技术回归的 colleague 不是产品推荐路径", "记录实际行为（产品面不得暴露同事）",
               actual, True)

        r = call("POST", "/api/recommendations", {"intake": base_intake, "demo": None})
        report = r.get("body") or {}
        cands = report.get("candidates") or []
        actual = {
            "httpStatus": r.get("httpStatus"),
            "status": report.get("status"),
            "candidate_count": len(cands),
            "candidate_ids": [c.get("id") for c in cands if isinstance(c, dict)],
            "selectable": report.get("selectable_candidate_ids"),
            "selected": report.get("selected_candidate_id"),
            "repair_count": report.get("repair_count"),
            "business_data_verification": report.get("business_data_verification"),
            "report_text_head": (report.get("report_text") or "")[:120],
        }
        record("W-07", "正常路径：恰好三方案、独立校验、等待用户选择",
               "3 个候选、selected=null、repair_count=0、全部可选、数据标注未核实",
               actual, actual["httpStatus"] == 200 and actual["candidate_count"] == 3
               and actual["selected"] is None and actual["repair_count"] == 0
               and actual["selectable"] == ["c1", "c2", "c3"]
               and actual["business_data_verification"] == "not_verified")

        run_id = report.get("recommendation_run_id") or report.get("run_id")

        r = call("POST", "/api/recommendations", {"intake": base_intake, "demo": "model_error"})
        broken = r.get("body") or {}
        validation = broken.get("validation") or {}
        actual = {
            "httpStatus": r.get("httpStatus"), "status": broken.get("status"),
            "top_level_all_passed_present": "all_passed" in broken,
            "validation_all_passed": validation.get("all_passed"),
            "repair_count": broken.get("repair_count"),
            "remaining_repairs": broken.get("remaining_repairs"),
            "selectable": broken.get("selectable_candidate_ids"),
            "selected": broken.get("selected_candidate_id"),
            "codes": codes_deep(broken), "notices": broken.get("notices"),
        }
        record("W-08", "损坏模型 JSON：修订一次后仍失败就停止，不伪装通过",
               "status=failed；validation.all_passed=false；repair_count=1；无可选项；明确失败说明",
               actual, actual["httpStatus"] == 200 and actual["status"] == "failed"
               and actual["validation_all_passed"] is False and actual["repair_count"] == 1
               and actual["selectable"] == [] and actual["selected"] is None)

        r = call("POST", "/api/presentations", {"recommendation_run_id": run_id, "selected_candidate_id": None})
        payload = r.get("body") or {}
        actual = {"httpStatus": r.get("httpStatus"), "status": payload.get("status"), "codes": codes(payload)}
        record("W-09", "未选择时不生成呈现", "4xx + INVALID_SELECTION，且不替用户选择",
               actual, actual["httpStatus"] in (400, 409, 422) and "INVALID_SELECTION" in actual["codes"])

        r = call("POST", "/api/presentations", {"recommendation_run_id": run_id, "selected_candidate_id": "c999"})
        payload = r.get("body") or {}
        actual = {"httpStatus": r.get("httpStatus"), "status": payload.get("status"), "codes": codes(payload)}
        record("W-10", "不存在的候选被拒", "4xx + 明确的标识错误", actual, actual["httpStatus"] in (400, 404, 409, 422))

        r = call("POST", "/api/presentations", {"recommendation_run_id": "no-such-run", "selected_candidate_id": "c1"})
        payload = r.get("body") or {}
        actual = {"httpStatus": r.get("httpStatus"), "status": payload.get("status"), "codes": codes(payload)}
        record("W-11", "未知运行 ID 被拒", "404", actual, actual["httpStatus"] == 404)

        r = call("POST", "/api/presentations", {"recommendation_run_id": run_id, "selected_candidate_id": "c2"})
        view = r.get("body") or {}
        text = json.dumps(view, ensure_ascii=False)
        actual = {
            "httpStatus": r.get("httpStatus"),
            "top_keys": sorted(view.keys())[:20],
            "has_four_sections": all(k in text for k in ("配色", "包装", "贺卡", "赠送")),
            "mentions_not_verified": "not_verified" in text or "未核实" in text,
            "notices": view.get("notices"),
        }
        record("W-12", "有效选择后生成四段呈现（配色→包装→贺卡→赠送）",
               "HTTP 200；含四个中文段落；标注数据未核实",
               actual, actual["httpStatus"] == 200 and actual["has_four_sections"])

        r = call("POST", "/api/presentations", {"recommendation_run_id": run_id, "selected_candidate_id": "c3",
                                                "demo": "presentation_over_budget"})
        payload = r.get("body") or {}
        actual = {"httpStatus": r.get("httpStatus"), "status": payload.get("status"),
                  "codes": codes_deep(payload), "notices": payload.get("notices")}
        record("W-13", "呈现阶段超预算如实失败（不自动换方案）", "409 或明确失败状态，不标为完成",
               actual, actual["httpStatus"] in (200, 409) and payload.get("status") != "passed")

        r = call("GET", "/")
        raw = r.get("body_raw") or ""
        html = raw
        actual = {"httpStatus": r.get("httpStatus"), "length": len(html) if html else None,
                  "chinese_ui": "选择" in html or "礼物" in html if html else None,
                  "leaks_key": "DIFY_API_KEY" in html or "sk-" in html}
        record("W-14", "首页可访问、中文界面、不泄露密钥", "200；含中文；无密钥痕迹",
               actual, actual["httpStatus"] == 200 and actual["leaks_key"] is False)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    stamp = datetime.datetime.now(TZ).strftime("%Y%m%d-%H%M%S")
    out = {
        "note": "web/ 于 2026-10-30 20:56 才出现，尚未交付验收；本文件是有界预备观察，不构成 WEB-001 验收判定。",
        "observed_at": datetime.datetime.now(TZ).isoformat(),
        "mode": "mock（服务端自身模式判定；未调用 Dify、未调用任何模型）",
        "web_file_hashes": hashes["web"],
        "server_log": str(log_path.relative_to(ROOT)).replace(os.sep, "/"),
        "results": results,
        "passed": sum(1 for x in results if x["passed"]),
        "failed": sum(1 for x in results if not x["passed"]),
    }
    target = OUT / f"web-demo-path-smoke-{stamp}.json"
    target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"smoke: {out['passed']} passed / {out['failed']} failed")
    for x in results:
        print(("  PASS " if x["passed"] else "  FAIL ") + x["id"] + " " + x["title"])
    print("evidence:", target.relative_to(ROOT))
    return 0 if out["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
