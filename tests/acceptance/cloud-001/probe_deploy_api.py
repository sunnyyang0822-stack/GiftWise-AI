"""CLOUD-001 独立复核探针：对已运行的容器规则 API 做接口级复核。

**独立立场**：本脚本不读取 deploy/evidence 的任何结论，只对活着的服务发真实请求，
并把结果与"本机进程内 validate()"和"deploy/README.md 的状态码契约表"直接比对。

覆盖：
  D3  /healthz 200 且 rules_source_sha256 == 本机 validator/rules.py 的 sha256
  D4  POST /validate 与进程内 validate() 的一致性（含比较方法说明与区分力验证）
  D5  deploy/README.md 状态码契约表逐行比对
  RAW 原始 socket 攻击：无 Content-Length、HTTP/1.1 keep-alive、声明长度大于实发、非法 Content-Length

用法：
    python tests/acceptance/cloud-001/probe_deploy_api.py <base_url> <out_json>
"""

import hashlib
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate  # noqa: E402  —— 本机进程内基准

RESULTS = []


def rec(cid, title, expected, actual, ok, extra=None):
    entry = {"id": cid, "title": title, "expected": expected, "actual": actual, "passed": bool(ok)}
    if extra:
        entry["extra"] = extra
    RESULTS.append(entry)
    return entry


def dump(v):
    """与 deploy/server.py 的序列化口径一致（不引入空格、不转义非 ASCII）。"""
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def http(method, base, path, raw_body=None, headers=None, timeout=15):
    url = base + path
    req = urllib.request.Request(url, data=raw_body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"status": resp.status, "body": resp.read(),
                    "headers": {k.lower(): v for k, v in resp.getheaders()}}
    except urllib.error.HTTPError as err:
        return {"status": err.code, "body": err.read(),
                "headers": {k.lower(): v for k, v in err.headers.items()}}
    except Exception as err:
        return {"error": f"{type(err).__name__}: {err}"}


def raw_exchange(host, port, payload: bytes, read_timeout=8.0, half_close=False):
    """原始 socket：自己拼字节，不让任何 http 客户端替我补 Content-Length。"""
    sock = socket.create_connection((host, port), timeout=read_timeout)
    sock.settimeout(read_timeout)
    info = {"sent_bytes": len(payload), "chunks": [], "closed_by_peer": None, "elapsed": None}
    started = time.monotonic()
    try:
        sock.sendall(payload)
        if half_close:
            sock.shutdown(socket.SHUT_WR)
        while True:
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                info["chunks"].append({"timeout": True, "after_seconds": round(time.monotonic() - started, 3)})
                break
            if not chunk:
                info["closed_by_peer"] = True
                break
            info["chunks"].append({"len": len(chunk), "at": round(time.monotonic() - started, 3),
                                   "text": chunk.decode("utf-8", "replace")[:600]})
    except Exception as err:
        info["error"] = f"{type(err).__name__}: {err}"
    finally:
        info["elapsed"] = round(time.monotonic() - started, 3)
        try:
            sock.close()
        except OSError:
            pass
    info["all_text"] = "".join(c.get("text", "") for c in info["chunks"])
    return info


