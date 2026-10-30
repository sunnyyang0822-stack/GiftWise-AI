"""渲染赛道 B 架构图（可编辑源 → 1680×1170 PNG）。

用法（一条命令，仓库根目录下执行）：

    python docs/architecture/diagram-src/render_competition_diagram.py

做什么：
  1. 找到本机 Chrome（headless）；
  2. 把 diagram-src/system-architecture-competition.html 渲染成
     rendered/system-architecture-competition.png，窗口 1680×1170；
  3. **校验产物**：读 PNG 的 IHDR 核对像素尺寸必须正好 1680×1170，并打印 sha256 与字节数。

为什么自己解析 PNG：只依赖 Python 标准库（struct/hashlib），评审换台机器也能跑，
不会因为缺 Pillow 而失败。

退出码：0 = 渲染且尺寸校验通过；1 = 找不到 Chrome / 渲染失败；2 = 尺寸不符（会删掉不合格产物）。
图片尺寸由 Chrome 的 --window-size 决定，HTML 里 html/body 固定 1680×1170 且 overflow:hidden，
所以截图尺寸稳定；任何"内容溢出被截断"都会在人工看图时发现。
"""
from __future__ import annotations

import hashlib
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import pathlib

WIDTH, HEIGHT = 1680, 1170
HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
SOURCE = HERE / "system-architecture-competition.html"
OUTPUT = REPO / "docs" / "architecture" / "rendered" / "system-architecture-competition.png"

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome() -> str | None:
    for c in CHROME_CANDIDATES:
        if c and pathlib.Path(c).exists():
            return c
    for name in ("chrome", "google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    return None


def png_size(path: pathlib.Path) -> tuple[int, int]:
    """解析 PNG IHDR，返回 (width, height)；不依赖第三方库。"""
    with path.open("rb") as fh:
        head = fh.read(24)
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("不是合法的 PNG")
    width, height = struct.unpack(">II", head[16:24])
    return width, height


def main() -> int:
    if not SOURCE.exists():
        print(f"[FAIL] 找不到源文件：{SOURCE}")
        return 1
    chrome = find_chrome()
    if not chrome:
        print("[FAIL] 找不到 Chrome。请安装 Chrome，或把可执行文件路径加到 CHROME_CANDIDATES。")
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    # Chrome 需要独立的 user-data-dir，避免与本机已运行的 Chrome 抢 profile。
    # 用系统临时目录（脚本结束即删），不在仓库里留任何中间文件。
    profile = tempfile.mkdtemp(prefix="gw-diagram-chrome-")
    url = SOURCE.as_uri()
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        f"--user-data-dir={profile}",
        f"--window-size={WIDTH},{HEIGHT}",
        "--virtual-time-budget=4000",
        f"--screenshot={OUTPUT.as_posix()}",
        url,
    ]
    print("[chrome]", chrome)
    print("[source]", SOURCE)
    print("[out]   ", OUTPUT)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if proc.returncode != 0:
        print("[stderr]", (proc.stderr or "")[-1500:])
        print(f"[FAIL] Chrome 退出码 {proc.returncode}")
        return 1
    if not OUTPUT.exists():
        print("[stderr]", (proc.stderr or "")[-1500:])
        print("[FAIL] Chrome 未产出截图")
        return 1

    data = OUTPUT.read_bytes()
    width, height = png_size(OUTPUT)
    digest = hashlib.sha256(data).hexdigest()
    print("\n===== 产物 =====")
    print("路径：", OUTPUT.relative_to(REPO).as_posix())
    print("尺寸：", f"{width}x{height}", "(期望 1680x1170)")
    print("字节：", len(data))
    print("SHA256：", digest)

    if (width, height) != (WIDTH, HEIGHT):
        print(f"\n[FAIL] 尺寸不符：得到 {width}x{height}，期望 {WIDTH}x{HEIGHT}。已删除不合格产物。")
        OUTPUT.unlink()
        return 2
    print("\n[PASS] 尺寸校验通过：1680x1170")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
