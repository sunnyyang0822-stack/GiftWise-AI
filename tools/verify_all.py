#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""VERIFY-GUIDE-001｜一条命令跑完全部检查，并给出「项目／命令／结果／耗时／原始输出路径」结果表。

设计原则（对应任务书）：
  1. **不许把失败变绿**：每项只按事先写死的判据判定；判据来自对外声明，不来自"这项大概会过"。
     有些既有脚本**退出码恒为 0**（例如 `run_js_parity_probe.py` 只打印分歧数），
     这类检查必须用输出内容判据 —— 只看退出码就会把失败读成通过。
  2. `PASS / FAIL / SKIP` 三态；`SKIP` 必须写明原因（如"本机无 Docker"）。
  3. 失败项的原始输出**完整落盘**到 `docs/verification/runs/<时间戳>/`，可打开；**不覆盖历史**。
  4. 并发环境（8 条线共用同一工作目录）：某项 FAIL 时先记录相关文件 mtime，**自动重试一次**，
     避免把别线的中间状态报成缺陷；重试若转绿，状态记 PASS 但**备注里必须写明首次失败**，
     且首次的原始输出另存为 `<name>.attempt1.out`。
  5. 零模型调用：需要模型/Dify/云的一律不跑，按 SKIP 登记原因。

用法：
    python tools/verify_all.py                 # 快速档（默认，无 Docker）
    python tools/verify_all.py --full          # 完整档（含 Docker：镜像构建 / 容器内检查 / I-2）
    python tools/verify_all.py --only unit --only parity
    python tools/verify_all.py --list
    python tools/verify_all.py --no-retry      # 关闭失败自动重试

