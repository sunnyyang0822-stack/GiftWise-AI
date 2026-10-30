"""QA-001 容器同步性探针：**运行中的镜像**是否包含请求侧范围校验？

动机：我全部边界测试都是 `import validator.rules`——**测的是工作区源码，不是交付的镜像**。
若镜像早于范围裁决，则"测试全绿"与"部署件行为"会脱节。本探针直接问容器。

做法（全部只读，不重建镜像、不修改任何仓库文件）：
  1. 本地 `validator/rules.py` 字节与 sha256。
  2. `docker exec` 读容器内同一文件（base64 走管道，避免换行翻译），算 sha256 并做统一 diff。
  3. `GET /healthz` 取 `rules_source_sha256`，与**容器内自算**哈希比对，验证该字段口径是否自洽。
  4. `POST /validate` 送越界输入，直接观察**运行中的 API** 是否拒绝。
     （候选金额一律取 "0.00"、准备天数取 0，使"候选超预算/超期"不掩盖"请求本身越界"。）

运行前需容器在跑，例如：
    docker run -d --name gw-sync -p 18099:8000 giftwise-validator:latest
运行：
    python tests/acceptance/boundary/probe_container_sync.py
"""

import base64
import difflib
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONTAINER = "gw-sync"
BASE_URL = "http://127.0.0.1:18099"
OUT_JSON = ROOT / "docs/test-reports/boundary-001/evidence/container-sync.json"

READ_CONTAINER = (
    "import base64,pathlib;"
    "print(base64.b64encode(pathlib.Path('validator/rules.py').read_bytes()).decode())"
)

TMPL = (
    '{"recipient_relation":"\u670b\u53cb","recipient_relation_id":"friend",'
    '"occasion":"\u751f\u65e5","budget_amount":%(b)s,"currency":"CNY","available_days":%(d)s,'
    '"facts":[{"id":"f1","text":"x"}],"forbidden_tags":[],"forbidden_terms":[],"notes":"",'
    '"closeness":"unknown","preference_inferences":[],"gift_styles":[],'
    '"hard_exclusions_original":{"tags":[],"terms":[],"unresolved":[]}}'
)


def request(b='"200.00"', d="3"):
    return TMPL % {"b": b, "d": d}


def _cand(i, name, total, days):
    return ('{"id":"%s","name":"%s","description":"虚构方案说明","estimated_total":"%s",'
            '"currency":"CNY","estimated_preparation_days":%s,"tags":["other"],'
            '"reason":"匹配用户已确认的偏好与预算上限","fact_refs":["f1"],'
            '"inferences":["可能偏好实用礼物"],"unknowns":["实际价格以商家为准"],'
            '"presentation":"简要呈现"}' % (i, name, total, days))


def candidates(total="0.00", days="0"):
    body = ",".join([_cand(f"c{i}", f"候选{i}", total, days) for i in (1, 2, 3)])
    return '{"candidates":[' + body + "]}"


def docker(args, **kw):
    return subprocess.run(["docker", *args], capture_output=True, text=True, encoding="utf-8", **kw)


