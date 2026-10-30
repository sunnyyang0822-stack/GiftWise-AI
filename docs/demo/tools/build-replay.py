"""把离线快照内联进单文件回放页（file:// 直接可开，无 fetch、无 CDN、无网络）。

为什么必须内联：Chrome 对 `file://` 页面的 fetch/XHR 到同目录 JSON 会按 CORS 拒绝，
现场用「双击打开 HTML」的方式就会白屏。内联是唯一稳的做法。

运行：python docs/demo/tools/build-replay.py
产物：docs/demo/replay/offline-replay.html
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / "docs" / "demo" / "tools" / "replay-template.html"
SNAP = ROOT / "docs" / "demo" / "snapshot" / "demo-snapshot.json"
OUT = ROOT / "docs" / "demo" / "replay" / "offline-replay.html"
SHANGHAI = timezone(timedelta(hours=8))


def main() -> int:
    snap = json.loads(SNAP.read_text(encoding="utf-8"))
    tpl = TEMPLATE.read_text(encoding="utf-8")

    # 防止 </script> 提前闭合 + 保证任意字符安全
    payload = json.dumps(snap, ensure_ascii=False)
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")

    if "__SNAPSHOT_JSON__" not in tpl:
        print("模板缺少 __SNAPSHOT_JSON__ 占位符", file=sys.stderr)
        return 1

    html = tpl.replace("__SNAPSHOT_JSON__", payload)
    html = html.replace(
        "<title>GiftWise AI · 离线兜底回放（演示备份）</title>",
        f"<title>GiftWise AI · 离线兜底回放（演示备份）· {snap['built_at'][:16]}</title>",
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")

    print(f"写出 {OUT.relative_to(ROOT)}  ({OUT.stat().st_size/1024:.1f} KiB)")
    print(f"内联块数：{snap['counts']}")
    print(f"外部依赖：0（无 CDN / 无字体 / 无图片 / 无 fetch）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
