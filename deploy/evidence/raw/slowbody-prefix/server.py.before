"""GiftWise 最小规则 API。

只暴露确定性校验，不保存请求、不调用模型、不访问外部网络。
"""

from __future__ import annotations

import hashlib
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from validator.rules import validate


MAX_BODY_BYTES = 64 * 1024
RULES_HASH = hashlib.sha256(
    Path(__file__).resolve().parents[1].joinpath("validator", "rules.py").read_bytes()
).hexdigest()


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "GiftWiseValidator/0.1"

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
            payload = json.loads(self.rfile.read(size))
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
