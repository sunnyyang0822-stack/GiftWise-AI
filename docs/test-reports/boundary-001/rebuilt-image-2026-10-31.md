# 重建交付镜像的独立复验（PM 夜间指令 1–7）

> 本报告数字为 2026-10-31 时点真值；后续变更见 `docs/acceptance-criteria.md` 第 13 节。

- 执行角色：GiftWise｜测试验收 Agent（**独立执行**；全部判定出自我自己跑的原始输出）
- **模型调用：0 次**（未消耗 Dify 额度）；**未执行任何 git 分支操作**
- 结论：**7 项全部成立**，另加 3 项加强核查全部成立、1 次反证尝试失败（结论被加强）

## 0. 归属声明（必须先说清）

**我没有收到部署线对我的正式回报。** 我是靠**镜像 ID 与时间戳变化**判定重建已落地并开始复验的。

而且镜像在我复验期间**又被重建过一次**，这一点必须记录：

| 时刻 | `giftwise-validator:latest` 镜像 ID | 说明 |
| --- | --- | --- |
| 01:08:39 | `c15d1afee2d2` | 我第一次侦察时看到 |
| **01:13:59** | **`d9a4a35763ee`** | 我实际复验的就是这一个 |
| 复验结束（01:19–01:20） | `d9a4a35763ee` | **未再变动** |

**被测对象固定为**：

```
giftwise-validator:latest   Id = sha256:d9a4a35763eeff67a34702c1ee7028c081d57b21ced1814d16ff07f6f0528169
                            RepoDigests = [giftwise-validator@sha256:d9a4a35763ee...]
                            Created = 2026-10-30T17:13:59.527621865Z（= 2026-10-31 01:13:59 +0800）
                            Tags = [giftwise-validator:latest, giftwise-validator:submission-20261101]
```

即 **`latest` 与提交件 `submission-20261101` 是同一镜像**。复验开始时与结束时各记录一次，指纹一致（`evidence/rebuilt-image-digest.txt`）。

**我刻意没有先读部署线的报告**，以免被其结论锚定；其 `deploy/evidence/**` 从未作为我的证据。

复现命令：

```bash
docker run -d --name gw-verify -p 18099:8000 giftwise-validator:latest
docker run -d --name gw-obs    -p 18098:8000 giftwise-validator:latest python -m deploy.observable_server
python tests/acceptance/boundary/probe_rebuilt_image.py
python tests/acceptance/boundary/probe_rebuilt_image_extras.py
```

## 1. 七项复验结果（逐项原始输出）

### 项 1｜`/healthz` 的 `rules_source_sha256` vs 本机 — **成立**

```
本机 sha256(validator/rules.py) = 1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500
本机字节数 / 行数             = 14059 / 278
GET /healthz → HTTP 200
原始响应体: {"status":"ok","service":"giftwise-validator","rules_source_sha256":"1f389dad...d1a500"}
容器自报 rules_source_sha256   = 1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500
判定: 成立 —— 相等
```

容器启动日志亦自述同一哈希：`giftwise-validator listening on 0.0.0.0:8000; rules=1f389dad...`

**我上轮测到的旧镜像（`23a8c3bed390`，273 行、无范围校验）已被替换**——这是本轮最关键的修复确认。

### 项 2｜半开正文：`Content-Length: 100` 只发 5 字节 — **成立**

```
实发字节: 头部 97 字节 + 正文 5 字节（声明 100）
耗时              = 10.01 s
响应首行          = HTTP/1.0 408 Request Timeout
响应字节数        = 234
对端主动关闭      = True
响应原文          = 'HTTP/1.0 408 Request Timeout\r\nServer: GiftWiseValidator/0.1 Python/3.12.16\r\n
                    Date: Fri, 30 Oct 2026 17:16:01 GMT\r\nContent-Type: application/json; charset=utf-8\r\n
                    Content-Length: 27\r\nCache-Control: no-store\r\n\r\n{"error":"REQUEST_TIMEOUT"}'
判定: 408=成立；约10秒=成立；服务端关闭=成立
```

### 项 3｜并发 9 条半开连接 → 线程 1→10→1 — **成立**

```
服务进程 PID=1  线程数(基线)=1
cmdline: python -m deploy.server

并发进行中（9 条半开）线程数 = 10
全部结束后线程数(轮询收敛) = 1

各连接结果（耗时 / 首行）:
   10.00s  HTTP/1.0 408 Request Timeout
   10.02s  HTTP/1.0 408 Request Timeout      ← 共 9 条，全部 408
   ...
判定: 基线=1(期望1) 峰值=10(期望10) 收敛=1(期望1) → 成立
```

线程数取自容器内 `/proc/1/task` 条目数，非估算。

