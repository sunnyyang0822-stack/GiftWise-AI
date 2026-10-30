"""交付镜像 × 本机源码：**端点矩阵逐字节一致性**核验（针对某个具体 tag）。

`image_source_parity_check.py` 证明的是"容器内文件哈希 == 本机源码"与"半开正文行为"；
本脚本再补一条：**用同一套 10 个用例同时打本机进程与镜像容器，响应逐字节比对**——
覆盖正常 `/validate`、既有 5 条错误路径（含 413 超长正文）与"无 Content-Length"。

用法：

```bash
python deploy/evidence/image_container_matrix_check.py giftwise-validator:submission-20261101
```

复用 `slow_body_check.py` 里的 `start_local` / `endpoint_matrix` / `wait_http` / `docker`
（不重复实现，避免两套口径）。只做本机操作，不上传、不推送。
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import slow_body_check as sbc  # noqa: E402  （复用其工具函数）

CN = timezone(timedelta(hours=8))
HOST_PORT = 8806
CONTAINER_PORT = 8807


def _jsonable(matrix: dict) -> dict:
    """`endpoint_matrix` 的正文是 bytes，落盘前解码（逐字节比对仍在内存里用 bytes 做）。"""
    return {name: [status, body.decode("utf-8", "replace")] for name, (status, body) in matrix.items()}


def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "giftwise-validator:latest"
    stamp = datetime.now(CN).strftime("%Y%m%d-%H%M%S")
    outdir = sbc.RAW / f"image-matrix-{stamp}"
    outdir.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    console: list[str] = []

    def log(line: str = "") -> None:
        console.append(line)
        print(line, flush=True)

    log(f"镜像 tag：{tag}")
    log(f"输出目录：{outdir}")

    # 1) 本机进程
    log("\n--- 本机进程（python -m deploy.server）---")
    host_out = outdir / "host"
    host_out.mkdir(exist_ok=True)
    proc, log_path = sbc.start_local(HOST_PORT, "deploy.server", "host", host_out)
    if proc is None:
        log("本机进程启动失败")
        return 1
    ok, detail = sbc.wait_http(HOST_PORT)
    log(f"本机 /healthz 200：{ok} {detail}")
    host_matrix = sbc.endpoint_matrix(HOST_PORT)
    sbc.stop_local(proc)
    log(f"本机日志：{log_path}")
    (outdir / "host-endpoint-matrix.json").write_text(
        json.dumps(_jsonable(host_matrix), ensure_ascii=False, indent=2), encoding="utf-8")

    # 2) 镜像容器
    name = f"gw-matrix-{uuid.uuid4().hex[:6]}"
    sbc.docker(["rm", "-f", name])
    code, text = sbc.docker(["run", "-d", "--name", name,
                             "-p", f"127.0.0.1:{CONTAINER_PORT}:8000", tag])
    log(f"\n--- 镜像容器 {tag} ---\n{text.strip()[:200]}")
    if code != 0:
        log("容器启动失败")
        return 1
    try:
        ok, detail = sbc.wait_http(CONTAINER_PORT)
        log(f"容器 /healthz 200：{ok} {detail}")
        time.sleep(0.5)
        container_matrix = sbc.endpoint_matrix(CONTAINER_PORT)
    finally:
        sbc.docker(["stop", "-t", "5", name])
        sbc.docker(["rm", "-f", name])

    # 3) 逐字节比对
    diff: dict = {}
    for case in host_matrix:
        host = host_matrix[case]
        cont = container_matrix.get(case)
        if cont is None:
            diff[case] = {"原因": "容器缺少该用例"}
            continue
        same_status = host[0] == cont[0]
        same_body = host[1] == cont[1]
        if not (same_status and same_body):
            diff[case] = {
                "本机状态": host[0], "容器状态": cont[0],
                "本机正文": host[1][:200].decode("utf-8", "replace"),
                "容器正文": cont[1][:200].decode("utf-8", "replace"),
            }
        results.append({"name": f"端点矩阵：{case}", "ok": same_status and same_body,
                        "detail": {"本机": host[0], "容器": cont[0], "字节一致": same_body}})

    (outdir / "container-endpoint-matrix.json").write_text(
        json.dumps(_jsonable(container_matrix), ensure_ascii=False, indent=2), encoding="utf-8")
    (outdir / "parity-diff.json").write_text(json.dumps(diff, ensure_ascii=False, indent=2), encoding="utf-8")
    (outdir / "checks.json").write_text(json.dumps(
        {"tag": tag, "checks_passed": sum(1 for r in results if r["ok"]),
         "checks_total": len(results), "checks": results, "diff": diff},
        ensure_ascii=False, indent=2), encoding="utf-8")

    log(f"\n用例数：{len(results)}；不一致：{len(diff)}")
    for item in results:
        log(f"[{'PASS' if item['ok'] else 'FAIL'}] {item['name']} :: {item['detail']}")
    if diff:
        log("\n差异明细（前 200 字节）：")
        log(json.dumps(diff, ensure_ascii=False, indent=2))

    passed = sum(1 for r in results if r["ok"])
    log(f"\n===== 交付镜像端点矩阵 {passed}/{len(results)} 逐字节一致 =====")
    (outdir / "console.txt").write_text("\n".join(console) + "\n", encoding="utf-8")
    (sbc.RAW / "image-matrix-latest.txt").write_text(str(outdir) + "\n", encoding="utf-8")
    log(f"原始输出：{outdir}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
