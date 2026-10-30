"""CLOUD-001 攻击实验（最关键一条）：两份 .dockerignore 会不会**误排除** COPY 源，
造成"镜像缺文件但服务看起来正常"。

方法要点：**复用真实 `deploy/Dockerfile`**（用 `-f deploy/Dockerfile`，不改它），
但把构建上下文换成我在 `tests/` 下自建的**同构上下文**（含 validator/、deploy/server.py、
以及 docs/tests/workflow/web/.git/__pycache__/*.pyc 等诱饵）。
这样既完全复刻真实构建行为，又能在不改 `deploy/**` 的前提下变异 `.dockerignore`。

三个实验：
  E-A 逐模式敏感性：把 16 个模式各自单独放进 .dockerignore，看是否命中两个 COPY 源。
  E-B 误排除的失效模式：故意排除 `validator/rules.py`（模拟最坏误排除），
      看构建是失败、还是成功了但服务"看起来正常"。
  E-C 两份文件差异：分别用根 .dockerignore 与 deploy/.dockerignore 构建，比较幸存文件集。

用法：
    python tests/acceptance/cloud-001/attack_dockerignore.py <out_json>
"""

import json
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOCKER = "docker"
WORK = ROOT / "tests/acceptance/cloud-001/_ctx"          # 自建同构上下文
DOCKERFILE = "deploy/Dockerfile"                          # 复用真实 Dockerfile，不修改

ROOT_IGNORE = [".env", ".git", ".gitignore", "__pycache__", "*.pyc", "*.pyo", "tests",
               "workflow", "docs", "web", ".tmp", "deploy/evidence", "*.log", "*.msi", "*.exe"]
DEPLOY_IGNORE = [".env", ".git", "__pycache__", "*.pyc", "tests", "workflow", ".dockerignore",
                 "docs", "web", ".tmp", "deploy/evidence", "*.log"]
COPY_SOURCES = ["validator/rules.py", "validator/__init__.py", "deploy/server.py"]


def sh(args, timeout=180, check=False):
    return subprocess.run([DOCKER] + args, capture_output=True, text=True, timeout=timeout, check=check)


def build_mirror_context():
    """在 tests/ 下搭一个与仓库同构的最小上下文（不改仓库任何既有文件）。"""
    if WORK.exists():
        shutil.rmtree(WORK)
    (WORK / "validator" / "__pycache__").mkdir(parents=True)
    (WORK / "deploy" / "evidence").mkdir(parents=True)
    (WORK / "deploy" / "__pycache__").mkdir(parents=True)
    for decoy in ("docs", "tests", "workflow", "web", ".git", ".tmp"):
        (WORK / decoy).mkdir(parents=True, exist_ok=True)
        (WORK / decoy / "decoy.txt").write_text("decoy", encoding="utf-8")

    for rel in COPY_SOURCES:
        src = ROOT / rel
        dst = WORK / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    # 诱饵与真实产物
    for rel in ("validator/__pycache__/__init__.cpython-312.pyc",
                "validator/__pycache__/rules.cpython-312.pyc"):
        src = ROOT / rel
        if src.exists():
            shutil.copy2(src, WORK / rel)
    (WORK / "deploy" / "__pycache__" / "server.cpython-312.pyc").write_bytes(b"stale")
    (WORK / "deploy" / "evidence" / "x.json").write_text("{}", encoding="utf-8")
    for name in (".env", "app.log", "tool.exe", "old.pyo", ".gitignore", "debug.msi"):
        (WORK / name).write_text("decoy", encoding="utf-8")
    (WORK / ".git" / "config").write_text("decoy", encoding="utf-8")
    (WORK / "AGENTS.md").write_text("decoy", encoding="utf-8")
    return WORK


def write_ignore(patterns):
    (WORK / ".dockerignore").write_text("\n".join(patterns) + "\n", encoding="utf-8")


def build_and_list(tag, patterns, progress=False):
    """用真实 deploy/Dockerfile 构建同构上下文，返回 (rc, stderr 尾, 幸存文件列表 或 None)。"""
    write_ignore(patterns)
    args = ["build", "--no-cache", "-t", tag, "-f", str(ROOT / DOCKERFILE), str(WORK)]
    res = sh(args, timeout=300)
    if res.returncode != 0:
        tail = (res.stderr or "").strip().splitlines()
        return res.returncode, " | ".join(tail[-3:]), None
    listing = sh(["run", "--rm", "--entrypoint", "find", tag, "/app", "-type", "f"])
    files = sorted(p.strip() for p in listing.stdout.splitlines() if p.strip())
    return 0, "", files


