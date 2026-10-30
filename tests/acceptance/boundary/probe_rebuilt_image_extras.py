"""重建镜像复验的**加强核查**（补充 probe_rebuilt_image.py 的 7 项）。

这三项是"不满足于盖章"的追加证据：
  A. 容器内 `validator/` 每个文件与本地**逐字节**比对（哈希相等只证明指纹，逐字节才是证明）
  B. `/metrics` 的作用域：默认入口不暴露，但需证明它**确实存在**（observable 变体可提供），
     否则会把"根本不存在"误报成"未暴露"；同时检查默认环境变量里没有开启开关
  C. 高并发（32 线程）下的日志完整性：行数 1:1、无粘连行，并预检连通性
     （预检很重要：URL 写错时会"全失败但看起来很快"，从而把假失败当成真结论）

用法：
    docker run -d --name gw-verify -p 18099:8000 giftwise-validator:latest
    docker run -d --name gw-obs    -p 18098:8000 giftwise-validator:latest python -m deploy.observable_server
    python tests/acceptance/boundary/probe_rebuilt_image_extras.py
"""

import base64
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PLAIN = os.environ.get("GW_VERIFY_CONTAINER", "gw-verify")
OBS = os.environ.get("GW_OBS_CONTAINER", "gw-obs")
PLAIN_PORT = int(os.environ.get("GW_VERIFY_PORT", "18099"))
OBS_PORT = int(os.environ.get("GW_OBS_PORT", "18098"))
H = "127.0.0.1"

TMPL = ('{"recipient_relation":"\u670b\u53cb","recipient_relation_id":"friend","occasion":"\u751f\u65e5",'
        '"budget_amount":"200.00","currency":"CNY","available_days":3,"facts":[{"id":"f1","text":"x"}],'
        '"forbidden_tags":[],"forbidden_terms":[],"notes":"","closeness":"unknown",'
        '"preference_inferences":[],"gift_styles":[],'
        '"hard_exclusions_original":{"tags":[],"terms":[],"unresolved":[]}}')
CJ = ('{"candidates":[{"id":"c1","name":"\u793c\u76d2","description":"\u865a\u6784\u65b9\u6848\u8bf4\u660e",'
      '"estimated_total":"150.00","currency":"CNY","estimated_preparation_days":1,"tags":["other"],'
      '"reason":"\u5339\u914d\u504f\u597d","fact_refs":["f1"],"inferences":["\u53ef\u80fd"],'
      '"unknowns":["\u4ee5\u5546\u5bb6\u4e3a\u51c6"],"presentation":"\u7b80\u8981"}]}')

LINE = "=" * 78
V = {}


def h(t):
    print("\n" + LINE + "\n" + t + "\n" + LINE)


def docker(args, timeout=60, c=None):
    return subprocess.run(["docker", *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)


def get_in_container(container, rel):
    code = ("import base64,pathlib;"
            "print(base64.b64encode(pathlib.Path(%r).read_bytes()).decode())" % rel)
    ex = docker(["exec", container, "python", "-c", code], c=container)
    if ex.returncode != 0:
        return None
    return base64.b64decode(ex.stdout.strip())


def http_code(port, path, timeout=10):
    try:
        with urllib.request.urlopen(f"http://{H}:{port}{path}", timeout=timeout) as r:
            return r.status, r.read()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200]
    except Exception as e:
        return None, f"{type(e).__name__}: {e}".encode()


# ---------------------------------------------------------------- A
def extra_a():
    h("A｜容器内 validator/ 与本地逐字节比对")
    local_dir = ROOT / "validator"
    all_same = True
    for p in sorted(local_dir.rglob("*.py")):
        rel = str(p.relative_to(ROOT)).replace("\\", "/")
        con = get_in_container(PLAIN, rel)
        loc = p.read_bytes()
        if con is None:
            print(f"  {rel:<26} 容器内**不存在**")
            all_same = False
            continue
        same = con == loc
        all_same &= same
        print(f"  {rel:<26} 本地={len(loc):>6}B  容器={len(con):>6}B  逐字节一致={same}")
    ex = docker(["exec", PLAIN, "python", "-c",
                 "import pathlib;print(sorted(p.name for p in pathlib.Path('validator').iterdir()))"])
    print(f"\n  容器内 validator/ 清单: {ex.stdout.strip()}")
    print(f"  本地   validator/ 清单: ['__init__.py', 'rules.py']")
    print(f"\n判定: {'成立 —— 全部逐字节一致' if all_same else '**不成立**'}")
    V["A 容器内 validator 逐字节一致"] = all_same
    return all_same


