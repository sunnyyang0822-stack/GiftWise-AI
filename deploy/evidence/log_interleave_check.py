"""缺陷 N-4（日志粘连）核验：并发打请求后，容器 stdout 是否出现"两行粘成一行"。

**缺陷**（PM 夜间指令 N-4，可复现）：并发 60 请求后 `docker logs` 51 行里有 9 行粘连，例如
`… "POST /validate HTTP/1.1" 400 -172.17.0.1 - "GET /nope-3 …" 404 -`。
根因：`deploy/server.py` 的 `log_message` 用裸 `print()`——它先写正文再写 `"\n"`，两次写之间会被别的线程插入。

**修法**：所有日志走同一把锁 + 一次 `write()` 写完**整行（含换行）** + 立即 flush（`_log_line()`）。

**用法**

```bash
python deploy/evidence/log_interleave_check.py                      # 只测当前交付镜像（tag 可给多个）
python deploy/evidence/log_interleave_check.py --with-prefix        # 额外用修复前源码树构建对照镜像，复现粘连
```

判定：一行"正常"= 恰好一条 `地址 - "请求行" 状态码 长度`（`log_message` 的格式）。
粘连行 = 同一行里出现多于一个 `HTTP/1.1`，或行尾不是 `- 数字`。只做本机操作。
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import slow_body_check as sbc  # noqa: E402  （复用 docker()/wait_http()/http()/raw_request()）

CN = timezone(timedelta(hours=8))
PORT = 8808
REQUESTS = 60          # 与 PM 的复现口径一致
STARTUP_LINE = "giftwise-validator listening on"
LINE_OK = re.compile(r'^\S+ - "(?:GET|POST|PUT|HEAD|DELETE) \S+ HTTP/1\.1" \d{3} -$')

VALID_BODY = sbc.VALID_BODY


def fire(port: int) -> None:
    """60 个并发请求：/healthz、/validate（正常与错误）、若干个 /nope-N 路径。"""
    def one(index: int) -> None:
        if index % 3 == 0:
            sbc.http(port, "GET", "/healthz")
        elif index % 3 == 1:
            sbc.http(port, "POST", "/validate", VALID_BODY, {"Content-Type": "application/json"})
        else:
            sbc.http(port, "GET", f"/nope-{index}")
    threads = [threading.Thread(target=one, args=(i,), daemon=True) for i in range(REQUESTS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)


def classify(lines: list[str]) -> tuple[list[str], list[str]]:
    glued, other = [], []
    for line in lines:
        if not line.strip():
            continue
        if line.count("HTTP/1.1") > 1:
            glued.append(line)
        elif LINE_OK.match(line) or STARTUP_LINE in line:
            other.append(line)
        else:
            glued.append(line)
    return glued, other


def run_phase(tag: str, outdir: Path, label: str, results: list[dict], console: list[str],
              expect_glued: bool) -> None:
    def log(line: str = "") -> None:
        console.append(line)
        print(line, flush=True)

    name = f"gw-log-{uuid.uuid4().hex[:6]}"
    sbc.docker(["rm", "-f", name])
    code, text = sbc.docker(["run", "-d", "--name", name, "-p", f"127.0.0.1:{PORT}:8000", tag])
    log(f"\n===== {label}：{tag} =====")
    if code != 0:
        log(f"容器启动失败：{text.strip()[:200]}")
        results.append({"phase": label, "tag": tag, "ok": False, "detail": "容器启动失败"})
        return
    try:
        ready, detail = sbc.wait_http(PORT)
        log(f"/healthz 200：{ready}")
        if not ready:
            results.append({"phase": label, "tag": tag, "ok": False, "detail": detail})
            return
        time.sleep(0.5)
        fire(PORT)
        time.sleep(1.0)
        code, logs = sbc.docker(["logs", name])
        lines = [line for line in logs.splitlines() if line.strip()]
        glued, normal = classify(lines)
    finally:
        sbc.docker(["stop", "-t", "5", name])
        sbc.docker(["rm", "-f", name])

    (outdir / f"{label}-docker-logs.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (outdir / f"{label}-glued-lines.txt").write_text("\n".join(glued) + "\n", encoding="utf-8")
    startup = [line for line in normal if STARTUP_LINE in line]
    request_lines = [line for line in normal if STARTUP_LINE not in line]
    log(f"并发 {REQUESTS} 请求后：docker logs 共 {len(lines)} 行 = 正常请求日志 {len(request_lines)} 行 "
        f"+ 启动行 {len(startup)} 行 + **粘连行 {len(glued)} 行**")
    if glued:
        log("粘连样例（最多 3 条）：")
        for line in glued[:3]:
            log("   " + line[:160])
    ok = (len(glued) > 0) if expect_glued else (len(glued) == 0)
    detail_out = {"总行数": len(lines), "正常请求日志行": len(request_lines), "启动行": len(startup),
                  "粘连行数": len(glued), "样例": glued[:3],
                  "期望": "粘连 > 0（复现缺陷）" if expect_glued else "粘连 == 0（已修复）"}
    results.append({"phase": label, "tag": tag, "ok": ok, "detail": detail_out})
    log(f"→ {'如预期' if ok else '**不符预期**'}：{detail_out['期望']}")


def make_prefix_tree() -> Path:
    """修复前源码树（server.py + Dockerfile 的字节副本 + validator），用于复现 N-4。"""
    tree = Path(sbc.TMP) / "log-prefix-tree"
    (tree / "deploy").mkdir(parents=True, exist_ok=True)
    (tree / "validator").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(sbc.PRE_FIX_SERVER, tree / "deploy" / "server.py")
    shutil.copyfile(sbc.PRE_FIX_DOCKERFILE, tree / "deploy" / "Dockerfile")
    for name in ("rules.py", "__init__.py"):
        src = sbc.REPO / "validator" / name
        if src.exists():
            shutil.copyfile(src, tree / "validator" / name)
    return tree


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    with_prefix = "--with-prefix" in sys.argv
    tags = args or ["giftwise-validator:latest"]
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    outdir = sbc.RAW / f"log-interleave-{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    console: list[str] = []
    print(f"输出目录：{outdir}")

    if with_prefix:
        tree = make_prefix_tree()
        code, text = sbc.docker(["build", "-t", "giftwise-validator:log-prefix",
                                 "-f", str(tree / "deploy" / "Dockerfile"), str(tree)])
        (outdir / "prefix-build.txt").write_text(text, encoding="utf-8")
        console.append(f"修复前对照镜像构建 exit={code}")
        print(f"修复前对照镜像构建 exit={code}")
        if code == 0:
            run_phase("giftwise-validator:log-prefix", outdir, "修复前（裸 print）", results, console,
                      expect_glued=True)
        else:
            results.append({"phase": "修复前", "tag": "log-prefix", "ok": False,
                            "detail": text.strip().splitlines()[-1][:160]})

    for index, tag in enumerate(tags, start=1):
        run_phase(tag, outdir, f"修复后{index}", results, console, expect_glued=False)

    (outdir / "console.txt").write_text("\n".join(console) + "\n", encoding="utf-8")
    (outdir / "log-interleave-check.json").write_text(
        json.dumps({"stamp": stamp, "requests": REQUESTS, "phases": results,
                    "checks_passed": sum(1 for r in results if r["ok"]), "checks_total": len(results)},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    (sbc.RAW / "log-interleave-latest.txt").write_text(str(outdir) + "\n", encoding="utf-8")
    print(f"\n===== 日志粘连核验：{sum(1 for r in results if r['ok'])}/{len(results)} 阶段通过 =====")
    for item in results:
        print(f"  [{'PASS' if item['ok'] else 'FAIL'}] {item['phase']} :: {item['detail']}")
    print(f"原始输出：{outdir}")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