def service_probe(tag, port):
    """启动镜像，看服务是否真的可用（这一步才是"看起来正常"的判据）。"""
    name = f"gw-attack-{port}"
    sh(["rm", "-f", name])
    run = sh(["run", "-d", "--name", name, "-p", f"127.0.0.1:{port}:8000", tag])
    if run.returncode != 0:
        return {"started": False, "error": run.stderr.strip()[:300]}
    t0 = time.monotonic()
    health, attempts = None, 0
    while time.monotonic() - t0 < 25:
        attempts += 1
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1) as resp:
                if resp.status == 200:
                    health = resp.read().decode()
                    break
        except Exception:
            time.sleep(0.2)
    logs = sh(["logs", name])
    state = sh(["inspect", name, "--format", "{{.State.Status}} exit={{.State.ExitCode}}"])
    sh(["rm", "-f", name])
    return {"started": True, "seconds_to_health": round(time.monotonic() - t0, 3) if health else None,
            "healthz": health, "attempts": attempts,
            "container_state": state.stdout.strip()[:120],
            "logs_tail": " | ".join((logs.stdout + logs.stderr).strip().splitlines()[-4:])[:400]}


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs/test-reports/cloud-001/evidence/dockerignore-attack.json"
    build_mirror_context()
    doc = {"suite": "CLOUD-001 攻击实验：.dockerignore 误排除", "dockerfile": DOCKERFILE,
           "note": "复用真实 deploy/Dockerfile，仅替换构建上下文为我自建的同构目录；未修改 deploy/**。",
           "copy_sources": COPY_SOURCES}

    # ---------------- E-A 逐模式敏感性
    patterns = sorted(set(ROOT_IGNORE + DEPLOY_IGNORE))
    ea = []
    for i, pat in enumerate(patterns):
        rc, err, files = build_and_list(f"gw-pat-{i}", [pat])
        surviving = {s: (f"/app/{s}" in (files or [])) for s in COPY_SOURCES}
        # 诱饵是否被排除，用于确认该模式本身有效
        excluded_any = None
        if files is not None:
            excluded_any = len(files)
        ea.append({"pattern": pat, "build_rc": rc, "build_error": err,
                   "surviving_copy_sources": surviving,
                   "excludes_any_copy_source": not all(surviving.values()),
                   "files_kept": excluded_any,
                   "files": files})
    doc["E-A_per_pattern"] = ea
    doc["E-A_conclusion"] = {
        "patterns_tested": len(patterns),
        "any_pattern_excludes_a_copy_source": sorted(
            {e["pattern"] for e in ea if e["excludes_any_copy_source"]}) or [],
    }

    # ---------------- E-C 两份文件差异
    variants = {"root": ROOT_IGNORE, "deploy": DEPLOY_IGNORE,
                "none": [], "union": patterns}
    ec = {}
    for name, pats in variants.items():
        rc, err, files = build_and_list(f"gw-ignore-{name}", pats)
        ec[name] = {"build_rc": rc, "build_error": err, "files": files,
                    "copy_sources_present": {s: (f"/app/{s}" in (files or [])) for s in COPY_SOURCES}}
    doc["E-C_two_files"] = ec
    doc["E-C_conclusion"] = {
        "root_and_deploy_same_for_copy_sources":
            ec["root"]["copy_sources_present"] == ec["deploy"]["copy_sources_present"],
        "root_files": ec["root"]["files"], "deploy_files": ec["deploy"]["files"],
    }

    # ---------------- E-B 误排除的失效模式
    eb = {}
    scenarios = {
        "B1_exclude_rules_py": ["validator/rules.py"],
        "B2_exclude_whole_validator": ["validator"],
        "B3_exclude_server_py": ["deploy/server.py"],
        "B4_exclude_deploy_dir": ["deploy"],
        "B5_root_rules_ignore_only": ROOT_IGNORE,
    }
    for idx, (name, pats) in enumerate(scenarios.items()):
        rc, err, files = build_and_list(f"gw-fail-{idx}", pats)
        entry = {"patterns": pats, "build_rc": rc, "build_error": err, "image_files": files}
        if rc == 0:
            entry["service"] = service_probe(f"gw-fail-{idx}", 18200 + idx)
        eb[name] = entry
    doc["E-B_failure_mode"] = eb
    doc["E-B_conclusion"] = {
        "exclude_rules_py_build_ok": eb["B1_exclude_rules_py"]["build_rc"] == 0,
        "exclude_rules_py_service_healthy": bool(
            (eb["B1_exclude_rules_py"].get("service") or {}).get("healthz")),
        "exclude_whole_validator_build_rc": eb["B2_exclude_whole_validator"]["build_rc"],
        "exclude_server_py_build_rc": eb["B3_exclude_server_py"]["build_rc"],
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("E-A 命中 COPY 源的模式:", doc["E-A_conclusion"]["any_pattern_excludes_a_copy_source"] or "无")
    print("E-C 根与 deploy 对 COPY 源结果相同:", doc["E-C_conclusion"]["root_and_deploy_same_for_copy_sources"])
    print("E-B 见:", json.dumps(doc["E-B_conclusion"], ensure_ascii=False))
    print("evidence:", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
