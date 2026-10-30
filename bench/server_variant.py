#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""瓶颈对照实验用的服务端变体（**只用于测量，不是交付物**）。

为什么需要它
------------
`bench.py ramp` 在 ~400-760 rps 处触顶、p95/p99 爆到 1-4 秒，并出现
`ConnectionResetError` / `ConnectionRefusedError`。要定位瓶颈，必须做**单变量实验**。
本文件复用**交付镜像里同一份 handler**（`deploy.server.Handler`），只改两个可疑变量：

  BENCH_BACKLOG : listen backlog。交付实现用 Python 标准库默认值
                  `request_queue_size = 5`（而容器 somaxconn=4096 完全没被用上）。
  BENCH_NOLOG   : 关掉每请求的同步日志。`deploy/server.py` 的 `log_message`
                  走 `_log_line`，是**每请求一次持锁 stdout 写**——在 500 rps 下这本身就是候选瓶颈。

这样就能把"服务端算得慢"与"连接接不进来 / 日志把线程串起来"分开。

⚠️ 这不是交付物，也不改 `deploy/**`；它只在 127.0.0.1 高位端口上跑测量。
"""
from __future__ import annotations

import os
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from deploy.server import Handler  # noqa: E402

BACKLOG = int(os.environ.get("BENCH_BACKLOG", "128"))
NOLOG = os.environ.get("BENCH_NOLOG", "0") == "1"
PORT = int(os.environ.get("BENCH_PORT", "18903"))


class VariantHandler(Handler):
    """同一个 handler；仅在需要时静音日志。"""

    if NOLOG:  # pragma: no cover - 仅在测量时生效
        def log_message(self, fmt, *args):  # noqa: D102
            return


class VariantServer(ThreadingHTTPServer):
    """同一个服务端；仅改 listen backlog。"""

    request_queue_size = BACKLOG
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    srv = VariantServer(("127.0.0.1", PORT), VariantHandler)
    print(f"[variant] listening 127.0.0.1:{PORT} backlog={BACKLOG} nolog={NOLOG}",
          flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
