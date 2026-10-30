# 翻车点清单（含已复现证据）— DEMO-001

- 归属任务：**DEMO-001**（Issue #27）
- 记录时间：2026-10-31 00:2x–00:5x（Asia/Shanghai）
- 冻结 HEAD：`351330da346f7382d86d34d822bd000b7228c3c2`（分支 `release/2026-11-01-submission`）
- **零模型调用**：本轮未发起任何模型调用。所有"真实模型"数据均来自 `workflow/evidence/**` 的归档。

> **诚实性约定（本文严格遵守）**
> - **已复现** = 我在本机实际跑出来、有原始输出的。
> - **未复现** = 我按它设计并试了，但**没有**在本轮观测到。我不会把它写成"已发现"。
> - 被测文件在本轮期间被其他 Agent 改过时，我按任务书要求**先看 mtime、再重试一次**；
>   确认中间态的**不记为缺陷**。本文已逐条标注。

---

## 汇总表

| # | 翻车点 | 状态 | 影响 | 兜底 | 兜底已验证？ |
| --- | --- | --- | --- | --- | --- |
| **F1** | 端口 8787 已被**另一个 Agent** 占用 | **已复现** | 按脚本原样启动会 EADDRINUSE | 端口自动避让 `servers.sh start` | ✅ 实测避让到 8788 |
| **F2** | Windows 控制台 GBK 编码导致 Python **硬崩**（exit 1） | **已复现** | 现场敲命令直接报错 | `chcp 65001` + `PYTHONIOENCODING=utf-8`；脚本内 `reconfigure` | ✅ 两种改法均实测通过 |
| **F3** | 脚本 §5.2 的代码片段用错字段 → `KeyError: 'result'` | **已复现** | 照读照敲必崩 | 用真实契约 `resp['status']`；改用 `run-rules-layer-demo.py` | ✅ 修正后 6/6 通过 |
| **F4** | MSYS `timeout` **杀不掉**原生 `node.exe` → 孤儿占端口 | **已复现（有计数）** | 自检脚本自己挂死；端口永久被占 | PID 文件 + `Stop-Process` 精确终止 | ✅ 实测端口释放且无连带损伤 |
| **F5** | 脚本说"工作流**未发布**"，实际**已发布 v2** | **已复现（证据矛盾）** | 口播与画面直接打架 | 改口径为"已发布·版本 2" | ✅ 见 `脚本修订建议.md` |
| **F6** | 本机 **HTTPS 整体不可用**（不只 Dify） | **已复现** | **模式 A 在本机无法预演** | 模式 C 全离线（本包主力） | ✅ 回放页 file:// 实测可开 |
| **F7** | Python `subprocess` 在沙箱下 `WinError 5` | **已复现** | 任何"外壳调用+取输出"的脚本崩 | 直接读文件，不用 subprocess | ✅ 快照构建器改后通过 |
| **F8** | `chrome.exe --headless` 在沙箱内无法启动 | **已复现** | 截图/录屏自动化不可用 | 复用已有 CDP 端点 + 新建即弃 target | ✅ 截图全部产出 |
| **F9** | 脚本写"期望 322 项单测"，实测 **329** | **已复现** | 数字对不上 | 报实际读数 | ✅ 见预演记录 |
| **F10** | 脚本写"10 次 / 34,127 tokens"，实际 **13 次 / 38,326** | **已复现** | 成本口径过期 | 报实际读数 | ✅ 见预演记录 |
| **F11** | `case2/case5` 被脚本标为"**真实运行记录**"，实际**未接模型** | **已复现（节点名逐字）** | 诚实性风险，评委一追问就露 | 改用 `dify-real-*`；`case*` 改称"确定性夹具" | ✅ 已定位正确的真实模型归档 |
| **F12** | 演示 `FORBIDDEN_TAG` 时只改名字**不会**触发 | **已复现** | 现场"演不出来"很尴尬 | 必须改候选声明的 `tags` | ✅ 改 tags 后命中 |
| **F13** | 投影分辨率变化 | 已测（**未发现**溢出） | — | 1024×768–1920×1080 均无横向溢出 | ✅ 6 种分辨率实测 |
| **F14** | 另一个 Agent 正在写文件导致 404 | **未复现** | 潜在 | mtime 判定 + 重试规则 | ✅ 规则三分支已测 |
| **F15** | `landing.css` 单文件 **4.1 MB** | **已复现（已量化）** | 首次渲染负载 | 本机 17 ms，风险低；已记录 | ✅ 已量 |
| **F16** | 「模拟数据」横幅只有 **12 px** | **已复现（已量化）** | 投影可能看不清 | 浏览器缩放 125–150% | ✅ 缩放后可见 |
| **F17** | Dify 请求侧校验失败**不短路**，仍白烧一次模型调用 | **已复现（归档）** | 输入打错 → 浪费额度 + 结果误导 | 现场输入前先核对数值范围 | 归档证据 |
| **F18** | MSYS 改写 curl 参数（含前导 `/` 的字符串） | **已复现** | 命令行为与预期不符 | `MSYS2_ARG_CONV_EXCL='*'`；避免前导 `/` | ✅ 实测 |
| **F19** | 未知 API 路径 GET 返回 **405** 而非 404 | **已复现** | 被问"API 设计"时的小瑕疵 | 如实说明；不影响 Demo | — |
| **F20** | `web/server/config.mjs` 的**用户可见提示**里也写着"**尚未发布**" | **已复现** | 与 F5 同源；评委若看到该提示会得出错误结论 | 改用已发布口径（属 `web/`，需 web 线改） | ✅ 已定位到具体字符串 |
| **F21** | Dify 无凭证 / 超时的降级路径 | **已复现（行为正确）** | — | **无需兜底**：接入层表现正确 | ✅ 两条路径都实测 |