def post_validate(request_json, candidates_json):
    body = json.dumps({"request_json": request_json, "candidates_json": candidates_json}).encode("utf-8")
    req = urllib.request.Request(BASE_URL + "/validate", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def all_codes(result):
    codes = [e["code"] for e in result.get("errors") or []]
    for item in result.get("candidate_results") or []:
        codes.extend(e["code"] for e in item.get("errors") or [])
    return sorted(set(codes))


def main():
    evidence = {"probe": "container-sync", "container": CONTAINER, "base_url": BASE_URL}
    problems = []

    # ---- 0. 容器在跑吗 ----
    ps = docker(["inspect", "-f", "{{.State.Running}}", CONTAINER])
    if ps.returncode != 0 or ps.stdout.strip() != "true":
        print(f"容器 {CONTAINER} 未运行，请先启动。stderr={ps.stderr[:300]}")
        return 3

    # ---- 1. 本地文件 ----
    local_bytes = (ROOT / "validator" / "rules.py").read_bytes()
    local_sha = hashlib.sha256(local_bytes).hexdigest()
    evidence["local"] = {"path": "validator/rules.py", "bytes": len(local_bytes), "sha256": local_sha}
    print(f"本地   validator/rules.py : {len(local_bytes)} 字节  sha256={local_sha}")

    # ---- 2. 容器内文件 ----
    ex = docker(["exec", CONTAINER, "python", "-c", READ_CONTAINER])
    if ex.returncode != 0:
        print("读取容器内文件失败:", ex.stderr[:500])
        return 3
    container_bytes = base64.b64decode(ex.stdout.strip())
    container_sha = hashlib.sha256(container_bytes).hexdigest()
    evidence["container"] = {"path": "validator/rules.py", "bytes": len(container_bytes), "sha256": container_sha}
    print(f"容器内 validator/rules.py : {len(container_bytes)} 字节  sha256={container_sha}")
    same = local_bytes == container_bytes
    evidence["bytes_identical"] = same
    print(f"字节完全相同: {same}")
    if not same:
        problems.append("容器内 rules.py 与本地不一致（镜像落后于工作区源码）")

    # ---- 3. /healthz 口径自洽性 ----
    try:
        with urllib.request.urlopen(BASE_URL + "/healthz", timeout=10) as resp:
            health = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print("GET /healthz 失败:", e)
        return 3
    reported = health.get("rules_source_sha256")
    evidence["healthz"] = health
    consistent = reported == container_sha
    evidence["healthz_hash_matches_container_file"] = consistent
    print(f"/healthz rules_source_sha256 = {reported}")
    print(f"是否等于容器内文件 sha256    = {consistent}（口径自洽性）")
    if not consistent:
        problems.append("/healthz 报告的哈希与容器内文件实算不符——该字段不可用作指纹")

    # ---- 4. 直接问运行中的 API：越界输入是否被拒 ----
    probes = [
        ("预算 \"10000.01\"（越界，本地规则应拒）", request('"10000.01"')),
        ("预算 \"10001\"（越界，本地规则应拒）", request('"10001"')),
        ("预算 \"0\"（越界，本地规则应拒）", request('"0"')),
        ("天数 366（越界，本地规则应拒）", request('"200.00"', "366")),
        ("天数 9007199254740991（越界，本地规则应拒）", request('"200.00"', "9007199254740991")),
        ("预算 \"10000\" + 天数 365（双端点，须通过）", request('"10000"', "365")),
    ]
    api_rows = []
    print("\n--- 运行中 API 的实际判定（候选金额一律 0.00、准备 0 天）---")
    for label, req in probes:
        status_code, result = post_validate(req, candidates())
        codes = all_codes(result)
        api_rows.append({"label": label, "http": status_code, "status": result.get("status"),
                         "all_passed": result.get("all_passed"), "codes": codes})
        print(f"  {label:<46} HTTP={status_code} status={result.get('status'):<12} codes={codes}")
    evidence["container_api"] = api_rows

    # 判定：越界输入若在容器里被 passed，即为部署件缺口
    accepted = [r["label"] for r in api_rows if r["status"] == "passed" and "越界" in r["label"]]
    if accepted:
        problems.append("容器 /validate 对越界输入返回 passed：" + "; ".join(accepted))
    control = [r for r in api_rows if "双端点" in r["label"]][0]
    evidence["control_passes"] = control["status"] == "passed"

    evidence["problems"] = problems
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n" + "=" * 78)
    if problems:
        print("发现问题：")
        for p in problems:
            print("  -", p)
    else:
        print("未发现问题：容器与工作区源码一致，且越界输入被拒。")
    print("=" * 78)
    print("证据:", OUT_JSON)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
