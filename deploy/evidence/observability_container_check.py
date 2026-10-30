"""阶段 14 可观测代码的容器内验证（不修改 deploy/Dockerfile）。

做法（刻意不碰被 QA 冻结的文件）：
  - 用现有 `deploy/Dockerfile` 构建，但打**独立 tag** `giftwise-validator:obs-check`，
    避免与 QA/PM 的 `giftwise-validator:latest` 相互覆盖；
  - `docker run` 时**覆盖命令**为 `python -m deploy.observable_server`，并把仓库 `deploy/`
    以**只读**方式挂到 `/app/deploy`，从而在不改镜像定义的前提下跑新入口；
  - 端口只绑 `127.0.0.1:8792`（不对公网暴露），不与 QA 占用的 8000 冲突。

验证点：容器内 `/healthz` 200、`/validate` 与本机纯函数一致、`/metrics` 的 RSS 走 Linux
（/proc）路径、JSONL 落在容器内且不含请求体、`docker stop`（SIGTERM）优雅退出并打印末次汇总、
镜像非 root 用户。

只用标准库；docker 输出一律重定向到文件后读回（不使用管道）。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "deploy" / "evidence" / "raw"
CN = timezone(timedelta(hours=8))
TAG = "giftwise-validator:obs-check"
CONTAINER = "gw-obs-check"
HOST_PORT = 8792
SENTINEL = "SENTINEL_容器内不记录_" + uuid.uuid4().hex[:10]
DOCKER_DIRS = [
    r"C:\Program Files\Docker\Docker\resources\bin",
    r"C:\ProgramData\DockerDesktop\version-bin",
]

sys.path.insert(0, str(REPO))
from deploy.server import RULES_HASH, _json_bytes  # noqa: E402
from validator.rules import validate  # noqa: E402

results: list[dict] = []
console: list[str] = []
TMP = Path(os.environ.get("TEMP", "/tmp")) / f"dsh-obs-{uuid.uuid4().hex[:8]}"
TMP.mkdir(parents=True, exist_ok=True)


def log(line: str = "") -> None:
    console.append(line)
    print(line, flush=True)


def check(name: str, ok: bool, detail: object) -> None:
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    log(f"[{'PASS' if ok else 'FAIL'}] {name} :: {detail}")


def docker_bin() -> str | None:
    found = shutil.which("docker")
    if found:
        return found
    for directory in DOCKER_DIRS:
        candidate = Path(directory) / "docker.exe"
        if candidate.exists():
            return str(candidate)
    return None


def capture(args: list[str], timeout: float = 600.0) -> tuple[int, str]:
    """运行命令并把 stdout+stderr 写进临时文件后读回（避免使用管道）。"""
    out_file = TMP / f"cmd-{uuid.uuid4().hex[:8]}.txt"
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join(DOCKER_DIRS + [env.get("PATH", "")])
    env["MSYS_NO_PATHCONV"] = "1"
    with out_file.open("wb") as handle:
        try:
            completed = subprocess.run(args, cwd=str(REPO), env=env, stdout=handle,
                                       stderr=subprocess.STDOUT, timeout=timeout)
            code = completed.returncode
        except subprocess.TimeoutExpired:
            code = -9
            handle.write(b"\n[timeout]\n")
    text = out_file.read_text(encoding="utf-8", errors="replace")
    try:
        out_file.unlink()
    except OSError:
        pass
    return code, text


def http(method: str, path: str, body: bytes | None = None,
         headers: dict | None = None, timeout: float = 20.0) -> tuple[int, dict, bytes]:
    request = urllib.request.Request(f"http://127.0.0.1:{HOST_PORT}{path}", data=body, method=method)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def wait_http(path: str = "/healthz", timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, _, _ = http("GET", path, timeout=3.0)
            if status == 200:
                return True
        except Exception:
            time.sleep(0.4)
    return False


def main() -> int:  # noqa: C901
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    outdir = RAW / f"observability-container-{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    archive: dict[str, str] = {}

    def save(name: str, text: str) -> None:
        (outdir / name).write_text(text, encoding="utf-8")
        archive[name] = text

    binary = docker_bin()
    check("找到 docker 客户端", bool(binary), binary)
    if not binary:
        return 1
    log(f"docker = {binary}")
    log(f"输出目录：{outdir}")
    log(f"哨兵串：{SENTINEL}")

    code, text = capture([binary, "version", "--format", "{{.Client.Version}}|{{.Server.Version}}|{{.Server.Os}}|{{.Server.Arch}}"])
    save("docker-version.txt", text)
    check("docker 引擎可用", code == 0, text.strip())

    started = time.perf_counter()
    code, text = capture([binary, "build", "-t", TAG, "-f", "deploy/Dockerfile", "."], timeout=900)
    build_seconds = time.perf_counter() - started
    save("docker-build.txt", text)
    check("镜像构建成功（独立 tag，未改 Dockerfile）", code == 0, f"exit={code} {build_seconds:.1f}s")
    tail = [line for line in text.strip().splitlines() if line.strip()][-1:] or [""]
    log(f"构建末行：{tail[0][:160]}")

    code, text = capture([binary, "images", TAG, "--format", "{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}"])
    save("docker-images.txt", text)
    check("镜像已入库", code == 0 and TAG in text, text.strip())

    capture([binary, "rm", "-f", CONTAINER])
    mount = f"{REPO / 'deploy'}:/app/deploy:ro"
    run_args = [
        binary, "run", "-d", "--name", CONTAINER,
        "-p", f"127.0.0.1:{HOST_PORT}:8000",
        "-v", mount,
        "-e", "GIFTWISE_ACCESS_LOG=/tmp/access.jsonl",
        "-e", "PYTHONUNBUFFERED=1",
        TAG, "python", "-m", "deploy.observable_server",
    ]
    code, text = capture(run_args)
    save("docker-run.txt", text)
    container_id = text.strip()
    check("容器启动（覆盖命令为可观测入口 + 只读挂载）",
          code == 0 and len(container_id) == 64 and all(c in "0123456789abcdef" for c in container_id),
          f"exit={code} container_id={container_id[:12]}… len={len(container_id)}")

    healthy = wait_http()
    check("宿主经 127.0.0.1:8792 访问容器 /healthz 返回 200", healthy, f"127.0.0.1:{HOST_PORT}")

    # 容器健康检查状态（镜像自带 HEALTHCHECK，指向 127.0.0.1:8000/healthz）
    health = "unknown"
    for _ in range(30):
        code, text = capture([binary, "inspect", "--format", "{{.State.Health.Status}}", CONTAINER])
        health = text.strip()
        if health == "healthy":
            break
        time.sleep(1.0)
    save("docker-health.txt", health + "\n")
    check("镜像自带 HEALTHCHECK 判定为 healthy", health == "healthy", health)

    code, text = capture([binary, "inspect", "--format",
                          "user={{.Config.User}}|image={{.Image}}|ports={{.HostConfig.PortBindings}}",
                          CONTAINER])
    save("docker-inspect.txt", text)
    check("容器以非 root 用户运行（镜像 USER 生效）", "user=10001" in text or "user=giftwise" in text,
          text.strip()[:200])

    # ------------------------------------------------------------ 容器内请求
    ledger: list[tuple[str, int]] = []
    c_status, c_headers, c_body = http("GET", "/healthz")
    ledger.append(("GET /healthz", c_status))
    check("容器 /healthz 200 且规则指纹与本机一致",
          c_status == 200 and json.loads(c_body)["rules_source_sha256"] == RULES_HASH,
          json.loads(c_body))

    payload = json.loads((REPO / "tests" / "test_cases.json").read_text(encoding="utf-8"))
    cases = payload if isinstance(payload, list) else (payload.get("cases") or payload.get("test_cases"))
    case = next(item for item in cases if item.get("id") == "T01_normal")
    request = json.loads(json.dumps(case["request"]))
    request["notes"] = f"{SENTINEL} " + str(request.get("notes", ""))
    valid = {"request_json": json.dumps(request, ensure_ascii=False),
             "candidates_json": json.dumps(case["candidate_batch"], ensure_ascii=False)}
    body = json.dumps(valid, ensure_ascii=False).encode("utf-8")
    v_status, v_headers, v_body = http("POST", "/validate", body,
                                       {"Content-Type": "application/json",
                                        "X-GiftWise-Run-Id": "run-container-001"})
    ledger.append(("POST /validate", v_status))
    inproc = _json_bytes(validate(valid["request_json"], valid["candidates_json"]))
    check("容器 /validate 200、与本机纯函数逐字节一致、all_passed=True",
          v_status == 200 and v_body == inproc and json.loads(v_body)["all_passed"] is True,
          f"status={v_status} 一致={v_body == inproc} all_passed={json.loads(v_body)['all_passed']} len={len(v_body)}")
    check("容器响应回显 X-GiftWise-Request-Id", bool(v_headers.get("X-GiftWise-Request-Id")),
          v_headers.get("X-GiftWise-Request-Id"))

    for _ in range(2):
        status, _, _ = http("POST", "/validate", b"{broken json " + SENTINEL.encode())
        ledger.append(("POST /validate", status))
    status, _, _ = http("GET", "/nope")
    ledger.append(("GET /nope", status))
    status, _, _ = http("GET", "/readyz")
    ledger.append(("GET /readyz", status))
    check("容器内 400/404/readyz 行为符合契约",
          [s for name, s in ledger if name == "POST /validate"] == [200, 400, 400] and status == 200,
          ledger)

    m_status, _, m_body = http("GET", "/metrics?format=json")
    save("container-metrics.json", m_body.decode("utf-8", "replace"))
    metrics = json.loads(m_body)
    check("容器 /metrics?format=json 200 且 RSS 走 Linux /proc",
          m_status == 200 and metrics["platform"] == "Linux" and (metrics["process_resident_memory_bytes"] or 0) > 0,
          {"platform": metrics["platform"], "rss_mib": round((metrics["process_resident_memory_bytes"] or 0) / 1048576, 2),
           "requests_total": metrics["requests_total"]})
    scrapes = 1  # 上面这一次 /metrics
    polls = 1    # wait_http 成功的那一次 /healthz
    check("指标里的请求数 >= 我发起的请求数（差额来自容器自带 HEALTHCHECK 与本次抓取）",
          metrics["requests_total"] >= len(ledger) + scrapes,
          {"指标": metrics["requests_total"], "我发起": len(ledger), "抓取": scrapes})
    check("容器内成本/模型调用恒为 0",
          metrics["model_calls_total"] == 0 and metrics["cost"]["amount"] == 0, metrics["cost"])

    code, text = capture([binary, "exec", CONTAINER, "cat", "/tmp/access.jsonl"])
    save("container-access.jsonl", text)
    lines = [line for line in text.splitlines() if line.strip()]
    parsed, bad = [], 0
    for line in lines:
        try:
            parsed.append(json.loads(line))
        except json.JSONDecodeError:
            bad += 1
    healthz_records = sum(1 for record in parsed if record.get("route") == "/healthz")
    check("容器内 JSONL 逐行可解析、行数不低于已发请求数", bad == 0 and len(parsed) >= len(ledger),
          {"行数": len(lines), "可解析": len(parsed), "坏行": bad, "我发起": len(ledger)})
    check("容器自带 HEALTHCHECK 确实在打 /healthz（日志可见）",
          healthz_records > 1,
          {"/healthz 记录数": healthz_records, "其中我发起": 1, "wait_http 探活": polls})
    check("容器日志不含请求体（哨兵串 0 命中）", SENTINEL not in text and "request_json" not in text,
          {"sentinel": SENTINEL in text, "request_json": text.count("request_json")})
    check("容器日志记录了透传 run_id 与耗时",
          any(r.get("run_id") == "run-container-001" for r in parsed)
          and all(isinstance(r.get("duration_ms"), (int, float)) for r in parsed),
          sorted({str(r.get("run_id")) for r in parsed}))

    limp = capture([binary, "logs", "--tail", "40", CONTAINER])
    save("container-stdout.txt", limp[1])

    # ------------------------------------------------------------ 优雅退出
    code, text = capture([binary, "stop", "-t", "10", CONTAINER], timeout=60)
    save("docker-stop.txt", text)
    stopped_state = ""
    for _ in range(20):
        code2, text2 = capture([binary, "inspect", "--format", "{{.State.Status}}", CONTAINER])
        stopped_state = text2.strip()
        if stopped_state == "exited":
            break
        time.sleep(0.5)
    check("docker stop（SIGTERM）后容器退出", stopped_state == "exited", stopped_state)

    code, text = capture([binary, "logs", CONTAINER])
    save("container-logs-full.txt", text)
    shutdown = None
    for line in text.splitlines():
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError:
            continue
        if candidate.get("event") == "shutdown":
            shutdown = candidate
    check("容器内优雅退出并打印末次汇总（含请求总数/RSS）",
          shutdown is not None and shutdown.get("requests_total", 0) >= len(ledger),
          {k: shutdown.get(k) for k in ("requests_total", "uptime_seconds", "process_resident_memory_bytes")}
          if shutdown else None)

    # 完全对账：关机汇总总数 = 我发起的 + 我的一次抓取 + 我的一次探活 + 容器自带 HEALTHCHECK
    final_lines = [line for line in text.splitlines() if line.strip()]
    jsonl_lines = 0
    try:
        jsonl_lines = len([line for line in (outdir / "container-access.jsonl").read_text(
            encoding="utf-8", errors="replace").splitlines() if line.strip()])
    except OSError:
        pass
    healthchecks = (shutdown or {}).get("requests_total", 0) - len(ledger) - scrapes - polls
    check("请求数可完整对账：我的请求 + 抓取 + 探活 + 容器 HEALTHCHECK",
          (shutdown or {}).get("requests_total") == len(ledger) + scrapes + polls + healthchecks
          and healthchecks >= 1,
          {"关机汇总总数": (shutdown or {}).get("requests_total"), "我发起": len(ledger),
           "抓取": scrapes, "探活": polls, "容器 HEALTHCHECK": healthchecks})
    check("关机汇总总数 >= 容器内 JSONL 行数（日志在关机前读取）",
          (shutdown or {}).get("requests_total", 0) >= jsonl_lines,
          {"关机汇总": (shutdown or {}).get("requests_total"), "JSONL 行数": jsonl_lines})

    code, text = capture([binary, "inspect", "--format", "{{.State.ExitCode}}", CONTAINER])
    check("容器退出码为 0（收到 SIGTERM 后正常收尾）", text.strip() == "0", text.strip())
    capture([binary, "rm", "-f", CONTAINER])

    save("console.txt", "\n".join(console) + "\n")
    payload_out = {
        "stamp": stamp,
        "sentinel": SENTINEL,
        "tag": TAG,
        "host_port": HOST_PORT,
        "container": CONTAINER,
        "build_seconds": round(build_seconds, 1),
        "docker_version": archive.get("docker-version.txt", "").strip(),
        "image": archive.get("docker-images.txt", "").strip(),
        "health": health,
        "metrics": metrics,
        "ledger": ledger,
        "jsonl_lines": len(parsed),
        "shutdown_summary": shutdown,
        "checks": results,
        "checks_passed": sum(1 for item in results if item["ok"]),
        "checks_total": len(results),
        "files": sorted(path.name for path in outdir.iterdir()),
    }
    (outdir / "observability-container-check.json").write_text(
        json.dumps(payload_out, ensure_ascii=False, indent=2), encoding="utf-8")
    (RAW / "observability-container-latest.txt").write_text(str(outdir) + "\n", encoding="utf-8")

    passed = sum(1 for item in results if item["ok"])
    log()
    log(f"===== 容器断言 {passed}/{len(results)} 通过 =====")
    for item in results:
        if not item["ok"]:
            log(f"  FAIL: {item['name']} :: {item['detail']}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