---

## F1 · 端口 8787 已被另一个 Agent 占用　【已复现】

**脚本原文**（`docs/demo-script.md:64`）：
```bash
GW_MODE=mock GW_PORT=8787 node web/server/server.mjs
```
脚本没有先检查端口。

**实测证据**：
```
$ netstat -ano | grep 8787
  TCP    127.0.0.1:8787   0.0.0.0:0   LISTENING   13360

$ curl -sS http://127.0.0.1:8787/healthz
{"status":"ok","mode":"mock","runs":56}
```
探测期间该实例的 `runs` 计数持续增长：**56 → 63 → 80 → 87 → 95**，说明**另一个 Agent 正在活跃使用它**。

**兜底**：`bash docs/demo/bin/servers.sh start` —— 从 8787 起自动找空闲端口。

**兜底验证**：
```
$ bash docs/demo/bin/servers.sh start
  !! 8000 已被占用（别的 Agent 或残留进程），自动改用备用端口
  校验器端口：8001
  界面端口：8788
  界面   http://127.0.0.1:8788/healthz
    {"status":"ok","mode":"mock","runs":0}
```
✅ 正确避让到 8001/8788。

**现场纪律**：**不要杀掉别人的 8787**。多 Agent 共用工作目录时它属于别人，杀掉会破坏其他线的工作。
`preflight.sh` §3 会明确提示"**不要杀掉它**"。

---

## F2 · Windows 控制台 GBK 编码：Python 硬崩　【已复现】

**最小复现**：
```
$ python -c "import sys; print('stdout.encoding =', sys.stdout.encoding)"
stdout.encoding = gbk

$ python -c "print('A \u21b3 B')"
Traceback (most recent call last):
  File "<string>", line 1, in <module>
UnicodeEncodeError: 'gbk' codec can't encode character '\u21b3' in position 2: illegal multibyte sequence
--- exit=1 ---
```

`↳`(U+21B3) 只是例子。**同类会崩的字符**：`✅ ⚠ → ★ ⇢ ─ │ ● ✔ ✗` 以及各种 emoji。
**任何**在 `print` 里带这些字符的现场命令都会以 exit 1 结束——包括我一开始写的规则层演示脚本（**已实际崩过一次**）。

**第二种表现：中文乱码但不崩**
```
$ python -c "print('中文测试 通过')"
���Ĳ��� ͨ��
```
编码上"成功"，但 `chcp` 显示代码页为 **936**，输出在 UTF-8 管道里就是乱码。

**兜底（两种，均已实测）**：
```
$ PYTHONIOENCODING=utf-8 python -c "import sys; print('stdout.encoding =', sys.stdout.encoding); print('A \u21b3 B 中文测试 \u2705\u26a0')"
stdout.encoding = utf-8
A ↳ B 中文测试 ✅⚠
--- exit=0 ---

$ python -X utf8 -c "import sys; print('stdout.encoding =', sys.stdout.encoding); print('A \u21b3 B 中文')"
stdout.encoding = utf-8
A ↳ B 中文
--- exit=0 ---
```

**第三种（我要推荐的）**：在脚本内部自救，不依赖调用者记不记得设环境变量：
```python
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
```
`docs/demo/bin/run-rules-layer-demo.py` 与 `docs/demo/tools/build-snapshot.py` 都内置了这一行。
✅ 实测：加这行之前脚本崩、加之后 6/6 通过。

**现场动作**：开演前执行 `chcp 65001`，并 `set PYTHONIOENCODING=utf-8`。`preflight.sh` §1 会检查并提示。

---

## F3 · 脚本 §5.2 的代码片段用错响应字段　【已复现】

**脚本原文**（`docs/demo-script.md:171`）：
```python
print(json.loads(urllib.request.urlopen(req, timeout=10).read().decode())['result']['status'])
```

**实测**：真实 `/validate` 响应**没有** `result` 这一层。
```
$ python -c "...['result']['status']..."
KeyError: 'result'
```
真实响应结构：
```json
{
  "status": "passed",
  "all_passed": true,
  "errors": [],
  "candidate_results": [
    {"id": "c1", "passed": true, "errors": [], "warnings": []},
    {"id": "c2", "passed": true, "errors": [], "warnings": []},
    {"id": "c3", "passed": true, "errors": [], "warnings": []}
  ],
  "business_data_verification": "not_verified"
}
```

