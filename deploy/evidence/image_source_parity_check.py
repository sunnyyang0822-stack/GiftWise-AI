"""交付镜像 × 源码一致性核验（重建前/重建后跑同一个脚本，逐条给原始输出）。

**为什么要这个脚本（PM 更正 + 独立审计）**

1. 口径更正：镜像**从未推送任何仓库**，因此 `docker inspect` 的 `RepoDigests` 只是**本地 config digest**
   （与镜像 ID 同值），"重建后的 manifest digest"**当前不存在**。
   稳定标识改用 **`tag` + 构建日期 + `/healthz` 的 `rules_source_sha256`**；镜像 ID 只作辅助，且**会漂移**。
2. 独立审计实测交付镜像 `latest` **三处过时**：
   ① 容器内 `/app/validator/rules.py` 的 sha256 ≠ 本机源码；
   ② 半开正文探测 **>25 s 无响应**（不含 I-2 修复）；
   ③ `/app` 只有 3 个文件（不含 `deploy/observable_server.py` / `deploy/observability.py`）。

**用法**

```bash
python deploy/evidence/image_source_parity_check.py                      # 默认核 giftwise-validator:latest
python deploy/evidence/image_source_parity_check.py <tag> [<tag> ...]    # 一次核多个 tag
```

只做本机操作：`docker build`/`run`/`exec`/`inspect` 与回环 socket；不上传、不推送、不产生费用。
子进程输出一律重定向到文件后读回（不用管道）。
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
PROBE_PORT = 8796
PROBE_WINDOW = 26.0          # 与独立审计一致：观察 >25 秒
DEFAULT_TIMEOUT = 10.0

DOCKER_DIRS = [
    r"C:\Program Files\Docker\Docker\resources\bin",
    r"C:\ProgramData\DockerDesktop\version-bin",
]

#: 容器内路径 → 本机源码路径（缺失即视为"镜像里没有这个文件"）
PARITY_FILES = {
    "deploy/server.py": "deploy/server.py",
    "validator/rules.py": "validator/rules.py",
    "validator/__init__.py": "validator/__init__.py",
    "deploy/observable_server.py": "deploy/observable_server.py",
    "deploy/observability.py": "deploy/observability.py",
}

HALF_HEAD = (b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n"
             b"Content-Length: 100\r\n\r\n")
HALF_BODY = b'{"a"'          # 声明 100，只发 5 字节

TMP = Path(os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp"))) / f"dsh-imgparity-{uuid.uuid4().hex[:8]}"
TMP.mkdir(parents=True, exist_ok=True)
results: list[dict] = []
console: list[str] = []


def log(line: str = "") -> None:
    console.append(line)
    print(line, flush=True)


def check(name: str, ok: bool, detail: object) -> None:
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    log(f"[{'PASS' if ok else 'FAIL'}] {name} :: {detail}")


def save(outdir: Path, name: str, text: str) -> None:
    (outdir / name).write_text(text, encoding="utf-8", errors="replace")


# ------------------------------------------------------------------ 子进程

def capture(args: list[str], timeout: float = 600.0) -> tuple[int, str]:
    out_file = TMP / f"cmd-{uuid.uuid4().hex[:8]}.txt"
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join(DOCKER_DIRS + [env.get("PATH", "")])
    env["MSYS_NO_PATHCONV"] = "1"
    with out_file.open("wb") as handle:
        try:
            code = subprocess.run(args, cwd=str(REPO), env=env, stdout=handle,
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
    return capture([docker_bin() or "docker"] + args, timeout=timeout)


def host_sha256(rel: str) -> str | None:
    path = REPO / rel
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


# ------------------------------------------------------------------ HTTP / 裸 socket

def http(port: int, path: str = "/healthz", timeout: float = 4.0):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)
    except Exception as exc:  # noqa: BLE001
        return None, repr(exc).encode(), {}


def wait_http(port: int, timeout: float = 60.0) -> tuple[bool, object]:
    deadline = time.time() + timeout
    last: object = "no attempt"
    while time.time() < deadline:
        status, body, _ = http(port)
        last = {"status": status, "body": body[:80].decode("utf-8", "replace")} if status else body
        if status == 200:
            return True, last
        time.sleep(0.4)
    return False, last


def half_open_probe(port: int, window: float) -> dict:
    """声明 Content-Length: 100 只发 5 字节；观察 window 秒内是否有响应、连接是否被关闭。"""
    out: dict = {"data": b"", "code": None, "closed": False, "elapsed": None, "err": None}
    try:
        sock = socket.create_connection(("127.0.0.1", port), timeout=window + 6)
    except OSError as exc:
        out["err"] = f"connect: {exc}"
        return out
    try:
        sock.sendall(HALF_HEAD + HALF_BODY)
        sock.settimeout(window)
        t0 = time.monotonic()
        try:
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    out["closed"] = True
                    break
                out["data"] += chunk
        except socket.timeout:
            pass
        except ConnectionResetError:
            out["closed"] = True
        out["elapsed"] = time.monotonic() - t0
    except OSError as exc:
        out["err"] = f"io: {exc}"
    finally:
        try:
            sock.close()
        except OSError:
            pass
    if out["data"]:
        line = out["data"].split(b"\r\n", 1)[0].decode("latin1")
        parts = line.split()
        out["status_line"] = line
        out["code"] = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
    return out


def container_threads(container: str) -> int | None:
    code, text = docker(["exec", container, "sh", "-c", "grep -i '^Threads' /proc/1/status"])
    for line in text.splitlines():
        if line.lower().startswith("threads:"):
            return int(line.split()[1])
    return None


# ------------------------------------------------------------------ 核验一个 tag

def verify_image(tag: str, outdir: Path, index: int) -> dict:
    prefix = f"{index:02d}-{tag.replace(':', '_').replace('/', '_')}"
    log(f"\n===== 核验镜像 {tag} =====")
    report: dict = {"tag": tag}

    code, text = docker(["image", "inspect", tag, "--format",
                         "Id={{.Id}}\nCreated={{.Created}}\nSize={{.Size}}\nRepoDigests={{json .RepoDigests}}"])
    save(outdir, f"{prefix}-inspect.txt", text)
    if code != 0:
        check(f"{tag}：镜像存在", False, text.strip()[:120])
        return report
    fields = {}
    for line in text.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            fields[key] = value
    image_id = fields.get("Id", "")
    digests = json.loads(fields.get("RepoDigests", "[]") or "[]")
    config_digest = image_id.replace("sha256:", "")
    digest_is_local = bool(digests) and all(d.endswith(config_digest) for d in digests)
    report.update({"image_id": image_id, "created": fields.get("Created"), "size": fields.get("Size"),
                   "repo_digests": digests, "repo_digests_are_local_config": digest_is_local})
    check(f"{tag}：镜像存在且能读到元数据", bool(image_id), {"Id": image_id[:19], "Created": fields.get("Created")})
    log(f"  RepoDigests={digests}")
    log(f"  → 这些 digest 与镜像 ID 同值（本地 config digest），**不是 manifest digest**（镜像从未推送）："
        f"{digest_is_local}")

    # ① /app 文件树 + 逐文件哈希
    code, text = docker(["run", "--rm", "--entrypoint", "sh", tag, "-c", "find /app -type f | sort"])
    tree = [line.strip() for line in text.splitlines() if line.strip().startswith("/app/")]
    save(outdir, f"{prefix}-app-tree.txt", "\n".join(tree) + f"\n--- 文件数 {len(tree)} ---\n")
    log(f"  /app 文件数={len(tree)}：{tree}")
    report["app_files"] = tree

    file_hashes: dict = {}
    for container_path, host_path in PARITY_FILES.items():
        expected = host_sha256(host_path)
        cpath = f"/app/{container_path}"
        if cpath not in tree:
            file_hashes[container_path] = {"container": None, "host": expected, "match": False,
                                           "note": "镜像内不存在"}
            continue
        code, text = docker(["run", "--rm", "--entrypoint", "sh", tag, "-c", f"sha256sum {cpath}"])
        got = text.split()[0] if text.split() else None
        file_hashes[container_path] = {"container": got, "host": expected,
                                       "match": got == expected, "note": ""}
    report["file_hashes"] = file_hashes
    save(outdir, f"{prefix}-file-hashes.json", json.dumps(file_hashes, ensure_ascii=False, indent=2))
    for path, item in file_hashes.items():
        log(f"    {path}: 容器={ (item['container'] or '（不存在）')[:16] }  本机={ (item['host'] or '（无）')[:16] }"
            f"  {'一致' if item['match'] else '**不一致/缺失**'}")
    rules = file_hashes["validator/rules.py"]
    check(f"{tag}①容器内 validator/rules.py 与本机源码一致", rules["match"],
          {"容器": (rules["container"] or "缺失")[:16], "本机": (rules["host"] or "无")[:16]})
    server = file_hashes["deploy/server.py"]
    check(f"{tag}①容器内 deploy/server.py 与本机源码一致（I-2 修复是否进镜像）", server["match"],
          {"容器": (server["container"] or "缺失")[:16], "本机": (server["host"] or "无")[:16]})
    has_observability = all(file_hashes[name]["container"] for name in
                            ("deploy/observable_server.py", "deploy/observability.py"))
    report["has_observability_entrypoint"] = has_observability
    check(f"{tag}③镜像内含可观测入口（observable_server.py + observability.py）", has_observability,
          {"/app 文件数": len(tree),
           "缺": [n for n in ("deploy/observable_server.py", "deploy/observability.py")
                 if not file_hashes[n]["container"]]})

    # ② 半开正文探测（默认 CMD 起容器）
    name = f"gw-parity-{uuid.uuid4().hex[:6]}"
    docker(["rm", "-f", name])
    code, text = docker(["run", "-d", "--name", name, "-p", f"127.0.0.1:{PROBE_PORT}:8000", tag])
    save(outdir, f"{prefix}-run.txt", text)
    if code != 0:
        check(f"{tag}②默认 CMD 能启动容器", False, text.strip()[:160])
        docker(["rm", "-f", name])
        return report
    ready, ready_detail = wait_http(PROBE_PORT)
    health_status, health_body, _ = http(PROBE_PORT)
    try:
        health = json.loads(health_body)
    except Exception:  # noqa: BLE001
        health = {}
    report["health_rules_sha256"] = health.get("rules_source_sha256")
    check(f"{tag}②默认 CMD 启动后 /healthz 200", ready, ready_detail)
    log(f"  /healthz rules_source_sha256 = {report['health_rules_sha256']}")
    check(f"{tag}①/healthz 的 rules_source_sha256 == 本机 validator/rules.py 的 sha256",
          report["health_rules_sha256"] == rules["host"],
          {"镜像": (report["health_rules_sha256"] or "无")[:16], "本机": (rules["host"] or "无")[:16]})

    threads_before = container_threads(name)
    holder: dict = {}
    thread = threading.Thread(target=lambda: holder.update(half_open_probe(PROBE_PORT, PROBE_WINDOW)),
                              daemon=True)
    thread.start()
    time.sleep(2.0)
    threads_during = container_threads(name)
    during_health = http(PROBE_PORT)[0]
    thread.join(timeout=PROBE_WINDOW + 10)
    conn_closed_client_side = True
    time.sleep(1.0)
    threads_after = container_threads(name)
    outcome = holder or {}
    report["half_open"] = {k: (v if k != "data" else v[:120].decode("latin1", "replace"))
                           for k, v in outcome.items()}
    save(outdir, f"{prefix}-half-open.json", json.dumps(report["half_open"], ensure_ascii=False, indent=2))
    log(f"  半开正文探测（观察窗口 {PROBE_WINDOW:.0f}s）：状态行={outcome.get('status_line') or '（无响应）'} "
        f"耗时={ (outcome.get('elapsed') or 0):.2f}s 服务端关闭={outcome.get('closed')} "
        f"Threads 前/中/后={threads_before}/{threads_during}/{threads_after}")
    answered = outcome.get("code") == 408
    check(f"{tag}②半开正文探测在 {PROBE_WINDOW:.0f}s 内返回 408（含 I-2 修复）", answered,
          {"状态行": outcome.get("status_line"), "耗时": round(outcome.get("elapsed") or 0, 2),
           "窗口": PROBE_WINDOW})
    check(f"{tag}②探测期间 /healthz 仍 200（与修复与否无关，证明健康检查会掩盖）", during_health == 200,
          {"状态": during_health})
    report["threads"] = {"before": threads_before, "during": threads_during, "after_client_close": threads_after}
    if answered:
        check(f"{tag}②连接被服务端关闭且线程回落",
              outcome.get("closed") is True and threads_after is not None
              and threads_before is not None and threads_after <= threads_before + 1,
              {"服务端关闭": outcome.get("closed"), "Threads 前": threads_before, "Threads 后": threads_after})
    else:
        check(f"{tag}②半开连接占住一个线程（缺陷：客户端不关就不释放）",
              threads_during is not None and threads_before is not None
              and threads_during >= threads_before + 1,
              {"Threads 前": threads_before, "Threads 中": threads_during,
               "客户端关闭后": threads_after, "服务端关闭": outcome.get("closed")})
    docker(["stop", "-t", "5", name])
    docker(["rm", "-f", name])
    return report


def main() -> int:
    tags = sys.argv[1:] or ["giftwise-validator:latest"]
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    outdir = RAW / f"image-parity-{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    log(f"输出目录：{outdir}")
    log(f"本机源码哈希：")
    for container_path, host_path in PARITY_FILES.items():
        value = host_sha256(host_path)
        log(f"  {host_path}: {(value or '（不存在）')[:16] if value else '（不存在）'}")

    code, text = docker(["version", "--format", "client={{.Client.Version}} server={{.Server.Version}}"])
    save(outdir, "docker-version.txt", text)
    code, text = docker(["images", "giftwise-validator", "--format",
                         "{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}"])
    save(outdir, "images.txt", text)
    log("\n本机 giftwise-validator 镜像（注意 ID 会漂移）：\n" + text.strip())

    reports = [verify_image(tag, outdir, index) for index, tag in enumerate(tags, start=1)]
    (outdir / "image-source-parity.json").write_text(
        json.dumps({"stamp": stamp, "checks_passed": sum(1 for item in results if item["ok"]),
                    "checks_total": len(results), "checks": results, "images": reports},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    (outdir / "console.txt").write_text("\n".join(console) + "\n", encoding="utf-8")
    (RAW / "image-parity-latest.txt").write_text(str(outdir) + "\n", encoding="utf-8")
    passed = sum(1 for item in results if item["ok"])
    log(f"\n===== 镜像核验断言 {passed}/{len(results)} 通过 =====")
    for item in results:
        if not item["ok"]:
            log(f"  FAIL: {item['name']} :: {item['detail']}")
    log(f"原始输出：{outdir}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
