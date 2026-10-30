"""阶段 14 可观测性验证：真跑工作负载 + 断言，原始输出归档。

覆盖：
  1. 结构化请求日志（每请求一行 JSON）——并发下不交错、**不含请求体**、路径脱敏防日志注入；
  2. 健康检查：`/healthz` 与冻结实现逐字节一致；新增 `/readyz`；
  3. 进程级指标：请求数/错误数/延迟分位/RSS、`/metrics`（Prometheus 文本）与 `?format=json`；
  4. 回归：可观测入口的 `/validate`、`/healthz` 响应体与冻结实现一致；
  5. keep-alive 双请求（验证 do_POST 顶替 rfile 后仍能继续读下一个请求）；
  6. 优雅退出（Windows 用 CTRL_BREAK_EVENT，容器内用 SIGTERM）。

期望值随每次请求一并登记（方法/路由/状态码/预期错误码/预期校验结果），断言只与账本比，
不写死人工规格。只用标准库；子进程输出一律重定向到文件（不使用管道）。
"""

from __future__ import annotations

import json
import os
import signal
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "deploy" / "evidence" / "raw"
CN = timezone(timedelta(hours=8))
PORT_FROZEN = 8801
PORT_OBS = 8802
SENTINEL = "SENTINEL_绝不入库_" + uuid.uuid4().hex[:12]

sys.path.insert(0, str(REPO))
from deploy.server import RULES_HASH, _json_bytes  # noqa: E402
from validator.rules import validate  # noqa: E402

results: list[dict] = []
console: list[str] = []


def log(line: str = "") -> None:
    console.append(line)
    print(line, flush=True)


def check(name: str, ok: bool, detail: object) -> None:
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    log(f"[{'PASS' if ok else 'FAIL'}] {name} :: {detail}")


# --------------------------------------------------------------------- HTTP