**注意**：`deploy/README.md` 与脚本正文都没有把这个形状写清楚，脚本 §5.2 是现场唯一会照敲的代码，**它一定会崩**。

**兜底**：改正字段名，并提供一个已经跑通的整段脚本：
```
$ python docs/demo/bin/run-rules-layer-demo.py
  [PASS] 基线三候选      batch.status = passed
  [PASS] 超预算候选      ['OVER_BUDGET']
  [PASS] 禁忌词「巧克力」 ['FORBIDDEN_TERM']
  [PASS] 禁忌类别 alcohol ['FORBIDDEN_TAG']
  [PASS] 只改文本、不声明标签  passed
=== 6 项用例，失败 0 项 ===
```
✅ 已验证。

**顺带修正脚本的一处措辞**：脚本 5.2 注释写"期望输出：failed（错误码 OVER_BUDGET）"——实测确实如此，这部分是对的，只有取值路径错了。

---

## F4 · MSYS `timeout` 杀不掉原生 `node.exe`　【已复现，有计数】

这是本轮**最危险**的一个：它会让"为了保险加个超时"这个动作**本身**变成故障源。

**判定实验**：让 node 每秒写一次心跳，外面包 `timeout 3`。
```bash
H=web/.tmp/demo-rehearsal/_heartbeat.txt
timeout 3 node -e "const fs=require('fs');let n=0;setInterval(()=>{fs.appendFileSync(process.argv[1],(++n)+'\n')},1000);" "$H" &
sleep 9
wc -l < "$H"
```

**实测输出**：
```
wrapped in timeout 3, waiting 9s...
heartbeat lines after 9s = 8   (期望 3 才对；>3 说明 timeout 没杀掉)
VERDICT: timeout 未能终止原生 node.exe —— 仍存活，心跳继续
--- 现在手工清理 ---
after kill -9 wrapper: lines=10 -> 12 (还在涨说明 node 仍孤儿存活)
```

**结论（逐字）**：
1. `timeout 3` 之后 **9 秒写了 8 行心跳** —— 期望是 3 行。timeout **完全没生效**。
2. 对包装进程 `kill -9` 之后，心跳**从 10 涨到 12** —— node **孤儿存活**。

**连带影响**：孤儿 node 会**一直占着端口**。于是下一个动作尝试绑同一端口 → 失败 → 看起来像"端口被占"。
**F1 与 F4 会互相放大**：先用 `timeout` 兜底 → 留下孤儿 → 端口被占 → 再想兜底就没有端口了。

**另一处实测**：同一个坑直接挂死了我的工具调用——
```
$ GW_MODE=dify GW_PORT=8792 timeout 6 node web/server/server.mjs | head -20
[still running after 120000ms; moved to background job]
```
（服务进程本来就常驻，`timeout 6` 本该 6 秒后收工，结果 **120 秒仍在跑**。）

**兜底（已实测）**：用 PID 文件 + **PowerShell `Stop-Process`** 精确终止，不用 `timeout`。
```
$ bash docs/demo/bin/servers.sh stop
== 停止演示服务 ==
  已停止 web 界面 (pid 1195)
  已停止 校验器 (pid 1188)
  完成

$ 端口复查
8001 已释放 OK
8788 已释放 OK

$ 对照：另一个 Agent 的 8787 必须还活着
{"status":"ok","mode":"mock","runs":80}
```
✅ 两个原生进程都被真停掉；端口释放；**另一个 Agent 的服务毫发无损**（`runs` 从 56 涨到 80，说明它在正常被使用）。

**现场纪律**：
- **绝不要**用 `timeout` 包 node/python。
- 要限时就用 `curl -m`（那是 curl 自己的机制，可靠）。
- 起服务一律走 `servers.sh`，它记录 PID 并能精确回收。

---

## F5 · 脚本说"未发布"，实际已发布 v2　【已复现，证据矛盾】

**脚本原文**（多处）：
- `docs/demo-script.md:13`："Dify 工作流**未发布、未创建版本**（B5）。现场打开的是**草稿**"
- `:118`：屏幕应为"草稿画布、11 节点、**未发布**标识"
- `:231`：S2 角标"**草稿 · 未发布**"、操作要点"**不要**点发布"
- `:294`（B 组第 5 条）："工作流未发布、未创建版本（当前是草稿状态）"

**归档证据**：
```
workflow/evidence/WF-003-2026-10-30/dify-publish-success-evidence.txt
  【发布成功证据】2026-10-30 23:04（+08:00）
  ---> '操作成功'
  ---> '已发布'
  hasUnpublishedLabel=False, hasPublishedLabel=True

workflow/evidence/WF-003-2026-10-31-publish-v2/README.md
  | 已发布版本 | **版本 #2**（version_number: 2，hash f20ccdd98f1c…） |
  | 发布动作   | POST .../workflows/publish → **200** |
  | 检查清单   | **「所有问题均已解决」** |
```

