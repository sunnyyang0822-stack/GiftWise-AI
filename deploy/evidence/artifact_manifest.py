"""生成部署交付物的版本快照清单（CLOUD-001）。

用途：把本次证据对应的确切代码版本（git HEAD + 关键文件 sha256）固定下来，
满足"现场若使用不同版本需主动说明"的要求。

运行：在仓库根目录执行 `python deploy/evidence/artifact_manifest.py`
输出：deploy/evidence/raw/artifact-manifest.json
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "deploy" / "evidence" / "raw"
CN = timezone(timedelta(hours=8))

TRACKED = [
    "deploy/server.py",
    "deploy/Dockerfile",
    "deploy/.dockerignore",
    "deploy/publish-to-uhost.ps1",
    "deploy/evidence/local_check.py",
    "deploy/evidence/container_layout_dryrun.py",
    "deploy/evidence/container_probe.py",
    # 阶段 14（2026-10-30 晚）新增：可观测性实现与验证脚本
    "deploy/observability.py",
    "deploy/observable_server.py",
    "deploy/evidence/observability_check.py",
    "deploy/evidence/observability_container_check.py",
    "deploy/evidence/ps1_static_check.py",
    # 缺陷 I-2（= 安全自查 S-5，2026-10-30 晚第三轮）新增：半开正文修复前对照 + 修复后回归
    "deploy/evidence/slow_body_check.py",
    "deploy/evidence/raw/slowbody-prefix/server.py.before",
    # 交付镜像重建与口径更正（2026-10-31 凌晨）：镜像×源码一致性核验 + 审计报告 + 候选 Dockerfile
    "deploy/evidence/image_source_parity_check.py",
    "deploy/evidence/image_container_matrix_check.py",
    "deploy/evidence/image-audit-2026-10-31.md",
    "deploy/evidence/candidate-Dockerfile-observable",
    # PM 夜间指令四修（2026-10-31 01:13:59）：N-1 入口进镜像 / N-4 日志粘连 + 改前 Dockerfile 字节副本
    "deploy/evidence/log_interleave_check.py",
    "deploy/evidence/image-rebuild-n1n4-2026-10-31.md",
    "deploy/evidence/raw/slowbody-prefix/Dockerfile.before",
    "validator/rules.py",
    "validator/__init__.py",
    "workflow/examples/intake.json",
    "workflow/examples/candidates.json",
    "tests/test_cases.json",
]


def shell(cmd: str, out: Path) -> str:
    with open(out, "w", encoding="utf-8", errors="replace") as fh:
        subprocess.run(cmd, shell=True, cwd=REPO, stdout=fh, stderr=subprocess.STDOUT)
    return out.read_text(encoding="utf-8", errors="replace").strip()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_at": datetime.now(CN).isoformat(timespec="seconds"),
        "git_head": shell("git rev-parse HEAD", RAW / "_manifest_head.txt"),
        "git_head_short": shell("git rev-parse --short HEAD", RAW / "_manifest_head_short.txt"),
        "git_branch": shell("git rev-parse --abbrev-ref HEAD", RAW / "_manifest_branch.txt"),
        "git_status_porcelain": shell("git status --porcelain", RAW / "_manifest_status.txt").splitlines(),
        "python_version": sys.version.split()[0],
        "files": {},
    }
    for rel in TRACKED:
        path = REPO / rel
        manifest["files"][rel] = {
            "exists": path.exists(),
            "bytes": path.stat().st_size if path.exists() else None,
            "sha256": sha256(path) if path.exists() else None,
        }
    (RAW / "artifact-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"git HEAD = {manifest['git_head']}")
    print(f"工作区未提交改动 {len(manifest['git_status_porcelain'])} 条")
    for rel, info in manifest["files"].items():
        print(f"  {info['sha256'][:16] if info['sha256'] else '<missing>':<18} {info['bytes']:>8} B  {rel}")
    print("-> deploy/evidence/raw/artifact-manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