def wait_port(port: int, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                return True
        except OSError:
            time.sleep(0.15)
    return False


def http(method: str, path: str, body: bytes | None = None, headers: dict | None = None,
         port: int = PORT_OBS, timeout: float = 20.0) -> tuple[int, dict, bytes]:
    url = f"http://127.0.0.1:{port}{path}"
    request = urllib.request.Request(url, data=body, method=method)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def raw_request(payload: bytes, port: int, expect_responses: int = 1,
                timeout: float = 6.0) -> list[tuple[int, bytes]]:
    """裸 socket 发字节流，按 Content-Length 解析响应（用于 keep-alive 与畸形报文）。"""
    responses: list[tuple[int, bytes]] = []
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            sock.sendall(payload)
            buffer = b""
            for _ in range(expect_responses):
                while b"\r\n\r\n" not in buffer:
                    chunk = sock.recv(4096)
                    if not chunk:
                        return responses
                    buffer += chunk
                head, rest = buffer.split(b"\r\n\r\n", 1)
                lines = head.split(b"\r\n")
                status = int(lines[0].split()[1])
                length = 0
                for line in lines[1:]:
                    if line.lower().startswith(b"content-length:"):
                        length = int(line.split(b":", 1)[1].strip())
                while len(rest) < length:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    rest += chunk
                responses.append((status, rest[:length]))
                buffer = rest[length:]
    except (socket.timeout, OSError, ValueError, IndexError):
        return responses
    return responses


def post_payload(payload: dict, port: int = PORT_OBS,
                 headers: dict | None = None) -> tuple[int, dict, bytes]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    base = {"Content-Type": "application/json"}
    base.update(headers or {})
    return http("POST", "/validate", body, base, port=port)


# --------------------------------------------------------------------- 载荷

def _load_t01() -> tuple[dict, dict]:
    """取仓库内真实通过用例 tests/test_cases.json#T01_normal（只读，不修改该文件）。"""
    data = json.loads((REPO / "tests" / "test_cases.json").read_text(encoding="utf-8"))
    cases = data if isinstance(data, list) else (data.get("cases") or data.get("test_cases"))
    case = next(item for item in cases if item.get("id") == "T01_normal")
    return case["request"], case["candidate_batch"]


T01_REQUEST, T01_CANDIDATES = _load_t01()

# 把哨兵串注入两个"自由文本"字段：若实现真的记录了请求体，它必然出现在日志里
REQUEST = json.loads(json.dumps(T01_REQUEST))
REQUEST["notes"] = f"{SENTINEL} " + str(REQUEST.get("notes", ""))
REQUEST["facts"] = [dict(item) for item in REQUEST.get("facts", [])]
if REQUEST["facts"]:
    REQUEST["facts"][0]["text"] = f"{SENTINEL} " + str(REQUEST["facts"][0].get("text", ""))

_VALID_JSON = json.dumps(REQUEST, ensure_ascii=False)
_CAND_JSON = json.dumps(T01_CANDIDATES, ensure_ascii=False)
VALID = {"request_json": _VALID_JSON, "candidates_json": _CAND_JSON}
# 缺字段属于【业务失败】：契约规定返回 HTTP 200 + status=needs_input
MISSING_FIELD = {"request_json": json.dumps({k: v for k, v in REQUEST.items() if k != "available_days"},
                                            ensure_ascii=False),
                 "candidates_json": _CAND_JSON}
# 两个字段不是 JSON 字符串 → HTTP 400 INVALID_PAYLOAD
NON_STRING = {"request_json": REQUEST, "candidates_json": _CAND_JSON}

RUN_ID_1 = "run-obs-check-001"
RUN_ID_2 = "run-obs-conc-002"
KEEP_BODY = json.dumps(VALID, ensure_ascii=False).encode("utf-8")
KEEP_ALIVE_TWO = (b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n"
                  b"Content-Type: application/json\r\nContent-Length: " + str(len(KEEP_BODY)).encode() +
                  b"\r\n\r\n" + KEEP_BODY) * 2


def main() -> int:  # noqa: C901
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    outdir = RAW / f"observability-{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    access_log = outdir / "access.jsonl"
    log(f"输出目录：{outdir}")
    log(f"哨兵串（用于证明请求体未入日志）：{SENTINEL}")

    probe = validate(VALID["request_json"], VALID["candidates_json"])
    check("前置：工作负载载荷经纯函数校验为 passed（否则下面的期望不成立）",
          probe["status"] == "passed" and probe["all_passed"] is True,
          {"status": probe["status"], "all_passed": probe["all_passed"], "errors": probe["errors"][:2]})

    env = dict(os.environ)
    env.update({
        "GIFTWISE_BIND": "127.0.0.1",
        "PYTHONUNBUFFERED": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

    frozen_log = (outdir / "frozen-server.log").open("wb")
    obs_log = (outdir / "observable-server.log").open("wb")
    frozen = subprocess.Popen(
        [sys.executable, "-m", "deploy.server"], cwd=str(REPO),
        env=dict(env, GIFTWISE_PORT=str(PORT_FROZEN)),
        stdout=frozen_log, stderr=subprocess.STDOUT, creationflags=creationflags)
    observed = subprocess.Popen(
        [sys.executable, "-m", "deploy.observable_server"], cwd=str(REPO),
        env=dict(env, GIFTWISE_PORT=str(PORT_OBS), GIFTWISE_ACCESS_LOG=str(access_log)),
        stdout=obs_log, stderr=subprocess.STDOUT, creationflags=creationflags)
    log(f"冻结服务 pid={frozen.pid} :{PORT_FROZEN}；可观测服务 pid={observed.pid} :{PORT_OBS}")

    keys: Counter = Counter()          # (method, route, status) → 次数
    statuses: Counter = Counter()      # status → 次数
    codes: Counter = Counter()         # 预期错误码
    val_results: Counter = Counter()   # 预期校验结果（status 字段）

    def rec(method: str, route: str, status: int, code: str | None = None,
            result: str | None = None) -> int:
        keys[(method, route, status)] += 1
        statuses[status] += 1
        if code:
            codes[code] += 1
        if result:
            val_results[result] += 1
        return status

    try:
        check("两个服务在 30s 内就绪", wait_port(PORT_FROZEN) and wait_port(PORT_OBS), "127.0.0.1 可连接")

        # ---------------------------------------------------------- 阶段 1：串行工作负载
        started = time.perf_counter()
        for _ in range(30):
            status, _, _ = post_payload(VALID, headers={"X-GiftWise-Run-Id": RUN_ID_1, "X-GiftWise-Stage": "stage14"})
            rec("POST", "/validate", status, result="passed")
        for _ in range(8):
            status, _, _ = http("POST", "/validate", b"{not json " + SENTINEL.encode(), port=PORT_OBS)
            rec("POST", "/validate", status, code="INVALID_JSON")
        for _ in range(3):
            status, _, _ = post_payload(NON_STRING)
            rec("POST", "/validate", status, code="INVALID_PAYLOAD")
        for _ in range(3):
            status, _, _ = post_payload(MISSING_FIELD)
            rec("POST", "/validate", status, code="MISSING_FIELD", result="needs_input")
        for _ in range(3):
            status, _, _ = http("POST", "/validate", b"x" * (64 * 1024 + 61), port=PORT_OBS)
            rec("POST", "/validate", status, code="REQUEST_TOO_LARGE")
        for _ in range(4):
            status, _, _ = http("GET", "/no-such-path", port=PORT_OBS)
            rec("GET", "__unmatched__", status, code="NOT_FOUND")
        for _ in range(2):
            status, _, _ = http("PUT", "/validate", b"{}", port=PORT_OBS)
            rec("PUT", "/validate", status)
        for _ in range(6):
            status, _, _ = http("GET", "/healthz", port=PORT_OBS)
            rec("GET", "/healthz", status)
        for _ in range(2):
            status, _, _ = http("GET", "/readyz", port=PORT_OBS)
            rec("GET", "/readyz", status)
        status, _, _ = http("GET", "/", port=PORT_OBS)
        rec("GET", "/", status)
        for _ in range(3):
            status, _, _ = http("GET", "/metrics", port=PORT_OBS)
            rec("GET", "/metrics", status)
        status, _, _ = http("GET", "/metrics?format=json", port=PORT_OBS)
        rec("GET", "/metrics", status)
        esc = raw_request(b"GET /a\x1bb HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n", PORT_OBS)
        rec("GET", "__unmatched__", esc[0][0] if esc else 0, code="NOT_FOUND")
        nolen = raw_request(b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n", PORT_OBS)
        rec("POST", "/validate", nolen[0][0] if nolen else 0, code="REQUEST_TOO_LARGE")
        # HTTP/1.0 基线：本服务每连接只处理一个请求（见下方与冻结实现的一致性对比）
        keep = raw_request(KEEP_ALIVE_TWO, PORT_OBS, expect_responses=2)
        for status, _ in keep:
            rec("POST", "/validate", status, result="passed")
        phase1_seconds = time.perf_counter() - started
        log(f"阶段 1 完成：{sum(statuses.values())} 个请求，{phase1_seconds:.3f}s，状态分布 {dict(sorted(statuses.items()))}")

        check("阶段 1 每个请求都拿到响应（无 0 状态）", 0 not in statuses, dict(sorted(statuses.items())))
        check("阶段 1 状态码分布符合契约（0 个 5xx）",
              statuses.get(500, 0) == 0 and statuses.get(501, 0) == 2 and statuses.get(413, 0) == 4,
              dict(sorted(statuses.items())))

        # ---------------------------------------------------------- 指标抓取
        m_status, m_headers, m_body = http("GET", "/metrics", port=PORT_OBS)
        rec("GET", "/metrics", m_status)
        (outdir / "metrics-prometheus.txt").write_bytes(m_body)
        # 注意：本次抓取返回的计数【不含它自己】——记录在后，渲染在前。下面据此对齐口径。
        j_status, _, j_body = http("GET", "/metrics?format=json", port=PORT_OBS)
        (outdir / "metrics-summary.json").write_bytes(j_body)
        summary = json.loads(j_body)
        check("/metrics 200 且 content-type 为 Prometheus 文本 v0.0.4",
              m_status == 200 and "version=0.0.4" in m_headers.get("Content-Type", ""),
              f"{m_status} {m_headers.get('Content-Type')}")
        check("/metrics?format=json 200 且可解析", j_status == 200 and isinstance(summary, dict),
              f"{j_status} 字段数={len(summary)}")

        requests_before_concurrency = summary["requests_total"]
        check("指标请求总数 == 已记录请求数（不含本次抓取自身）",
              requests_before_concurrency == sum(statuses.values()),
              f"指标={requests_before_concurrency} 账本={sum(statuses.values())}")

        by_key = summary["requests_by_key"]
        expected_by_key = {f"{m} {r} {s}": c for (m, r, s), c in keys.items()}
        mismatches = {k: {"指标": by_key.get(k), "账本": v} for k, v in expected_by_key.items() if by_key.get(k) != v}
        extra = {k: v for k, v in by_key.items() if k not in expected_by_key}
        check("按 方法/路由/状态码 的计数与账本完全一致", not mismatches and not extra,
              {"不一致": mismatches, "多余键": extra})
        check("错误码计数与账本一致", {k: v for k, v in summary["error_codes_total"].items()} == dict(codes),
              {"指标": summary["error_codes_total"], "账本": dict(codes)})
        check("校验结果分布与账本一致", summary["validate_results_total"] == dict(val_results),
              {"指标": summary["validate_results_total"], "账本": dict(val_results)})

        # ---------------------------------------------------------- 阶段 2：并发
        conc_started = time.perf_counter()
        concurrent: list[int] = []
        lock = threading.Lock()

        def worker() -> None:
            local: list[int] = []
            for _ in range(10):
                status, _, _ = post_payload(VALID, headers={"X-GiftWise-Run-Id": RUN_ID_2})
                local.append(status)
            with lock:
                concurrent.extend(local)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        conc_seconds = time.perf_counter() - conc_started
        for status in concurrent:
            keys[("POST", "/validate", status)] += 1
            statuses[status] += 1
            if status == 200:
                val_results["passed"] += 1
        check("并发 8×10 全部 200", concurrent.count(200) == 80,
              f"200×{concurrent.count(200)} / {len(concurrent)}，{conc_seconds:.3f}s")

        _, _, j_body2 = http("GET", "/metrics?format=json", port=PORT_OBS)
        summary2 = json.loads(j_body2)
        (outdir / "metrics-summary-after-concurrency.json").write_bytes(j_body2)
        expected_total = requests_before_concurrency + 1 + len(concurrent)
        check("并发后请求总数 = 前值 + 抓取 + 并发数",
              summary2["requests_total"] == expected_total,
              f"指标={summary2['requests_total']} 期望={expected_total}")
        check("并发后校验结果分布仍与账本一致",
              summary2["validate_results_total"] == dict(val_results),
              {"指标": summary2["validate_results_total"], "账本": dict(val_results)})

        # ---------------------------------------------------------- 日志与断言
        raw_lines = access_log.read_text(encoding="utf-8", errors="replace").splitlines()
        parsed, bad = [], []
        for line in raw_lines:
            if not line.strip():
                continue
            try:
                parsed.append(json.loads(line))
            except json.JSONDecodeError:
                bad.append(line[:200])
        check("访问日志每行都是合法 JSON（并发未交错）", not bad,
              f"总行数={len(raw_lines)} 解析失败={len(bad)} 首条坏行={bad[:1]}")
        check("日志行数 == 指标请求总数 + 本次抓取自身（抓取在渲染后才记账）",
              len(parsed) == summary2["requests_total"] + 1,
              f"行数={len(parsed)} 指标={summary2['requests_total']}+1")

        text = access_log.read_text(encoding="utf-8", errors="replace")
        check("请求体未进入日志（哨兵串 0 命中）", SENTINEL not in text,
              f"sentinel_in_log={SENTINEL in text} matches={text.count(SENTINEL)}")
        body_markers = ["request_json", "candidates_json", "notes", "咖啡主题杯垫与马克杯", "recipient_relation"]
        hits = {marker: text.count(marker) for marker in body_markers}
        check("日志不含请求体字段与商品文本", all(count == 0 for count in hits.values()), hits)
        esc_paths = [record_.get("path") for record_ in parsed if (record_.get("path") or "").startswith("/a")]
        check("路径字段已脱敏（ESC 被替换，无控制字符）",
              all("\x1b" not in (record_.get("path") or "") and "\t" not in (record_.get("path") or "")
                  for record_ in parsed),
              f"含 ESC 的路径记录={esc_paths[:2]}")

        ids = {record_.get("request_id") for record_ in parsed}
        check("每条日志都有唯一非空 request_id", all(ids) and len(ids) == len(parsed),
              f"唯一 id 数={len(ids)} 行数={len(parsed)}")
        run_ids = Counter(record_.get("run_id") for record_ in parsed)
        check("透传的 run_id 被如实记录（缺失记 null）",
              run_ids.get(RUN_ID_1) == 30 and run_ids.get(RUN_ID_2) == 80, dict(run_ids))
        durations = [record_["duration_ms"] for record_ in parsed
                     if isinstance(record_.get("duration_ms"), (int, float))]
        check("每条日志都有非负耗时",
              len(durations) == len(parsed) and all(value >= 0 for value in durations),
              f"n={len(durations)} min={min(durations):.3f}ms median={statistics.median(durations):.3f}ms "
              f"max={max(durations):.3f}ms")
        fps = {record_.get("candidates_sha256") for record_ in parsed if record_.get("candidates_sha256")}
        check("候选串指纹被记录且不含内容", len(fps) >= 1 and all(len(f) == 64 for f in fps),
              f"唯一指纹数={len(fps)} 样例={sorted(fps)[0][:16] if fps else None}…")
        check("日志记录模型调用与成本恒为 0",
              all(record_.get("model_calls") == 0 and (record_.get("cost") or {}).get("amount") == 0
                  for record_ in parsed), "全部 0")

        metrics_text = (outdir / "metrics-prometheus.txt").read_text(encoding="utf-8")
        required_metrics = [
            "giftwise_up", "giftwise_build_info", "giftwise_uptime_seconds",
            "giftwise_process_resident_memory_bytes", "giftwise_http_requests_total",
            "giftwise_http_errors_total", "giftwise_validate_results_total",
            "giftwise_validate_error_codes_total", "giftwise_http_request_duration_ms_bucket",
            "giftwise_latency_p95_ms", "giftwise_model_calls_total", "giftwise_cost_cny_total",
        ]
        missing = [name for name in required_metrics if name not in metrics_text]
        check("Prometheus 文本包含全部要求的指标", not missing, f"缺失={missing}")

        lat = summary2["latency_by_route"].get("/validate", {})
        check("延迟分位为真实非零值且 p95 >= p50",
              lat.get("p95_ms", 0) > 0 and lat.get("p95_ms", 0) >= lat.get("p50_ms", 0),
              {k: lat.get(k) for k in ("count", "p50_ms", "p95_ms", "p99_ms", "max_ms")})
        rss = summary2.get("process_resident_memory_bytes") or 0
        check("RSS 为正且量级合理（1MiB–1GiB）", 1024 ** 2 < rss < 1024 ** 3,
              f"{rss} bytes = {rss / 1024 / 1024:.2f} MiB")
        cost = summary2.get("cost", {})
        check("成本字段为确定性 0（未编造）",
              cost.get("amount") == 0 and summary2.get("model_calls_total") == 0, cost)
        healthz_lat = summary2["latency_by_route"].get("/healthz", {})
        validate_expected_count = sum(count for (method, route, status), count in keys.items()
                                      if route == "/validate")
        check("/healthz 与 /validate 各自有独立延迟统计",
              healthz_lat.get("count") == keys[("GET", "/healthz", 200)]
              and lat.get("count") == validate_expected_count,
              {"/healthz": healthz_lat.get("count"), "/validate": lat.get("count"),
               "/validate 账本": validate_expected_count})

        # ---------------------------------------------------------- 回归对比
        f_status, _, f_body = http("GET", "/healthz", port=PORT_FROZEN)
        o_status, o_headers, o_body = http("GET", "/healthz", port=PORT_OBS)
        check("/healthz 与冻结实现逐字节一致",
              f_status == o_status == 200 and f_body == o_body,
              f"frozen={f_status} obs={o_status} 逐字节一致={f_body == o_body} len={len(o_body)}")

        f_v, _, f_vbody = post_payload(VALID, port=PORT_FROZEN)
        o_v, o_vheaders, o_vbody = post_payload(VALID, port=PORT_OBS)
        inproc = _json_bytes(validate(VALID["request_json"], VALID["candidates_json"]))
        check("/validate 与冻结实现、纯函数三方逐字节一致",
              f_v == o_v == 200 and f_vbody == o_vbody == inproc,
              f"frozen={f_v} obs={o_v} frozen==obs={f_vbody == o_vbody} obs==inproc={o_vbody == inproc} "
              f"len={len(o_vbody)} all_passed={json.loads(o_vbody).get('all_passed')}")
        echoed = o_vheaders.get("X-GiftWise-Request-Id")
        check("/validate 响应回显 X-GiftWise-Request-Id", bool(echoed), echoed)
        keep_frozen = raw_request(KEEP_ALIVE_TWO, PORT_FROZEN, expect_responses=2)
        check("流水线第二个请求的行为与冻结实现一致（HTTP/1.0：每连接只应答一个请求）",
              len(keep) == len(keep_frozen),
              f"可观测实现响应数={len(keep)} 冻结实现响应数={len(keep_frozen)}；"
              f"原因：protocol_version=HTTP/1.0，keep-alive 仅在 HTTP/1.1 才被采纳")
        check("容器 HEALTHCHECK 依赖的 /healthz 契约未变",
              json.loads(o_body)["rules_source_sha256"] == RULES_HASH
              and set(json.loads(o_body)) == {"status", "service", "rules_source_sha256"},
              json.loads(o_body))
        check("原实现的 501（不支持方法）行为未变",
              statuses.get(501, 0) == 2, f"501 次数={statuses.get(501, 0)}")
        check("原实现的 404（含 /healthz?x=1 一类未匹配路径）行为未变",
              summary2["requests_by_key"].get("GET __unmatched__ 404") == 5,
              f"unmatched 404={summary2['requests_by_key'].get('GET __unmatched__ 404')}")

        # ---------------------------------------------------------- 优雅退出
        sent = False
        try:
            observed.send_signal(signal.CTRL_BREAK_EVENT)
            sent = True
        except (ValueError, OSError, AttributeError):
            sent = False
        graceful = False
        if sent:
            try:
                observed.wait(timeout=10)
                graceful = True
            except subprocess.TimeoutExpired:
                graceful = False
        if not graceful:
            observed.terminate()
            try:
                observed.wait(timeout=5)
            except subprocess.TimeoutExpired:
                observed.kill()
        obs_log.flush()
        shutdown_text = (outdir / "observable-server.log").read_text(encoding="utf-8", errors="replace")
        shutdown_summary = None
        for line in shutdown_text.splitlines():
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue
            if candidate.get("event") == "shutdown":
                shutdown_summary = candidate
        check("优雅退出并打印末次指标汇总", shutdown_summary is not None,
              f"ctl_break_sent={sent} graceful={graceful}")

        # 关机汇总在【所有请求之后】输出，因此是唯一能与访问日志逐行对上的口径
        final_lines = [line for line in access_log.read_text(encoding="utf-8", errors="replace").splitlines()
                       if line.strip()]
        final_bad = 0
        for line in final_lines:
            try:
                json.loads(line)
            except json.JSONDecodeError:
                final_bad += 1
        check("关机汇总的请求总数 == 访问日志行数",
              shutdown_summary is not None and shutdown_summary.get("requests_total") == len(final_lines),
              {"关机汇总": (shutdown_summary or {}).get("requests_total"), "日志行数": len(final_lines)})
        check("整份访问日志无一行解析失败", final_bad == 0, f"坏行={final_bad} 总行={len(final_lines)}")
        check("关机汇总里 /healthz 契约依旧",
              bool(((shutdown_summary or {}).get("rules_source_sha256"))),
              (shutdown_summary or {}).get("rules_source_sha256", "")[:16] + "…")

        frozen.terminate()
        try:
            frozen.wait(timeout=5)
        except subprocess.TimeoutExpired:
            frozen.kill()

        # ---------------------------------------------------------- 汇总
        payload = {
            "stamp": stamp,
            "sentinel": SENTINEL,
            "port_frozen": PORT_FROZEN,
            "port_observable": PORT_OBS,
            "phase1_seconds": round(phase1_seconds, 3),
            "concurrency_seconds": round(conc_seconds, 3),
            "concurrency_rps": round(len(concurrent) / conc_seconds, 1),
            "requests_total_after_phase1": requests_before_concurrency,
            "requests_total_final": summary2["requests_total"],
            "ledger_status_counts": dict(sorted(statuses.items())),
            "ledger_keys": {f"{m} {r} {s}": c for (m, r, s), c in sorted(keys.items())},
            "ledger_error_codes": dict(sorted(codes.items())),
            "ledger_validate_results": dict(sorted(val_results.items())),
            "jsonl_lines": len(parsed),
            "jsonl_invalid": len(bad),
            "metrics_after_phase1": summary,
            "metrics_after_concurrency": summary2,
            "checks": results,
            "checks_passed": sum(1 for item in results if item["ok"]),
            "checks_total": len(results),
            "files": sorted(path.name for path in outdir.iterdir()),
        }
        (outdir / "observability-check.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        (outdir / "console.txt").write_text("\n".join(console) + "\n", encoding="utf-8")
        (RAW / "observability-latest.txt").write_text(str(outdir) + "\n", encoding="utf-8")
    finally:
        for proc, stream in ((frozen, frozen_log), (observed, obs_log)):
            try:
                if proc.poll() is None:
                    proc.terminate()
                    proc.wait(timeout=5)
            except Exception:
                pass
            try:
                stream.close()
            except Exception:
                pass

    passed = sum(1 for item in results if item["ok"])
    log()
    log(f"===== 断言 {passed}/{len(results)} 通过 =====")
    for item in results:
        if not item["ok"]:
            log(f"  FAIL: {item['name']} :: {item['detail']}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