**影响**：这是**口径与画面直接矛盾**。主持人照读"未发布"，屏幕上写着"已发布 / 版本 2"，评委一眼就能看到。比"少讲一句"严重得多。

**兜底**：把口径改成"**已发布为版本 2**，但**没有上云**、**没有版本回退入口**"。
特别提醒：v2 README 明写"**不能回退到版本 #1**；已归档的 v1 整份只可作为**手工重建**依据"——
所以**不要**说"我们随时能回滚"，那是不成立的。

**额外收获**：工作流线已经自己写了一份 `workflow/evidence/WF-003-2026-10-31-publish-v2/materials-stale-publish-claims.md`，
其中已经点名了 `docs/demo-script.md:124`。我这份是**独立复核**，结论一致。
✅ 兜底 = 改口径，已写入 [`脚本修订建议.md`](脚本修订建议.md) 与 [`timeline-3min.md`](timeline-3min.md) §6。

---

## F6 · 本机 HTTPS 整体不可用　【已复现】

**实测**：
```
$ curl -sS -m 8 -o /dev/null -w 'code=%{http_code}' https://cloud.dify.ai/
code=000
   curl exit=35
   stderr: curl: (35) schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)

$ curl -sS -m 8 -o /dev/null -w 'code=%{http_code}' http://www.baidu.com/
code=200
   curl exit=0
```
Python 用另一套 TLS 栈，同样失败：
```
  https://cloud.dify.ai/  -> ERR URLError: <urlopen error [SSL: CERTIFICATE_VERIFY_FAILED]
                                  certificate verify failed: unable to get local issuer certificate (_ssl.c:1010)>
  https://www.baidu.com/  -> ERR URLError: <urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] ...>
```
DNS 指向保留段：
```
$ nslookup cloud.dify.ai
Addresses:  fdfe:dcba:9876::58
            198.18.0.94
```
`198.18.0.0/15` 是 **benchmarking 保留段**，不是公网真实地址 → 本机处于**拦截式代理**环境。

**结论与边界（必须这样说）**：
- 本机**不是断网**（明文 HTTP 到 baidu 是 200），而是 **HTTPS 链不受信**。
- 因此**本机无法预演模式 A**。时间轴 0:30–1:00 的真实模型段，本轮**未能在本机验证**。
- **不能推断会场网络同样如此**。
- 正因为本机**连预演都做不到**，模式 C 兜底必须万无一失。

**兜底（已实测）**：`docs/demo/replay/offline-replay.html`
```
$ node web/.tmp/demo-rehearsal/shot.mjs 10-offline-replay-top \
    "file:///C:/Users/lenovo/Desktop/giftwise/docs/demo/replay/offline-replay.html" 1600 1000
{
  "title": "GiftWise AI · 离线兜底回放（演示备份）· 2026-10-31T00:47",
  "readyState": "complete",
  "bodyChars": 13118,
  "scrollW": 1600, "clientW": 1600,
  "horizontal_overflow": false,
  "console_errors": [],
  "failed_requests": []
}
```
✅ `file://` 直开、0 控制台错误、0 失败请求、无横向溢出、53.5 KiB、**零外部资源引用**。

---

## F7 · Python `subprocess` 在沙箱下 `WinError 5`　【已复现】

```
Traceback (most recent call last):
  File "docs/demo/tools/build-snapshot.py", line 168, in main
    HEAD = subprocess.run(["git","rev-parse","HEAD"], capture_output=True, ...)
  ...
PermissionError: [WinError 5] 拒绝访问
```
崩在 `_winapi.CreatePipe`。任何"起子进程并取输出"的写法在本机环境下都会崩——
这会让自检脚本、版本冻结脚本、日志收集脚本**全部失效**。

**兜底（已实测）**：直接读 `.git` 元数据，不起子进程。
顺带发现第二个坑：本仓库**分支 ref 收在 `.git/packed-refs` 里，`.git/refs/heads/` 是空的**，
所以"只读 `.git/<ref>` 文件"会得到 `?`。正确做法是**回退查 `packed-refs`**。
```
$ bash docs/demo/bin/preflight.sh
8. 版本冻结（评分规则 1.4）
  当前 HEAD：351330da346f7382d86d34d822bd000b7228c3c2
```
✅ 修正后 HEAD 正确解析。

---

## F8 · `chrome.exe --headless` 在沙箱内无法启动　【已复现】

```
$ "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
    --no-sandbox --remote-debugging-port=9345 --user-data-dir=... about:blank
[ERROR:crashpad_client_win.cc:431] OpenProcess: 拒绝访问。 (0x5)
[FATAL:mojo/public/cpp/platform/platform_channel.cc:112] Check failed: . : 拒绝访问。 (0x5)
[ERROR:crashpad_client_win.cc:145] crash server failed to launch, self-terminating
[exit code: 127]
```
与 F7 同源：沙箱不允许建命名管道 / 跨进程句柄。

