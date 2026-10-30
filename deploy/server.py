"""GiftWise 最小规则 API。

只暴露确定性校验，不保存请求、不调用模型、不访问外部网络。
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from validator.rules import validate


MAX_BODY_BYTES = 64 * 1024

#: 缺陷 N-4（2026-10-31）的修复点：并发下日志会**粘连**成一行。
#: 根因是裸 `print()` 分两次写（先写正文、再写换行），两次写之间可被其他线程插入；
#: 容器里 60 并发后实测 `docker logs` 51 行中有 9 行粘连（如 `…400 -172.17.0.1 - "GET /nope-3 …" 404 -`）。
#: 修法：所有日志走**同一把锁** + **一次 `write()` 写完整行（含换行）** + 立即 flush。
_LOG_LOCK = threading.Lock()


def _log_line(text: str) -> None:
    """整行原子写出：一行 = 一次 write，且全程持锁（见 N-4 说明）。"""
    with _LOG_LOCK:
        sys.stdout.write(text + "\n")
        sys.stdout.flush()

#: 单连接上任何一次 socket 读/写的等待上限（秒），也是读取正文的【总预算】。
#: 缺陷 I-2（= 安全自查 S-5）的修复点：没有它时，声明 `Content-Length: 100` 却只发 5 字节
#: 的连接会永久占用一个线程（实测 45 秒零响应、连接永不关闭，9 条连接使线程数 +9 且不回收）。
#: 可用 GIFTWISE_READ_TIMEOUT 覆盖；设为 0 或负数会在启动时直接报错（不允许回到无限等待）。
READ_TIMEOUT_SECONDS = float(os.environ.get("GIFTWISE_READ_TIMEOUT", "10") or "10")
if READ_TIMEOUT_SECONDS <= 0:
    raise RuntimeError("GIFTWISE_READ_TIMEOUT must be > 0")
RULES_HASH = hashlib.sha256(
    Path(__file__).resolve().parents[1].joinpath("validator", "rules.py").read_bytes()
).hexdigest()


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "GiftWiseValidator/0.1"
    #: socketserver.StreamRequestHandler.setup() 读这个属性并给连接 settimeout()，
    #: 因此请求行、请求头、正文的读取都不再无限等待（超时会抛 TimeoutError）。
    timeout = READ_TIMEOUT_SECONDS

    def _read_body(self, size: int) -> bytes:
        """在总预算内读取声明长度的正文；超预算抛 TimeoutError，绝不无限挂起。

        单次 recv 与整体预算都受 READ_TIMEOUT_SECONDS 约束，因此"只发几个字节后静默"
        与"每 9 秒发 1 字节"这两种拖时间的方式都会被同一个上限截断。
        对端提前关闭时返回已读到的较短内容（短读），由调用方按既有错误路径处理。
        """
        deadline = time.monotonic() + READ_TIMEOUT_SECONDS
        chunks: list[bytes] = []
        remaining = size
        while remaining > 0:
            budget = deadline - time.monotonic()
            if budget <= 0:
                raise TimeoutError("body read budget exceeded")
            self.connection.settimeout(min(READ_TIMEOUT_SECONDS, budget))
            chunk = self.rfile.read1(remaining)
            if not chunk:
                break  # 对端关闭：短读
            chunks.append(chunk)
            remaining -= len(chunk)
        # 正文读完后把额度恢复为完整值：否则"最后一刻才读完"的连接会带着几毫秒的残余预算去写响应，
        # 可能把明明正常的响应掐掉（408 路径已在 _send_request_timeout 里做了同样的事）。
        self.connection.settimeout(READ_TIMEOUT_SECONDS)
        return b"".join(chunks)

    def _send_request_timeout(self) -> None:
        """正文没读完就超时：返回 408 并关闭连接（不回显已读到的任何字节）。"""
        self.close_connection = True
        try:
            self.connection.settimeout(READ_TIMEOUT_SECONDS)
        except OSError:
            pass
        try:
            self._send(HTTPStatus.REQUEST_TIMEOUT, {"error": "REQUEST_TIMEOUT"})
        except OSError:
            pass

    def _send(self, status: int, value: object) -> None:
        body = _json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._send(HTTPStatus.OK, {"status": "ok", "service": "giftwise-validator", "rules_source_sha256": RULES_HASH})
            return
        if self.path == "/":
            self._send(HTTPStatus.OK, {"service": "giftwise-validator", "endpoints": ["GET /healthz", "POST /validate"]})
            return
        self._send(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/validate":
            self._send(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})
            return
        try:
            size = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            size = -1
        if size < 0 or size > MAX_BODY_BYTES:
            self._send(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "REQUEST_TOO_LARGE"})
            return
        try:
            payload = json.loads(self._read_body(size))
        except TimeoutError:
            # I-2/S-5：正文没读完就超时 —— 明确给出 408 并关闭连接，不再挂在 rfile.read 上。
            self._send_request_timeout()
            return
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send(HTTPStatus.BAD_REQUEST, {"error": "INVALID_JSON"})
            return
        if not isinstance(payload, dict) or not isinstance(payload.get("request_json"), str) or not isinstance(payload.get("candidates_json"), str):
            self._send(HTTPStatus.BAD_REQUEST, {"error": "INVALID_PAYLOAD", "message": "request_json 和 candidates_json 必须是 JSON 字符串"})
            return
        try:
            result = validate(payload["request_json"], payload["candidates_json"])
        except Exception:
            # 不把堆栈或输入内容返回给调用方。
            self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "INTERNAL_ERROR"})
            return
        self._send(HTTPStatus.OK, result)

    def log_message(self, fmt: str, *args: object) -> None:
        # 只记录方法和路径，避免请求内容进入日志。
        # N-4：不用 print（它会分两次写、并发下粘连），走 _log_line 的加锁整行写。
        _log_line("%s - %s" % (self.address_string(), fmt % args))


class Server(ThreadingHTTPServer):
    """交付服务端：唯一一处改动是把 `listen(2)` 的 backlog 从标准库默认值抬高。

    **优化点 P-1（2026-10-31，性能线用单变量对照定位）**
    `socketserver.TCPServer.request_queue_size` 的默认值是 **5**——基类 `TCPServer` 的
    `server_activate()` 里执行 `self.socket.listen(self.request_queue_size)`，直接用它；
    而容器内 `/proc/sys/net/core/somaxconn = 4096`：**内核给得起 4096，进程只要 5**。
    后果是高并发下连接还没走到 handler 就在**内核 accept 队列**里被丢掉，客户端看到
    `ConnectionReset` / `ConnectionRefused`，而服务端其实完全算得过来
    （规则校验 p50 只有 0.216 ms，见性能报告 §3）。

    性能线单变量对照实测（`docs/performance/性能与容量基准-2026-10-31.md` §6）：
    只动 backlog（5 → 128、日志保持开启）时，c=100 的错误 219 → 0、无错吞吐 566 → 965 rps；
    提到 512（该项日志关）时，c=200 的错误 631 → 0、p95 1,039 → 194 ms。

    ⚠️ **这是"用延迟换错误"的反向操作，不是纯粹变快**：基线把 5.3% 的连接直接拒掉，
    而被拒请求的延迟**不进延迟分布**，所以**基线 p50 反而更低（6.6 ms）、调优后 p50 升到 162 ms**。
    调优后的 p50 才是真实的排队等待，基线的 p50 是"被扔掉的人不算数"。
    提高 backlog **不消灭排队，只把"直接拒绝"换成"排队等待"**。完整解释见
    `docs/performance/调优后复测-2026-10-31.md`（反直觉点专章）。

    **取值 512 的理由（不是拍脑袋）**
    1. **实测最优值中的最大值**：单变量对照只测过 5 / 128 / 512，512 这一档在 c=100 与 c=200 上
       同时取得最好结果。**比 512 更大的值没有任何实测支持**，因此不取（不猜）。
    2. **不超过内核上限**：Linux 的实际 accept 队列长度 = `min(request_queue_size, somaxconn)`，
       512 < 4096，所以本值会被**完整采纳**，不会被内核静默截断。
    3. **与 SYN 队列对齐**：同一容器内 `/proc/sys/net/ipv4/tcp_max_syn_backlog = 512`，
       512 让连接建立两段队列（半连接队列 / accept 队列）的尺寸一致。
    4. **内存有界**：线程模型是**一连接一线程**（实测 1,000 并发 = 989 线程峰值、约 27 KB/连接），
       512 条排队连接最坏约 14 MiB，远低于实测余量（1,000 条并发半开连接只多吃 27 MiB）。
    """

    request_queue_size = 512


def main() -> None:
    host = os.environ.get("GIFTWISE_BIND", "0.0.0.0")
    port = int(os.environ.get("GIFTWISE_PORT", "8000"))
    #: 用本模块的 Server（backlog = 512）；不再直接用标准库 backlog = 5 的 ThreadingHTTPServer。
    server = Server((host, port), Handler)
    _log_line(
        f"giftwise-validator listening on {host}:{port}; "
        f"rules={RULES_HASH}; backlog={Server.request_queue_size}"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