退出码：无 FAIL 为 0；有任一 FAIL 为非 0（FAIL 是真实缺陷，不是本工具故障）。
"""

from __future__ import annotations

import argparse
import atexit
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = ROOT / "docs" / "verification" / "runs"
CN = timezone(timedelta(hours=8))

FAST, FULL = "fast", "full"
DOCKER_DIRS = [r"C:\Program Files\Docker\Docker\resources\bin",
               r"C:\ProgramData\DockerDesktop\version-bin"]

#: 本项目对外声明里"已知未修的缺口（修复中）"——仅用于结果表备注，**不参与判据**，
#: 也不会把 FAIL 改判成别的状态。详见 docs/verification/复核指南-2026-10-31.md。
KNOWN_GAPS = {
    "js_range_parity": "已知缺口 #2：**请求侧范围校验已同步**（2026-10-31 修复，越界网格 13/14 两侧一致）。"
                       "唯一残差「days=10**20（越界）」：Python 返回 needs_input / LIMIT_EXCEEDED"
                       " @request.available_days，JS 返回 error / INVALID_JSON @request_json。"
                       "**两侧都拒绝该输入**，只是分类不同。根因不在范围校验代码，而在 JSON 解析层："
                       "web/server/jsonstrict.mjs 刻意拒绝超出 2^53-1 的整数**字面量**"
                       "（「整数超出安全范围」）——因为 JS 的 double 会静默改写这类整数，"
                       "实测 JSON.stringify(2^53+1) 得到 9007199254740992；"
                       "而 Python 用任意精度整数，再按 [0,365] 判越界。"
                       "判据未放宽：该残差以精确分歧集合匹配处理。",
    "image_latest_stale": "已知缺口 #1：giftwise-validator:latest 未重建，不含 I-2 修复（修复中）",
    "stage_b": "已知缺口 #3：stage_b 把 4 个文件 SHA256 钉在旧评审记录上，未随实现更新（待 PM 出新版本记录）",
    "declared_rules_hash": "已知缺口 #4：对外材料《材料清单与自查》§2/§7 声明的规则哈希 4782255b… 与当前 "
                           "validator/rules.py 1f389dad… 不一致（与缺口 #1 同源：材料包与镜像都停在加范围校验之前）",
    "browser_check": "已知缺口 #5：web/tools/browser-check.mjs 找的按钮文案（「填写三步需求」）与当前页面"
                     "（「开始选礼物/下一步：兴趣与风格」）不一致 → 该自查当前跑不完（归属 web 线）",
}

#: 某项 FAIL 时一并记录这些文件/目录的 mtime —— 用来判断"是不是另一条线正在写"（并发环境约定）。
WATCH = {
    "unit": ["validator/rules.py", "tests/test_cases.json", "tests/test_validator.py"],
    "stage_c": ["tests/acceptance/stage_c"],
    "contract": ["docs/test-reports/contract-001/tools", "validator/rules.py"],
    "probe46": ["workflow/verify_local.py", "validator/rules.py", "workflow/generated"],
    "parity": ["web/tools/parity-check.mjs", "web/server/checker.mjs", "web/server/config.mjs"],
    "http_smoke": ["web/tools/smoke-http.mjs", "web/server/server.mjs"],
    "browser_check": ["web/tools/browser-check.mjs", "web/public/app.js"],
    "page_probe": ["web/tools/page-probe.mjs", "web/index.html"],
    "access_layer": ["web/tests/access-layer.test.mjs", "web/server"],
    "boundary": ["tests/acceptance/boundary"],
    "js_range_parity": ["tests/acceptance/boundary/run_js_parity_probe.py", "web/server/checker.mjs"],
    "stage_b": ["tests/acceptance/stage_b", "validator/rules.py",
                "docs/pm-reviews/val-001-rereview-2026-10-29.md"],
    "range_contract": ["validator/rules.py"],
    "i2_local": ["deploy/server.py", "validator/rules.py"],
    "docker_build": ["deploy/Dockerfile", "validator/rules.py"],
    "container_check": ["deploy/Dockerfile"],
    "i2_image": ["deploy/server.py", "deploy/Dockerfile"],
    "image_latest_stale": ["deploy/server.py"],
    "declared_rules_hash": ["docs/competition/材料清单与自查.md", "validator/rules.py",
                            "workflow/generated/manifest.json"],
    "secret_scan": ["web/server", "web/public", "docs/competition"],
    "dify_publish_state": ["workflow/evidence/WF-003-2026-10-31-publish-v2"],
}

IMAGE_TAG = "giftwise-validator:verify-guide"

#: 接入层与浏览器调试端口（与既有多条线使用的默认值一致，便于复用已启动的进程）。
WEB_PORT = 8787
CDP_PORT = 9333


# --------------------------------------------------------------------------- 小工具

def now_cn() -> datetime:
    return datetime.now(CN)


def stamp() -> str:
    return now_cn().strftime("%Y%m%dT%H%M%S%z")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def display_width(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in text)


def pad(text: str, width: int) -> str:
    return text + " " * max(0, width - display_width(text))


def truncate(text: str, width: int) -> str:
    if display_width(text) <= width:
        return text
    out, used = "", 0
    for ch in text:
        step = 2 if unicodedata.east_asian_width(ch) in "WF" else 1
        if used + step > width - 1:
            break
        out += ch
        used += step
    return out + "…"


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((host, port)) == 0


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def http_json(url: str, timeout: float = 5.0):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def http_post_json(url: str, payload: dict, timeout: float = 10.0):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read()


def wait_http(url: str, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            status, _ = http_json(url, timeout=2.0)
            if status == 200:
                return True
        except Exception:
            time.sleep(0.3)
    return False


# --------------------------------------------------------------------------- 判据

def exit_zero(code: int, text: str):
    """判据：退出码为 0。"""
    if code == 0:
        return True, f"退出码 0"
    return False, f"退出码 {code}（非 0 即判据不满足）"


def exit_zero_and_contains(*needles: str):
    """判据：退出码 0 且输出含全部字面量。"""
    def check(code: int, text: str):
        ok, note = exit_zero(code, text)
        if not ok:
            return False, note
        missing = [n for n in needles if n not in text]
        if missing:
            return False, "输出缺少关键行：" + " / ".join(missing)
        return True, f"退出码 0，且命中 {len(needles)} 条关键输出"
    return check


def contains_only(*needles: str):
    """判据：忽略退出码，只看输出内容（用于退出码恒为 0 的既有脚本）。"""
    def check(code: int, text: str):
        missing = [n for n in needles if n not in text]
        if missing:
            return False, ("输出未命中期望内容：" + " / ".join(missing)
                           + f"（该脚本退出码={code}，故不能以退出码判定）")
        return True, f"命中关键输出（脚本退出码={code}，判据取输出内容）"
    return check


def regex_only(pattern: str, expect: str):
    def check(code: int, text: str):
        found = re.findall(pattern, text)
        if not found:
            return False, f"输出里找不到模式 {pattern!r}（退出码={code}）"
        if found[-1] != expect:
            return False, f"期望 {expect}，实际 {found[-1]}（退出码={code}）"
        return True, f"命中 {found[-1]}"
    return check


# --------------------------------------------------------------------------- 运行上下文

class Row:
    __slots__ = ("name", "group", "what", "status", "seconds", "cmd", "out_path",
                 "note", "retry_note", "mtimes")

    def __init__(self, name, group, what, status, seconds, cmd, out_path, note="",
                 retry_note="", mtimes=None):
        self.name = name
        self.group = group
        self.what = what
        self.status = status
        self.seconds = seconds
        self.cmd = cmd
        self.out_path = out_path
        self.note = note
        self.retry_note = retry_note
        self.mtimes = mtimes or {}


class Ctx:
    """单次运行的上下文：负责建归档目录、跑子进程、写原始输出。"""

    def __init__(self, run_dir: Path, retry: bool):
        self.run_dir = run_dir
        self.retry = retry
        self.env = dict(os.environ)
        self.env["PYTHONIOENCODING"] = "utf-8"
        self.env["PYTHONUTF8"] = "1"
        self.env["PYTHONUNBUFFERED"] = "1"
        self.docker = self._resolve_docker()
        self.cleanups: list = []
        self.notes: list[str] = []

    @staticmethod
    def _resolve_docker():
        found = shutil.which("docker")
        if found:
            return found
        for directory in DOCKER_DIRS:
            candidate = Path(directory) / "docker.exe"
            if candidate.exists():
                return str(candidate)
        return None

    def note(self, message: str) -> None:
        """环境说明去重（多项检查会重复报告同一件事，例如复用同一个已监听端口）。"""
        if message not in self.notes:
            self.notes.append(message)

    def python(self, *args: str) -> list:
        return [sys.executable, "-X", "utf8", *args]

    def node(self, *args: str) -> list:
        node = shutil.which("node")
        return [node or "node", *args]

    def display(self, cmd) -> str:
        if isinstance(cmd, str):
            return cmd
        return " ".join(cmd)

    def execute(self, cmd, timeout, cwd: Path | None = None, env: dict | None = None):
        """跑一条命令，返回 (exit_code, 合并输出)。不用 shell，避免转义陷阱。"""
        merged = dict(self.env)
        if env:
            merged.update(env)
        try:
            proc = subprocess.run(
                cmd if isinstance(cmd, list) else cmd,
                cwd=str(cwd or ROOT), env=merged, timeout=timeout,
                capture_output=True, shell=isinstance(cmd, str),
            )
        except subprocess.TimeoutExpired as exc:
            text = (exc.stdout or b"").decode("utf-8", "replace") + \
                   (exc.stderr or b"").decode("utf-8", "replace")
            return 124, text + f"\n[本工具] 超过 {timeout}s 超时，已终止该检查。\n"
        out = proc.stdout.decode("utf-8", "replace")
        err = proc.stderr.decode("utf-8", "replace")
        return proc.returncode, out + (("\n[stderr]\n" + err) if err.strip() else "")

    def section(self, handle, title: str, cmd_display: str, code: int, text: str, note: str):
        handle.write(f"\n{'=' * 78}\n## {title}\n## 命令: {cmd_display}\n"
                     f"## 退出码: {code}\n## 判定: {note}\n{'=' * 78}\n")
        handle.write(text.rstrip() + "\n")
        handle.flush()

    def mtimes(self, rel_paths) -> dict:
        """文件给自身 mtime；目录给"目录内最新文件"的 mtime（判断别线是否正在写）。"""
        out = {}
        for rel in rel_paths:
            path = ROOT / rel
            try:
                if path.is_dir():
                    newest, newest_name = 0.0, None
                    for child in path.rglob("*"):
                        if child.is_file() and "__pycache__" not in child.parts and child.suffix != ".pyc":
                            moment = child.stat().st_mtime
                            if moment > newest:
                                newest, newest_name = moment, child.relative_to(ROOT).as_posix()
                    out[rel] = (f"{datetime.fromtimestamp(newest, CN):%Y-%m-%d %H:%M:%S}"
                                f"（目录内最新：{newest_name}）") if newest else "空目录"
                else:
                    out[rel] = datetime.fromtimestamp(path.stat().st_mtime, CN).strftime("%Y-%m-%d %H:%M:%S")
            except OSError:
                out[rel] = "缺失"
        return out

    def cleanup(self) -> list:
        """停掉本工具临时启动的进程（复用既有监听的进程不动）。"""
        messages = []
        for kind, proc in self.cleanups:
            try:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    messages.append(f"已停止本工具临时启动的 {kind}（pid={proc.pid}）")
            except Exception as exc:  # noqa: BLE001
                messages.append(f"清理 {kind} 失败：{exc!r}")
        return messages


# --------------------------------------------------------------------------- 内置纯函数探针

def probe_range_contract(ctx: Ctx) -> tuple[bool, str, list[str]]:
    """声明：请求侧范围 [1,10000] / [0,365]，且候选侧不受约束。内置、无写盘、无需 Docker。"""
    sys.path.insert(0, str(ROOT))
    from validator.rules import validate  # noqa: E402  只读引用

    cases = json.loads((ROOT / "tests/test_cases.json").read_text(encoding="utf-8"))["cases"]
    base = next(c for c in cases if c["id"] == "T01_normal")

    def call(budget=None, days=None, totals=None, preps=None):
        request = json.loads(json.dumps(base["request"]))
        batch = json.loads(json.dumps(base["candidate_batch"]))
        if budget is not None:
            request["budget_amount"] = budget
        if days is not None:
            request["available_days"] = days
        if totals is not None:
            for item, value in zip(batch["candidates"], totals):
                item["estimated_total"] = value
        if preps is not None:
            for item, value in zip(batch["candidates"], preps):
                item["estimated_preparation_days"] = value
        return validate(json.dumps(request, ensure_ascii=False),
                        json.dumps(batch, ensure_ascii=False))

    checks: list[tuple[str, bool, str]] = []

    def want(name, ok, detail):
        checks.append((name, bool(ok), detail))

    def codes(out):
        return [(e["code"], e["path"]) for e in out["errors"]]

    for value, expect in (("0", "reject"), ("0.99", "reject"), ("1", "allow"),
                          ("10000", "allow"), ("10000.01", "reject"), ("10001", "reject")):
        out = call(budget=value, totals=["0", "0", "0"], preps=[0, 0, 0])
        if expect == "allow":
            want(f"预算 {value} 允许", out["status"] == "passed" and not out["errors"],
                 f"status={out['status']} errors={codes(out)}")
        else:
            want(f"预算 {value} 拒绝（LIMIT_EXCEEDED @ request.budget_amount）",
                 out["status"] == "needs_input" and ("LIMIT_EXCEEDED", "request.budget_amount") in codes(out),
                 f"status={out['status']} errors={codes(out)}")

    for value, expect in ((-1, "format"), (0, "allow"), (1, "allow"), (365, "allow"), (366, "reject")):
        out = call(days=value, totals=["0", "0", "0"], preps=[0, 0, 0])
        if expect == "allow":
            want(f"天数 {value} 允许（0=当天）", out["status"] == "passed" and not out["errors"],
                 f"status={out['status']} errors={codes(out)}")
        elif expect == "reject":
            want(f"天数 {value} 拒绝（LIMIT_EXCEEDED @ request.available_days）",
                 out["status"] == "needs_input" and ("LIMIT_EXCEEDED", "request.available_days") in codes(out),
                 f"status={out['status']} errors={codes(out)}")
        else:
            want(f"天数 {value} 走格式错误（INVALID_TYPE，不是范围码）",
                 out["status"] == "needs_input" and ("INVALID_TYPE", "request.available_days") in codes(out),
                 f"status={out['status']} errors={codes(out)}")

    # 反证：候选侧不受范围约束 —— 同一批字面量 0 / 0.0 / 0.00 在候选侧必须通过。
    out = call(budget="100.00", days=0, totals=["0", "0.0", "0.00"], preps=[0, 0, 0])
    want("候选侧零估算（0/0.0/0.00）+ 零准备天数仍通过",
         out["status"] == "passed" and out["all_passed"] is True and not out["errors"],
         f"status={out['status']} all_passed={out['all_passed']} errors={codes(out)}")

    # 候选越界不得报范围码，必须走语义码。
    out = call(budget="10000", days=365, totals=["10001", "10000.00", "35.00"], preps=[400, 1, 2])
    got = [(e["code"], e["path"]) for e in out["candidate_results"][0]["errors"]]
    want("候选 estimated_total=10001 → OVER_BUDGET（不是 LIMIT_EXCEEDED）",
         ("OVER_BUDGET", "candidates[0].estimated_total") in got
         and not any(c == "LIMIT_EXCEEDED" for c, _ in got), f"candidate errors={got}")
    want("候选 estimated_preparation_days=400 → PREPARATION_TOO_LONG（不是 LIMIT_EXCEEDED）",
         ("PREPARATION_TOO_LONG", "candidates[0].estimated_preparation_days") in got
         and not any(c == "LIMIT_EXCEEDED" for c, _ in got), f"candidate errors={got}")

    lines = ["声明：请求侧 budget_amount ∈ [1,10000]、available_days ∈ [0,365]；候选侧不受该范围约束。",
             f"被检实现：validator/rules.py  sha256={sha256_file(ROOT / 'validator/rules.py')}", ""]
    passed = 0
    for name, ok, detail in checks:
        lines.append(f"  [{'ok  ' if ok else 'FAIL'}] {name}  —— {detail}")
        passed += 1 if ok else 0
    lines += ["", f"合计 {passed}/{len(checks)} 项符合预期。"]
    text = "\n".join(lines)
    ok_all = passed == len(checks)
    return ok_all, (f"{passed}/{len(checks)} 项符合预期" if ok_all else f"仅 {passed}/{len(checks)} 项符合预期"), text


def probe_i2_half_open(ctx: Ctx, base_url: str, timeout: float) -> tuple[bool, str, str]:
    """声明：I-2 半开正文已修 —— Content-Length: 100 只发 5 字节，应得 408 且连接关闭。"""
    host, port = base_url.split("://")[1].split(":")
    port = int(port)
    head = (b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\n"
            b"Content-Type: application/json\r\nContent-Length: 100\r\n\r\n")
    body = b'{"req'  # 只发 5 字节，然后停住不发
    transcript = [f"目标 {base_url}（判定窗口 {timeout:.0f}s）",
                  f"实际发送：请求头 + 正文 {len(body)} 字节（声明 Content-Length: 100）"]
    started = time.monotonic()
    status_line, closed, elapsed, buf = None, False, None, b""
    try:
        with socket.create_connection((host, port), timeout=timeout + 5) as sock:
            sock.sendall(head + body)
            sock.settimeout(timeout + 5)
            deadline = time.monotonic() + timeout + 6      # 绝对上限：不许无限等
            while time.monotonic() < deadline:
                try:
                    chunk = sock.recv(4096)
                except socket.timeout:
                    break
                if not chunk:                              # 服务端关闭了连接
                    closed = True
                    break
                buf += chunk
            elapsed = time.monotonic() - started
            status_line = buf.split(b"\r\n", 1)[0].decode("latin1", "replace") if buf else "(无响应)"
    except OSError as exc:
        elapsed = time.monotonic() - started
        transcript.append(f"socket 异常：{exc!r}")
    transcript += [f"状态行：{status_line}", f"耗时：{elapsed:.2f}s" if elapsed else "耗时：n/a",
                   f"连接被服务端关闭：{closed}"]
    ok = bool(status_line and " 408 " in status_line and closed and elapsed and elapsed <= timeout + 4)
    if ok:
        note = f"408 且连接关闭（{elapsed:.2f}s）"
    else:
        bits = []
        if not status_line or " 408 " not in status_line:
            bits.append("未得到 408")
        if not closed:
            bits.append("连接未关闭")
        if elapsed and elapsed > timeout + 4:
            bits.append("超出上限耗时")
        note = "；".join(bits) or "判据不满足"
    return ok, note, "\n".join(transcript)


# --------------------------------------------------------------------------- 声明一致性探针（只读）

MATERIAL_DOC = "docs/competition/材料清单与自查.md"
MANIFEST = "workflow/generated/manifest.json"
PUBLISH_V2 = "workflow/evidence/WF-003-2026-10-31-publish-v2"

#: 声明"公开材料与接入层不含真实密钥"的判据。刻意收紧到"必须带像样的值"，
#: 否则文档里用来描述命令的样例串（如 `API_KEY=…`）会把自己扫成命中。
SECRET_PATTERNS = [r"sk-[A-Za-z0-9]{20,}", r"Bearer [A-Za-z0-9._-]{20,}",
                   r"-----BEGIN [A-Z ]*PRIVATE KEY", r"API_KEY=[A-Za-z0-9_-]{12,}",
                   r"ghp_[A-Za-z0-9]{20,}", r"Cookie: [A-Za-z0-9._-]{20,}"]
SCAN_ROOTS = ["README.md", "docs/demo-script.md", "docs/competition", "web/server", "web/public"]
SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".zip", ".pyc"}


def probe_declared_rules_hash() -> tuple[bool, str, str]:
    """声明：对外材料给出的规则版本指纹 == 当前 `validator/rules.py` 的 sha256。"""
    actual = sha256_file(ROOT / "validator/rules.py")
    lines = [f"当前 validator/rules.py sha256 = {actual}",
             f"当前 git HEAD = {git_head()}", ""]
    ok, declared = True, 0
    for rel in (MATERIAL_DOC, "docs/acceptance-criteria.md"):
        path = ROOT / rel
        lines.append(f"--- {rel} ---")
        if not path.is_file():
            lines.append("  [缺失]")
            ok = False
            continue
        found = 0
        for lineno, text in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "规则哈希" in text or "rules_source_sha256" in text:
                for value in re.findall(r"[0-9a-f]{64}", text):
                    found += 1
                    declared += 1
                    same = value == actual
                    ok &= same
                    lines.append(f"  第 {lineno} 行声明 {value} → {'一致' if same else '**不一致**'}")
        if not found:
            lines.append("  （本文件没有声明规则哈希；只引用 manifest 指针）")

    manifest_path = ROOT / MANIFEST
    lines += ["", f"--- {MANIFEST} ---"]
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        value = manifest.get("sources_sha256", {}).get("validator/rules.py")
        same = value == actual
        ok &= bool(same)
        lines.append(f"  sources_sha256['validator/rules.py'] = {value} → {'一致' if same else '**不一致**'}")
    else:
        lines.append("  [缺失]（先跑 --only probe46 会重建该清单）")
        ok = False

    lines += ["", f"共核对 {declared} 处对外声明哈希。"]
    note = ("对外声明的规则哈希与当前实现一致" if ok
            else "对外材料声明的规则哈希与当前 validator/rules.py 不一致（见原始输出）")
    return ok, note, "\n".join(lines)


def probe_secret_scan() -> tuple[bool, str, str]:
    """声明：公开材料（README/演示脚本/竞赛文档）与 `web/server`、`web/public` 不含真实密钥。"""
    scanned, hits = 0, []
    for rel in SCAN_ROOTS:
        path = ROOT / rel
        if not path.exists():
            hits.append(f"{rel}: 路径不存在（声明里的扫描范围缺失）")
            continue
        items = [path] if path.is_file() else sorted(path.rglob("*"))
        for item in items:
            if not item.is_file() or item.suffix.lower() in SKIP_SUFFIX:
                continue
            if any(part in {"node_modules", ".git", ".tmp", "__pycache__"} for part in item.parts):
                continue
            if item.stat().st_size > 512 * 1024:
                continue
            scanned += 1
            text = item.read_text(encoding="utf-8", errors="replace")
            for lineno, line in enumerate(text.splitlines(), 1):
                for pattern in SECRET_PATTERNS:
                    if re.search(pattern, line):
                        hits.append(f"{item.relative_to(ROOT).as_posix()}:{lineno}: /{pattern}/ → {line.strip()[:100]}")

    # 声明里逐字给出的两条命令（`grep -rn "sk-" web/server web/public` 期望 0 行）
    verbatim = []
    for rel in ("web/server", "web/public"):
        count = 0
        for item in sorted((ROOT / rel).rglob("*")):
            if item.is_file() and "node_modules" not in item.parts and item.suffix.lower() not in SKIP_SUFFIX:
                count += sum(1 for line in item.read_text(encoding="utf-8", errors="replace").splitlines()
                             if "sk-" in line)
        verbatim.append((rel, count))
    lines = [f"扫描范围：{'、'.join(SCAN_ROOTS)}", f"实际读取文件数：{scanned}", "",
             "逐字执行声明里的命令（期望 0）："]
    for rel, count in verbatim:
        lines.append(f"  grep -rn \"sk-\" {rel} → {count} 行")
    lines += ["", f"收紧后的密钥模式命中：{len(hits)} 处"]
    lines += [f"  {h}" for h in hits] or ["  （无）"]
    ok = not hits and all(count == 0 for _, count in verbatim)
    note = (f"0 命中（{scanned} 个文件）" if ok
            else f"命中 {len(hits)} 处 / 逐字命令非 0，见原始输出")
    return ok, note, "\n".join(lines)


# --------------------------------------------------------------------------- 服务/浏览器编排

def ensure_access_layer(ctx: Ctx, port: int = WEB_PORT) -> tuple[bool, str, object]:
    """接入层：已在监听就复用（记账），否则本工具自己拉起并在结束时关掉。"""
    if port_open(port):
        ctx.note(f"接入层 127.0.0.1:{port} 已在监听：**复用既有进程**（非本工具启动），结果反映当前工作区状态。")
        return True, "复用已在监听的接入层", None
    env = {"GW_PORT": str(port)}
    proc = subprocess.Popen(ctx.node("web/server/server.mjs"), cwd=str(ROOT),
                            env={**ctx.env, **env}, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    ctx.cleanups.append(("server", proc))
    if wait_http(f"http://127.0.0.1:{port}/api/config", 20) or port_open(port):
        ctx.note(f"接入层 127.0.0.1:{port} 由本工具临时启动。")
        return True, "本工具临时启动", proc
    return False, f"接入层未能就绪（127.0.0.1:{port}）", proc


def ensure_cdp(ctx: Ctx, port: int = CDP_PORT) -> tuple[bool, str]:
    """Chrome 调试端口：已在监听就复用；否则尝试用本机 Chrome 无头启动。"""
    if port_open(port):
        ctx.note(f"Chrome CDP 127.0.0.1:{port} 已在监听：**复用既有浏览器**（非本工具启动）。")
        return True, "复用已在监听的 Chrome CDP"
    chrome = None
    for candidate in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                      r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                      os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")):
        if Path(candidate).exists():
            chrome = candidate
            break
    if not chrome:
        return False, "本机未找到 Chrome，且 9333 无调试端口"
    # ⚠️ user-data-dir 绝不能落在归档目录里：实测一次运行会写进 ~70 MB / 489 个文件
    # （含 35 MB 的 optimization_guide_model_store/*.tflite 与各类缓存），既污染证据归档，
    # 又可能夹带本机浏览器痕迹。改为**系统临时目录**，进程退出时删除。
    # （2026-10-31 由 PM 修正；此前写进 docs/verification/runs/<时间戳>/chrome-profile/）
    profile = Path(tempfile.mkdtemp(prefix="gw-chrome-profile-"))
    atexit.register(shutil.rmtree, profile, True)
    proc = subprocess.Popen([chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
                             f"--remote-debugging-port={port}",
                             f"--user-data-dir={profile}", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ctx.cleanups.append(("chrome", proc))
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if port_open(port):
            ctx.note(f"Chrome CDP 由本工具临时启动（headless，profile 在系统临时目录 {profile}，退出时删除，不进归档）。")
            return True, "本工具临时启动 Chrome"
        time.sleep(0.5)
    return False, "Chrome 已尝试启动但 20s 内未开放调试端口"


# --------------------------------------------------------------------------- 检查定义

def build_checks() -> list[dict]:
    """全部检查。每项：name / group / what / 判据 / 执行。"""
    checks: list[dict] = []

    def add(name, group, what, runner, retry=True):
        checks.append({"name": name, "group": group, "what": what,
                       "runner": runner, "retry": retry})

    # ---------- 任务单快速档 ----------
    def unit(ctx, out):
        return simple(ctx, out, "单元测试（规则层 + 数据驱动夹具）",
                      ctx.python("-m", "unittest", "discover", "-s", "tests"), 180,
                      exit_zero, ["validator/rules.py", "tests/test_cases.json"])

    def stage_c(ctx, out):
        return simple(ctx, out, "阶段 C 独立验收（39 例，QA-001）",
                      ctx.python("-m", "unittest", "discover", "-s", "tests/acceptance/stage_c"), 180,
                      exit_zero, ["tests/acceptance/stage_c"])

    def contract(ctx, out):
        return simple(ctx, out, "契约探针（19 码触达 + 边界矩阵 + 文档双向对账）",
                      ctx.python("docs/test-reports/contract-001/tools/run_all.py"), 240,
                      exit_zero_and_contains("validator/rules.py   19/19", "结论：全部通过"),
                      ["docs/test-reports/contract-001/tools", "validator/rules.py"])

    def probe46(ctx, out):
        return simple(ctx, out, "本地 46 探针（离线、0 模型调用）",
                      ctx.python("tests/acceptance/stage_c/run_verify_local_nopipe.py"), 240,
                      exit_zero_and_contains("local probes: 46 passed; 0 failed",
                                             "results.json model_calls = 0"),
                      ["workflow/verify_local.py", "validator/rules.py"])

    def parity(ctx, out):
        steps = [
            ("① 生成样例（JS 侧夹具）", ctx.node("web/tools/gen-parity-fixtures.mjs")),
            ("② 生成 Python 参考结果", ctx.python("web/tools/parity-reference.py")),
            ("③ 逐项比对", ctx.node("web/tools/parity-check.mjs")),
        ]
        return multi(ctx, out, "JS↔Python parity（**样例级**等价，非全域等价）", steps, 180,
                     exit_zero, ["web/tools/parity-check.mjs", "web/server/checker.mjs"])

    def http_smoke(ctx, out):
        ready, how, _ = ensure_access_layer(ctx)
        if not ready:
            return "SKIP", f"接入层未就绪且无法启动：{how}", "(未执行)", ""
        return simple(ctx, out, f"HTTP 冒烟（59 项；{how}）",
                      ctx.node("web/tools/smoke-http.mjs"), 180,
                      exit_zero_and_contains("失败 0 项"),
                      ["web/tools/smoke-http.mjs", "web/server/server.mjs"],
                      env={"GW_BASE": f"http://127.0.0.1:{WEB_PORT}"})

    def page_probe(ctx, out):
        ready, how, _ = ensure_access_layer(ctx)
        if not ready:
            return "SKIP", f"接入层未就绪且无法启动：{how}", "(未执行)", ""
        cdp_ok, cdp_how = ensure_cdp(ctx)
        if not cdp_ok:
            return "SKIP", f"无可用浏览器调试端口：{cdp_how}（页面探针需要 Chrome CDP）", "(未执行)", ""
        return simple(ctx, out, f"页面探针（首帧渲染；{cdp_how}）",
                      ctx.node("web/tools/page-probe.mjs"), 180, exit_zero,
                      ["web/tools/page-probe.mjs"],
                      env={"GW_CDP": f"http://127.0.0.1:{CDP_PORT}",
                           "GW_URL": f"http://127.0.0.1:{WEB_PORT}/"})

    def browser_check(ctx, out):
        # web 线自带的浏览器自查（比页首帧探针更全：多视口、吸顶标识、无外部请求、主流程点击）。
        ready, how, _ = ensure_access_layer(ctx)
        if not ready:
            return "SKIP", f"接入层未就绪且无法启动：{how}", "(未执行)"
        cdp_ok, cdp_how = ensure_cdp(ctx)
        if not cdp_ok:
            return "SKIP", f"无可用浏览器调试端口：{cdp_how}（浏览器自查需要 Chrome CDP）", "(未执行)"
        return simple(ctx, out, f"浏览器自查（web 线自带，多视口 + 主流程点击；{cdp_how}）",
                      ctx.node("web/tools/browser-check.mjs"), 300, exit_zero,
                      ["web/tools/browser-check.mjs"],
                      env={"GW_CDP": f"http://127.0.0.1:{CDP_PORT}",
                           "GW_URL": f"http://127.0.0.1:{WEB_PORT}/"})

    # ---------- 本线补入的既有检查（同属快速档，均无需 Docker）----------
    def access_layer(ctx, out):
        return simple(ctx, out, "接入层单元测试（40 例）",
                      ctx.node("web/tests/access-layer.test.mjs"), 180, exit_zero,
                      ["web/tests/access-layer.test.mjs", "web/server"])

    def boundary(ctx, out):
        return simple(ctx, out, "边界套件（25 例，跨层闸门/判别性）",
                      ctx.python("-m", "unittest", "discover", "-s", "tests/acceptance/boundary"), 180,
                      exit_zero, ["tests/acceptance/boundary"])

    def js_range_parity(ctx, out):
        # 该脚本退出码恒为 0，只打印分歧数 → 判据必须取输出内容。
        return simple(ctx, out, "JS 侧请求侧范围一致性（**已知缺口 #2**）",
                      ctx.python("tests/acceptance/boundary/run_js_parity_probe.py"), 180,
                      regex_only(r"分歧用例数：(\S+)", "0/14"),
                      ["tests/acceptance/boundary/run_js_parity_probe.py", "web/server/checker.mjs"])

    def stage_b(ctx, out):
        return simple(ctx, out, "阶段 B 契约验收（269 例 + 版本哈希核对）",
                      ctx.python("-m", "unittest", "discover", "-s", "tests/acceptance/stage_b"), 180,
                      exit_zero, ["tests/acceptance/stage_b", "validator/rules.py"])

    def range_contract(ctx, out):
        ok, note, text = probe_range_contract(ctx)
        out.write(text + "\n")
        out.flush()
        return ("PASS" if ok else "FAIL"), note, "(内置纯函数探针：validator.rules.validate)"

    def i2_local(ctx, out):
        port, timeout = 8799, 3.0
        if port_open(port):
            return "SKIP", f"端口 {port} 已被占用，无法启动本机服务做 I-2 探针", "(未执行)", ""
        import subprocess as _sp
        env = {**ctx.env, "GIFTWISE_PORT": str(port), "GIFTWISE_BIND": "127.0.0.1",
               "GIFTWISE_READ_TIMEOUT": str(int(timeout))}
        proc = _sp.Popen(ctx.python("-m", "deploy.server"), cwd=str(ROOT), env=env,
                         stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
        ctx.cleanups.append(("i2-local 服务", proc))
        if not wait_http(f"http://127.0.0.1:{port}/healthz", 25):
            proc.terminate()
            return "FAIL", f"本机 deploy.server 未能就绪（127.0.0.1:{port}）", "(未执行)"
        ok, note, transcript = probe_i2_half_open(ctx, f"http://127.0.0.1:{port}", timeout)
        out.write(transcript + "\n")
        out.flush()
        proc.terminate()
        return ("PASS" if ok else "FAIL"), note, \
            f"GIFTWISE_PORT={port} GIFTWISE_READ_TIMEOUT={int(timeout)} python -m deploy.server + 原始 socket"

    def declared_rules_hash(ctx, out):
        ok, note, text = probe_declared_rules_hash()
        out.write(text + "\n")
        out.flush()
        return ("PASS" if ok else "FAIL"), note, f"(内置只读探针：{MATERIAL_DOC} + {MANIFEST})"

    def secret_scan(ctx, out):
        ok, note, text = probe_secret_scan()
        out.write(text + "\n")
        out.flush()
        return ("PASS" if ok else "FAIL"), note, "(内置只读探针：密钥模式扫描 + 声明里的逐字 grep 命令)"

    def dify_publish_state(ctx, out):
        """零模型调用 + 不访问外部服务：本项只读已归档证据，不重跑、不重新探测 Dify。"""
        files = [f"{PUBLISH_V2}/README.md", f"{PUBLISH_V2}/dify-v2-publish-success.png",
                 f"{PUBLISH_V2}/dify-published-v2-workflow.json",
                 "workflow/evidence/WF-003-2026-10-30/dify-publish-success-evidence.txt",
                 "workflow/evidence/WF-003-2026-10-30/dify-published-state-2026-10-30T2305+0800.json"]
        out.write("本项按任务约束**不重跑**（需要 Dify 控制台访问与模型调用），只读工作流线已归档的证据。\n"
                  "结论口径：Dify 工作流**已发布并创建版本**（版本 #1：2026-10-30 23:04；版本 #2：2026-10-31 00:1x）；\n"
                  "**发布后外部可访问性未核实** —— 本项目从未部署、没有在线体验地址，本条目前无判据。\n\n")
        for rel in files:
            path = ROOT / rel
            out.write(f"--- {rel} ---\n")
            if not path.exists():
                out.write("[缺失]\n\n")
                continue
            if path.suffix == ".md":
                text = path.read_text(encoding="utf-8", errors="replace")
                out.write(text[:2500] + ("\n…（此处截断，完整原文见该文件）\n\n" if len(text) > 2500 else "\n"))
            elif path.suffix == ".txt":
                text = path.read_text(encoding="utf-8", errors="replace")
                out.write(text[:1500] + ("\n…（截断）\n\n" if len(text) > 1500 else "\n"))
            else:
                out.write(f"[存在] 大小 {path.stat().st_size} 字节\n\n")
        out.flush()
        return "SKIP", ("零模型调用/不访问外部服务：发布状态由工作流线归档证据给出（见原始输出）；"
                        "**发布后外部可访问性未核实**（无判据）"), \
            "(未执行；只读归档证据 workflow/evidence/WF-003-2026-10-31-publish-v2/)"

    add("unit", FAST, "单元测试（规则层 + 数据驱动夹具；用例数随各线新增而变）", unit)
    add("stage_c", FAST, "阶段 C 独立验收（QA-001）", stage_c)
    add("contract", FAST, "契约探针（19 码/边界/双向对账）", contract)
    add("probe46", FAST, "本地 46 探针（离线）", probe46)
    add("parity", FAST, "JS↔Python parity（样例级）", parity)
    add("http_smoke", FAST, "HTTP 冒烟（接入层 mock 链路）", http_smoke)
    add("page_probe", FAST, "页面探针（真实浏览器首帧）", page_probe)
    add("browser_check", FAST, "浏览器自查（web 线自带，多视口 + 主流程）", browser_check)
    add("access_layer", FAST, "接入层单元测试（node:test）", access_layer)
    add("boundary", FAST, "边界套件（跨层闸门/判别性）", boundary)
    add("js_range_parity", FAST, "JS 侧范围一致性（已知缺口）", js_range_parity)
    add("stage_b", FAST, "阶段 B 契约验收（+ 版本哈希核对）", stage_b)
    add("range_contract", FAST, "请求侧范围契约（内置纯函数探针）", range_contract, retry=False)
    add("i2_local", FAST, "I-2 半开正文（本机工作区代码）", i2_local)
    add("declared_rules_hash", FAST, "对外材料声明的规则哈希 / 版本指纹", declared_rules_hash, retry=False)
    add("secret_scan", FAST, "公开材料与接入层无密钥（声明为 0 命中）", secret_scan, retry=False)
    add("dify_publish_state", FAST, "Dify 发布状态（只读归档证据，不重跑）", dify_publish_state)

    # ---------- 完整档（含 Docker）----------
    def docker_build(ctx, out):
        if not ctx.docker:
            return "SKIP", "本机无 Docker CLI（未安装或不在 PATH）", "(未执行)", ""
        cmd = [ctx.docker, "build", "-f", "deploy/Dockerfile", "-t", IMAGE_TAG, "."]
        return simple(ctx, out, f"镜像构建（独立 tag {IMAGE_TAG}，**不动 latest**）", cmd, 1200,
                      exit_zero, ["deploy/Dockerfile", "validator/rules.py"])

    def container_check(ctx, out):
        return container_pipeline(ctx, out, mode="check")

    def i2_image(ctx, out):
        return container_pipeline(ctx, out, mode="i2")

    def image_latest_stale(ctx, out):
        return latest_stale(ctx, out)

    add("docker_build", FULL, f"镜像构建（独立 tag {IMAGE_TAG}）", docker_build, retry=False)
    add("container_check", FULL, "容器内检查（哈希一致/字节一致/非 root/无密钥）", container_check, retry=False)
    add("i2_image", FULL, "I-2 半开正文（新构建镜像内）", i2_image, retry=False)
    add("image_latest_stale", FULL, "giftwise-validator:latest 是否已含 I-2（已知缺口 #1）",
        image_latest_stale, retry=False)
    return checks


# --------------------------------------------------------------------------- 执行辅助

def simple(ctx: Ctx, out, what: str, cmd, timeout: float, criterion, watch: list,
           env: dict | None = None):
    display = ctx.display(cmd) + (f"   [env: {' '.join(f'{k}={v}' for k, v in env.items())}]" if env else "")
    code, text = ctx.execute(cmd, timeout, env=env)
    ok, note = criterion(code, text)
    ctx.section(out, what, display, code, text, note)
    return ("PASS" if ok else "FAIL"), note, display


def multi(ctx: Ctx, out, what: str, steps, timeout: float, criterion, watch: list):
    displays, codes, texts = [], [], []
    for title, cmd in steps:
        code, text = ctx.execute(cmd, timeout)
        displays.append(ctx.display(cmd))
        codes.append(code)
        texts.append(text)
        ctx.section(out, f"{what} — {title}", ctx.display(cmd), code, text,
                    "退出码 0" if code == 0 else f"退出码 {code}")
    combined = "\n".join(texts)
    ok = all(c == 0 for c in codes)
    note = criterion(max(codes), combined)[1] if ok else f"有步骤退出码非 0：{codes}"
    return ("PASS" if ok else "FAIL"), note, "  &&  ".join(displays)


def _docker(ctx: Ctx, *args: str, timeout: float = 300):
    return ctx.execute([ctx.docker, *args], timeout)


def container_pipeline(ctx: Ctx, out, mode: str):
    """在独立 tag 的镜像上做容器内检查 / I-2 探针。只读挂载，无写盘副作用。"""
    if not ctx.docker:
        return "SKIP", "本机无 Docker CLI（未安装或不在 PATH）", "(未执行)", ""
    tag = IMAGE_TAG
    code, text = _docker(ctx, "image", "inspect", tag, "--format", "{{.Id}}", timeout=60)
    ctx.section(out, f"前置：镜像 {tag} 是否存在", f"docker image inspect {tag}", code, text, "")
    if code != 0:
        return "SKIP", f"镜像 {tag} 不存在：先跑 --only docker_build（完整档会自带构建）", "(未执行)", ""

    measured = time.monotonic()
    port = free_port()
    name = f"gw-verify-{mode}-{os.getpid()}"
    local_hash = sha256_file(ROOT / "validator/rules.py")
    logs: list[str] = [f"本地 validator/rules.py sha256 = {local_hash}",
                       f"镜像 = {tag}，容器 = {name}，宿主端口 = {port}"]
    ok = True
    (code, text) = _docker(ctx, "run", "-d", "--rm", "--name", name,
                           "-e", "GIFTWISE_READ_TIMEOUT=3",
                           "-p", f"127.0.0.1:{port}:8000", tag, timeout=120)
    logs.append(f"$ docker run -d --name {name} -p 127.0.0.1:{port}:8000 {tag}\n{text}")
    if code != 0:
        ctx.section(out, "启动容器", "docker run", code, "\n".join(logs), "启动失败")
        return "FAIL", "容器启动失败", f"docker run -d ... {tag}", "\n".join(logs)
    try:
        ready = wait_http(f"http://127.0.0.1:{port}/healthz", 30)
        logs.append(f"容器 /healthz 就绪：{ready}")
        if not ready:
            ctx.section(out, "容器就绪", "GET /healthz", 1, "\n".join(logs), "未就绪")
            return "FAIL", "容器 30s 内 /healthz 未就绪", f"docker run ... {tag}", "\n".join(logs)

        # (1) 规则只有一份来源：容器 /healthz 哈希 == 本地 rules.py 哈希
        status, payload = http_json(f"http://127.0.0.1:{port}/healthz")
        remote_hash = payload.get("rules_source_sha256")
        same = status == 200 and remote_hash == local_hash
        logs.append(f"[1] GET /healthz → HTTP {status}\n    {json.dumps(payload, ensure_ascii=False)}\n"
                    f"    本地 sha256 = {local_hash}\n    一致 = {same}")
        ok &= same

        # (2) /validate 与本机纯函数逐字节一致
        sys.path.insert(0, str(ROOT))
        from validator.rules import validate  # noqa: E402
        cases = json.loads((ROOT / "tests/test_cases.json").read_text(encoding="utf-8"))["cases"]
        case = next(c for c in cases if c["id"] == "T01_normal")
        req = json.dumps(case["request"], ensure_ascii=False)
        cand = json.dumps(case["candidate_batch"], ensure_ascii=False)
        expected = json.dumps(validate(req, cand), ensure_ascii=False,
                              separators=(",", ":")).encode("utf-8")
        vstatus, body = http_post_json(f"http://127.0.0.1:{port}/validate",
                                      {"request_json": req, "candidates_json": cand})
        identical = body == expected
        logs.append(f"[2] POST /validate（夹具 T01_normal）→ HTTP {vstatus}\n"
                    f"    容器字节数 = {len(body)}，本机字节数 = {len(expected)}，逐字节一致 = {identical}")
        if not identical:
            logs.append(f"    容器: {body[:160]!r}\n    本机: {expected[:160]!r}")
        ok &= identical

        # (3) 容器内非 root
        code, uid = _docker(ctx, "run", "--rm", "--entrypoint", "id", tag, "-u", timeout=120)
        non_root = code == 0 and uid.strip() == "10001"
        logs.append(f"[3] $ docker run --rm --entrypoint id {tag} -u\n    {uid.strip()}\n"
                    f"    非 root（uid=10001）= {non_root}")
        ok &= non_root

        # (4) 镜像内无 .git、无测试/文档/工作流目录、无密钥
        code, listing = _docker(ctx, "run", "--rm", "--entrypoint", "find", tag, "/app",
                                "-maxdepth", "2", timeout=120)
        forbidden = [p for p in (".git", "/tests", "/docs", "/workflow", ".env")
                     if p in listing]
        pattern = r"sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY"
        code2, hits = _docker(ctx, "run", "--rm", "--entrypoint", "sh", tag, "-c",
                              f"grep -rlE '{pattern}' /app 2>/dev/null || true", timeout=120)
        no_secret = not hits.strip()
        clean = not forbidden and no_secret
        logs.append(f"[4] 镜像内文件清单（find /app -maxdepth 2）：\n{listing.rstrip()}\n"
                    f"    禁止项命中 = {forbidden or '无'}\n"
                    f"    密钥模式命中 = {hits.strip() or '无'}\n    结论 = {clean}")
        ok &= clean

        # (5) I-2 半开正文（容器内）
        if mode == "i2":
            i2_ok, i2_note, transcript = probe_i2_half_open(ctx, f"http://127.0.0.1:{port}", 3.0)
            logs.append("[5] I-2 半开正文探针（容器内）\n" + transcript)
            ok &= i2_ok
    finally:
        code, text = _docker(ctx, "stop", name, timeout=120)
        logs.append(f"$ docker stop {name}\n{text}")

    seconds = time.monotonic() - measured
    what = "容器内检查（哈希/字节/非root/无密钥）" if mode == "check" else "I-2 半开正文（新构建镜像）"
    display = (f"docker run -d -p 127.0.0.1:<free>:8000 {tag} + /healthz + /validate + id -u + find /app + grep 密钥"
               if mode == "check" else
               f"同 container_check 起容器 + 原始 socket（Content-Length: 100 只发 5 字节）")
    ctx.section(out, what, display, 0 if ok else 1, "\n".join(logs),
                "全部子项满足" if ok else "存在不满足子项")
    return ("PASS" if ok else "FAIL"), ("全部子项满足" if ok else "存在不满足子项"), display, "\n".join(logs)


def latest_stale(ctx: Ctx, out):
    """如实检查 `latest`：这一项**预期 FAIL**（已知缺口 #1），FAIL 就是它的正确结果。"""
    if not ctx.docker:
        return "SKIP", "本机无 Docker CLI（未安装或不在 PATH）", "(未执行)", ""
    tag = "giftwise-validator:latest"
    code, text = _docker(ctx, "image", "inspect", tag, "--format", "{{.Id}} {{.Created}}", timeout=60)
    if code != 0:
        return "SKIP", f"本机没有 {tag} 镜像", "(未执行)", f"docker image inspect {tag}\n{text}"
    local_hash = sha256_file(ROOT / "validator/rules.py")
    port = free_port()
    name = f"gw-verify-latest-{os.getpid()}"
    logs = [f"本地 validator/rules.py sha256 = {local_hash}",
            f"$ docker image inspect {tag} --format '{{{{.Id}}}} {{{{.Created}}}}'\n{text}"]
    _docker(ctx, "run", "-d", "--rm", "--name", name, "-e", "GIFTWISE_READ_TIMEOUT=3",
            "-p", f"127.0.0.1:{port}:8000", tag, timeout=120)
    hash_ok = i2_ok = False
    try:
        if wait_http(f"http://127.0.0.1:{port}/healthz", 30):
            _, payload = http_json(f"http://127.0.0.1:{port}/healthz")
            remote = payload.get("rules_source_sha256")
            hash_ok = remote == local_hash
            logs.append(f"[a] latest 的 /healthz 哈希 = {remote}\n    本地 = {local_hash}\n    一致 = {hash_ok}")
            i2_ok, i2_note, transcript = probe_i2_half_open(ctx, f"http://127.0.0.1:{port}", 3.0)
            logs.append("[b] I-2 半开正文探针（latest）\n" + transcript + f"\n    判定：{i2_note}")
        else:
            logs.append("latest 容器 30s 内 /healthz 未就绪")
    finally:
        _docker(ctx, "stop", name, timeout=120)
    ok = hash_ok and i2_ok
    note = ("latest 已含 I-2 修复且哈希一致" if ok else
            f"latest 未重建：哈希一致={hash_ok}、I-2 得 408={i2_ok}（已知缺口 #1，修复中）")
    display = f"docker run -d {tag} -p 127.0.0.1:<free>:8000 + /healthz 哈希 + 半开正文探针"
    ctx.section(out, "giftwise-validator:latest 现状核对（已知缺口 #1）", display,
                0 if ok else 1, "\n".join(logs), note)
    return ("PASS" if ok else "FAIL"), note, display, "\n".join(logs)