**兜底（已实测）**：**复用**一个已经在跑的 CDP 端点，为每次截图**新建一个独立 target，截完立刻关闭**，
不碰别人已有的页面。已用这种方式产出全部截图，全程 0 控制台错误。
```
$ node web/.tmp/demo-rehearsal/shot.mjs 01-web-mock-top http://127.0.0.1:8791/ 1440 900
{ "file": ".../01-web-mock-top.png", "readyState": "complete",
  "hasMockBanner": true, "console_errors": [], "failed_requests": [] }
```
✅ 已验证（同时证明 F8 不影响"用真实浏览器验证界面"这个目标）。

**对录屏的含义**：现场**录屏**同样需要浏览器。如果演示当天浏览器自动化不可用，
就用**人工录屏**——回放页本身可以在正常浏览器里手动操作，不需要自动化。

---

## F9 / F10 · 脚本里的数字已过期　【已复现】

| 项 | 脚本写的 | 本轮实测 / 最新归档 | 证据 |
| --- | --- | --- | --- |
| 单元测试 | **322** 项 | **329** 项 | `python -m unittest discover -s tests -q` → `Ran 329 tests in 0.298s  OK` |
| stage_c 测试 | 39 项 | 39 项（一致） | `Ran 39 tests in 0.095s  OK` |
| 本机探针 | 46 项 | 46 项（一致） | `local probes: 46 passed; 0 failed; model calls: 0` |
| Dify 模型调用 | **10** 次 | **13** 次 | `WF-003-2026-10-30.md:1388`、v2 README §19 |
| Dify tokens | **34,127** | **38,326** | 同上（前几轮 11 次/35,614 + v2 2 次/2,712） |

**影响**：现场照读旧数字、屏幕显示新数字 → 被追问时很被动。数字类口径**一律以现场屏幕为准**。
✅ 兜底：`preflight.sh` 与 [`demo-rehearsal-record.md`](demo-rehearsal-record.md) 都记录**实际读数**，现场报实际值。

---

## F11 · `case2/case5` 被标为"真实运行记录"，实际未接模型　【已复现】

**脚本原文**（`docs/demo-script.md:121`、`:215`-`:216`）：
> 切归档真实修订记录（case2/case5）｜证据性质：**已归档的真实运行记录**
> D5 = 节点级输入输出：`N4[repairable]→N5→N6→N7b` ← `dify-node-io-case2*.md`

**实测（节点名逐字）**：
```
workflow/evidence/WF-003-2026-10-30/dify-node-io-case2_over_budget_repair_passes.md
  端到端耗时：1099 ms
  N2 需求分析与三候选（占位·未接模型）      0.059982 s
  N5 一次修订（占位·未接模型）              0.055171 s

workflow/evidence/WF-003-2026-10-30/dify-node-io-case5_persistent_failure.md
  端到端耗时：1018 ms
  N2 需求分析与三候选（占位·未接模型）      0.057766 s
  N5 一次修订（占位·未接模型）              0.099386 s
```
文件头也写着：`placeholder: true 与 model_called: false 表示该节点未调用模型`。

**影响**：这 5 份（case1–case5）是**确定性夹具跑**——工作流真的执行了、代码节点真的跑了，
但**模型没有被调用**。把它们当作"真实运行"展示，评委一问"这次调用模型了吗"就会很难回答，
因为节点名上**逐字写着"占位·未接模型"**。

**兜底（已定位正确的素材）**：真实模型的修订链路在这里：
```
workflow/evidence/WF-003-2026-10-30/dify-real-node-io-real1_normal_200.md
  头部：# 节点级输入输出原文（真实模型调用） · real1_normal_200
  N2 需求分析与三候选（真实 LLM）   model_name = "deepseek-v4-flash"
  N5 一次修订（真实 LLM）           latency = 3.026
  total_tokens = 3811
  → N4[repairable] → N5 → N6 → N7b → End B，repair_count = 1
```
✅ 两份都已提取进离线快照：R-03（真实模型修订链路）与 R-05（占位夹具，明确标注未接模型）。
**措辞**：case* 应称"**确定性夹具跑**"或"工作流确定性路径记录"，**不要**称"真实运行记录"。

---

## F12 · 演示 `FORBIDDEN_TAG` 时只改名字不会触发　【已复现】

**我最初的错误夹具**：把候选 `c2` 的 `name` 改成"精酿啤酒品鉴套装"、`description` 写"含酒类"，
然后期待 `FORBIDDEN_TAG`。

**实测**：
```
[FAIL] R5 注入含酒候选 → 期望 FORBIDDEN_TAG/TERM 命中
   batch_status: "passed", all_codes: []
```

**原因**（`validator/rules.py:205-207`）：
```python
for j, tag in enumerate(arrays["tags"]):
    if tag and _tag(tag) in context["forbidden_tags"]:
        _error(errors, "FORBIDDEN_TAG", f"{path}.tags[{j}]", "候选包含明确禁止的类别")
```
禁忌**类别**只在候选**自己声明的 `tags`** 上匹配；自由文本由 `forbidden_terms` 另行负责。

