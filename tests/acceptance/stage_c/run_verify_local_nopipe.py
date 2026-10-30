"""QA-001 独立复核辅助脚本：在禁止匿名管道（CreatePipe -> WinError 5）的环境中
真实复跑 workflow/verify_local.py 的 46 项探针。

背景：verify_local.py 最后一步用 subprocess.check_output(["git","rev-parse","HEAD"])
写入 results.json。在受限沙箱中该调用因无法创建管道而抛 PermissionError，
导致脚本在全部探针执行完之后崩溃、不打印汇总行、不写 results.json。
本脚本不改动 workflow/verify_local.py（不属于测试 Agent 文件边界），
只在调用前把 subprocess.check_output 替换为"重定向到临时文件"的等价实现，
从而取到与 PM 相同命令相同的探针结论。

用法：
    python tests/acceptance/stage_c/run_verify_local_nopipe.py
"""

import io
import os
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, REPO_ROOT)

_ORIGINAL = subprocess.check_output


def _pipe_free_check_output(cmd, **kwargs):
    """等价于 check_output，但不使用匿名管道（重定向到临时文件）。"""
    text = kwargs.pop("text", False)
    encoding = kwargs.pop("encoding", None)
    errors = kwargs.pop("errors", None)
    kwargs.pop("stdout", None)
    kwargs.pop("stderr", None)
    with tempfile.TemporaryFile() as sink, tempfile.TemporaryFile() as errsink:
        proc = subprocess.run(cmd, stdout=sink, stderr=errsink, **kwargs)
        if proc.returncode != 0:
            errsink.seek(0)
            raise subprocess.CalledProcessError(
                proc.returncode, cmd, output=b"", stderr=errsink.read()
            )
        sink.seek(0)
        raw = sink.read()
    if text or encoding:
        if encoding in (None, "locale"):
            import locale as _locale

            encoding = _locale.getpreferredencoding(False) or "utf-8"
        return raw.decode(encoding, errors or "strict")
    return raw


def main():
    subprocess.check_output = _pipe_free_check_output
    sys.argv = ["verify_local.py"]
    from workflow import verify_local

    verify_local.subprocess.check_output = _pipe_free_check_output
    buf = io.StringIO()
    real_stdout = sys.stdout
    sys.stdout = buf
    try:
        verify_local.run()
    finally:
        sys.stdout = real_stdout
    summary = buf.getvalue()
    print(summary, end="")
    results_path = os.path.join(REPO_ROOT, "workflow", "evidence", "local-2026-10-29", "results.json")
    if os.path.exists(results_path):
        import json

        with open(results_path, encoding="utf-8") as fh:
            data = json.load(fh)
        print("results.json head =", data.get("head"))
        print("results.json passed =", data.get("passed"), "failed =", data.get("failed"))
        print("results.json model_calls =", data.get("model_calls"), "cloud_verified =", data.get("cloud_verified"))
        print("probe names =", len(data.get("results", [])))
    else:
        print("results.json NOT WRITTEN at", results_path)


if __name__ == "__main__":
    main()
