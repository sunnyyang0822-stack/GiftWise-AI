"""对**重建后的交付镜像**做 7 项独立复验（不采信部署线自述）。

覆盖 PM 夜间指令 1–7：
  1. GET /healthz 的 rules_source_sha256 == 本机 sha256(validator/rules.py)
  2. 半开正文（Content-Length: 100 只发 5 字节）→ 约 10 秒返回 408 且服务端关闭连接
  3. 并发 9 条半开连接 → 容器内线程数 1 → 10 → 1
  4. 容器内文件树是否含 deploy/observability.py、deploy/observable_server.py
  5. 并发日志是否仍有"粘连行"（两条记录挤在同一行）
  6. 容器内 /validate 与本机规则层是否**逐字节**一致（同输入比对）
  7. 镜像内若存在 /metrics 入口，确认它**不是默认暴露**的

用法（需先自行起容器并映射端口 18099→8000）：
    docker run -d --name gw-verify -p 18099:8000 giftwise-validator:latest
    python tests/acceptance/boundary/probe_rebuilt_image.py

本脚本只读：不重建、不打标签、不推送镜像，不修改仓库文件（仅写 docs/ 下的证据文件）。
"""

import base64
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONTAINER = os.environ.get("GW_VERIFY_CONTAINER", "gw-verify")
HOST = "127.0.0.1"
PORT = int(os.environ.get("GW_VERIFY_PORT", "18099"))
EVIDENCE = ROOT / "docs/test-reports/boundary-001/evidence"

LOCAL_RULES = ROOT / "validator" / "rules.py"
TMPL = (
    '{"recipient_relation":"\u670b\u53cb","recipient_relation_id":"friend",'
    '"occasion":"\u751f\u65e5","budget_amount":%(b)s,"currency":"CNY","available_days":%(d)s,'
    '"facts":[{"id":"f1","text":"x"}],"forbidden_tags":[],"forbidden_terms":[],"notes":"",'
    '"closeness":"unknown","preference_inferences":[],"gift_styles":[],'
    '"hard_exclusions_original":{"tags":[],"terms":[],"unresolved":[]}}'
)


def req(b='"200.00"', d="3"):
    return TMPL % {"b": b, "d": d}


def _cand(i, name, total, days):
    return ('{"id":"%s","name":"%s","description":"\u865a\u6784\u65b9\u6848\u8bf4\u660e",'
            '"estimated_total":"%s","currency":"CNY","estimated_preparation_days":%s,'
            '"tags":["other"],"reason":"\u5339\u914d\u504f\u597d\u4e0e\u9884\u7b97",'
            '"fact_refs":["f1"],"inferences":["\u53ef\u80fd\u504f\u597d\u5b9e\u7528\u793c\u7269"],'
            '"unknowns":["\u4ef7\u683c\u4ee5\u5546\u5bb6\u4e3a\u51c6"],'
            '"presentation":"\u7b80\u8981\u5448\u73b0"}' % (i, name, total, days))


def cands(t='"150.00"', d="1"):
    return '{"candidates":[' + ",".join(
        [_cand("c1", "\u624b\u51b2\u5496\u5561\u793c\u76d2", t, d),
         _cand("c2", "\u9676\u74f7\u9a6c\u514b\u676f", '"120.00"', "2"),
         _cand("c3", "\u5496\u5561\u8c46\u8ba2\u9605\u5361", '"80.00"', "3")]) + "]}"


LINE = "=" * 78
V = {}  # 各项判定


def h(title):
    print("\n" + LINE)
    print(title)
    print(LINE)