**这不是产品缺陷，是规则语义。** 我把它作为**反例**保留在演示脚本里（第 5 步），因为它本身就是个好讲点。

**兜底（已实测）**：改 `tags` 而不是名字。
```
[PASS] R5  c2.tags=[alcohol] → FORBIDDEN_TAG     c2_errors: ["FORBIDDEN_TAG"]
[PASS] R5b 只改文本/不声明 tags → 实测 passed（不是缺陷，是规则语义）
```
✅ 两条都已通过，且第 5 步专门用来**防止现场误判**。

**现场纪律**：脚本 B8 声明"没有自然触发的 `FORBIDDEN_TAG` 证据"——
所以我构造的这个是**主动注入夹具**，**不要说成"自然触发"**。脚本这点已经写对了，我保持。

---

## F13 · 投影分辨率变化　【已测，未发现溢出】

6 种分辨率实测（`shot.mjs` 报告 `scrollW` vs `clientW`）：

| 分辨率 | 横向溢出 | 模拟标识可见 | 控制台错误 |
| --- | --- | --- | --- |
| 1920×1080 | 否 | 是 | 无 |
| 1600×900 | 否 | 是 | 无 |
| 1440×900 | 否 | 是 | 无 |
| 1366×768 | 否 | 是 | 无 |
| 1280×720 | 否 | 是 | 无 |
| 1024×768 | 否 | 是 | 无 |

✅ 结论：**没有分辨率导致的横向溢出**。这一项**不需要兜底**。
（截图存于 `docs/demo/shots/RES-*.png`。）

---

## F14 · 另一个 Agent 正在写文件导致 404　【未复现】

**任务书明确点名这个场景**，所以我把探针建起来并跑了：

**做法**：25 秒里持续拉取 `/`、`/app.js`、`/styles.css`、`/tokens.css`（每 400 ms 一次，共 62 次采样），
同时记录被服务文件的 mtime/size 前后快照。

**实测结果**：
```json
{
  "duration_s": 25,
  "samples": 62,
  "bad_responses": [],
  "verdict": {
    "transient_failures_observed": 0,
    "content_changed_during_probe": false,
    "content_shape_varied": false
  },
  "files_changed_during_probe": []
}
```

**诚实结论**：**本轮没有复现**。在 25 秒窗口内 0 次 404/5xx，页面字节数稳定。
原因是 `web/public/` 下的文件在被探测期间**没有被写入**（最新 mtime `app.js` 23:02、`index.html` 00:07、`landing.css` 00:14，
而探测发生在 ~00:55）。

**我不会把它写成"已发现的缺陷"** —— 它没有发生。

**但我把缓解规则做出来并验证了**，因为它在多 Agent 环境下是真的会发生的：
`docs/demo/bin/retry-on-404.mjs` —— 用 **mtime 新鲜度**区分"并发中间态"与"真问题"：

| 用例 | 输入 | 实测结论 |
| --- | --- | --- |
| 1 | 请求 `/nope.js`，目标文件**不存在** | `REAL_PROBLEM`，exit 1 ✅ |
| 2 | 请求 `/nope2.js`，参照文件 mtime 很旧（`file_age_s = 6662.4`，约 1.85 h） | `REAL_PROBLEM`，exit 1 ✅ |
| 3 | 请求 `/nope3.js`，参照文件**刚被写过**（`file_age_s = 0.2`） | `TRANSIENT` → 等 1.5 s 重试 → 仍 404 → `TRANSIENT_UNRESOLVED`，exit 2 ✅ |

**现场规则**（照做即可）：
1. 页面 404/500 → **先 `stat` 目标文件 mtime**。
2. mtime 在最近 **60 秒**内 → 判为"有人正在写"，**等 1.5 秒重试一次**。
3. 重试成功 → **不算翻车**，但这说明演示前应冻结相关文件。
4. 重试仍失败 → **记录为真问题**，如实报告，不要用重试掩盖。

✅ 规则三分支均已实测。同时提示：**开演前应停止其他 Agent 对 `web/public/` 的写入**（PM 统一协调）。

---

## F15 / F16 · 两个已量化的观感风险　【已复现，已量化】

### F15 · `landing.css` 单文件 4.1 MB

真实浏览器实测（1440×900）：
```json
{
  "load_ms_observed": 436,
  "fcp_ms": 372,
  "resource_count": 6,
  "total_decoded_bytes": 4182774,
  "top5_by_decoded": [
    {"n": "landing.css", "decoded": 4104653, "dur": 17},
    {"n": "app.js",      "decoded": 50652,   "dur": 6}
  ]
}
```
`landing.css` 占**全部字节的 98%**。
本机 17 ms、FCP 372 ms，**不影响现场**（都是本地回环）。
但如果演示机同时跑别的重活，或有人试图远程访问，这会变成瓶颈。✅ 已量化，**已记为观察项，不阻塞 Demo**。

### F16 · 「模拟数据」横幅只有 12 px

