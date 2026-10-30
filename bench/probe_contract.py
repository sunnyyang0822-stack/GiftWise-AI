# -*- coding: utf-8 -*-
"""性能线：契约实测（不猜，全部实测）。

用途：确认 GET /healthz、POST /validate、GET /metrics 的真实行为与响应形状，
并找出一个**合法的** request_json / candidates_json 样本对，供后续压测复用。
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18901"


def req(method, path, body=None, headers=None, timeout=10):
    h = dict(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}", {}


print(f"== 目标 {BASE} ==")
print("GET  /        ->", req("GET", "/")[:2])
st, body, _ = req("GET", "/healthz")
print("GET  /healthz ->", st, body)
st, body, _ = req("GET", "/metrics")
print("GET  /metrics ->", st, body[:120])

# 找合法样本
fx_path = Path(".tmp/web-parity/fixtures.json")
if not fx_path.exists():
    print("!! 找不到 .tmp/web-parity/fixtures.json，改用其它样本源")
    sys.exit(0)

fx = json.loads(fx_path.read_text(encoding="utf-8"))
print("\n== fixtures 结构 ==")
for k, v in fx.items():
    if isinstance(v, str):
        print(f"  {k}: str len={len(v)}")
    elif isinstance(v, list):
        print(f"  {k}: list n={len(v)}  first_type={type(v[0]).__name__ if v else '-'}")
    else:
        print(f"  {k}: {type(v).__name__}")

rj = fx["request_json"]
print("\n  request_json[:160] =", rj[:160])

batches = fx.get("candidate_batches") or []
if batches:
    b0 = batches[0]
    print("  candidate_batches[0] type:", type(b0).__name__)
    if isinstance(b0, dict):
        print("  keys:", list(b0.keys()))
        cands = b0.get("candidates")
    else:
        cands = b0
    if isinstance(cands, list):
        print("  candidates n =", len(cands))
        print("  candidates[0] keys:", list(cands[0].keys()) if isinstance(cands[0], dict) else type(cands[0]).__name__)

    # 尝试合法 POST
    cj = json.dumps(cands, ensure_ascii=False)
    st, body, _ = req("POST", "/validate", {"request_json": rj, "candidates_json": cj})
    print("\n== POST /validate（合法样本）==")
    print("  status:", st)
    try:
        parsed = json.loads(body)
        print("  top-level keys:", list(parsed.keys()))
        print("  status field:", parsed.get("status"))
        print("  passed:", parsed.get("passed"), " all_passed:", parsed.get("all_passed"))
        print("  response 字节数:", len(body))
        Path("bench/_sample_request.json").write_text(rj, encoding="utf-8")
        Path("bench/_sample_candidates.json").write_text(cj, encoding="utf-8")
        print("  已保存 bench/_sample_request.json / bench/_sample_candidates.json")
    except Exception:
        print("  body[:300]:", body[:300])

# 错误路径（供压测/健壮性参考）
print("\n== 错误路径 ==")
print("  POST /validate {} ->", req("POST", "/validate", {})[:2])
print("  POST /validate 非字符串 ->", req("POST", "/validate", {"request_json": {}, "candidates_json": "[]"})[:2])
print("  GET  /nope ->", req("GET", "/nope")[:2])
print("  POST /nope ->", req("POST", "/nope", {})[:2])