# ---------------------------------------------------------------- B
def extra_b():
    h("B｜/metrics 作用域：默认不暴露，但确实存在")
    print("默认入口 vs observable 变体（同一镜像、不同启动命令）:")
    rows = {}
    for label, port in (("默认入口(deploy.server)", PLAIN_PORT), ("observable 变体", OBS_PORT)):
        for path in ("/healthz", "/metrics", "/readyz"):
            st, body = http_code(port, path)
            rows[(label, path)] = st
            print(f"  {label:<26} GET {path:<9} → HTTP {st}")
    print("\n镜像默认环境变量（检查是否有默认开启 metrics 的开关）:")
    ex = docker(["image", "inspect", "giftwise-validator:latest",
                 "--format", "{{range .Config.Env}}{{println .}}{{end}}"])
    env = [l for l in (ex.stdout or "").splitlines() if l.strip()]
    for l in env:
        print("   ", l)
    suspects = [l for l in env if re.search(r"METRIC|OBSERV|ACCESS_LOG|READY", l, re.I)]
    print(f"  含 METRIC/OBSERV/ACCESS_LOG/READY 的变量: {suspects or '（无）'}")
    ex = docker(["image", "inspect", "giftwise-validator:latest", "--format",
                 "Cmd={{.Config.Cmd}}  Exposed={{.Config.ExposedPorts}}"])
    print(f"  默认 {ex.stdout.strip()}")

    exists = rows[("observable 变体", "/metrics")] == 200
    not_default = (rows[("默认入口(deploy.server)", "/metrics")] == 404
                   and rows[("默认入口(deploy.server)", "/readyz")] == 404)
    print(f"\n  /metrics 确实存在（observable 变体 200）        = {exists}")
    print(f"  默认入口不暴露（/metrics 与 /readyz 均 404）    = {not_default}")
    print(f"  默认环境无开启开关                              = {not suspects}")
    ok = exists and not_default and not suspects
    print(f"\n判定: {'成立 —— 存在但非默认暴露' if ok else '**不成立**'}")
    V["B /metrics 存在但不默认暴露"] = ok
    return ok


# ---------------------------------------------------------------- C
def extra_c():
    h("C｜高并发日志完整性（32 线程）")
    url = f"http://{H}:{PLAIN_PORT}/validate"
    body = json.dumps({"request_json": TMPL, "candidates_json": CJ}).encode()

    def logs():
        ex = docker(["logs", PLAIN])
        return (ex.stdout or "") + (ex.stderr or "")

    # 先取基线，再发预检，**并轮询等预检那条日志真的可见**，之后才取 n1 作为正式基线。
    # 若在预检日志落盘前就取基线，那 1 行会混进并发段，导致 65 vs 64 的**假"不成立"**。
    n0 = len(logs().splitlines())

    # 连通性预检：否则 URL 写错会"全失败且瞬时返回"，把假失败读成真结论
    try:
        with urllib.request.urlopen(urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"}, method="POST"),
                timeout=20) as r:
            print(f"连通性预检: HTTP {r.status}  body={len(r.read())}B")
    except Exception as e:
        print(f"连通性预检**失败**: {type(e).__name__}: {e}")
        print("判定: **不成立**（无法连通，本项无意义）")
        V["C 高并发日志 1:1 无粘连"] = False
        return False

    n1 = n0
    for _ in range(40):
        time.sleep(0.25)
        n1 = len(logs().splitlines())
        if n1 >= n0 + 1:
            break
    print(f"预检日志确认可见: 行数 {n0} → {n1}（正式基线 n1={n1}）")
    if n1 < n0 + 1:
        print("判定: **不成立**（预检日志始终未出现，无法建立可靠基线）")
        V["C 高并发日志 1:1 无粘连"] = False
        return False
    M, N = 32, 2
    okc = [0]
    lock = threading.Lock()

    def w():
        for _ in range(N):
            try:
                urllib.request.urlopen(urllib.request.Request(
                    url, data=body, headers={"Content-Type": "application/json"}, method="POST"),
                    timeout=30).read()
                with lock:
                    okc[0] += 1
            except Exception:
                pass

    t0 = time.monotonic()
    ts = [threading.Thread(target=w) for _ in range(M)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    dur = time.monotonic() - t0
    # 轮询等日志落盘，避免"还没写完就采样"造成的行数短缺
    lines = logs().splitlines()
    for _ in range(60):
        if len(lines) >= n1 + okc[0]:
            break
        time.sleep(0.25)
        lines = logs().splitlines()
    new = lines[n1:]
    print(f"\n并发 {M} 线程 × {N} 次 = {M*N} 次；成功 {okc[0]} 次；用时 {dur:.2f}s")
    print(f"日志新增行数 = {len(new)}   成功请求数 = {okc[0]}")
    one2one = (len(new) == okc[0])
    print(f"判定 1:1 → {'成立' if one2one else '**不成立**'}")
    pat = re.compile(r'"(?:GET|POST) [^"]*HTTP/1\.[01]"')
    sticky = [l for l in lines if len(pat.findall(l)) >= 2]
    other = [l for l in new if not pat.search(l)]
    print(f"粘连行（一行 ≥2 个请求记录）= {len(sticky)}")
    print(f"新增行中不含请求记录的行     = {len(other)}")
    for l in other[:5]:
        print("   非请求行:", l[:160])
    for l in sticky[:5]:
        print("   粘连行!!:", l[:200])
    print("\n新增日志样本（前 4 行）:")
    for l in new[:4]:
        print("   |", l)
    ok = one2one and not sticky and not other
    print(f"\n判定: {'成立 —— 行数 1:1 且无粘连' if ok else '**不成立**'}")
    V["C 高并发日志 1:1 无粘连"] = ok
    return ok


def main():
    h("重建镜像复验 · 加强核查")
    ex = docker(["inspect", "giftwise-validator:latest", "--format", "{{.Id}}"])
    print("giftwise-validator:latest Id =", (ex.stdout or "").strip())
    for fn in (extra_a, extra_b, extra_c):
        try:
            fn()
        except Exception as e:
            print(f"\n!! 执行异常: {type(e).__name__}: {e}")
            V[fn.__name__] = False
    h("加强核查总判定")
    for k, v in V.items():
        print(f"  {'成立  ' if v else '不成立'}  {k}")
    bad = [k for k, v in V.items() if not v]
    print(f"\n{len(V)-len(bad)}/{len(V)} 成立" + (f"；不成立: {bad}" if bad else "；全部成立"))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