```json
{
  "mock_banner": {
    "found": true,
    "text": "模拟数据 · 未接真实模型",
    "visible_after_scroll": true,
    "top_after_scroll": 22,
    "font_size": "12px",
    "color": "rgb(120, 75, 20)",
    "background": "rgb(255, 244, 223)",
    "ancestor_position": "sticky"
  }
}
```
✅ **好消息**：sticky 常驻，滚动 1800 px 后仍在视口内（top=22 px）——脚本 §2 要求的"全程可见"满足。
⚠ **风险**：**12 px** 在投影上偏小。脚本 §2 要求"高对比配色"和"显著"。
**兜底**：浏览器缩放 **125%–150%**（`Ctrl` + `+`）。若仍看不清，按脚本 §2 的规则"**宁可少展示**"，
改用口播 + 回放页（回放页的模拟数据角标是 16–19 px 且带高对比色块）。
> 该文件属 `web/`（`web/public/styles.css`），我**只记录不改**，已转给 [`脚本修订建议.md`](脚本修订建议.md)。

---

## F17 · Dify 请求侧校验失败不短路，白烧一次模型调用　【归档已复现】

`workflow/evidence/WF-003-2026-10-31-publish-v2/v2-run2-boundary-summary.json`：
```json
{
  "case": "boundary_over_budget_999999",
  "N1_status": "needs_input",
  "N1_errors": [{"code": "LIMIT_EXCEEDED", "path": "request.budget_amount",
                 "message": "预算须在 1 至 10000 之间"}],
  "N2_elapsed_s": 3.900877,
  "N2_usage": {"total_tokens": 1198},
  "N3_status": "error",
  "N3_codes": ["INVALID_JSON"],
  "end_outputs": {"status": "error", "all_passed": false, "repair_count": 0},
  "workflow_status": "succeeded"
}
```
**N1 已经判定输入非法，工作流仍然真实调用了 N2 一次**（3.90 s / 1198 tokens），
最终 `status: error`。

**影响**：现场如果把预算敲错（例如输成区间"100-200"或 999999），会
① 浪费一次模型调用，② 屏幕上出现 `error`，③ 3 分钟里白丢 4 秒。

**兜底（已实测）**：现场输入前先核对数值范围——预算必须是 **1–10000** 的单个数值，不是区间。
`docs/demo/bin/run-rules-layer-demo.py` 与 web 接入层都会在提交前拒绝这类输入；但 **Dify 侧不会**。
**口播提示**（如果真踩到）："这次输入越界了，它没有短路，所以白白调用了一次模型、
最后落在 error——这也是我如实记录的未完成项。"

---

## F18 · MSYS 改写 curl 参数　【已复现】

```
$ curl ... -w '/api/nope -> %{http_code}\n' http://127.0.0.1:8791/api/nope
C:/Users/lenovo/.dsh/dsh-ops/bash-ipc/bdb4e95c3c18523c2e712138/api/nope -> 405
```
`-w` 里以 `/` 开头的字符串被 MSYS 当成路径，重写成了本机绝对路径。

**兜底（已实测）**：
- 用 `export MSYS2_ARG_CONV_EXCL="*"`；
- 或者干脆别让参数以 `/` 开头（`-w 'api-nope-http=%{http_code}\n'` → 正常输出 405）。

✅ 改后正常。**注意**：这个坑会让人**误以为服务端行为异常**，实际是**命令行被改写**。

---

## F19 · 未知 API 路径 GET 返回 405 而非 404　【已复现】

```
$ curl -sS -m 5 --path-as-is -o /dev/null -w 'api-nope-http=%{http_code}\n' \
    'http://127.0.0.1:8791/api/nope'
api-nope-http=405
```
`web/server/server.mjs:210` 在 `handleApi` 里，未匹配的路径会落到 `if (req.method !== "POST") return 405`，
所以 GET 一个不存在的 API 返回 **405 METHOD_NOT_ALLOWED**，而不是 404。

**影响**：低。**不影响 Demo 主路径**。若评委问"未知路由怎么处理"，如实说明即可。
目录穿越防护是好的：
```
/../package.json          -> 404
/%2e%2e/package.json      -> 404
```
✅ 无信息泄露。该文件属 `web/`，**只记录不改**。

---

## F20 · 接入层的**用户可见提示**里也写着"尚未发布"　【已复现】

**F5 的同源问题，但这条更危险**——因为它不是脚本文案，而是**页面上会显示出来的字符串**。

**实测**（`GW_MODE=dify`，无凭证时 `/api/config` 返回）：
```json
{
  "mode": "dify",
  "dify_configured": false,
  "notices": {
    "mock_mode": "⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。"
  }
}
```

**来源**：`web/server/config.mjs` 的 `MOCK_MODE_NOTICE` 常量。

**问题**：这句话在**当前状态下已经不成立**——
工作流**已发布为版本 2**（11 节点、含真实模型节点 `deepseek-v4-flash`），
不是"草稿只有「用户输入 → 代码执行」，无模型、无结束节点"。