def run_one(ctx: Ctx, check: dict, attempt: int):
    """跑一项，返回 (status, note, cmd_display, seconds, out_path)。

    每次尝试写各自的 `<name>.attemptN.out`，**不改名、不覆盖**；
    最终判定的副本另写 `<name>.out`（见 finalize_output）。
    """
    out_path = ctx.run_dir / f"{check['name']}.attempt{attempt}.out"
    with open(out_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(f"检查: {check['name']}\n分组: {check['group']}\n说明: {check['what']}\n"
                     f"开始: {now_cn().isoformat()}\n尝试: 第 {attempt} 次\n")
        started = time.monotonic()
        try:
            result = check["runner"](ctx, handle)
        except Exception as exc:  # noqa: BLE001 —— 检查自身崩溃按 FAIL 记，不吞掉
            import traceback
            handle.write("\n[本工具] 该检查自身抛出异常：\n" + traceback.format_exc())
            result = ("FAIL", f"检查自身异常：{exc!r}", "(未执行)")
        seconds = time.monotonic() - started
        status, note, cmd_display = result[0], result[1], result[2]
        handle.write(f"\n[本工具] 本次尝试判定：{status}（{note}）；耗时 {seconds:.2f}s\n")
    return status, note, cmd_display, seconds, out_path


def finalize_output(ctx: Ctx, check: dict, attempts: list, final_path: Path, status: str) -> Path:
    """写 `<name>.out`：最终判定的内容副本 + 全部尝试的判定记录（各次原始输出另行保留）。"""
    header = [f"# 检查：{check['name']}",
              f"# 最终判定：{status}",
              "# 尝试记录：" + "；".join(f"{tag} {st}（{path.name}）" for tag, st, path in attempts),
              f"# 本文件 = 最终尝试（{final_path.name}）的内容副本；各次尝试的原始输出独立保留，未被覆盖。",
              ""]
    out_path = ctx.run_dir / f"{check['name']}.out"
    out_path.write_text("\n".join(header) + final_path.read_text(encoding="utf-8"), encoding="utf-8")
    return out_path


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="GiftWise AI 一条命令全量验证（VERIFY-GUIDE-001）")
    parser.add_argument("--full", action="store_true", help="完整档：追加需要 Docker 的检查")
    parser.add_argument("--only", action="append", default=[],
                        help="只跑指定检查（可重复，或逗号分隔）；见 --list")
    parser.add_argument("--list", action="store_true", help="列出全部检查名后退出")
    parser.add_argument("--no-retry", action="store_true", help="关闭失败自动重试")
    args = parser.parse_args(argv)

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    checks = build_checks()
    if args.list:
        print("快速档（默认）与完整档检查：\n")
        for check in checks:
            tier = "快速档" if check["group"] == FAST else "完整档"
            print(f"  {pad(check['name'], 20)} {tier}  {check['what']}")
        print("\n用法示例：python tools/verify_all.py --only unit --only parity")
        return 0

    wanted = [name.strip() for item in args.only for name in item.split(",") if name.strip()]
    if wanted:
        unknown = [name for name in wanted if name not in {c["name"] for c in checks}]
        if unknown:
            print(f"未知检查名：{unknown}\n用 --list 查看全部可用检查。", file=sys.stderr)
            return 2
        selected = [c for c in checks if c["name"] in wanted]
    else:
        selected = [c for c in checks if c["group"] == FAST or args.full]

    # ---- 归档目录：独占创建，绝不覆盖历史 ----
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    base_stamp = stamp()
    run_dir = RUNS_DIR / base_stamp
    index = 1
    while run_dir.exists():
        index += 1
        run_dir = RUNS_DIR / f"{base_stamp}-{index}"
    run_dir.mkdir(parents=True, exist_ok=False)

    ctx = Ctx(run_dir, retry=not args.no_retry)
    print(f"GiftWise AI 全量验证｜{'完整档' if args.full else '快速档'}"
          f"（{len(selected)} 项）")
    print(f"归档目录：{run_dir.relative_to(ROOT).as_posix()}")
    print(f"Python {platform.python_version()}｜Node {shutil.which('node') or '未找到'}"
          f"｜Docker {ctx.docker or '未找到'}")
    print()

    if any(c["name"] == "probe46" for c in selected):
        ctx.note(
            "probe46 走的是 workflow/verify_local.py 的等价跑法，它会把本次证据**追加**到 "
            "workflow/evidence/local-2026-10-29/runs/<时间戳>/ 并重建 workflow/generated/* "
            "——这是该脚本自己的追加式写入设计（不属于本工具的写入，本工具既不修改也不回滚它）。")

    rows: list[Row] = []
    cleanup_messages: list[str] = []
    try:
        for check in selected:
            status, note, cmd, seconds, path1 = run_one(ctx, check, attempt=1)
            attempts = [("第1次", status, path1)]
            final_path, retry_note = path1, ""
            if status == "FAIL" and ctx.retry and check.get("retry", True):
                # 并发环境（8 条线共用工作目录）：先按 mtime 判断别线是否正在写，再重试一次。
                print(f"  [RETRY] {check['name']} 首次 FAIL，3s 后重试一次（并发环境约定）")
                for rel, when in ctx.mtimes(WATCH.get(check["name"], [])).items():
                    print(f"          相关 mtime：{rel} = {when}")
                time.sleep(3.0)
                status2, note2, cmd2, seconds2, path2 = run_one(ctx, check, attempt=2)
                attempts.append(("第2次", status2, path2))
                retry_note = (f"首次 FAIL（{path1.name}）→ 重试 "
                              f"{'PASS' if status2 == 'PASS' else '仍 FAIL'}（{path2.name}）")
                final_path = path2
                status, note, cmd, seconds = status2, note2, cmd2, seconds + seconds2
            out_path = finalize_output(ctx, check, attempts, final_path, status)
            rows.append(Row(check["name"], check["group"], check["what"], status, seconds,
                            cmd, out_path.relative_to(ROOT).as_posix(), note, retry_note,
                            ctx.mtimes(WATCH.get(check["name"], []))))
            print(f"  [{status}] {check['name']}（{seconds:.1f}s）{note}")
            if status == "SKIP":
                print(f"      SKIP 原因：{note}")
    finally:
        cleanup_messages = ctx.cleanup()

    # ---- 结果表 ----
    headers = ["项目", "结果", "耗时", "命令（截断）", "原始输出路径"]
    widths = [26, 6, 8, 62, 54]
    print()
    print("┌" + "─" * (sum(widths) + 4 * len(widths) - 1) + "┐")
    print("│ " + " │ ".join(pad(h, w) for h, w in zip(headers, widths)) + " │")
    print("├" + "─" * (sum(widths) + 4 * len(widths) - 1) + "┤")
    for row in rows:
        cells = [truncate(row.name, widths[0]), row.status, f"{row.seconds:.1f}s",
                 truncate(row.cmd, widths[3]), truncate(row.out_path, widths[4])]
        print("│ " + " │ ".join(pad(c, w) for c, w in zip(cells, widths)) + " │")
    print("└" + "─" * (sum(widths) + 4 * len(widths) - 1) + "┘")

    fails = [r for r in rows if r.status == "FAIL"]
    skips = [r for r in rows if r.status == "SKIP"]
    passes = [r for r in rows if r.status == "PASS"]

    if any(r.retry_note for r in rows):
        print("\n重试记录（并发环境：测试偶发失败先看 mtime，再重试一次）")
        for row in rows:
            if row.retry_note:
                print(f"  · {row.name}：{row.retry_note}")
                for rel, when in row.mtimes.items():
                    print(f"      相关文件 mtime：{rel} = {when}")

    if ctx.notes:
        print("\n运行环境说明")
        for note in ctx.notes:
            print(f"  · {note}")

    if cleanup_messages:
        print("\n临时进程清理")
        for message in cleanup_messages:
            print(f"  · {message}")

    if skips:
        print("\nSKIP 及原因（未跑 ≠ 通过）")
        for row in skips:
            print(f"  · {row.name}：{row.note}")

    if fails:
        print("\nFAIL 明细（真实缺陷，不是本工具故障；原始输出已完整落盘）")
        for row in fails:
            gap = KNOWN_GAPS.get(row.name)
            print(f"  · {row.name}：{row.note}")
            print(f"      原始输出：{row.out_path}")
            if gap:
                print(f"      {gap}")

    summary = {"timestamp": now_cn().isoformat(), "tier": "full" if args.full else "fast",
               "run_dir": run_dir.relative_to(ROOT).as_posix(),
               "python": platform.python_version(), "node": shutil.which("node"),
               "docker": ctx.docker, "head": git_head(),
               "passed": len(passes), "failed": len(fails), "skipped": len(skips),
               "model_calls": 0, "notes": ctx.notes,
               "rows": [{"name": r.name, "group": r.group, "what": r.what, "status": r.status,
                         "seconds": round(r.seconds, 3), "command": r.cmd,
                         "raw_output": r.out_path, "note": r.note, "retry": r.retry_note,
                         "related_mtimes": r.mtimes} for r in rows]}
    (run_dir / "commands.txt").write_text(
        "# 本次实际执行的完整命令（结果表里因排版被截断，这里给全文）\n"
        + "\n".join(f"[{r.status}] {r.name}: {r.cmd}" for r in rows) + "\n", encoding="utf-8")
    (run_dir / "results.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (run_dir / "environment.json").write_text(json.dumps({
        "timestamp": now_cn().isoformat(), "platform": platform.platform(),
        "python": platform.python_version(), "node": node_version(ctx),
        "docker": docker_version(ctx), "git_head": git_head(),
        "ports_in_use": {str(p): port_open(p) for p in (8000, 8787, 8791, 8792, 8799, 9333)},
        "sources_sha256": {"validator/rules.py": sha256_file(ROOT / "validator/rules.py"),
                           "web/server/checker.mjs": sha256_or_none(ROOT / "web/server/checker.mjs"),
                           "tools/verify_all.py": sha256_file(Path(__file__))},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"\n结果：PASS {len(passes)}｜FAIL {len(fails)}｜SKIP {len(skips)}"
          f"；零模型调用；归档 {summary['run_dir']}")
    if fails:
        print("存在 FAIL —— 对外声明里有未达标项，详见上表与 "
              "docs/verification/复核指南-2026-10-31.md。")
    return 1 if fails else 0


def git_head():
    try:
        proc = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(ROOT),
                              capture_output=True, text=True, timeout=20)
        return proc.stdout.strip() or "unknown"
    except Exception:
        return "unavailable"


def node_version(ctx: Ctx):
    code, text = ctx.execute(ctx.node("-v"), 30)
    return text.strip() if code == 0 else "unavailable"


def docker_version(ctx: Ctx):
    if not ctx.docker:
        return None
    code, text = ctx.execute([ctx.docker, "version", "--format",
                              "client={{.Client.Version}} server={{.Server.Version}}"], 60)
    return text.strip() if code == 0 else text.strip()[:200]


def sha256_or_none(path: Path):
    return sha256_file(path) if path.is_file() else None


if __name__ == "__main__":
    raise SystemExit(main())