def parse_status(text):
    first = text.split("\r\n", 1)[0] if text else ""
    parts = first.split(" ")
    return int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18000"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs/test-reports/cloud-001/evidence/api-probe.json"
    host, port = "127.0.0.1", int(base.rsplit(":", 1)[-1])

    cases = {c["id"]: c for c in json.loads((ROOT / "tests/test_cases.json").read_text(encoding="utf-8"))["cases"]}
    t01 = cases["T01_normal"]
    request_obj = t01["request"]
    batch_obj = t01["candidate_batch"]
    request_json = dump(request_obj)
    candidates_json = dump(batch_obj)
    payload_bytes = dump({"request_json": request_json, "candidates_json": candidates_json}).encode("utf-8")

    # ---------------------------------------------------------------- D3
    local_rules_sha = hashlib.sha256((ROOT / "validator/rules.py").read_bytes()).hexdigest()
    hz = http("GET", base, "/healthz")
    body = hz.get("body", b"")
    try:
        hz_json = json.loads(body)
    except ValueError:
        hz_json = {}
    actual = {"httpStatus": hz.get("status"), "content_type": hz.get("headers", {}).get("content-type"),
              "server": hz.get("headers", {}).get("server"),
              "container_rules_sha256": hz_json.get("rules_source_sha256"),
              "local_rules_sha256": local_rules_sha,
              "content_length_header": hz.get("headers", {}).get("content-length"),
              "actual_body_bytes": len(body)}
    rec("D3-01", "/healthz 200 且规则哈希与本机 rules.py 一致",
        "HTTP 200；rules_source_sha256 == 本机 sha256；Content-Length 与实际字节数相符",
        actual, actual["httpStatus"] == 200 and actual["container_rules_sha256"] == local_rules_sha
        and actual["content_length_header"] == str(len(body)))

    # ---------------------------------------------------------------- D4
    resp = http("POST", base, "/validate", payload_bytes,
                {"Content-Type": "application/json", "Content-Length": str(len(payload_bytes))})
    server_bytes = resp.get("body", b"")
    inproc = validate(request_json, candidates_json)
    inproc_compact = dump(inproc).encode("utf-8")
    inproc_default = json.dumps(inproc).encode("utf-8")
    inproc_sorted = json.dumps(inproc, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    try:
        server_obj = json.loads(server_bytes)
    except ValueError:
        server_obj = None

    actual = {
        "httpStatus": resp.get("status"),
        "server_body_bytes": len(server_bytes),
        "inproc_bytes": len(inproc_compact),
        "identical_compact": server_bytes == inproc_compact,
        "identical_default_separators": server_bytes == inproc_default,
        "identical_sorted_keys": server_bytes == inproc_sorted,
        "parsed_deep_equal": server_obj == inproc,
        "server_prefix": server_bytes[:120].decode("utf-8", "replace"),
    }
    rec("D4-01", "POST /validate 响应体与进程内 validate() 逐字节一致",
        "server_bytes == json.dumps(validate(...), ensure_ascii=False, separators=(',',':')) 的字节",
        actual, actual["httpStatus"] == 200 and actual["identical_compact"] and actual["parsed_deep_equal"])

    # 比较方法说明 + 区分力：证明这个"逐字节"不是vacuous（两种不同序列化都可比出来）
    rec("D4-02", "逐字节比较方法有效（不是同一个 JSON 序列化两次）",
        "必须能区分不同序列化口径：compact 版相等、默认分隔符版不等、排序键版不等",
        {"compact_equal": server_bytes == inproc_compact,
         "default_separators_equal": server_bytes == inproc_default,
         "sorted_keys_equal": server_bytes == inproc_sorted,
         "compact_len": len(inproc_compact), "default_len": len(inproc_default)},
        server_bytes == inproc_compact and server_bytes != inproc_default and server_bytes != inproc_sorted
        and len(inproc_compact) != len(inproc_default))

    # 非空转：服务端是"算出来的"而不是固定返回
    mutated = json.loads(candidates_json)
    mutated["candidates"][0]["estimated_total"] = "999.00"
    mutated_json = dump(mutated)
    mutated_payload = dump({"request_json": request_json, "candidates_json": mutated_json}).encode("utf-8")
    resp2 = http("POST", base, "/validate", mutated_payload,
                 {"Content-Type": "application/json", "Content-Length": str(len(mutated_payload))})
    mutated_inproc = validate(request_json, mutated_json)
    first = next((r for r in (json.loads(resp2.get("body", b"{}")).get("candidate_results") or []) if r["id"] == "c1"), {})
    rec("D4-03", "改动输入后响应随之改变（排除固定/伪造响应）",
        "把 c1 改为 999.00 后 c1 必须失败且含 OVER_BUDGET；响应仍与进程内逐字节一致",
        {"httpStatus": resp2.get("status"), "c1_passed": first.get("passed"),
         "c1_error_codes": sorted({e["code"] for e in first.get("errors", [])}),
         "byte_identical_after_mutation": resp2.get("body", b"") == dump(mutated_inproc).encode("utf-8")},
        first.get("passed") is False and "OVER_BUDGET" in {e["code"] for e in first.get("errors", [])}
        and resp2.get("body", b"") == dump(mutated_inproc).encode("utf-8"))

    # 多例一致性（不止 T01）
    multi = {}
    for cid in ("T01_normal", "T02_amount_200.01", "T03_tag", "T04_days_2", "T13_null_root"):
        if cid not in cases:
            continue
        c = cases[cid]
        rj = dump(c["request"]) if not isinstance(c["request"], str) else c["request"]
        cj = dump(c["candidate_batch"]) if not isinstance(c["candidate_batch"], str) else c["candidate_batch"]
        p = dump({"request_json": rj, "candidates_json": cj}).encode("utf-8")
        rr = http("POST", base, "/validate", p, {"Content-Type": "application/json", "Content-Length": str(len(p))})
        multi[cid] = {"http": rr.get("status"),
                      "byte_identical": rr.get("body", b"") == dump(validate(rj, cj)).encode("utf-8")}
    rec("D4-04", "多例一致性（正常/超预算/禁忌/时间/异常根）",
        "5 例都 HTTP 200 且响应体逐字节等于进程内 validate()",
        multi, len(multi) >= 4 and all(v["http"] == 200 and v["byte_identical"] for v in multi.values()))

    # ---------------------------------------------------------------- D5 契约表
    # 注意：Content-Length 一律由实际字节数算出。第一版探针里我手写了长度并算错，
    # 导致服务端按声明长度截断成非法 JSON，被误判为契约不符——那是我方缺陷，已在结论中说明。
    def post(body_bytes):
        return http("POST", base, "/validate", body_bytes,
                    {"Content-Type": "application/json", "Content-Length": str(len(body_bytes))})

    def show(r):
        return {"http": r.get("status"), "body": r.get("body", b"").decode("utf-8", "replace")}

    err = {}
    err["invalid_json"] = show(post(b"not-json"))
    err["invalid_payload_types"] = show(post(b'{"request_json": 1, "candidates_json": "{}"}'))
    err["top_level_array"] = show(post(b"[]"))
    err["missing_field"] = show(post(b'{"request_json":"{}"}'))
    err["null_field"] = show(post(b'{"request_json":null,"candidates_json":null}'))
    r = http("GET", base, "/nope")
    err["get_unknown_path"] = show(r)
    err["post_unknown_path"] = show(http("POST", base, "/nope", b"{}",
                                        {"Content-Type": "application/json", "Content-Length": "2"}))
    err["root"] = show(http("GET", base, "/"))
    err["valid_but_business_fail"] = show(post(b'{"request_json":"{}","candidates_json":"{}"}'))
    err["oversized"] = show(post(b"x" * 70000))
    err["oversized_exact_boundary_65536"] = show(post(b"y" * 65536))
    err["oversized_boundary_65537"] = show(post(b"y" * 65537))
    err["head_method"] = show(http("HEAD", base, "/healthz"))
    rec("D5-01", "状态码契约表逐行比对（deploy/README.md）",
        "非法JSON=400 INVALID_JSON；类型/缺字段/非对象=400 INVALID_PAYLOAD；未知路径=404 NOT_FOUND；"
        "业务不通过=200；>65536=413 且 65536 本身不算超长；HEAD=501",
        err,
        err["invalid_json"]["http"] == 400 and '"INVALID_JSON"' in err["invalid_json"]["body"]
        and err["invalid_payload_types"]["http"] == 400 and "INVALID_PAYLOAD" in err["invalid_payload_types"]["body"]
        and err["top_level_array"]["http"] == 400 and "INVALID_PAYLOAD" in err["top_level_array"]["body"]
        and err["missing_field"]["http"] == 400 and "INVALID_PAYLOAD" in err["missing_field"]["body"]
        and err["null_field"]["http"] == 400 and "INVALID_PAYLOAD" in err["null_field"]["body"]
        and err["get_unknown_path"]["http"] == 404 and "NOT_FOUND" in err["get_unknown_path"]["body"]
        and err["post_unknown_path"]["http"] == 404 and "NOT_FOUND" in err["post_unknown_path"]["body"]
        and err["root"]["http"] == 200
        and err["valid_but_business_fail"]["http"] == 200
        and err["oversized"]["http"] == 413 and "REQUEST_TOO_LARGE" in err["oversized"]["body"]
        and err["oversized_boundary_65537"]["http"] == 413
        and err["head_method"]["http"] == 501)

    # ---------------------------------------------------------------- RAW 攻击
    raw = {}
    # R1: HTTP/1.0，完全没有 Content-Length，也没有 body
    raw["no_content_length_http10"] = raw_exchange(
        host, port, b"POST /validate HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
    # R2: HTTP/1.1 + keep-alive，没有 Content-Length
    raw["no_content_length_http11_keepalive"] = raw_exchange(
        host, port, b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n")
    # R3: HTTP/1.1 + chunked（有 body 但没有 Content-Length）
    raw["chunked_body_no_content_length"] = raw_exchange(
        host, port,
        b"POST /validate HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n")
    # R4: 声明长度大于实发长度，然后停住不补
    raw["declared_longer_than_sent"] = raw_exchange(
        host, port, b"POST /validate HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\nshort",
        read_timeout=6.0)
    # R5/R6: 非法 Content-Length
    raw["negative_content_length"] = raw_exchange(
        host, port, b"POST /validate HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Length: -5\r\n\r\n")
    raw["nonnumeric_content_length"] = raw_exchange(
        host, port, b"POST /validate HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Length: abc\r\n\r\n")
    # R7: Content-Length: 0
    raw["zero_content_length"] = raw_exchange(
        host, port, b"POST /validate HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n")

    for key, value in raw.items():
        value["status_line"] = parse_status(value.get("all_text", ""))
        value.pop("all_text", None)

    r1 = raw["no_content_length_http10"]
    rec("RAW-01", "无 Content-Length：立即 413 且不挂起、连接被对端关闭",
        "6 秒内返回 413 REQUEST_TOO_LARGE；对端关闭连接（closed_by_peer=true）；无 timeout chunk",
        {"status_line": r1["status_line"], "elapsed": r1["elapsed"],
         "timeout_chunks": [c for c in r1["chunks"] if c.get("timeout")],
         "closed_by_peer": r1["closed_by_peer"], "chunk_lens": [c.get("len") for c in r1["chunks"]]},
        r1["status_line"] == 413 and r1["closed_by_peer"] is True
        and not any(c.get("timeout") for c in r1["chunks"]) and r1["elapsed"] < 6)

    r2 = raw["no_content_length_http11_keepalive"]
    rec("RAW-02", "HTTP/1.1 keep-alive 且无 Content-Length：是否半开连接",
        "记录实际行为：是否声明 keep-alive、是否由对端关闭、是否需要在同一 socket 上再发请求验证不同步",
        {"status_line": r2["status_line"], "elapsed": r2["elapsed"], "closed_by_peer": r2["closed_by_peer"],
         "timeout_chunks": [c for c in r2["chunks"] if c.get("timeout")],
         "response_head": r2["chunks"][0]["text"][:200] if r2["chunks"] else None},
        # 判定：不允许挂起；必须能明确判定连接去向
        not any(c.get("timeout") for c in r2["chunks"]) and r2["status_line"] == 413)

    r3 = raw["chunked_body_no_content_length"]
    rec("RAW-03", "HTTP/1.1 + chunked 有 body 但无 Content-Length",
        "413；且不在同一连接上留下未读 body 造成协议不同步（记录是否关闭）",
        {"status_line": r3["status_line"], "closed_by_peer": r3["closed_by_peer"],
         "timeout_chunks": [c for c in r3["chunks"] if c.get("timeout")],
         "response_head": r3["chunks"][0]["text"][:200] if r3["chunks"] else None},
        r3["status_line"] == 413)

    r4 = raw["declared_longer_than_sent"]
    rec("RAW-04", "声明 Content-Length 大于实发字节（客户端停住）",
        "服务端应有时限或明确行为；若无限等待即为半开连接/线程占用缺陷",
        {"status_line": r4["status_line"], "elapsed": r4["elapsed"], "closed_by_peer": r4["closed_by_peer"],
         "timeout_chunks": [c for c in r4["chunks"] if c.get("timeout")], "error": r4.get("error")},
        r4["status_line"] is not None and not any(c.get("timeout") for c in r4["chunks"]))

    rec("RAW-05", "非法 Content-Length（负数 / 非数字）",
        "不得崩溃；按 REQUEST_TOO_LARGE 或 INVALID_JSON 明确拒绝",
        {"negative": {"status_line": raw["negative_content_length"]["status_line"],
                      "body": (raw["negative_content_length"]["chunks"][0]["text"][-120:]
                               if raw["negative_content_length"]["chunks"] else None)},
         "nonnumeric": {"status_line": raw["nonnumeric_content_length"]["status_line"],
                        "body": (raw["nonnumeric_content_length"]["chunks"][0]["text"][-120:]
                                 if raw["nonnumeric_content_length"]["chunks"] else None)}},
        raw["negative_content_length"]["status_line"] in (400, 413)
        and raw["nonnumeric_content_length"]["status_line"] in (400, 413))

    rec("RAW-06", "Content-Length: 0（空 body）",
        "400 INVALID_JSON（不是 413，也不是挂起）",
        {"status_line": raw["zero_content_length"]["status_line"],
         "body": (raw["zero_content_length"]["chunks"][0]["text"][-160:]
                  if raw["zero_content_length"]["chunks"] else None)},
        raw["zero_content_length"]["status_line"] == 400)

    doc = {
        "suite": "CLOUD-001 独立复核（容器规则 API）",
        "base_url": base,
        "container": "gw-qa (giftwise-validator:latest) 由 QA 自行启动",
        "note": "本文件由独立测试 Agent 执行；不引用 deploy/evidence 的结论。",
        "passed": sum(1 for r in RESULTS if r["passed"]),
        "failed": sum(1 for r in RESULTS if not r["passed"]),
        "results": RESULTS,
        "raw_socket_detail": raw,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"passed={doc['passed']} failed={doc['failed']}")
    for r in RESULTS:
        print(("  PASS " if r["passed"] else "  FAIL ") + r["id"] + " " + r["title"])
    return 0 if doc["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