def docker(args, timeout=60):
    return subprocess.run(["docker", *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)


def local_sha():
    return hashlib.sha256(LOCAL_RULES.read_bytes()).hexdigest()


def json_bytes(v):
    """与 deploy/server.py 的 _json_bytes 完全一致（逐字节比对的前提）。"""
    return json.dumps(v, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def raw_http(payload: bytes, timeout: float = 60.0, keep_open: bool = False):
    """发原始字节，读到对端关闭；返回 (耗时, 响应字节, 是否被对端关闭)。"""
    s = socket.create_connection((HOST, PORT), timeout=timeout)
    t0 = time.monotonic()
    s.sendall(payload)
    buf = b""
    closed = False
    try:
        while True:
            chunk = s.recv(65536)
            if not chunk:
                closed = True
                break
            buf += chunk
    except (socket.timeout, ConnectionResetError) as e:
        closed = not isinstance(e, socket.timeout)
    finally:
        elapsed = time.monotonic() - t0
        if not keep_open:
            try:
                s.close()
            except OSError:
                pass
    return elapsed, buf, closed


def http_get(path, timeout=15):
    try:
        with urllib.request.urlopen(f"http://{HOST}:{PORT}{path}", timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def http_post(path, obj, timeout=30):
    body = json.dumps(obj).encode("utf-8")
    rq = urllib.request.Request(f"http://{HOST}:{PORT}{path}", data=body,
                                headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(rq, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def container_logs():
    """合并容器的 stdout 与 stderr。

    `docker logs` 会把容器的 stdout 与 stderr **分别**送到本进程的 stdout/stderr；
    而 `BaseHTTPRequestHandler.log_message` 写的是 stderr。只读 `.stdout` 会得到空结果，
    从而把"有日志但没读到"误判成"日志正常"。这是本探针曾踩过的坑，故单独封装。
    """
    ex = docker(["logs", CONTAINER])
    return (ex.stdout or "") + (ex.stderr or "")


def server_pid_and_threads():
    """返回 (pid, cmdline, 线程数)。线程数取自 /proc/<pid>/task。"""
    code = (
        "import glob,os\n"
        "hit=None\n"
        "for p in glob.glob('/proc/[0-9]*'):\n"
        "    try: c=open(p+'/cmdline','rb').read().replace(b'\\x00',b' ').decode()\n"
        "    except Exception: continue\n"
        "    if 'deploy.server' in c or 'observable_server' in c or 'deploy/observable' in c:\n"
        "        hit=(p.split('/')[-1], c.strip()); break\n"
        "if hit is None:\n"
        "    print('-1|(未找到服务进程)|-1')\n"
        "else:\n"
        "    pid,cmd=hit\n"
        "    n=len(os.listdir('/proc/'+pid+'/task'))\n"
        "    print('%s|%s|%d' % (pid, cmd, n))\n")
    ex = docker(["exec", CONTAINER, "python", "-c", code], timeout=30)
    out = (ex.stdout or "").strip().splitlines()
    if not out:
        return None, (ex.stderr or "")[:200], None
    parts = out[-1].split("|", 2)
    if len(parts) != 3:
        return None, out[-1][:200], None
    return parts[0], parts[1], (int(parts[2]) if parts[2].lstrip("-").isdigit() else None)


# ---------------------------------------------------------------- 项 1
def item1():
    h("项 1｜/healthz 的 rules_source_sha256 是否等于本机规则文件哈希")
    want = local_sha()
    print(f"本机 sha256(validator/rules.py) = {want}")
    print(f"本机字节数 / 行数             = {len(LOCAL_RULES.read_bytes())} / "
          f"{len(LOCAL_RULES.read_text(encoding='utf-8').splitlines())}")
    st, body = http_get("/healthz")
    print(f"GET /healthz → HTTP {st}")
    print(f"原始响应体: {body.decode('utf-8')}")
    try:
        got = json.loads(body).get("rules_source_sha256")
    except Exception as e:
        got = f"(解析失败 {e})"
    print(f"容器自报 rules_source_sha256   = {got}")
    ok = (got == want)
    print(f"\n判定: {'成立 —— 相等' if ok else '**不成立** —— 不相等'}")
    V["项1 healthz 哈希相符"] = ok
    return ok


# ---------------------------------------------------------------- 项 2
def item2():
    h("项 2｜半开正文：Content-Length: 100 只发 5 字节 → 是否约 10 秒返回 408 且关闭")
    head = (f"POST /validate HTTP/1.1\r\nHost: {HOST}\r\n"
            f"Content-Type: application/json\r\nContent-Length: 100\r\n\r\n").encode()
    payload = head + b"abcde"
    print(f"实发字节: 头部 {len(head)} 字节 + 正文 5 字节（声明 100）")
    elapsed, buf, closed = raw_http(payload, timeout=40)
    first = buf.split(b"\r\n", 1)[0].decode("latin1") if buf else "(无响应)"
    print(f"耗时              = {elapsed:.2f} s")
    print(f"响应首行          = {first}")
    print(f"响应字节数        = {len(buf)}")
    print(f"对端主动关闭      = {closed}")
    print(f"响应原文          = {buf.decode('utf-8', 'replace')[:300]!r}")
    ok_408 = b" 408 " in buf.split(b"\r\n", 1)[0]
    ok_time = 8.0 <= elapsed <= 15.0
    print(f"\n判定: 408={'成立' if ok_408 else '**不成立**'}；"
          f"约10秒={'成立' if ok_time else '**不成立**'}；"
          f"服务端关闭={'成立' if closed else '**不成立**'}")
    V["项2 半开正文返回408"] = ok_408
    V["项2 约10秒超时"] = ok_time
    V["项2 服务端关闭连接"] = closed
    return ok_408 and ok_time and closed


# ---------------------------------------------------------------- 项 3
def item3():
    h("项 3｜并发 9 条半开连接 → 容器内线程数 1 → 10 → 1")
    pid0, cmd0, base = server_pid_and_threads()
    print(f"服务进程 PID={pid0}  线程数(基线)={base}")
    print(f"cmdline: {cmd0}")

    N = 9
    socks, results = [], []
    head = (f"POST /validate HTTP/1.1\r\nHost: {HOST}\r\n"
            f"Content-Length: 100\r\n\r\n").encode()

    def holder():
        try:
            s = socket.create_connection((HOST, PORT), timeout=45)
            s.sendall(head + b"abcde")
            socks.append(s)
            t0 = time.monotonic()
            buf = b""
            while True:
                c = s.recv(65536)
                if not c:
                    break
                buf += c
            results.append((time.monotonic() - t0, buf.split(b"\r\n", 1)[0].decode("latin1", "replace")))
        except Exception as e:
            results.append((-1.0, f"异常 {type(e).__name__}"))

    ths = [threading.Thread(target=holder, daemon=True) for _ in range(N)]
    for t in ths:
        t.start()
    time.sleep(2.0)  # 等 9 条连接都被 accept 并各起一个线程
    pid1, _, during = server_pid_and_threads()
    print(f"\n并发进行中（{N} 条半开）线程数 = {during}")
    for t in ths:
        t.join(timeout=45)
    peak = during
    # 线程回收可能滞后几秒，轮询等待
    after = during
    for _ in range(20):
        time.sleep(1.0)
        _, _, after = server_pid_and_threads()
        if after == base:
            break
    print(f"全部结束后线程数(轮询收敛) = {after}")
    print(f"\n各连接结果（耗时 / 首行）:")
    for e, f in sorted(results):
        print(f"  {e:6.2f}s  {f}")
    ok = (base == 1 and during == 1 + N and after == 1)
    print(f"\n判定: 基线={base}(期望1) 峰值={during}(期望{1+N}) 收敛={after}(期望1) → "
          f"{'成立' if ok else '**不成立**'}")
    V["项3 线程 1→10→1"] = ok
    return ok


# ---------------------------------------------------------------- 项 4
def item4():
    h("项 4｜容器内文件树是否含 deploy/observability.py、deploy/observable_server.py")
    want = ["deploy/observability.py", "deploy/observable_server.py"]
    for w in want:
        ex = docker(["exec", CONTAINER, "python", "-c",
                     f"import pathlib;print(pathlib.Path('{w}').is_file())"])
        exists = (ex.stdout or "").strip() == "True"
        size = ""
        if exists:
            ex2 = docker(["exec", CONTAINER, "python", "-c",
                          f"import pathlib;print(pathlib.Path('{w}').stat().st_size)"])
            size = f"  {ex2.stdout.strip()} 字节"
        print(f"  {w:<32} exists={exists}{size}")
    print("\n容器内 deploy/ 目录清单:")
    ex = docker(["exec", CONTAINER, "python", "-c",
                 "import pathlib;print('\\n'.join(sorted(p.name for p in pathlib.Path('deploy').iterdir())))"])
    for l in (ex.stdout or "").splitlines():
        print("   ", l)
    print("\n镜像默认入口（决定 /metrics 是否可能默认暴露）:")
    ins = docker(["inspect", CONTAINER, "--format",
                  "Cmd={{.Config.Cmd}} Entrypoint={{.Config.Entrypoint}} Exposed={{.Config.ExposedPorts}}"])
    print("  " + (ins.stdout or "").strip())
    both = all(docker(["exec", CONTAINER, "python", "-c",
                       f"import pathlib;raise SystemExit(0 if pathlib.Path('{w}').is_file() else 1)"]).returncode == 0
               for w in want)
    print(f"\n判定: 两者都在镜像内 = {'成立' if both else '**不成立**'}")
    V["项4 两文件均在镜像内"] = both
    return both


# ---------------------------------------------------------------- 项 5
def item5():
    h("项 5｜并发日志是否仍有粘连行")
    before = container_logs()
    n0 = len(before.splitlines())
    M, N = 12, 3  # 12 线程 × 3 请求
    print(f"发起 {M} 线程 × {N} 次并发 POST /validate（共 {M*N} 次）")

    def w():
        for _ in range(N):
            try:
                http_post("/validate", {"request_json": req(), "candidates_json": cands()}, timeout=30)
            except Exception:
                pass

    ths = [threading.Thread(target=w) for _ in range(M)]
    t0 = time.monotonic()
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    print(f"并发完成，用时 {time.monotonic()-t0:.2f} s")

    time.sleep(1.0)
    after = container_logs()
    lines = after.splitlines()
    new = lines[n0:]
    print(f"\n日志总行数 {len(lines)}（本次新增 {len(new)} 行）")
    print("本次新增日志样本（前 8 行）:")
    for l in new[:8]:
        print("   |", l)

    # 粘连判定：同一行出现 ≥2 个请求记录标记（"POST /validate 或 GET / 的引号模式）
    pat = re.compile(r'"(?:GET|POST) [^"]*HTTP/1\.[01]"')
    sticky = [l for l in lines if len(pat.findall(l)) >= 2]
    # 另一个特征：一行里出现 ≥2 个 IPv4 - - [
    ip_pat = re.compile(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3} - - \[")
    sticky2 = [l for l in lines if len(ip_pat.findall(l)) >= 2]
    print(f"\n含 ≥2 个请求标记的行数 = {len(sticky)}")
    print(f"含 ≥2 个 '<ip> - - [' 的行数 = {len(sticky2)}")
    if sticky or sticky2:
        print("粘连行样本:")
        for l in (sticky + sticky2)[:5]:
            print("   !!", l[:200])
    ok = not sticky and not sticky2
    print(f"\n判定: {'成立 —— 无粘连行' if ok else '**不成立** —— 存在粘连行'}")
    V["项5 日志无粘连"] = ok
    return ok


# ---------------------------------------------------------------- 项 6
def item6():
    h("项 6｜容器内 /validate 与本机规则层是否逐字节一致（同输入）")
    sys.path.insert(0, str(ROOT))
    from validator.rules import validate as local_validate  # noqa: E402

    cases = [
        ("范围内常规", req(), cands()),
        ("预算上界内", req('"10000"', "365"), cands()),
        ("预算越上界", req('"10000.01"'), cands()),
        ("预算越下界", req('"0"'), cands()),
        ("天数越上界", req('"200.00"', "366"), cands()),
        ("格式错(区间)", req('"100-200"'), cands()),
        ("类型错(JSON数字)", req('20000'), cands()),
        ("币种错", (TMPL % {"b": '"200.00"', "d": "3"}).replace('"CNY"', '"USD"'), cands()),
        ("宏观错误组合", req('"0"', "366"), cands()),
        ("候选超预算", req('"100.00"'), cands('"150.00"')),
        ("候选天数超期", req('"200.00"', "1"), cands('"50.00"', "5")),
        ("JSON 无效", "not json", cands()),
        ("根为数组", "[]", cands()),
        ("缺字段", '{"recipient_relation":"朋友"}', cands()),
    ]
    rows, all_ok = [], True
    for name, rj, cj in cases:
        if "|" in name or rj.endswith("|" + cj):
            pass
        st, body = http_post("/validate", {"request_json": rj, "candidates_json": cj})
        try:
            local = local_validate(rj, cj)
            lb = json_bytes(local)
        except Exception as e:
            lb = f"(本机异常 {type(e).__name__})".encode()
        same = (body == lb)
        all_ok &= same
        rows.append((name, st, len(body), len(lb), same))
        print(f"  {name:<20} HTTP={st} 容器={len(body)}B 本机={len(lb)}B 逐字节一致={same}")
        if not same:
            print(f"      容器: {body[:200]!r}")
            print(f"      本机: {lb[:200]!r}")
    print(f"\n判定: {sum(1 for r in rows if r[4])}/{len(rows)} 逐字节一致 → "
          f"{'成立' if all_ok else '**不成立**'}")
    V["项6 规则层逐字节一致"] = all_ok
    return all_ok


# ---------------------------------------------------------------- 项 7
def item7():
    h("项 7｜/metrics 是否默认暴露")
    for path in ["/metrics", "/readyz", "/"]:
        st, body = http_get(path)
        print(f"  GET {path:<10} → HTTP {st}  body={body.decode('utf-8','replace')[:140]!r}")
    st_m, body_m = http_get("/metrics")
    st_r, body_r = http_get("/readyz")
    print(f"\n判定依据：默认入口 do_GET 仅处理 /healthz 与 /，其余返回 404。")
    not_exposed = (st_m == 404 and st_r == 404)
    print(f"/metrics HTTP={st_m}、/readyz HTTP={st_r} → "
          f"{'成立 —— 默认未暴露' if not_exposed else '**不成立** —— 默认可见'}")
    V["项7 /metrics 默认未暴露"] = not_exposed
    return not_exposed


def main():
    h("重建镜像 7 项独立复验")
    ins = docker(["inspect", CONTAINER, "--format",
                  "{{.Image}}|{{.Config.Image}}|{{.State.StartedAt}}|{{.State.Running}}"])
    print("被测容器:", CONTAINER)
    print("容器明细:", (ins.stdout or ins.stderr or "").strip())
    img = docker(["image", "inspect", "giftwise-validator:latest", "--format",
                  "{{.Id}}|{{.Created}}|{{index .Config.Labels \"org.opencontainers.image.revision\"}}"])
    print("giftwise-validator:latest:", (img.stdout or "").strip())
    print("本机 rules.py sha256:", local_sha())

    checks = [(1, item1), (2, item2), (3, item3), (4, item4),
              (5, item5), (6, item6), (7, item7)]
    for n, fn in checks:
        try:
            fn()
        except Exception as e:
            print(f"\n!! 项 {n} 执行异常: {type(e).__name__}: {e}")
            V[f"项{n} 执行异常"] = False

    h("总判定")
    for k, v in V.items():
        print(f"  {'成立  ' if v else '不成立'}  {k}")
    bad = [k for k, v in V.items() if not v]
    print(f"\n{len(V)-len(bad)}/{len(V)} 子项成立" + (f"；不成立: {bad}" if bad else "；全部成立"))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