**影响**：
- 这段提示是**给用户/评委看的**，措辞比脚本文案更有"官方口径"的分量。
- 若评委看到它，会以为"你们连工作流都没发布"——**比脚本说错更严重**。
- 但它**不是**诚实性问题：在它写下的那个时间点（工作流确实未发布时）它是**准确**的。
  现在它只是**过期**了。

**兜底 / 处理**：
- 该文件属 **`web/**`（不是 DEMO-001 的地盘）**，我**只记录、不修改**。
- 正确修改方向：把"尚未发布可用的礼赠工作流"改为"已发布为版本 2，但**本页面仍使用模拟数据**
  （接入层未联通 Dify）"——**保留**"模拟数据"这个必要声明，只**修正**"未发布"这个过期事实。
- ⚠️ **修改时不要删掉"这不是模型真实输出"这句** —— 它是诚实性声明，必须保留。
- 已转给 [`脚本修订建议.md`](脚本修订建议.md) 的跨线路条目。

**现场应对**：若页面上显示这段过期提示，**主动说明**：
> "这条提示是工作流发布之前写的，措辞已经过期；实际工作流**已发布为版本 2**。
> 但它说的'本页是模拟数据'**仍然成立**，我如实标注。"

---

## F21 · Dify 无凭证 / 超时降级　【已复现，**行为正确，无需兜底**】

任务书要求验证"Dify 不可达 / 没有凭证"这条路径。**实测接入层表现正确**，因此这里记录的是**证据**，不是缺陷。

### 用例 A：`GW_MODE=dify` 但没有凭证

```
$ GW_MODE=dify GW_PORT=8795 node web/server/server.mjs
$ curl -sS -X POST …/api/recommendations --data-binary @body.json
{"status":"error",
 "errors":[{"code":"DIFY_NOT_CONFIGURED","path":"dify",
            "message":"服务端未配置 Dify 地址与密钥，当前只能使用模拟数据模式。"}],
 "mode":"dify",
 "notices":["真实 Dify 调用未成功，未生成任何候选，也没有把模拟数据伪装成真实结果。"]}
[HTTP 503]
```
✅ 进程**存活**（结构化降级，不是崩溃）
✅ **没有**静默切回模拟数据并标成成功
✅ 提示语**主动声明**"没有把模拟数据伪装成真实结果"

### 用例 B：假凭证 + 黑洞地址 + 1.5 秒超时

```
$ GW_MODE=dify GW_PORT=8796 DIFY_API_BASE=http://10.255.255.1/v1 \
    DIFY_API_KEY=fake-key-for-test DIFY_PUBLISHED_VERIFIED=1 DIFY_TIMEOUT_MS=1500 \
    node web/server/server.mjs
$ curl -sS -X POST …/api/recommendations --data-binary @body.json
{"status":"error",
 "errors":[{"code":"DIFY_TIMEOUT","path":"dify",
            "message":"Dify 调用超过 1500 毫秒未返回，已按超时处理。"}],
 "mode":"dify",
 "notices":["真实 Dify 调用未成功，未生成任何候选，也没有把模拟数据伪装成真实结果。"]}
[HTTP 503]
  实测耗时：1633 ms
```
✅ **超时是真的生效的**：配置 1500 ms，实测 **1633 ms** 返回
✅ 进程**存活**，日志里**没有**未捕获异常
✅ 同样**没有**伪装成成功

**结论**：**这条路径不需要额外兜底**。接入层的降级行为符合诚实性要求，可以直接向评委演示
（"我把凭证拿掉，它宁可报错也不假装成功"——这反而是个加分演示点）。

**注意**：环境变量名是 **`DIFY_TIMEOUT_MS`**（不是 `CLIENT_TIMEOUT_MS`），
配置项还有 `DIFY_API_BASE` / `DIFY_API_KEY` / `DIFY_PUBLISHED_VERIFIED`。

---

## 附：与 F1–F21 对应的兜底验证索引

| 兜底方案 | 验证方式 | 结论文件 |
| --- | --- | --- |
| 端口自动避让 | `servers.sh start` 在 8787/8000 被占时避让到 8788/8001 | [`fallback-verification.md`](fallback-verification.md) §1 |
| 可靠停服务 | `servers.sh stop` 释放端口且不动别人的进程 | 同上 §2 |
| 编码自救 | 脚本内 `reconfigure` + `chcp 65001` | 同上 §3 |
| 纯规则层演示 | `run-rules-layer-demo.py` 6/6 通过 | 同上 §4 |
| 离线回放页 | `file://` 直开、0 外部引用、0 控制台错误 | 同上 §5 |
| 单文件自包含快照 | `demo-snapshot.json` 19 块、0 新模型调用 | 同上 §6 |
| 404 并发判定 | `retry-on-404.mjs` 三分支实测 | 同上 §7 |
| 浏览器截图 | 复用 CDP 端点、新建即弃 target | 同上 §8 |
| Dify 无凭证 / 超时降级 | `DIFY_NOT_CONFIGURED` / `DIFY_TIMEOUT` 两条路径实测 | 同上 §9 |
