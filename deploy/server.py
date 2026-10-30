"""GiftWise 最小规则 API。

只暴露确定性校验，不保存请求、不调用模型、不访问外部网络。
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from validator.rules import validate


MAX_BODY_BYTES = 64 * 1024

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
        print("%s - %s" % (self.address_string(), fmt % args))


def main() -> None:
    host = os.environ.get("GIFTWISE_BIND", "0.0.0.0")
    port = int(os.environ.get("GIFTWISE_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"giftwise-validator listening on {host}:{port}; rules={RULES_HASH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