### 项 4｜容器内是否含 `deploy/observability.py`、`deploy/observable_server.py` — **成立**

```
  deploy/observability.py          exists=True  21077 字节
  deploy/observable_server.py      exists=True  15511 字节

容器内 deploy/ 目录清单:
    .dockerignore  Dockerfile  README.md  __init__.py  observability-collection.md
    observability.py  observable_server.py  preprod-plan.md  publish-to-uhost.ps1
    security-review.md  server.py

镜像默认入口:
  Cmd=[python -m deploy.server] Entrypoint=[] Exposed=map[8000/tcp:{}]
```

### 项 5｜并发日志是否仍有粘连行 — **成立**

主探针（12 线程 × 3 = 36 次）：

```
日志总行数 50（本次新增 36 行）
   | 172.17.0.1 - "POST /validate HTTP/1.1" 200 -
   | 172.17.0.1 - "POST /validate HTTP/1.1" 200 -      ← 每行恰好一条记录
含 ≥2 个请求标记的行数 = 0
含 ≥2 个 '<ip> - - [' 的行数 = 0
判定: 成立 —— 无粘连行
```

加强核查（32 线程 × 2 = 64 次）：**成功 64 次、日志恰好新增 64 行（1:1）、粘连 0 行**（详见 §2.C）。

源码层原因（我读了实现，不只是看现象）——`deploy/server.py:146–147`：

```python
# N-4：不用 print（它会分两次写、并发下粘连），走 _log_line 的加锁整行写。
_log_line("%s - %s" % (self.address_string(), fmt % args))
```

`_LOG_LOCK = threading.Lock()` + `with _LOG_LOCK:` 整行写 → 从机制上消除粘连，不只是"这次没复现"。

### 项 6｜`/validate` 与本机规则层是否逐字节一致 — **成立**

14 组同输入，容器 HTTP 响应体 与本机 `validate()` 序列化结果**逐字节比对**：

```
  范围内常规       HTTP=200 容器=242B 本机=242B 逐字节一致=True
  预算上界内       HTTP=200 容器=242B 本机=242B 逐字节一致=True
  预算越上界       HTTP=200 容器=343B 本机=343B 逐字节一致=True
  预算越下界       HTTP=200 容器=343B 本机=343B 逐字节一致=True
  天数越上界       HTTP=200 容器=351B 本机=351B 逐字节一致=True
  格式错(区间)     HTTP=200 容器=388B 本机=388B 逐字节一致=True
  类型错(JSON数字) HTTP=200 容器=343B 本机=343B 逐字节一致=True
  币种错           HTTP=200 容器=350B 本机=350B 逐字节一致=True
  宏观错误组合     HTTP=200 容器=452B 本机=452B 逐字节一致=True
  候选超预算       HTTP=200 容器=242B 本机=242B 逐字节一致=True
  候选天数超期     HTTP=200 容器=242B 本机=242B 逐字节一致=True
  JSON 无效        HTTP=200 容器=366B 本机=366B 逐字节一致=True
  根为数组         HTTP=200 容器=329B 本机=329B 逐字节一致=True
  缺字段           HTTP=200 容器=581B 本机=581B 逐字节一致=True
判定: 14/14 逐字节一致 → 成立
```

**但更强的证据是 §2.A**：容器内 `validator/` 的**文件本身**与本地**逐字节相同**。行为一致 + 文件一致，双重成立。

（注：该 API 对错误输入也返回 HTTP 200，判定结果在响应体的 `status` 字段里——这是既有契约，非异常。）

### 项 7｜`/metrics` 是否默认暴露 — **成立（且证实它确实存在）**

只证明"默认 404"不够——那也可能是"根本没有该功能"。故我用同一镜像的 observable 变体做对照：

```
  默认入口(deploy.server)  GET /healthz → HTTP 200
  默认入口(deploy.server)  GET /metrics → HTTP 404
  默认入口(deploy.server)  GET /readyz  → HTTP 404
  observable 变体          GET /healthz → HTTP 200
  observable 变体          GET /metrics → HTTP 200
  observable 变体          GET /readyz  → HTTP 200

observable 变体 /metrics 内容前 3 行:
# HELP giftwise_up 服务是否在运行（进程存活则恒为 1）
# TYPE giftwise_up gauge
giftwise_up 1

默认入口 /metrics 原文（应 404）: {"error":"NOT_FOUND"}
```

镜像默认环境变量（**无任何开启开关**）：

```
PATH / LANG=C.UTF-8 / GPG_KEY / PYTHON_VERSION / PYTHON_SHA256 /
PYTHONDONTWRITEBYTECODE=1 / PYTHONUNBUFFERED=1 / GIFTWISE_PORT=8000 / GIFTWISE_BIND=0.0.0.0
含 METRIC/OBSERV/ACCESS_LOG/READY 的变量: （无）
默认 Cmd=[python -m deploy.server]  Exposed=map[8000/tcp:{}]
```

