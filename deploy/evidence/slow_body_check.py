"""I-2（= 安全自查 S-5）"半开正文/慢连接"缺陷：修复前复现 + 修复后回归证据。

缺陷（QA-001 实验结论）：`Content-Length: 100` 只发 5 字节 → 服务端挂在 `rfile.read(100)` 上，
45 秒零响应、连接永不关闭；9 条此类连接让容器 PID 1 的线程数 +9 且 10 秒不回收，
而 `/healthz` 仍返回 200（健康检查发现不了）。

本脚本给出四类可复核的证据：
  A. 修复后（默认入口，默认 10s 超时）：半开正文 → **408 + 立即关闭**；9 条并发全部如此；
     期间 `/healthz` 仍 200；线程数回落。
  B. 修复后（`GIFTWISE_READ_TIMEOUT=3`）：短读 → 400、不读正文的连接 → 有界关闭、
     滴流（每 1s 1 字节）也被**总预算**截断 → 408（证明不只靠单次 recv 超时）。
  C. 修复前对照（`raw/slowbody-prefix/server.py.before`，git HEAD 的字节副本）：
     14 秒窗口内无响应且连接未关闭、线程不回收（缺陷复现），并给出端点矩阵用于逐字节回归对比。
  D. 修复后（可观测入口）：同样返回 408，且 JSONL/指标记到 408 + `REQUEST_TIMEOUT`。
  E. 容器内（PID 1）：修复前镜像 Threads 前/中/后（+9 不回收）与修复后镜像（回落到基线），
     并在 9 条半开连接进行中验证 `/healthz` 仍 200。

只做本机与容器内操作：不连接任何外部主机、不上传、不产生费用。只用标准库；
子进程输出一律重定向到文件后读回（不使用管道）。
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "deploy" / "evidence" / "raw"
CN = timezone(timedelta(hours=8))
PRE_FIX_SERVER = RAW / "slowbody-prefix" / "server.py.before"
PRE_FIX_DOCKERFILE = RAW / "slowbody-prefix" / "Dockerfile.before"

DEFAULT_TIMEOUT = 10.0   # deploy/server.py 的默认读超时
SHORT_TIMEOUT = 3.0      # 阶段 B 用 GIFTWISE_READ_TIMEOUT 覆盖
PREFIX_WINDOW = 14.0     # 修复前对照的观察窗口（QA 观察到 45s 无响应；这里 14s 足以证明"仍在挂"）

PORT_DEFAULT, PORT_SHORT, PORT_PREFIX, PORT_OBS = 8801, 8802, 8803, 8804
IMG_FIXED = "giftwise-validator:slowbody-check"
IMG_PREFIX = "giftwise-validator:prefix-check"
C_FIXED, C_PREFIX = "gw-slowbody-fixed", "gw-slowbody-prefix"
P_FIXED, P_PREFIX = 8794, 8795

DOCKER_DIRS = [
    r"C:\Program Files\Docker\Docker\resources\bin",
    r"C:\ProgramData\DockerDesktop\version-bin",
]

HALF_HEAD = (b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n"
             b"Content-Length: 100\r\n\r\n")
HALF_BODY = b'{"a"'          # 只发 5 字节，声明 100 → 半开正文

results: list[dict] = []
console: list[str] = []
TMP = Path(os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp"))) / f"dsh-i2-{uuid.uuid4().hex[:8]}"
TMP.mkdir(parents=True, exist_ok=True)


def log(line: str = "") -> None:
    console.append(line)
    print(line, flush=True)


def check(name: str, ok: bool, detail: object) -> None:
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    log(f"[{'PASS' if ok else 'FAIL'}] {name} :: {detail}")


def save(outdir: Path, name: str, text: str) -> None:
    (outdir / name).write_text(text, encoding="utf-8", errors="replace")


# --------------------------------------------------------------------- 载荷

def _load_t01():
    data = json.loads((REPO / "tests" / "test_cases.json").read_text(encoding="utf-8"))
    cases = data if isinstance(data, list) else (data.get("cases") or data.get("test_cases"))
    case = next(item for item in cases if item.get("id") == "T01_normal")
    return case["request"], case["candidate_batch"]


T01_REQUEST, T01_CANDIDATES = _load_t01()
VALID = {"request_json": json.dumps(T01_REQUEST, ensure_ascii=False),
         "candidates_json": json.dumps(T01_CANDIDATES, ensure_ascii=False)}
VALID_BODY = json.dumps(VALID, ensure_ascii=False).encode("utf-8")
NON_STRING = {"request_json": T01_REQUEST, "candidates_json": VALID["candidates_json"]}


# --------------------------------------------------------------------- 进程/端口

def start_local(port: int, module: str, tag: str, outdir: Path,
                extra_env: dict | None = None, cwd: Path | None = None):
    env = dict(os.environ)
    env.update({"GIFTWISE_BIND": "127.0.0.1", "GIFTWISE_PORT": str(port),
                "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
                "PYTHONDONTWRITEBYTECODE": "1"})
    env.pop("GIFTWISE_READ_TIMEOUT", None)
    env.update(extra_env or {})
    log_path = outdir / f"{tag}.log"
    with log_path.open("wb") as handle:
        proc = subprocess.Popen([sys.executable, "-m", module], cwd=str(cwd or REPO), env=env,
                                stdout=handle, stderr=subprocess.STDOUT,
                                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    return proc, log_path


def stop_local(proc) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=6)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def wait_port(port: int, timeout: float = 25.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
            return True
        except OSError:
            time.sleep(0.25)
    return False


def wait_http(port: int, path: str = "/healthz", timeout: float = 60.0) -> tuple[bool, object]:
    """等到真正拿到 200 为止。

    注意：容器场景下 Docker 的端口代理会**先于应用**接受 TCP 连接，
    所以只用 `wait_port` 判断就绪会拿到连接被拒/空响应（踩过一次）。
    """
    deadline = time.time() + timeout
    last: object = "no attempt"
    while time.time() < deadline:
        status, body, _ = http(port, "GET", path, timeout=3.0)
        last = {"status": status, "body": body[:60].decode("utf-8", "replace")} if status else body
        if status == 200:
            return True, last
        time.sleep(0.4)
    return False, last


def make_pre_fix_tree() -> Path:
    """把 pre-fix 的 server.py 与 Dockerfile 字节副本 + validator 放进临时目录，用于"修复前对照"。

    **为什么连 Dockerfile 一起复制**（2026-10-31 修正）：仓库里的 `deploy/Dockerfile` 已按 PM 决定
    "B" 改成"COPY 可观测入口 + `CMD` = `deploy.observable_server`"。若仍用**当前** Dockerfile 构建
    修复前源码树，会同时踩两个坑：① 那两行 COPY 在修复前树里没有对应文件 → 构建直接失败；
    ② 把**当前**的 `observable_server.py` 配**修复前**的 `server.py` 是坏组合（前者依赖后者的
    `_read_body()`/`READ_TIMEOUT_SECONDS`）。所以对照镜像必须用它**当时的 Dockerfile**
    （`CMD` = `deploy.server`、只 COPY `validator` + `deploy/server.py`），字节副本见
    `raw/slowbody-prefix/Dockerfile.before`。
    """
    tree = TMP / "prefix-tree"
    (tree / "deploy").mkdir(parents=True, exist_ok=True)
    (tree / "validator").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PRE_FIX_SERVER, tree / "deploy" / "server.py")
    shutil.copyfile(PRE_FIX_DOCKERFILE, tree / "deploy" / "Dockerfile")
    for name in ("rules.py", "__init__.py"):
        src = REPO / "validator" / name
        if src.exists():
            shutil.copyfile(src, tree / "validator" / name)
    return tree


# --------------------------------------------------------------------- 原始 socket

def raw_request(port: int, head: bytes, body: bytes = b"", wait: float = 15.0,
                shutdown_write: bool = False) -> dict:
    """发原始请求并观察：响应内容、是否被服务端关闭、从发完到关闭的耗时。"""
    result: dict = {"data": b"", "body": b"", "code": None, "status_line": None,
                    "closed": False, "reset": False, "elapsed": None, "err": None}
    try:
        sock = socket.create_connection(("127.0.0.1", port), timeout=wait + 5)
    except OSError as exc:
        result["err"] = f"connect: {exc}"
        return result
    try:
        try:
            sock.sendall(head + body)
        except OSError as exc:
            result["err"] = f"send: {exc}"
        if shutdown_write:
            try:
                sock.shutdown(socket.SHUT_WR)
            except OSError:
                pass
        sock.settimeout(wait)
        chunks: list[bytes] = []
        t0 = time.monotonic()
        try:
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    result["closed"] = True
                    break
                chunks.append(chunk)
        except socket.timeout:
            pass
        except ConnectionResetError:
            result["reset"] = True
            result["closed"] = True
        result["elapsed"] = time.monotonic() - t0
        result["data"] = b"".join(chunks)
    finally:
        try:
            sock.close()
        except OSError:
            pass
    data = result["data"]
    if data:
        result["status_line"] = data.split(b"\r\n", 1)[0].decode("latin1")
        parts = result["status_line"].split()
        result["code"] = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        result["body"] = data.split(b"\r\n\r\n", 1)[-1] if b"\r\n\r\n" in data else b""
    return result


def parallel_raw(port: int, count: int, head: bytes, body: bytes, wait: float):
    """同时发起 count 条原始连接（barrier 保证同时），返回 (结果容器, 线程列表)。"""
    holder: dict = {"results": [None] * count}
    barrier = threading.Barrier(count)
    lock = threading.Lock()

    def worker(index: int) -> None:
        barrier.wait()
        outcome = raw_request(port, head, body, wait)
        with lock:
            holder["results"][index] = outcome

    threads = [threading.Thread(target=worker, args=(i,), daemon=True) for i in range(count)]
    for thread in threads:
        thread.start()
    return holder, threads


# --------------------------------------------------------------------- HTTP 客户端

def http(port: int, method: str, path: str, body: bytes | None = None,
         headers: dict | None = None, timeout: float = 15.0):
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body, method=method)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)
    except Exception as exc:  # noqa: BLE001
        return None, repr(exc).encode(), {}


def endpoint_matrix(port: int) -> dict:
    """现有端点矩阵（正常请求 + 既有 5 条错误路径 + 无 Content-Length），用于逐字节回归对比。"""
    json_headers = {"Content-Type": "application/json"}
    matrix: dict = {}
    matrix["GET /healthz"] = http(port, "GET", "/healthz")
    matrix["GET /"] = http(port, "GET", "/")
    matrix["GET /nope"] = http(port, "GET", "/nope")
    matrix["POST /validate 正常载荷"] = http(port, "POST", "/validate", VALID_BODY, json_headers)
    matrix["POST /validate 字段非字符串"] = http(port, "POST", "/validate",
                                                 json.dumps(NON_STRING, ensure_ascii=False).encode(), json_headers)
    matrix["POST /validate 非法 JSON"] = http(port, "POST", "/validate", b"{not-json", json_headers)
    matrix["POST /validate 超长正文"] = http(port, "POST", "/validate", b"x" * (64 * 1024 + 1), json_headers)
    matrix["PUT /validate 未实现方法"] = http(port, "PUT", "/validate", b"", {})
    matrix["POST /nope"] = http(port, "POST", "/nope", b"", {})
    no_len = raw_request(port, b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n", b"", wait=8)
    matrix["POST /validate 无 Content-Length"] = (no_len["code"], no_len["body"], {})
    return {name: (value[0], value[1]) for name, value in matrix.items()}


# --------------------------------------------------------------------- 线程数

def capture(args: list[str], timeout: float = 120.0, cwd: Path | None = None) -> tuple[int, str]:
    out_file = TMP / f"cmd-{uuid.uuid4().hex[:8]}.txt"
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join(DOCKER_DIRS + [env.get("PATH", "")])
    env["MSYS_NO_PATHCONV"] = "1"
    with out_file.open("wb") as handle:
        try:
            code = subprocess.run(args, cwd=str(cwd or REPO), env=env, stdout=handle,
                                  stderr=subprocess.STDOUT, timeout=timeout).returncode
        except subprocess.TimeoutExpired:
            code = -9
            handle.write(b"\n[timeout]\n")
    text = out_file.read_text(encoding="utf-8", errors="replace")
    try:
        out_file.unlink()
    except OSError:
        pass
    return code, text


def threads_local(pid: int) -> int | None:
    status = Path(f"/proc/{pid}/status")
    if status.exists():
        for line in status.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.lower().startswith("threads:"):
                return int(line.split()[1])
    code, text = capture(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                          f"(Get-Process -Id {pid}).Threads.Count"], timeout=40)
    for line in text.splitlines():
        line = line.strip()
        if line.isdigit():
            return int(line)
    return None


def threads_container(name: str) -> int | None:
    code, text = docker(["exec", name, "sh", "-c", "grep -i '^Threads' /proc/1/status"])
    for line in text.splitlines():
        if line.lower().startswith("threads:"):
            return int(line.split()[1])
    return None


def docker_bin() -> str | None:
    found = shutil.which("docker")
    if found:
        return found
    for directory in DOCKER_DIRS:
        candidate = Path(directory) / "docker.exe"
        if candidate.exists():
            return str(candidate)
    return None


def docker(args: list[str], timeout: float = 600.0) -> tuple[int, str]:
    binary = docker_bin() or "docker"
    return capture([binary] + args, timeout=timeout)


# --------------------------------------------------------------------- 主流程

def main() -> int:  # noqa: C901
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    outdir = RAW / f"slowbody-{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    log(f"输出目录：{outdir}")
    log(f"仓库根：{REPO}")
    log(f"修复前对照源码：{PRE_FIX_SERVER}")
    log(f"修复前对照 Dockerfile：{PRE_FIX_DOCKERFILE}")
    if not PRE_FIX_SERVER.exists():
        log("缺少修复前源码副本（deploy/evidence/raw/slowbody-prefix/server.py.before），无法做对照")
        return 2
    if not PRE_FIX_DOCKERFILE.exists():
        log("缺少修复前 Dockerfile 副本（deploy/evidence/raw/slowbody-prefix/Dockerfile.before），无法做容器对照")
        return 2

    probe = None
    sys.path.insert(0, str(REPO))
    from deploy.server import READ_TIMEOUT_SECONDS  # noqa: E402
    try:
        from validator.rules import validate  # noqa: E402
        probe = validate(VALID["request_json"], VALID["candidates_json"])
    except Exception as exc:  # noqa: BLE001
        log(f"纯函数前置校验失败：{exc}")

    check("前置：deploy/server.py 已带读超时且默认 10s", READ_TIMEOUT_SECONDS == DEFAULT_TIMEOUT,
          f"READ_TIMEOUT_SECONDS={READ_TIMEOUT_SECONDS}")
    check("前置：工作负载载荷经纯函数校验为 passed",
          bool(probe) and probe["status"] == "passed" and probe["all_passed"] is True,
          {"status": probe["status"] if probe else None})

    fixed_matrix: dict = {}
    prefix_matrix: dict = {}

    # ================================================== 阶段 A：修复后 · 默认入口
    log("\n===== 阶段 A：修复后默认入口（默认 10s 超时） =====")
    proc_a, log_a = start_local(PORT_DEFAULT, "deploy.server", "A-fixed-default", outdir)
    try:
        check("A0 服务就绪（<25s）", wait_port(PORT_DEFAULT), f"127.0.0.1:{PORT_DEFAULT}")
        base_status, base_body, _ = http(PORT_DEFAULT, "GET", "/healthz")
        threads_before = threads_local(proc_a.pid)

        single = raw_request(PORT_DEFAULT, HALF_HEAD, HALF_BODY, wait=DEFAULT_TIMEOUT + 8)
        check("A1 声明 Content-Length:100 只发 5 字节 → 408 REQUEST_TIMEOUT",
              single["code"] == 408 and b"REQUEST_TIMEOUT" in single["body"],
              {"状态行": single["status_line"], "body": single["body"][:60].decode("latin1", "replace")})
        check(f"A2 在上限内返回（{DEFAULT_TIMEOUT:.0f}s 量级，绝不再挂 45s）",
              single["elapsed"] is not None and DEFAULT_TIMEOUT - 0.5 <= single["elapsed"] <= DEFAULT_TIMEOUT + 3,
              f"耗时={single['elapsed']:.2f}s（观察窗口={DEFAULT_TIMEOUT + 8:.0f}s）")
        check("A3 服务端随后关闭了连接", single["closed"] is True,
              {"closed": single["closed"], "reset": single["reset"]})

        holder, threads = parallel_raw(PORT_DEFAULT, 9, HALF_HEAD, HALF_BODY, DEFAULT_TIMEOUT + 8)
        time.sleep(2.0)
        threads_during = threads_local(proc_a.pid)
        during_status, during_body, _ = http(PORT_DEFAULT, "GET", "/healthz")
        for thread in threads:
            thread.join(timeout=DEFAULT_TIMEOUT + 15)
        time.sleep(0.8)
        threads_after = threads_local(proc_a.pid)
        outcomes = [item for item in holder["results"] if item]
        codes = sorted({item["code"] for item in outcomes})
        elapsed_max = max((item["elapsed"] or 0) for item in outcomes)
        check("A4 9 条并发半开连接全部得到 408", len(outcomes) == 9 and codes == [408],
              {"条数": len(outcomes), "状态码集合": codes})
        check("A5 9 条全部被关闭、且都在上限内结束",
              all(item["closed"] for item in outcomes) and elapsed_max <= DEFAULT_TIMEOUT + 3,
              {"全部关闭": all(item["closed"] for item in outcomes), "最大耗时": round(elapsed_max, 2)})
        check("A6 半开连接进行中 /healthz 仍 200 且响应体与基线一致",
              during_status == 200 and during_body == base_body,
              {"状态": during_status, "与基线一致": during_body == base_body})
        check("A7 线程数回落（9 条结束后回到基线）",
              threads_before is not None and threads_after is not None
              and threads_after <= threads_before + 1,
              {"基线": threads_before, "半开进行中": threads_during, "全部结束后": threads_after})
        log(f"  Threads 采样：前={threads_before} 中={threads_during} 后={threads_after}")

        fixed_matrix = endpoint_matrix(PORT_DEFAULT)
        save(outdir, "A-endpoint-matrix.json",
             json.dumps({k: [v[0], v[1].decode("utf-8", "replace")] for k, v in fixed_matrix.items()},
                        ensure_ascii=False, indent=2))
        expect = {"GET /healthz": 200, "GET /": 200, "GET /nope": 404,
                  "POST /validate 正常载荷": 200, "POST /validate 字段非字符串": 400,
                  "POST /validate 非法 JSON": 400, "POST /validate 超长正文": 413,
                  "PUT /validate 未实现方法": 501, "POST /nope": 404,
                  "POST /validate 无 Content-Length": 413}
        actual = {name: value[0] for name, value in fixed_matrix.items()}
        check("A8 正常请求与既有错误路径全部保持原状态码（未回退）", actual == expect,
              {"实际": actual, "期望": expect})
        normal = json.loads(fixed_matrix["POST /validate 正常载荷"][1])
        check("A9 正常请求仍为业务通过（200 + status=passed + all_passed=true）",
              normal.get("status") == "passed" and normal.get("all_passed") is True,
              {"status": normal.get("status"), "all_passed": normal.get("all_passed")})
    finally:
        stop_local(proc_a)

    # ================================================== 阶段 B：短超时 + 辅助场景
    log(f"\n===== 阶段 B：GIFTWISE_READ_TIMEOUT={SHORT_TIMEOUT:.0f}s 的辅助场景 =====")
    proc_b, _ = start_local(PORT_SHORT, "deploy.server", "B-fixed-short", outdir,
                            extra_env={"GIFTWISE_READ_TIMEOUT": str(SHORT_TIMEOUT)})
    try:
        check("B0 短超时实例就绪（环境变量可覆盖）", wait_port(PORT_SHORT), "127.0.0.1:8802")
        short = raw_request(PORT_SHORT, HALF_HEAD, b'{"request_json":"x"}', wait=8, shutdown_write=True)
        check("B1 短读（发 20 字节后关闭写方向）→ 400 且立即返回",
              short["code"] == 400 and short["elapsed"] is not None and short["elapsed"] < 3,
              {"状态行": short["status_line"], "耗时": round(short["elapsed"] or 0, 3),
               "body": short["body"][:60].decode("latin1", "replace")})
        silent = raw_request(PORT_SHORT, b"", b"", wait=8)
        check("B2 连上不发任何数据 → 有界关闭（无响应，不再永久占线程）",
              silent["closed"] is True and silent["code"] is None
              and SHORT_TIMEOUT - 0.3 <= (silent["elapsed"] or 0) <= SHORT_TIMEOUT + 2,
              {"关闭": silent["closed"], "耗时": round(silent["elapsed"] or 0, 2), "响应": silent["code"]})
        half_line = raw_request(PORT_SHORT, b"POST /validate HT", b"", wait=8)
        check("B3 只发半个请求行 → 有界关闭",
              half_line["closed"] is True and SHORT_TIMEOUT - 0.3 <= (half_line["elapsed"] or 0) <= SHORT_TIMEOUT + 2,
              {"关闭": half_line["closed"], "耗时": round(half_line["elapsed"] or 0, 2)})

        # 滴流：每 1 秒发 1 字节，声明 100 字节 —— 单次 recv 超时挡不住这种拖法，总预算才行。
        # 发送与接收必须并发（发送方要持续 40s，若串行就永远读不到响应）。
        drip_holder: dict = {}
        drip_started = threading.Event()

        def drip() -> None:
            sock = socket.create_connection(("127.0.0.1", PORT_SHORT), timeout=8)
            stop_sending = threading.Event()

            def sender() -> None:
                for _ in range(40):
                    if stop_sending.is_set():
                        return
                    try:
                        sock.sendall(b"x")
                    except OSError:
                        return
                    time.sleep(1.0)

            try:
                sock.sendall(HALF_HEAD)
                threading.Thread(target=sender, daemon=True).start()
                drip_started.set()
                sock.settimeout(SHORT_TIMEOUT + 8)
                t0 = time.monotonic()
                data = b""
                try:
                    while True:
                        chunk = sock.recv(4096)
                        if not chunk:
                            break
                        data += chunk
                except OSError:
                    pass
                drip_holder["data"] = data
                drip_holder["elapsed"] = time.monotonic() - t0
            except OSError as exc:
                drip_holder["err"] = repr(exc)
            finally:
                stop_sending.set()
                sock.close()

        drip_thread = threading.Thread(target=drip, daemon=True)
        drip_thread.start()
        drip_started.wait(timeout=5)
        drip_thread.join(timeout=SHORT_TIMEOUT + 10)
        drip_data = drip_holder.get("data", b"")
        drip_parts = drip_data.split(b"\r\n", 1)[0].split(b" ") if drip_data else []
        drip_code = int(drip_parts[1]) if len(drip_parts) > 1 and drip_parts[1].isdigit() else None
        check("B4 滴流（每 1s 发 1 字节、声明 100 字节）被总预算截断 → 408",
              drip_code == 408 and (drip_holder.get("elapsed") or 0) <= SHORT_TIMEOUT + 3,
              {"状态行": drip_data.split(b"\r\n", 1)[0].decode("latin1") if drip_data else "<无响应>",
               "耗时": round(drip_holder.get("elapsed") or 0, 2), "预算": SHORT_TIMEOUT})
    finally:
        stop_local(proc_b)

    # ================================================== 阶段 C：修复前对照
    log(f"\n===== 阶段 C：修复前对照（git HEAD 的 server.py 字节副本，观察窗口 {PREFIX_WINDOW:.0f}s） =====")
    tree = make_pre_fix_tree()
    proc_c, _ = start_local(PORT_PREFIX, "deploy.server", "C-prefix", outdir, cwd=tree)
    try:
        check("C0 修复前实例就绪", wait_port(PORT_PREFIX), f"127.0.0.1:{PORT_PREFIX}（源码={tree}）")
        threads_before = threads_local(proc_c.pid)
        holder, threads = parallel_raw(PORT_PREFIX, 9, HALF_HEAD, HALF_BODY, PREFIX_WINDOW)
        time.sleep(2.0)
        threads_during = threads_local(proc_c.pid)
        # 关键：必须在【客户端仍持有连接】时再采一次样。修复前服务端自身没有超时，
        # 一旦客户端主动关闭，read 会立刻返回，线程就释放了 —— 那样采不到"不回收"。
        time.sleep(max(0.0, PREFIX_WINDOW - 4.0))
        threads_late = threads_local(proc_c.pid)
        for thread in threads:
            thread.join(timeout=PREFIX_WINDOW + 10)
        threads_after = threads_local(proc_c.pid)
        outcomes = [item for item in holder["results"] if item]
        no_response = [item for item in outcomes if item["data"] == b""]
        still_open = [item for item in outcomes if not item["closed"]]
        check(f"C1 缺陷复现：{PREFIX_WINDOW:.0f}s 内 9 条半开连接【零响应】",
              len(no_response) == 9,
              {"零响应条数": len(no_response), "总条数": len(outcomes)})
        check(f"C2 缺陷复现：{PREFIX_WINDOW:.0f}s 后连接仍【未被关闭】",
              len(still_open) == 9,
              {"仍打开条数": len(still_open)})
        check("C3 缺陷复现：半开连接进行中线程 +9，且 12s 后仍不回收（服务端自身无超时）",
              threads_before is not None and threads_during is not None and threads_late is not None
              and threads_during >= threads_before + 5 and threads_late >= threads_before + 5,
              {"基线": threads_before, "连接后 2s": threads_during, "连接后 12s": threads_late})
        check("C4 缺陷复现：只有【客户端主动关闭】后才释放（证明服务端没有自我超时）",
              threads_after is not None and threads_after <= threads_before + 1,
              {"基线": threads_before, "客户端关闭后": threads_after})
        log(f"  Threads 采样（修复前）：前={threads_before} 2s={threads_during} "
            f"12s={threads_late} 客户端关闭后={threads_after}")
        prefix_matrix = endpoint_matrix(PORT_PREFIX)
        save(outdir, "C-prefix-endpoint-matrix.json",
             json.dumps({k: [v[0], v[1].decode("utf-8", "replace")] for k, v in prefix_matrix.items()},
                        ensure_ascii=False, indent=2))
    finally:
        stop_local(proc_c)

    if fixed_matrix and prefix_matrix:
        diffs = []
        for name in sorted(set(fixed_matrix) | set(prefix_matrix)):
            left, right = fixed_matrix.get(name), prefix_matrix.get(name)
            if left is None or right is None or left[0] != right[0] or left[1] != right[1]:
                diffs.append({"用例": name,
                              "修复后": [left[0] if left else None, (left[1][:80].decode("utf-8", "replace") if left else None)],
                              "修复前": [right[0] if right else None, (right[1][:80].decode("utf-8", "replace") if right else None)]})
        save(outdir, "D-parity-diff.json", json.dumps({"差异": diffs}, ensure_ascii=False, indent=2))
        check("A10/C4 端点矩阵逐字节回归：修复后与修复前完全一致（10 个用例）",
              not diffs, {"差异条数": len(diffs), "差异": diffs[:3]})

    # ================================================== 阶段 E：可观测入口
    log("\n===== 阶段 E：可观测入口（deploy.observable_server） =====")
    access_log = outdir / "E-access.jsonl"
    proc_e, _ = start_local(PORT_OBS, "deploy.observable_server", "E-observable", outdir,
                            extra_env={"GIFTWISE_ACCESS_LOG": str(access_log)})
    try:
        check("E0 可观测入口就绪", wait_port(PORT_OBS), "127.0.0.1:8804")
        obs = raw_request(PORT_OBS, HALF_HEAD, HALF_BODY, wait=DEFAULT_TIMEOUT + 8)
        check("E1 可观测入口同样返回 408 并关闭（同一缺陷已一并修复）",
              obs["code"] == 408 and obs["closed"] is True
              and DEFAULT_TIMEOUT - 0.5 <= (obs["elapsed"] or 0) <= DEFAULT_TIMEOUT + 3,
              {"状态行": obs["status_line"], "关闭": obs["closed"], "耗时": round(obs["elapsed"] or 0, 2)})
        obs_health = http(PORT_OBS, "GET", "/healthz")
        check("E2 可观测入口 /healthz 仍 200", obs_health[0] == 200, {"状态": obs_health[0]})
        time.sleep(0.5)
        lines = [json.loads(line) for line in access_log.read_text(encoding="utf-8", errors="replace").splitlines()
                 if line.strip()]
        timeouts = [item for item in lines
                    if item.get("http_status") == 408 and "REQUEST_TIMEOUT" in (item.get("error_codes") or [])]
        check("E3 JSONL 记到了 408 + REQUEST_TIMEOUT（超时可被观测）",
              len(timeouts) >= 1,
              {"日志行数": len(lines), "408+REQUEST_TIMEOUT 行数": len(timeouts),
               "样例": {k: timeouts[0].get(k) for k in ("route", "http_status", "error_codes", "duration_ms")}
               if timeouts else None})
        status, body, _ = http(PORT_OBS, "GET", "/metrics?format=json")
        snapshot = json.loads(body)
        key_hits = {k: v for k, v in snapshot.get("requests_by_key", {}).items() if k.endswith(" 408")}
        check("E4 /metrics 里 POST /validate 408 计数 >= 1",
              status == 200 and sum(key_hits.values()) >= 1,
              {"状态": status, "408 计数": key_hits})
    finally:
        stop_local(proc_e)

    # ================================================== 阶段 F：容器内（PID 1）
    log("\n===== 阶段 F：容器内 —— PID 1 的 /proc/1/status Threads 前后 =====")
    binary = docker_bin()
    if binary is None:
        check("F0 找到 docker 客户端", False, "未找到 docker（跳过容器阶段）")
    else:
        code, text = docker(["--version"])
        check("F0 找到 docker 客户端", code == 0, text.strip()[:60])
        save(outdir, "F-docker-version.txt", text)

        # --- F1：修复后镜像
        code, text = docker(["build", "-t", IMG_FIXED, "-f", str(REPO / "deploy" / "Dockerfile"), "."])
        save(outdir, "F1-build-fixed.txt", text)
        check("F1 修复后镜像构建成功（默认 CMD = deploy.server；可观测入口随镜像交付但非默认入口）",
              code == 0, {"exit": code, "末行": text.strip().splitlines()[-1][:100] if text.strip() else ""})
        docker(["rm", "-f", C_FIXED])
        code, text = docker(["run", "-d", "--name", C_FIXED, "-p", f"127.0.0.1:{P_FIXED}:8000", IMG_FIXED])
        save(outdir, "F1-run-fixed.txt", text)
        container_id = text.strip().splitlines()[-1] if text.strip() else ""
        check("F2 修复后容器已启动", code == 0 and len(container_id) == 64,
              {"exit": code, "id 长度": len(container_id)})
        ready, ready_detail = wait_http(P_FIXED)
        check("F3 容器 /healthz 真正返回 200（端口代理先接受 TCP，不能只看端口通）",
              ready, ready_detail)
        before = threads_container(C_FIXED)
        holder, threads = parallel_raw(P_FIXED, 9, HALF_HEAD, HALF_BODY, DEFAULT_TIMEOUT + 8)
        time.sleep(2.0)
        during = threads_container(C_FIXED)
        health_during = http(P_FIXED, "GET", "/healthz")[0]
        for thread in threads:
            thread.join(timeout=DEFAULT_TIMEOUT + 15)
        time.sleep(1.2)
        after = threads_container(C_FIXED)
        save(outdir, "F1-threads.txt",
             f"修复后容器 {C_FIXED}\nThreads 前={before}\nThreads 中(9 条半开进行中)={during}\n"
             f"Threads 后(全部 408 之后)={after}\n")
        outcomes = [item for item in holder["results"] if item]
        codes = sorted({item["code"] for item in outcomes})
        check("F4 容器内 9 条半开连接全部 408 且全部关闭",
              len(outcomes) == 9 and codes == [408] and all(item["closed"] for item in outcomes),
              {"状态码集合": codes, "全部关闭": all(item["closed"] for item in outcomes)})
        check("F5 半开连接进行中 /healthz 仍 200（健康检查依旧正常）", health_during == 200,
              {"状态": health_during, "Threads 中": during})
        check("F6 修复后容器：Threads 中 ≈ 前+9，且 9 条结束后回落到基线（QA 的 +9 不回收已消除）",
              before is not None and during is not None and after is not None
              and during >= before + 5 and after <= before + 1,
              {"前": before, "中": during, "后": after})
        container_matrix = endpoint_matrix(P_FIXED)
        save(outdir, "F1-container-endpoint-matrix.json",
             json.dumps({k: [v[0], v[1].decode("utf-8", "replace")] for k, v in container_matrix.items()},
                        ensure_ascii=False, indent=2))
        check("F7 容器内端点矩阵与修复前一致（正常请求 + 既有 5 条错误路径未回退）",
              container_matrix == prefix_matrix,
              {"差异": [name for name in set(container_matrix) | set(prefix_matrix)
                       if container_matrix.get(name) != prefix_matrix.get(name)]})
        code, text = docker(["stop", C_FIXED])
        save(outdir, "F1-stop-fixed.txt", text)
        check("F8 修复后容器可正常停止", code == 0, text.strip()[:80])
        docker(["rm", "-f", C_FIXED])

        # --- F2：修复前镜像（复现 QA 的 PID 1 观测）
        # 用**修复前那份** Dockerfile（CMD = deploy.server、不含可观测入口的 COPY）：
        # 既避开"当前 Dockerfile 的 COPY 在修复前树里不存在"，也避开"当前 observable_server.py 依赖修复后 server.py"的坏组合。
        code, text = docker(["build", "-t", IMG_PREFIX, "-f", str(tree / "deploy" / "Dockerfile"), str(tree)])
        save(outdir, "F2-build-prefix.txt", text)
        prefix_df = (tree / "deploy" / "Dockerfile").read_text(encoding="utf-8", errors="replace")
        save(outdir, "F2-prefix-dockerfile-sha256.txt",
             hashlib.sha256((tree / "deploy" / "Dockerfile").read_bytes()).hexdigest()
             + "  deploy/Dockerfile（修复前字节副本）\n"
             + "CMD 行：" + next((ln for ln in prefix_df.splitlines() if ln.startswith("CMD")), "（无）") + "\n")
        check("F9 修复前镜像构建成功（上下文与 Dockerfile 都用修复前字节副本）", code == 0,
              {"exit": code, "末行": text.strip().splitlines()[-1][:100] if text.strip() else ""})
        check("F9b 修复前对照 Dockerfile 的 CMD 是 deploy.server（不是可观测入口）",
              next((ln for ln in prefix_df.splitlines() if ln.startswith("CMD")), "").strip()
              == 'CMD ["python", "-m", "deploy.server"]',
              {"CMD": next((ln for ln in prefix_df.splitlines() if ln.startswith("CMD")), "（无）")})
        docker(["rm", "-f", C_PREFIX])
        code, text = docker(["run", "-d", "--name", C_PREFIX, "-p", f"127.0.0.1:{P_PREFIX}:8000", IMG_PREFIX])
        save(outdir, "F2-run-prefix.txt", text)
        prefix_id = text.strip().splitlines()[-1] if text.strip() else ""
        check("F10 修复前容器已启动", code == 0 and len(prefix_id) == 64,
              {"exit": code, "id 长度": len(prefix_id)})
        ready, ready_detail = wait_http(P_PREFIX)
        check("F11 修复前容器 /healthz 200（健康检查在缺陷存在时也照常通过）", ready, ready_detail)
        before = threads_container(C_PREFIX)
        holder, threads = parallel_raw(P_PREFIX, 9, HALF_HEAD, HALF_BODY, PREFIX_WINDOW)
        time.sleep(2.0)
        during = threads_container(C_PREFIX)
        health_during = http(P_PREFIX, "GET", "/healthz")[0]
        time.sleep(max(0.0, PREFIX_WINDOW - 4.0))   # 客户端仍持有连接
        late = threads_container(C_PREFIX)
        for thread in threads:
            thread.join(timeout=PREFIX_WINDOW + 10)
        time.sleep(1.0)
        after = threads_container(C_PREFIX)
        save(outdir, "F2-threads.txt",
             f"修复前容器 {C_PREFIX}\nThreads 前={before}\nThreads 中(连接后 2s，仍持有)={during}\n"
             f"Threads 后(连接后 12s，仍持有)={late}\n"
             f"Threads 客户端关闭后={after}\n")
        outcomes = [item for item in holder["results"] if item]
        check(f"F12 缺陷复现（容器）：{PREFIX_WINDOW:.0f}s 内 9 条零响应且连接未关闭",
              all(item["data"] == b"" and not item["closed"] for item in outcomes) and len(outcomes) == 9,
              {"零响应条数": sum(1 for item in outcomes if item["data"] == b""),
               "仍打开条数": sum(1 for item in outcomes if not item["closed"])})
        check("F13 缺陷复现（容器 PID 1）：Threads +9 且 12s 内不回收；同时 /healthz 仍 200（被掩盖）",
              before is not None and during is not None and late is not None
              and during >= before + 5 and late >= before + 5 and health_during == 200,
              {"前": before, "中 2s": during, "中 12s": late, "客户端关闭后": after, "/healthz": health_during})
        code, text = docker(["stop", "-t", "5", C_PREFIX])
        save(outdir, "F2-stop-prefix.txt", text)
        docker(["rm", "-f", C_PREFIX])

        code, text = docker(["images", "giftwise-validator", "--format", "{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}"])
        save(outdir, "F3-images.txt", text)

    passed = sum(1 for item in results if item["ok"])
    (outdir / "console.txt").write_text("\n".join(console) + "\n", encoding="utf-8")
    payload = {
        "stamp": stamp,
        "checks_passed": passed,
        "checks_total": len(results),
        "checks": results,
        "default_timeout_seconds": DEFAULT_TIMEOUT,
        "short_timeout_seconds": SHORT_TIMEOUT,
        "prefix_window_seconds": PREFIX_WINDOW,
        "files": sorted(path.name for path in outdir.iterdir() if path.is_file()),
    }
    (outdir / "slowbody-check.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                                encoding="utf-8")
    (RAW / "slowbody-latest.txt").write_text(str(outdir) + "\n", encoding="utf-8")
    log()
    log(f"===== I-2 断言 {passed}/{len(results)} 通过 =====")
    for item in results:
        if not item["ok"]:
            log(f"  FAIL: {item['name']} :: {item['detail']}")
    log(f"原始输出：{outdir}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
