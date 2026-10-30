# 阶段 14 可观测性：实现与真跑证据（2026-10-30）

- 角色：GiftWise｜部署 Agent（Issue [#10](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/10) CLOUD-001）
- 设计依据：[`../observability-collection.md`](../observability-collection.md)（采集与落点方案，本次由"纯设计"推进为"已实现并实测"）
- 边界遵守：本轮**只新增 `deploy/**` 下的文件**；`deploy/server.py` 与 `deploy/Dockerfile` **一个字未改**
  （QA 正在独立复核，冻结中；已用 `git diff --quiet` 核验，见第 6 节）。
- 未做：未采购/未开通任何云资源、未上传任何主机、未推送任何镜像仓库。

> ⚠️ **2026-10-30 晚第三轮更正（后加，务必先读）**：本文档的**实现与断言结论全部仍然有效**，
> 但"`deploy/server.py` 一个字未改"这句**只在本轮当时为真**。
> 之后 QA-001 结束复核并抛出缺陷 **I-2**（= 安全自查 S-5，半开正文永久占用线程），PM 派发修复：
> `deploy/server.py` 已加读超时（默认 10 s）+ **总预算**正文读取 + **408 `REQUEST_TIMEOUT`**，
> `deploy/observable_server.py` 同一缺陷一并修复。**本文档的三套脚本在改动之后全部复跑通过**
> （39/39、24/24、17/17），因此第 5 节"与默认实现逐字节一致"的结论**在改动后仍然成立**；
> 但文中"冻结实现"一词应读作"默认入口 `deploy/server.py` 当时的实现"。`deploy/Dockerfile` 至今**仍未改动**。
> 详见 [`slow-body-2026-10-30.md`](slow-body-2026-10-30.md)。

## 1. 结论

**已实现并真跑通过**：结构化请求日志（不含请求体）、健康与就绪检查、进程级指标（请求数/错误数/延迟分位/RSS）、
`/metrics`（Prometheus 文本 + JSON）、优雅退出。两轮证据：

| 轮次 | 断言 | 结果 | 原始输出 |
| --- | --- | --- | --- |
| 本机双进程（冻结实现 vs 可观测实现对照） | 39 项 | **39/39 通过** | `raw/observability-20261030-224746/`（8 个文件） |
| 容器内（`python:3.12-slim`，只读挂载 + 命令覆盖） | 24 项 | **24/24 通过** | `raw/observability-container-20261030-224951/`（13 个文件） |
| 发布脚本静态校验（**不连接任何主机、不产生费用**） | 17 项 | **17/17 通过** | `raw/ps1-static-20261030-225356/`（7 个文件） |

复现：

```bash
cd <仓库根>
python deploy/evidence/observability_check.py            # 本机双进程对照，39 项断言
python deploy/evidence/observability_container_check.py  # 容器内验证，24 项断言（需 Docker）
python deploy/evidence/ps1_static_check.py               # 发布脚本静态校验，17 项断言（无网络写操作）
```

## 2. 新增文件（均为 `deploy/**`）

| 文件 | 职责 | sha256（前 16 位） | 大小 |
| --- | --- | --- | --- |
| [`deploy/observability.py`](../observability.py) | 指标注册表、JSONL 访问日志、RSS（Windows/Linux 双平台）、Prometheus 渲染、JSONL 汇总 | `467f98b88d033fcd` | 21 077 B |
| [`deploy/observable_server.py`](../observable_server.py) | 可观测入口：**子类化** `deploy.server.Handler`，新增 `/metrics`、`/readyz`、JSONL 日志、SIGTERM 优雅退出 | `30910867bbaf6a49` | 14 941 B |
| [`deploy/evidence/observability_check.py`](observability_check.py) | 本机对照验证脚本（工作负载 + 39 项断言 + 原始输出归档） | `82b7d5d623195c1a` | 28 624 B |
| [`deploy/evidence/observability_container_check.py`](observability_container_check.py) | 容器内验证脚本（24 项断言） | `9f8490c05706513a` | 16 371 B |
| [`deploy/evidence/ps1_static_check.py`](ps1_static_check.py) | 发布脚本静态校验（17 项断言，**不连接任何主机**） | `e20a96f6a0cd661a` | 12 086 B |

依赖面：**只用标准库** + `deploy.server` + `validator.rules`（无第三方包，`grep "^import"` 结果见原始输出）。

### 为什么用"子类化"而不是改 `server.py`

`deploy/server.py` 正被 QA 独立复核（12 项探针含无缓存重建），任何改动都会让复核失效。
因此新入口 `ObservableHandler(BaseHandler)` **只覆写钩子**（`handle_one_request` / `parse_request` /
`send_response` / `end_headers` / `_send` / `log_message` / `do_GET` / `do_POST`），
`/healthz`、`/`、`/validate` 的响应**体**仍由父类原样产出 —— 已用逐字节对比证明（第 5 节）。

## 3. 实现内容与设计文档的对应

| 设计（`observability-collection.md`） | 实现 | 实测验证方式 |
| --- | --- | --- |
| §3 L1 单行 JSON 日志、`GIFTWISE_ACCESS_LOG`、`logging` 模块（不自造锁）、按天轮转 | `observability.AccessLog`（`TimedRotatingFileHandler`，默认保留 7 天）+ `access_log_from_env()` | 152/154 行全部可 `json.loads`；并发 8 线程下**0 行交错** |
| §2 不记请求体，只记摘要/指纹 | 记录 `payload_sha256`、`candidates_sha256`，**不记内容** | 注入哨兵串 `SENTINEL_…` 到 `notes`/`facts[0].text` → 日志命中 **0** 次 |
| §2 run_id/stage **只透传不发明** | 读 `X-GiftWise-Run-Id` / `X-GiftWise-Stage`，缺失记 `null` | `run-obs-check-001`=30 条、`run-obs-conc-002`=80 条、其余 42 条为 `null` |
| §2 错误码沿用既有稳定代码 | 记 `INVALID_JSON`/`INVALID_PAYLOAD`/`MISSING_FIELD`/`NOT_FOUND`/`REQUEST_TOO_LARGE`，**不新建映射** | 指标错误码分布与账本**完全一致** |
| §2 成本固定 `model_calls=0`/`cost=0` | 每条日志与 `/metrics` 都带 `model_calls:0`、`cost{unit:CNY,amount:0}` | 断言全部为 0，无编造 |
| §3 L2 汇总脚本 | `observability.summarize_jsonl()`（只读、无第三方依赖） | 见 `metrics-summary*.json` 与 `observability-check.json` |
| §3 L3 云端集中采集 | **未做**（成本未知，未测量） | —— |

新增/增强的运行能力：

1. **健康检查**：`GET /healthz` 与冻结实现逐字节一致；新增 `GET /readyz`（检查规则指纹、进程、日志落点可写），
   返回 `200 {"status":"ready",…}` 或 `503`。
2. **进程级指标**：`GET /metrics`（Prometheus 文本 v0.0.4）/ `GET /metrics?format=json`。指标清单：
   `giftwise_up`、`giftwise_build_info`、`giftwise_uptime_seconds`、`giftwise_process_resident_memory_bytes`、
   `giftwise_in_flight_requests`、`giftwise_http_requests_total{method,route,status}`、
   `giftwise_http_errors_total{status}`、`giftwise_validate_results_total{result}`、
   `giftwise_validate_error_codes_total{code}`、`giftwise_http_request_duration_ms{_bucket,_sum,_count}`、
   `giftwise_latency_p95_ms{route}`、`giftwise_bytes_{in,out}_total`、`giftwise_metrics_scrapes_total`、
   `giftwise_ready_checks_total`、`giftwise_model_calls_total 0`、`giftwise_cost_cny_total 0.0`。
3. **优雅退出**：SIGTERM/SIGINT/SIGBREAK 后 flush 日志并打印末次指标 JSON（`"event":"shutdown"`），便于 `docker stop` 取证。
4. **基数与注入防护**：指标标签只取已知路由（未匹配归 `__unmatched__`）；日志 `path` 字段剔除控制字符并限长 160。
5. **可选安全项**（默认关闭，保持与冻结实现一致）：`GIFTWISE_HIDE_PY_VERSION=1` 时不回显 Python 版本（安全自查 S-4 的最小修复）。

## 4. 关键真实输出

### 4.1 结构化日志（`raw/observability-20261030-224746/access.jsonl` 第 1 行）

```json
{"ts":"2026-10-30T22:47:47.026+08:00","service":"giftwise-validator","request_id":"e5cfb8ba371644a9","run_id":"run-obs-check-001","stage":"stage14","method":"POST","route":"/validate","path":"/validate","http_status":200,"val_status":"passed","all_passed":true,"error_codes":[],"payload_sha256":"f7c73caf6093d644…","candidates_sha256":"8122251b2a29ec85…","duration_ms":0.781,"bytes_in":2245,"bytes_out":271,"remote":"127.0.0.1","model_calls":0,"cost":{"unit":"CNY","amount":0.0,"source":"deterministic_rules_only"},"rules_source_sha256":"4782255bb9c9ab48…"}
```

### 4.2 `/metrics` 节选（Prometheus 文本）

```
giftwise_up 1
giftwise_build_info{service="giftwise-validator",rules_source_sha256="4782255bb9c9ab48…",python_version="3.12.12"} 1
giftwise_uptime_seconds 1.159
giftwise_process_resident_memory_bytes 28119040
giftwise_in_flight_requests 1
giftwise_http_requests_total{method="GET",route="/healthz",status="200"} 6
giftwise_http_requests_total{method="GET",route="__unmatched__",status="404"} 5
giftwise_http_requests_total{method="POST",route="/validate",status="200"} 34
giftwise_http_requests_total{method="POST",route="/validate",status="400"} 11
giftwise_http_requests_total{method="POST",route="/validate",status="413"} 4
giftwise_http_requests_total{method="PUT",route="/validate",status="501"} 2
giftwise_latency_p95_ms{route="/validate"} 1.016
giftwise_model_calls_total 0
giftwise_cost_cny_total 0.0
```

（`giftwise_in_flight_requests 1` 是因为抓取这一请求正在处理中 —— 计数口径正确。）

### 4.3 本机双进程对照（39 项全过，节选）

- 阶段 1 共 **69** 个请求：`{200: 47, 400: 11, 404: 5, 413: 4, 501: 2}`，**0 个 5xx**。
- 指标 `requests_by_key` 与请求账本**逐键相等**（含 `PUT /validate 501`、`GET __unmatched__ 404`）。
- `/validate` 延迟：`p50 0.781 ms / p95 1.816 ms / p99 2.979 ms / max 4.018 ms`（131 样本）。
- `/healthz` 与 `/validate` 各自独立统计（6 / 131），互不污染。
- 并发 8×10：80 个请求 **0.659 s**（≈**121 rps**，同机客户端、每请求新建 TCP、HTTP/1.0 ⇒ 不等于容量上限）。
- RSS **26.96 MiB**；进程存活 2.133 s；`requests_total 154`、`errors_total 22`（22 = 11+5+4+2，可对账，error_rate 0.142857）。
- 请求数**完全对账**：154 = 70（阶段 1 + 首次抓取）+ 1（JSON 抓取）+ 80（并发）+ 1（并发后抓取）+ 2（回归请求）。

### 4.4 容器内（24 项全过，节选）

- 构建：`docker build -t giftwise-validator:obs-check -f deploy/Dockerfile .` → **exit 0**，0.8 s，
  镜像 `giftwise-validator:obs-check`／`61bdb8815bd9`／178 MB（**独立 tag，未改 Dockerfile**）。
- 运行：命令覆盖为 `python -m deploy.observable_server`，`deploy/` 以 **`:ro` 只读**挂载到 `/app/deploy`，
  端口只绑 `127.0.0.1:8792`（未对公网暴露，也不占用 QA 的 8000）。
- `docker inspect`：`user=giftwise`（非 root）、`ports=map[8000/tcp:[{127.0.0.1 8792}]]`。
- 镜像自带 `HEALTHCHECK` → **healthy**；日志里能看到它的 `/healthz` 记录（3 条 = 我 1 + 探活 1 + 健康检查 1）。
- 容器内 `/healthz` 200 且规则指纹与本机一致；`/validate` 200 且与本机纯函数**逐字节一致**（271 B，`all_passed=True`）。
- 容器内 `/metrics?format=json`：`platform=Linux`、RSS **27.82 MiB**（走 `/proc`，说明 Linux 分支真实生效）。
- 请求数对账：`9 = 我发起 6 + 抓取 1 + 探活 1 + 容器 HEALTHCHECK 1`。
- `docker stop`（SIGTERM）→ **exit code 0**，打印末次汇总 `requests_total=9, uptime=30.733s, RSS=29 167 616 B`。
- 容器内 JSONL 9 行**逐行可解析**，哨兵串与 `request_json` **0 命中**。

### 4.5 发布脚本静态校验（17/17，**从未上传任何主机**）

`python deploy/evidence/ps1_static_check.py` → **exit 0，17/17 通过**。口径：本脚本**从未上传过任何主机**，
以下检查全部不连接远端、不产生费用。原始输出：`raw/ps1-static-20261030-225356/`。

| 断言 | 真实结果 |
| --- | --- |
| 纯 ASCII 且无 UTF-8 BOM（PS 5.1 按 ANSI 读 `.ps1`，BOM 会破坏解析） | 非 ASCII 字节 **0**，无 BOM |
| PowerShell AST 解析 | **0 错误**，375 tokens |
| 参数表（AST） | 7 项齐全：`SshHost:Host`（`Host` 关键字作别名）、`KeyPath`、`User`、`SshPort`、`ServicePort`、`RemoteDir`、`DryRun`；前两项 Mandatory |
| 硬编码凭证扫描 | `PRIVATE KEY`/`password`/`api_key`/`token`/`secret` **0 命中** |
| IP 字面量 | 仅 `0.0.0.0` 与 `203.0.113.10`（RFC 5737 文档网段），无真实主机地址 |
| `-DryRun` 在执行路径上的位置 | `exit 0` 在第 **74** 行，首个 `& ssh`/`& scp` 在第 **78** 行 ⇒ 不传 `-DryRun` 才可能真的上传 |
| `-DryRun` 实跑 | **exit 0**，首行输出 `[DryRun] No ssh/scp/docker will be executed.`；上传清单仅 3 个文件（`validator/rules.py`、`deploy/server.py`、`deploy/Dockerfile`），**不含 `.env`/凭证/数据** |
| 端口映射 | 源码 `-p 0.0.0.0:${ServicePort}:8000`；展开为 `-p 0.0.0.0:8000:8000`；旧缺陷写法（锚定 `-p 0.0.0:<port>`）在代码与输出中**均不存在** |
| **实测坑（已固化）** | 本机 `LocalMachine=Restricted`：不加 `-ExecutionPolicy Bypass` 时 `powershell -File` 直接 **exit 1 / UnauthorizedAccess**；加 `Bypass`（仅本进程生效）后 exit 0。两种输出都已归档 |

> **诚实声明**：本机既没有远端主机，也没有任何"已上传"的记录可供出示。
> 因此这部分证据只能证明"脚本能够正确拼装命令、且 DryRun 路径不会产生任何 ssh/scp"，
> **不能**证明远端流程可用 —— 这一条仍然写在"未验证"里。
> 另外：该静态校验脚本自身也修过 3 处断言缺陷（`Get-Command` 取不到参数表、未加 `Bypass` 导致误判、
> 把正确写法 `0.0.0.0:8000:8000` 的后缀误当成旧缺陷串），中间轮次输出已清理，只保留最终 17/17 轮次。

## 5. 与冻结实现的回归一致性（证明"没有破坏契约"）

| 对比项 | 结果 |
| --- | --- |
| `GET /healthz` 响应体 | 冻结 vs 可观测 **逐字节一致**（135 B），且字段集仍为 `{status, service, rules_source_sha256}` |
| `POST /validate` 响应体 | 冻结 vs 可观测 vs 进程内纯函数 **三方逐字节一致**（271 B，容器内亦一致） |
| 501（`PUT /validate`） | 2/2，仍为标准库 HTML 错误页 |
| 404（未匹配路径，含 `/healthz?x=1` 一类） | 5/5，仍为 `{"error":"NOT_FOUND"}` |
| 413（无 `Content-Length`、超长体） | 4/4，仍为 `REQUEST_TOO_LARGE` |
| `Server` 头 | 仍为 `GiftWiseValidator/0.1 Python/3.12.12`（默认不隐藏，保持与冻结实现一致） |
| 流水线/keep-alive | 与冻结实现**行为一致**：HTTP/1.0 下每连接只应答 1 个请求（对比响应数 1 vs 1） |

**唯一有意的差异**：响应头新增 `X-GiftWise-Request-Id`（便于日志关联），以及新增 `/metrics`、`/readyz` 两个只读端点。
响应体一律未变。

## 6. 真跑中发现的问题（含我自己的缺陷）

| 编号 | 性质 | 现象 | 处置 |
| --- | --- | --- | --- |
| O-1 | **本次实现缺陷** | 首轮真跑指标显示 `validate_results_total{result="ok"}=6`、`needs_input=34`，与账本（31 passed / 3 needs_input）不符 —— 原因是我把**任何**含 `status` 字段的响应体都当校验结果，`/healthz` 的 `{"status":"ok"}`、`/readyz` 的 `"ready"` 被误采 | 已修：只有 `route == "/validate"` 才采集 `status/all_passed/errors`；接口层错误码仍全路由采集。修后指标与账本**完全一致** |
| O-2 | **我的验证脚本口径错** | 首版用手写规格（`_expected_keys`）当期望值，与实际发出的请求（ESC 路径、无 `Content-Length`、keep-alive）漂移，且 `docker run -d` 输出的是 **64 位**容器 ID 我按 12 位断言 | 已修：期望值改为"随每次请求登记的账本"驱动；容器 ID 按 64 位十六进制断言 |
| O-3 | **口径细节** | `/metrics` 的计数在**渲染之后**才记账，所以抓取自身不出现在本次响应里（差 1）；`/readyz` 的 p95 达 54 ms 是因为它要做一次文件可写试探（样本仅 2 条） | 已在脚本与本文写明口径，避免被误读为丢计数 |
| O-4 | **我写的"通过载荷"其实不通过** | 我手搓的 payload 把金额写成数字 `300` 而非十进制字符串 `"300.00"`，`validate` 返回 `status=needs_input`（HTTP 仍是 **200**）并带 34 条 `INVALID_TYPE` | 已改用仓库真实用例 `tests/test_cases.json#T01_normal`，并加**前置断言**（若载荷不 passed 就直接失败），避免"用错误的期望去验证实现" |
| O-5 | **既存行为（非缺陷）** | `Connection: keep-alive` 在 HTTP/1.0 下不被采纳，流水线第二个请求无响应 | 已与冻结实现做一致性对比（都是 1 个响应），并在文档写明原因，不改行为 |
| O-6 | 既存缺陷（本轮已在新入口修掉） | 原实现的访问日志用 `print` 且不 flush：并发交错、强杀丢日志（见 `observability-collection.md` §1） | 新入口改用 `logging`（自带锁 + flush），实测 154 行**零交错**、强杀/优雅退出均不丢 |

> 说明：O-1/O-4 是"实现与期望都错过一次"的真实记录，保留在此以证明证据链不是事后编的。
> 第一轮容器运行（`observability-container-20261030-224830/`）的 3 个 FAIL 即 O-2 的口径错误，
> 原始记录**一并保留**在 `raw/` 下，未删除。

## 7. 已验证 / 未验证 / 无法执行

**已验证（真实命令 + 原始输出）**

1. 结构化日志：每请求一行 JSON，154 行（本机）/ 9 行（容器）**全部可解析**，并发下**零交错**。
2. **不记录请求体**：哨兵串与 `request_json` 在日志中 0 命中（本机与容器各一次）。
3. 指标与请求账本**逐键相等**（本地含 501/404/413 全部分支），错误码分布一致。
4. 延迟分位、RSS、在途请求、成本常量均为真实值；RSS 双平台都跑通（Windows 26.96 MiB / Linux 27.82 MiB）。
5. `/healthz` 与 `/validate` 响应体与冻结实现**逐字节一致**；501/404/413 行为不变。
6. 容器内可观测入口可用，镜像自带 HEALTHCHECK healthy，非 root，SIGTERM 优雅退出（exit 0）。
7. 报告用到的每个数字都能在 `raw/` 下找到原始文件。
8. **发布脚本静态面全部通过**且**从未上传**：AST 0 错误、参数表与 `Host` 别名正确、无硬编码凭证、
   IP 只出现在文档网段、`-DryRun` 先于任何 ssh/scp（静态可证），并实测记录了"不加 `Bypass` 会被拒"这一本机坑。

**未验证**

1. L3 云端集中采集（Loki/Prometheus/云日志服务）——未接任何远端存储。
2. 长稳与轮转：未跑满一天，`TimedRotatingFileHandler` 的按天切割**未被真实触发**。
3. 高基数/大流量压力下的指标内存占用（采样窗口上限 4096/路由，未做压测）。
4. `GIFTWISE_HIDE_PY_VERSION=1` 的隐藏效果**只做了代码路径，未出证据**（默认关闭，未在断言中覆盖）。
5. Windows 上 `SIGTERM` 语义（`CTRL_BREAK_EVENT` 已测通优雅退出；真实 `SIGTERM` 只在 Linux 容器内测到）。
6. **`publish-to-uhost.ps1` 的远端流程（ssh/scp/远端 docker build）从未真实执行**：
   本机没有主机、私钥与授权，静态校验与 `-DryRun` 都不能替代这一点。
7. `/readyz` 的**失败**路径（日志目录不可写 → 503）未构造。

**无法执行（含原因）**

1. 云端任何部署/计费核对 —— 无账号、无额度、未授权（按边界不采购、不开通、不上传）。
2. 镜像仓库推送 —— 明确禁止。
3. 阶段 14 的"端到端跨组件 run_id 追溯" —— 上游接入层尚未产出 `run_id`，本服务只能透传；
   本次证据里的 `run_id` 是**我在测试中构造的**，不是真实接入层产物，**不得当作真实调用链**。
4. 该 Dify 租户平台级追踪（`trace-runs` 返回 `not_collected`），无平台侧调用记录可用。

## 8. 对评分规则的作用（如实）

- **工程完成度与 Demo（20 分）**：可观测性从"只有设计"变为"有实现 + 有真跑证据"，
  且原始输出可复核；但这是后端服务侧证据，**不替代**现场 Demo 的联调演示。
- **云原生架构与技术选型（15 分）**：新增的容器内验证（独立 tag、只读挂载、HEALTHCHECK、优雅退出、非 root）
  是**真实执行**的产物；仍未上云、未用 K8S。
- **成本、性能与工程化分析（10 分）**：现有真实数据为单机/单容器维度的延迟与内存；
  云端资源消耗与费用**仍未测量**，不得填估计值。

---

## 当前进度 / 未完成清单 / 阻塞

**当前进度（本轮真实执行过的命令与结果）**

- `python deploy/evidence/observability_check.py` → **exit 0，39/39 断言通过**；
  输出 `raw/observability-20261030-224746/`（access.jsonl 154 行、metrics-prometheus.txt、
  metrics-summary.json、metrics-summary-after-concurrency.json、observability-check.json、
  两个服务端日志、console.txt）。
- `python deploy/evidence/observability_container_check.py` → **exit 0，24/24 断言通过**；
  输出 `raw/observability-container-20261030-224951/`（docker-version/build/images/run/inspect/health/stop、
  container-access.jsonl、container-logs-full.txt、container-metrics.json、observability-container-check.json）。
- `docker build -t giftwise-validator:obs-check -f deploy/Dockerfile .` → exit 0，0.8 s（独立 tag）。
  `docker run … -p 127.0.0.1:8792:8000 -v <repo>/deploy:/app/deploy:ro … python -m deploy.observable_server` → 容器 healthy。
  `docker stop gw-obs-check` → exit code 0。容器已 `docker rm`，镜像 `giftwise-validator:obs-check` 保留在本机。
- `git diff --quiet deploy/server.py` → **无差异**（**仅在本轮当时为真**；第三轮为修 I-2/S-5 已改该文件，
  改动后本文档三套脚本已复跑通过）；`git diff --quiet deploy/Dockerfile` → **与 HEAD 一致**（QA 冻结未被触碰，至今仍一致）。
- `python deploy/evidence/ps1_static_check.py` → **exit 0，17/17 断言通过**；输出 `raw/ps1-static-20261030-225356/`
  （`ps1-parse.txt`、`ps1-parameters.txt`、`ps1-dryrun.txt`、`ps1-dryrun-without-bypass.txt`、
  `ps1-execution-policy.txt`、`console.txt`、`ps1-static-check.json`）。
  **该脚本仍未上传过任何主机**；本轮也未新增任何上传动作。
- `python deploy/evidence/artifact_manifest.py` → exit 0；git HEAD `bfc7f4a0c33702ad3dcc0d17cf94d51ae73f240f`，
  17 个关键文件 sha256 已落盘（含本轮新增的 5 个文件）。

**未完成清单（都是计划，未执行）**

1. **把新入口接进镜像**：`deploy/Dockerfile` 的 `CMD` 仍是 `python -m deploy.server`。
   这是**有意留白**（QA 冻结期不能改 Dockerfile）。解除冻结后只需把 CMD 改成
   `python -m deploy.observable_server`（一行），并在 README 注明镜像变体的两个 tag。
2. `GIFTWISE_HIDE_PY_VERSION` 的实测证据（安全自查 S-4 的落地验证）。
3. 日志轮转的真实触发（跑满一天或手动改系统时间）。
4. L2 汇总脚本的"阶段 14 报告模板"（`summarize_jsonl()` 已可用，但没产出固定格式报告）。
5. 与接入层对齐 `run_id`/`stage`/修订计数的真实产出（当前只能透传 + 记 `null`）。
6. L3 云上集中采集与成本评估（**未知，未测量**）。
8. 把本轮结论并入 `docs/architecture.md` 的可观测性清单 —— 该文件属架构线，**我未修改**。
9. `publish-to-uhost.ps1` 在**本机**需要 `-ExecutionPolicy Bypass`（`LocalMachine=Restricted`）；
   已在 README 与本文档写明，但**未提交任何策略变更**（不改本机设置）。

**阻塞**

1. ~~**QA 冻结**~~ → **2026-10-30 晚第三轮已解除**（QA-001 抛出 I-2 后 PM 派发修复，`server.py` 已改）。
   **仍然成立的部分**：`deploy/Dockerfile` 未改，"新入口成为镜像默认入口"这一步**仍未做**；
   当前可观测能力通过"命令覆盖 + 只读挂载"验证，属于**已实现但尚未成为默认部署形态**，不得表述为"镜像已默认启用可观测性"。
   > **历史记录（当时为真）**：`deploy/server.py`、`deploy/Dockerfile` 在 QA 出报告前不可改。
2. **上游未产出 run_id**：跨组件调用链无法闭环，本服务的 `run_id` 字段现阶段只能为 `null`（测试构造值不算）。
3. **无云资源授权**：L3 与云端成本数据无法推进（不采购、不开通、不上传）。