**判定：`/metrics` 在镜像内确实存在，但默认入口不提供、默认环境不开启、默认只暴露 8000 端口 → 不是默认暴露。**

## 2. 三项加强核查（不满足于盖章）

### A｜容器内 `validator/` 与本地逐字节比对 — **成立**

```
  validator/__init__.py    本地=   102B  容器=   102B  逐字节一致=True
  validator/rules.py       本地= 14059B  容器= 14059B  逐字节一致=True
  容器内 validator/ 清单: ['__init__.py', 'rules.py']
判定: 成立 —— 全部逐字节一致
```

这比"哈希相等"更强：哈希只证明指纹，逐字节证明**内容完全相同**。

### B｜`/metrics` 作用域 — **成立**（见项 7）

### C｜高并发（32 线程）日志完整性 — **成立**

```
连通性预检: HTTP 200  body=265B
预检日志确认可见: 行数 282 → 283（正式基线 n1=283）

并发 32 线程 × 2 次 = 64 次；成功 64 次；用时 1.27s
日志新增行数 = 64   成功请求数 = 64
判定 1:1 → 成立
粘连行（一行 ≥2 个请求记录）= 0 → 成立(无粘连)
新增行中不含请求记录的行 = 0
判定: 成立 —— 行数 1:1 且无粘连
```

## 3. 反证尝试：慢速滴灌能否拖住连接（**我试图证伪，失败了**）

源码 `_read_body` 声称用**整体总预算**而非"每次 recv 重置"，因此"每 9 秒发 1 字节"也应被同一上限截断。
若实现其实是每次 recv 重置超时，滴灌即可**无限占用线程**——那是真实漏洞。我去证伪：

```
[  0.00s] 已发送请求头 + 第 1 字节
[  9.03s] 已发送第 2 字节（滴灌）
[ 10.05s] 收到 234 字节响应

总耗时        = 10.05 s
响应首行      = HTTP/1.0 408 Request Timeout
实际发送字节数 = 2（声明 100）
判定: 成立 —— 总预算生效，滴灌无法拖住连接
```

第 2 次滴灌（9.03s）**没有**延长截止时间 → 总预算语义成立。

> 首段输出的 `对端关闭 = False` 是我**收到响应即 break**的测量局限，不是服务端行为。我另做一次读到 EOF 的确认：
> `[ 10.02s] 收到 234 字节` → `[ 10.02s] recv 返回空 → 对端已关闭（FIN）` → **`对端关闭: True`**。

## 4. 顺带确认：我此前两轮报的两个缺陷已修复

| 我此前的发现 | 现状 | 证据 |
| --- | --- | --- |
| **I-2** `Content-Length` 大于实发字节 → 线程永久占用、被 HEALTHCHECK 掩盖 | **已修复** | 项 2：10.01s 返回 408 并**关闭连接**；项 3：9 条并发半开在 10.02s 全部收尾，线程 10 → 1 |
| **I-1** 镜像内嵌套 `__pycache__` 泄漏 | **已修复** | 容器内 `__pycache__` 目录数 = **0**、`.pyc` 文件数 = **0**；镜像默认环境含 `PYTHONDONTWRITEBYTECODE=1` |

## 5. 一处**观察**（我不判定为缺陷，但必须报）

项 2 的 408 响应头暴露了解释器版本：

```
Server: GiftWiseValidator/0.1 Python/3.12.16
```

这是 `BaseHTTPRequestHandler` 的默认行为；`deploy/observable_server.py` 提供了 `GIFTWISE_HIDE_PY_VERSION`
开关，且**默认 0 = 保持与原实现一致**（源码注释明说）。故**默认暴露版本号是既有设计**，非本轮回归。
仅作为对外暴露面的信息记录：若日后有安全审计要求收敛指纹，这里是入口。

## 6. 我本阶段犯的探针缺陷（自曝，避免误判部署线）

**共 6 个，其中 2 个会直接产出错误结论**——记录下来，因为它们说明"探针 bug 比被测缺陷更常见"：

