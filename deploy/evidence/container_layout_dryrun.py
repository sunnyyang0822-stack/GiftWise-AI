"""容器布局等价演练（CLOUD-001 任务 4 的替代证据，非容器运行）。

本机没有 Docker/podman/WSL，无法构建镜像。本脚本改为在本机文件系统上精确复现
`deploy/Dockerfile` 的 COPY 结果与 CMD/HEALTHCHECK，验证"镜像里那份文件树能否跑起来"。

严格边界（必须如实说明）：
- 已验证：COPY 后的目录布局可导入、`python -m deploy.server` 可启动、
  `/healthz` 与 `POST /validate` 在该布局下行为与仓库内一致、HEALTHCHECK 命令可成功。
- 未验证：镜像构建本身、基础镜像 `python:3.12-slim`、非 root 用户 `giftwise`、
  容器网络/端口映射、镜像层与缓存、任何云环境。

运行：在仓库根目录执行 `python deploy/evidence/container_layout_dryrun.py`
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "deploy" / "evidence" / "raw"
CN = timezone(timedelta(hours=8))

PY = sys.executable

# 布局 1：与 Dockerfile 的 COPY 指令逐条对应（构建上下文=整个仓库）
COPY_PLAN = [("validator", "validator", True), ("deploy/server.py", "deploy/server.py", False)]

# 布局 2：与 deploy/publish-to-uhost.ps1 实际上传的文件完全一致
# （只上传 validator/rules.py 与 deploy/server.py，两者都没有 __init__.py）
UPLOAD_PLAN = [("validator/rules.py", "validator/rules.py", False), ("deploy/server.py", "deploy/server.py", False)]

HEALTHCHECK_CMD = (
    "import urllib.request; "
    "urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"
)


def build_tree(root: Path, plan: list[tuple[str, str, bool]]) -> list[str]:
    created: list[str] = []
    for src_rel, dst_rel, is_dir in plan:
        src, dst = REPO / src_rel, root / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if is_dir:
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            shutil.copy2(src, dst)
        created.append(dst_rel)
    return created


def wait_port(port: int, timeout: float = 20.0) -> float:
    start = time.perf_counter()
    while time.perf_counter() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), 0.5):
                return round((time.perf_counter() - start) * 1000, 1)
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("dry-run 服务未在超时内监听")


def run_layout(name: str, plan: list[tuple[str, str, bool]], port: int, stamp: str) -> dict:
    """在临时目录复刻一份 /app 等价文件树，用同一条 CMD 启动并请求。"""
    workdir = Path(tempfile.mkdtemp(prefix=f"giftwise-dryrun-{name}-"))
    app = workdir / "app"
    app.mkdir()
    log_path = RAW / f"container-layout-dryrun-{name}-{stamp}.log"
    result: dict = {
        "layout": name,
        "plan": [p[0] for p in plan],
        "disclaimer": "非容器运行；只验证 Dockerfile COPY（或发布脚本上传）后的文件树能否用同一条 CMD 启动",
        "copied": build_tree(app, plan),
        "app_tree": sorted(
            str(p.relative_to(app)).replace("\\", "/") for p in app.rglob("*") if p.is_file()
        ),
        "has_deploy_init": (app / "deploy" / "__init__.py").exists(),
        "has_validator_init": (app / "validator" / "__init__.py").exists(),
    }

    env = dict(os.environ)
    env.update({"GIFTWISE_BIND": "127.0.0.1", "GIFTWISE_PORT": str(port), "PYTHONUNBUFFERED": "1",
                "PYTHONDONTWRITEBYTECODE": "1"})
    env.pop("PYTHONPATH", None)  # 容器内没有仓库级 PYTHONPATH

    with open(log_path, "w", encoding="utf-8", errors="replace") as fh:
        proc = subprocess.Popen([PY, "-m", "deploy.server"], cwd=app, env=env,
                                stdout=fh, stderr=subprocess.STDOUT)
    try:
        result["ms_to_accept"] = wait_port(port)

        import http.client

        def call(method: str, path: str, body: bytes | None = None) -> dict:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            try:
                conn.request(method, path, body=body, headers={"Content-Type": "application/json"})
                resp = conn.getresponse()
                return {"status": resp.status, "body": resp.read().decode("utf-8", "replace")}
            finally:
                conn.close()

        result["healthz"] = call("GET", "/healthz")

        cases = json.loads((REPO / "tests" / "test_cases.json").read_text(encoding="utf-8"))["cases"]
        case = next(c for c in cases if c["id"] == "T01_normal")
        body = json.dumps({
            "request_json": json.dumps(case["request"], ensure_ascii=False),
            "candidates_json": json.dumps(case["candidate_batch"], ensure_ascii=False),
        }, ensure_ascii=False).encode("utf-8")
        validated = call("POST", "/validate", body)
        decoded = json.loads(validated["body"])
        result["validate"] = {
            "http_status": validated["status"],
            "status": decoded.get("status"),
            "all_passed": decoded.get("all_passed"),
        }

        # Dockerfile HEALTHCHECK 固定请求 127.0.0.1:8000；演练端口不同，做等价替换后执行。
        hc_path = RAW / f"container-layout-healthcheck-{name}-{stamp}.txt"
        hc_cmd = HEALTHCHECK_CMD.replace(":8000", f":{port}")
        with open(hc_path, "wb") as hf:
            rc = subprocess.run([PY, "-c", hc_cmd], stdout=hf, stderr=subprocess.STDOUT).returncode
        result["healthcheck_exit_code"] = rc
        result["healthcheck_output"] = hc_path.read_text(encoding="utf-8", errors="replace").strip()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    result["server_log"] = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    shutil.rmtree(workdir, ignore_errors=True)
    return result


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    RAW.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    report = {
        "generated_at": datetime.now(CN).isoformat(timespec="seconds"),
        "healthcheck_cmd_template": HEALTHCHECK_CMD,
        "note": "两种布局都用同一条 CMD：python -m deploy.server",
        "layouts": [],
    }
    for name, plan, port in (("repo_copy", COPY_PLAN, 8123), ("upload_minimal", UPLOAD_PLAN, 8124)):
        report["layouts"].append(run_layout(name, plan, port, stamp))

    (RAW / "container-layout-dryrun-latest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    for layout in report["layouts"]:
        print(f"\n=== 布局 {layout['layout']} ===")
        for p in layout["app_tree"]:
            print("   ", p)
        print(f"  deploy/__init__.py 存在 = {layout['has_deploy_init']}, "
              f"validator/__init__.py 存在 = {layout['has_validator_init']}")
        print(f"  启动到可接受连接 = {layout['ms_to_accept']} ms")
        print(f"  GET /healthz -> {layout['healthz']['status']}")
        print(f"  POST /validate -> HTTP {layout['validate']['http_status']}, "
              f"status={layout['validate']['status']}, all_passed={layout['validate']['all_passed']}")
        print(f"  HEALTHCHECK 等价命令 exit = {layout['healthcheck_exit_code']}")
    print("\n原始 JSON -> deploy/evidence/raw/container-layout-dryrun-latest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