| # | 缺陷 | 后果 | 修正 |
| --- | --- | --- | --- |
| 1 | `item6` 的"币种错"用例把元组写成 **2 个元素**（用 `+ "\|" +` 拼串） | 解包 `ValueError`，项 6 无法运行 | 改为正常三元组 |
| 2 | `item5` 只读 `docker logs` 的 **stdout**，而 HTTP 访问日志走 **stderr** | 会读到空日志，把"读不到"误判成"日志正常" | 封装 `container_logs()` 合并 stdout+stderr |
| 3 | `docker run -d` 后我按 **8080** 映射端口，实际镜像暴露 **8000** | 健康检查取不到响应 | 改 `-p 18099:8000` |
| 4 | **`\| tee file \| head -60`**：`head` 先退出 → SIGPIPE **杀死探针** | 项 6/7 根本没跑，输出却像"跑到一半" | 去掉管道，直接重定向到文件 |
| 5 | 并发脚本 URL **漏了端口**（`http://127.0.0.1/validate`） | 64 次请求全打到 80 端口瞬时被拒 → **0.00s、0 行日志**，差点报成"日志 1:1 不成立"的假缺陷 | 补 `:{PORT}`，并**加连通性预检**（预检失败即判本项无意义） |
| 6 | 并发脚本在**预检日志落盘前**就取基线 `n0` | 65 行 vs 64 次请求 → **假"不成立"**，若上报就是冤案 | 先取 `n0` → 发预检 → **轮询等该行可见**得 `n1` → 再并发；并轮询等日志落盘 |

> 第 5、6 两条是我差点**误告部署线**的两处。最终报告里的"成立"是在修掉它们之后重跑得到的。

## 7. 未核实 / 本次没做的（如实列出）

1. **没有验证部署线自己的报告内容**：我刻意先不读 `deploy/evidence/**`，避免锚定；其结论未作为我的证据。
2. **只复验了一个镜像**（`latest` = `submission-20261101` = `d9a4a35763ee`·01:13:59）。
   同批的 `obs-check`(`6bbe2a5d401e`)、`slowbody-check`(`5fb1eaff59be`)、`candidate-observable`(`b8d712a83155`)、
   `verify-guide`、`prefix-check`、`coldbuild-20261030`、`pm-baseline-20261030` **未逐一复验**。
   项 2/3/5/7 我是**直接在 `latest` 上**验的（更强：不依赖专用演示镜像），但我不能据此断言其他标签都同步。
3. **镜像仍在变动**：我观察到 `latest` 在 01:08:39 → 01:13:59 之间被重建。我固定了复验期间的指纹，
   但**无法保证部署线此后不再重建**。若再次重建，本报告结论需按新指纹重跑。
4. **`READ_TIMEOUT_SECONDS` 仅验默认值**（10s）：未测试环境变量覆盖、未测试非 10 秒取值下的行为。
5. **线程模型只在 9 条并发下验证**：未测试高并发（如 100/1000 条）下的线程耗尽或拒绝服务表现；
   `ThreadingHTTPServer` 每连接一线程，理论上存在线程爆炸面，**我未评估**。
6. **`/metrics` 只看了前 3 行**：未审计其**全部**指标是否含敏感信息（我只证明了它不默认暴露）。
7. **未测 `GIFTWISE_ACCESS_LOG` 落文件、轮转与保留天数**（`observable_server` 的功能），也未测 `GIFTWISE_HIDE_PY_VERSION=1` 的效果。
8. **项 6 的 14 组输入是抽样**，不是穷举；其完备性依赖 §2.A 的**文件逐字节一致**来兜底。
9. 未验证 `deploy/` 之外的重建一致性（如镜像内 `web/**`、`workflow/**` 是否与工作区同步）——**不在本次 7 项范围内**。
10. 未做真实模型链路与 Dify 相关验证；**本轮 0 次模型调用**。

## 8. 边界与副作用

- **未修改** `validator/**`、`workflow/**`、`web/**`、`deploy/**` 或任何契约文档。
- 本轮新增（我的边界内）：`tests/acceptance/boundary/probe_rebuilt_image.py`、`probe_rebuilt_image_extras.py`、
  本报告与 4 个证据文件。
- **容器**：我启动的 `gw-verify`、`gw-obs` 已 `docker rm -f` 删除；**未重建、未打标签、未推送任何镜像**，未 `docker prune`。
  部署线自己的容器（`gw-obs-check`、`gwbench`）**我一个都没动**。
- **未执行任何 git 分支操作**（无 checkout/switch/branch/merge/rebase/push）。
- 环境：Docker Desktop 29.9.2；容器内 Python 3.12.16；宿主 Python 3.12.12。

## 9. 证据索引

| 文件 | 内容 |
| --- | --- |
| `evidence/rebuilt-image-verify.txt` | **7 项复验完整原始输出**（含总判定 9/9 成立） |
| `evidence/rebuilt-image-extras.txt` | 加强核查 A/B/C 完整原始输出（3/3 成立） |
| `evidence/rebuilt-image-slowdrip.txt` | 慢速滴灌反证尝试 + 关闭确认（原始输出） |
| `evidence/rebuilt-image-digest.txt` | 被测镜像指纹固定（复验开始/结束各一次） |
