# deploy/ —— GiftWise 规则 API 部署包（CLOUD-001）

本目录只负责**部署确定性规则 API**（`POST /validate`、`GET /healthz`）。
它不包含 Dify 凭证、不调用模型、不访问外部网络、不含真实商品数据。

负责人：GiftWise｜部署 Agent（Issue [#10](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/10) CLOUD-001，阶段 12 + 14）。
本目录此前不属于任何文件线，本 Issue 即认领声明。

## 目录内容与状态

| 文件 | 职责 | 真实验证状态 |
| --- | --- | --- |
| `server.py` | 最小 HTTP 规则 API，复用 `validator/rules.py` | **已在真实进程运行并请求**（本次未修改） |
| `Dockerfile` | `python:3.12-slim` + 非 root 用户 + HEALTHCHECK | **已构建成功并真实运行**（2026-10-30 晚）：镜像 `giftwise-validator:latest`／ID `b42f408b4f07`（**ID 会漂移，仅辅助**）／`docker images` **178 MB**；冷构建 1.72 s（`--no-cache`，有归档）、热构建 0.6 s；容器内 `/healthz` 200、`/validate` 与本机纯函数逐字节一致；证据 [`evidence/docker-2026-10-30.md`](evidence/docker-2026-10-30.md)。<br>**2026-10-31 01:13:59 重建**（PM 夜间指令一次修四件事）：交付镜像 `giftwise-validator:submission-20261101`（= `latest`，构建日期 **2026-10-31 01:13:59 +0800**，ID `d9a4a35763ee`，`docker images` 178 MB = **169.66 MiB**，冷构建 **3.66 s**）。`Dockerfile` 改动＝`COPY deploy/server.py` → **`COPY deploy /app/deploy`**（缺陷 N-1：原来可观测入口根本没进镜像），**默认 `CMD` 保持 `python -m deploy.server`**——即可观测入口**已随镜像交付、但不是默认入口**（`/metrics` 因此不被默认暴露），要用需显式 `python -m deploy.observable_server`。交付标识按 **tag + 构建日期 + `/healthz` 的 `rules_source_sha256`**（= `1f389dad…`）；**镜像 ID 会漂移、且没有 manifest digest**（从未推仓库）。复测：镜像一致性 **9/9**、交付镜像端点矩阵 **10/10 逐字节一致**、日志粘连 **1 行都不粘**。见 [`evidence/image-rebuild-n1n4-2026-10-31.md`](evidence/image-rebuild-n1n4-2026-10-31.md) |
| `.dockerignore` | 收窄构建上下文 | **已随真实构建实测生效**：Docker 只读取**构建上下文根目录**的 `.dockerignore`，因此实际生效的是**仓库根 `.dockerignore`**（本次新增：排除 `.git`、`.tmp`、`tests`、`workflow`、`docs`、`web`、`deploy/evidence`、`*.msi`、`*.exe` 等）；原 `deploy/.dockerignore` **保留**并加指向说明，仅在 context = `deploy/` 时才起作用 |
| `publish-to-uhost.ps1` | 上传三个文件到 UHost 并远端构建启动 | **从未上传过任何主机**；本次修复两个致命缺陷并用 `-DryRun` 实测参数拼装 |
| `evidence/` | 运行证据、探针脚本与原始输出 | 本次新增，见 `evidence/README.md` |
| `observability-collection.md` | 阶段 14 采集与落点方案 | **方案 + 已实现**（2026-10-30 晚）；实现代码见下两行，证据见 [`evidence/observability-2026-10-30.md`](evidence/observability-2026-10-30.md) |
| `observability.py` | 采集实现：指标注册表、JSONL 访问日志、RSS（Win/Linux）、Prometheus 渲染、JSONL 汇总 | **已实现并真跑**（本机 + 容器）；只依赖标准库 |
| `observable_server.py` | 可观测入口：**子类化** `server.Handler`，新增 `/metrics`、`/readyz`、JSONL 日志、优雅退出 | **已实现并真跑**；`server.py` 未被修改 |
| `preprod-plan.md` | 预发候选方案、成本、风险与待确认事项 | 本次新增，纯方案，未采购未部署 |
| `security-review.md` | 安全与健壮性自查 | 本次新增，含实测证据 |

## 依赖

- Python **3.12**（本机实测 **3.12.12**；**交付容器内实测 3.12.16**——基础镜像 `python:3.12-slim` 会随上游打补丁，
  故"文档写的 3.12.12"与"容器 `Server` 头里的 3.12.16"**不一致且会继续漂移**，这是独立审计 N-3 的记录；仓库自带测试与 CI 均按 3.12）。
- 运行时**只用标准库**（`http.server`、`json`、`hashlib`、`decimal`、`re`、`unicodedata`），无第三方包、无 `requirements.txt` 需求。
- 必须能 `import validator.rules`，因此工作目录需为仓库根目录（或把仓库根加入 `sys.path`）。
- 容器路径额外依赖 Docker。**本机已安装 Docker Desktop 29.9.2（引擎 `linux`／`overlayfs`，24 核／8.0 GiB）并完成真实构建与容器内运行**，见"容器真实运行方式（已实测）"。

## 本地真实运行方式（已实测）

```bash
# 1) 显式绑定回环地址，避免默认对外监听
cd <仓库根>
GIFTWISE_BIND=127.0.0.1 GIFTWISE_PORT=8765 python -m deploy.server
# 启动即打印：giftwise-validator listening on 127.0.0.1:8765; rules=<rules.py 的 sha256>
```

**注意（A-1，2026-10-30 实测）**：`python deploy/server.py` **会失败**——此时 `sys.path[0]` 变成 `deploy/`，
报 `ModuleNotFoundError: No module named 'validator'`。请一律使用 `python -m deploy.server`。
环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GIFTWISE_BIND` | `0.0.0.0` | **默认监听所有接口**；本机自测建议显式设为 `127.0.0.1` |
| `GIFTWISE_PORT` | `8000` | 监听端口 |

请求（实测输出，取自 `evidence/raw/local-check-latest.json`，2026-10-30 21:25）：

```bash
curl -sS -i http://127.0.0.1:8000/healthz
# HTTP/1.0 200 OK
# Server: GiftWiseValidator/0.1 Python/3.12.12
# Content-Type: application/json; charset=utf-8
# Content-Length: 135
# Cache-Control: no-store
# {"status":"ok","service":"giftwise-validator","rules_source_sha256":"4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3"}
```

`POST /validate` 的输入是**两个 JSON 字符串**（不是嵌套对象）：

```bash
curl -sS -X POST http://127.0.0.1:8000/validate \
  -H 'Content-Type: application/json' \
  -d '{"request_json":"{\"recipient_relation\":\"pursuit\",...}","candidates_json":"{\"candidates\":[...]}"}'
```

真实通过用例（`tests/test_cases.json#T01_normal`）的实测响应：

```json
{"status":"passed","all_passed":true,"errors":[],"candidate_results":[{"id":"c1","passed":true,"errors":[],"warnings":[]}, ...],"business_data_verification":"not_verified"}
```

响应体与在同一进程内直接调用 `validator.rules.validate(...)` 的结果**逐字节一致**（实测 `byte_identical = true`，367 字节）。

### 容器真实运行方式（已实测）

> **构建上下文必须是仓库根。** `COPY validator` 与 `COPY deploy/server.py` 都是**仓库根相对路径**；若按 `docker build -t ... deploy/`（context = `deploy/`）会直接失败（`not found`）。这是本轮真实构建暴露并已修复的缺陷之一。
> 第二个缺陷：Docker 只读取**上下文根目录**的 `.dockerignore`，原先只放在 `deploy/.dockerignore` 的排除规则**实际不生效**；现已新增**仓库根 `.dockerignore`**，`deploy/.dockerignore` 保留并加指向说明。

```bash
# 1) 构建（必须在仓库根执行）
docker build -t giftwise-validator:latest -f deploy/Dockerfile .
# 实测：冷构建 1.72 s（--no-cache；归档 raw/d9-coldbuild.txt）；热构建 0.6 s；二次构建可复现成功
# 镜像：giftwise-validator:latest  docker images 178 MB（inspect 177,582,258 字节 = 169.36 MiB）
# 注意：镜像 ID / config digest 每次重建都会变，不要当一致性判据；判据用 tag + 构建日期 + rules_source_sha256 与字节数
# 注意：镜像从未推送仓库，所以【没有】manifest digest；docker inspect 的 RepoDigests 只是本地 config digest（≡ 镜像 ID）
# 基础镜像：python:3.12-slim  digest sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159

# 2) 运行（只绑回环，供本机演示）
docker run -d --name gw-val -p 127.0.0.1:8000:8000 giftwise-validator:latest
# 实测：启动到 /healthz 返回 200 耗时 0.750–0.939 s；运行内存 14.45–17.08 MiB；CPU 0.01–0.02%

# 3) 健康检查（打到容器）
curl -sS http://127.0.0.1:8000/healthz
```

`/healthz` 返回的 `rules_source_sha256` 与本机 `validator/rules.py` 的 sha256 `4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3` **一致**。

`POST /validate` 的容器响应与**同一进程内**调用 `validator.rules.validate(...)` 的结果**逐字节一致**（`all_passed = true`）。

容器内错误路径 5 项**全部符合契约**：非法 JSON → `400 INVALID_JSON`；载荷类型错误 → `400 INVALID_PAYLOAD`；未知路径 → `404 NOT_FOUND`；**无 `Content-Length`（原始 socket 写入）→ `413 REQUEST_TOO_LARGE`**；超长请求体 → `413 REQUEST_TOO_LARGE`。

镜像内容与安全：镜像内文件树仅 **9 行**，不含 `.git`／`tests`／`docs`／`workflow`／`web`／`deploy/evidence`；`docker history` 对 `sk-`／`gho_`／`PRIVATE KEY` **零命中**；容器以**非 root（uid 10001）**运行。

完整 9/9 汇总见 [`evidence/docker-2026-10-30.md`](evidence/docker-2026-10-30.md)；12 个原始输出文件见 [`evidence/raw/docker-2026-10-30/`](evidence/raw/docker-2026-10-30/)。

## 可观测入口（阶段 14，已实测）

采集能力实现在**新入口** `deploy/observable_server.py` 里：它**子类化** `deploy.server.Handler` 并只覆写钩子，
因此 `/healthz`、`/`、`/validate` 的响应**体**仍由原实现逐字节产出。
**2026-10-30 晚第二轮更正**：`deploy/server.py` 因缺陷 I-2（= S-5，半开正文把线程占住（**持续到客户端放弃或进程重启**，不是"永久不回收"））已**按 QA 派发修改**
（读超时 + 408，见 [`evidence/slow-body-2026-10-30.md`](evidence/slow-body-2026-10-30.md)）；
`deploy/Dockerfile` 当时仍未改。下列可观测性证据均在这次改动**之后**复跑通过（39/39、24/24）。
**2026-10-31 01:13:59 起已不成立**：`deploy/Dockerfile` 按 **PM 夜间指令**改成 `COPY deploy /app/deploy`——可观测入口的两份实现
（`observability.py`、`observable_server.py`）**已随镜像交付**；但**默认 `CMD` 保持 `python -m deploy.server`**（非默认入口）。
重建后复测：镜像一致性 **9/9**、交付镜像端点矩阵 **10/10 逐字节一致**、日志粘连 0 行（见 [`evidence/image-rebuild-n1n4-2026-10-31.md`](evidence/image-rebuild-n1n4-2026-10-31.md)）。

```bash
# 本机运行（JSONL 落到文件，同时写 stdout）
cd <仓库根>
GIFTWISE_BIND=127.0.0.1 GIFTWISE_PORT=8765 \
GIFTWISE_ACCESS_LOG=deploy/evidence/runtime/access.jsonl \
python -m deploy.observable_server

curl -sS http://127.0.0.1:8765/healthz                 # 与冻结实现逐字节一致（135 B）
curl -sS http://127.0.0.1:8765/readyz                  # 新增：就绪检查（含日志落点可写性）
curl -sS http://127.0.0.1:8765/metrics                 # 新增：Prometheus 文本 v0.0.4
curl -sS 'http://127.0.0.1:8765/metrics?format=json'   # 新增：同一份指标的 JSON 摘要
```

实测要点（原始输出见 [`evidence/observability-2026-10-30.md`](evidence/observability-2026-10-30.md) 与 `evidence/raw/observability-*`）：

- 每请求一行 JSON：`request_id`/`run_id`/`method`/`route`/`http_status`/`val_status`/`error_codes`/`duration_ms`/`bytes_in`/`bytes_out`/`RSS` 无关的进程指标等；**不记录请求体**（哨兵串 0 命中）。
- 并发 8×10 下 **0 行交错**（`logging` 自带锁），154 行全部可 `json.loads`。
- `/metrics` 的请求数、错误码、校验结果分布与"实际发出的请求账本"**逐键相等**；`model_calls_total` 与 `cost_cny_total` 恒为 0。
- 容器内也跑通（独立 tag + 只读挂载 + 命令覆盖，未改 `Dockerfile`）：`platform=Linux`、RSS 27.82 MiB、HEALTHCHECK healthy、`docker stop` 优雅退出 exit 0。

> ~~**未接进镜像**：`deploy/Dockerfile` 的 `CMD` 仍是 `python -m deploy.server`（QA 冻结期不能改）。~~
> ~~解除冻结后只需把 CMD 换成 `python -m deploy.observable_server`（一行）……~~
> **2026-10-31 01:13:59 已接进镜像（PM 夜间指令，缺陷 N-1）**：`Dockerfile` 改成 `COPY deploy /app/deploy`
> → 交付镜像 `giftwise-validator:submission-20261101`（= `latest`，ID `d9a4a35763ee`，构建 2026-10-31 01:13:59 +0800）
> 的 `/app` 有 **13 个文件**且哈希与本机源码逐一对齐，其中包含 `deploy/observability.py` 与 `deploy/observable_server.py`。
> **但默认 `CMD` 仍是 `python -m deploy.server`**：即"可观测入口**已随镜像交付、但不是默认入口**"，
> `/metrics` 与 `/readyz` 默认**不暴露**（`/metrics` 未鉴权，见下方公开风险说明）。
> 要启用可观测入口就显式覆盖：
> `docker run --rm -p 8000:8000 giftwise-validator:<tag> python -m deploy.observable_server`。
> 上面那段"命令覆盖 + 只读挂载"是**历史做法**，保留不改写。

### 状态码契约（全部实测）

| 场景 | 状态码 | 响应体 |
| --- | --- | --- |
| `GET /healthz` | 200 | `{"status":"ok","service":"giftwise-validator","rules_source_sha256":"..."}` |
| `GET /` | 200 | 端点清单 |
| `GET /<未知路径>` | 404 | `{"error":"NOT_FOUND"}` |
| `POST /validate` 合法载荷 | 200 | 校验结果（业务不通过也是 200，见下） |
| `POST /validate` 缺字段 / 字段非字符串 / 顶层非对象 | 400 | `{"error":"INVALID_PAYLOAD","message":"request_json 和 candidates_json 必须是 JSON 字符串"}` |
| `POST /validate` 请求体不是合法 JSON 或非 UTF-8 | 400 | `{"error":"INVALID_JSON"}` |
| `POST /validate` 请求体超过 65536 字节 | 413 | `{"error":"REQUEST_TOO_LARGE"}` |
| `POST /validate` 正文没发完（声明长度 > 实发，超时） | **408** | `{"error":"REQUEST_TIMEOUT"}`，随后**关闭连接**（2026-10-30 晚新增，修 I-2/S-5） |
| `POST /<其它路径>` | 404 | `{"error":"NOT_FOUND"}` |
| `HEAD` / `PUT` 等未实现方法 | 501 | 标准库 HTML 错误页（**不是** JSON） |

注意：**业务校验不通过时仍是 HTTP 200**，失败信息在响应体的 `status`/`all_passed`/`errors` 里
（实测 `{"request_json":"{}"}` → 200 + `status=needs_input`）。这一点与 `validator.rules.validate` 的契约一致，
调用方不能只看 HTTP 状态码。

**超时口径（2026-10-30 晚新增，修缺陷 I-2/S-5）**：`Handler.timeout = 10` 秒（`GIFTWISE_READ_TIMEOUT` 可覆盖），
作用于请求行、请求头、正文读取与响应写出。其中：

- **正文没读完** → 明确的 `408 REQUEST_TIMEOUT` + 关闭连接（实测 10.00 s 返回）；
- **请求行/请求头超时、连上不发数据** → 由标准库静默关闭（不返回响应，实测 3 s 回归用例）；
- 正文读取用**总预算**（不是单次 recv），因此"每 9 秒发 1 字节"的滴流也会被截断。

## 已验证 / 未验证 / 无法执行

### 已验证（有本次真实命令与输出）

1. 服务可在本机真实启动，启动到可接受连接 **563.9 ms**（含解释器启动与 `rules.py` 哈希计算）。
2. 上表 14 个请求用例的状态码与响应体，全部为真实回环请求结果。
3. `/validate` 响应与进程内 `validate()` 逐字节一致。
4. `T01_normal` 通过用例：HTTP 200、`status=passed`、`all_passed=true`。
5. 默认配置确实监听 `0.0.0.0:8000`（`netstat` 实测 `TCP 0.0.0.0:8000 LISTENING`）。
6. 进程常驻内存 **23.47 MiB**（Working Set）；无请求内容进入日志（日志仅方法+路径+状态码）。
7. 容器**布局**等价演练：按 Dockerfile 的 COPY 结果与按发布脚本实际上传的最小文件集，
   两种目录都能用同一条 `CMD python -m deploy.server` 启动，`/healthz` 200、`/validate` 通过、
   Dockerfile 的 HEALTHCHECK 命令 exit 0（**这不是构建镜像**，详见 `evidence/container-probe.md`）。
8. 修复后的 `publish-to-uhost.ps1 -DryRun` 可运行并打印完整计划命令，端口规格为 `0.0.0.0:8000:8000`。
   **运行提示（2026-10-30 晚实测）**：本机 `LocalMachine` 执行策略为 `Restricted`，
   直接 `powershell -File deploy\publish-to-uhost.ps1 …` 会被拒（exit 1 / `UnauthorizedAccess`）；
   需加 `-ExecutionPolicy Bypass`（仅本次进程生效，不改机器设置）：
   `powershell -NoProfile -ExecutionPolicy Bypass -File deploy\publish-to-uhost.ps1 -Host <主机> -KeyPath <私钥> -DryRun`。
   静态校验（17 项，含凭证扫描与 DryRun 顺序）见 `evidence/observability-2026-10-30.md` §4.5 与 `evidence/ps1_static_check.py`。
9. **镜像已真实构建并成功运行（2026-10-30 晚）**：`docker build -t giftwise-validator:latest -f deploy/Dockerfile .` 成功；
   冷构建 **1.72 s**（`--no-cache`，归档 `raw/d9-coldbuild.txt`）、热构建 0.6 s；`docker images` **178 MB**（inspect 177,582,258 字节＝**169.36 MiB**）；
   基础镜像 `python:3.12-slim` digest `sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159`。
10. **容器内端点矩阵真实通过**：`/healthz` 200（启动到可接受连接 **0.750–0.939 s**）、`/validate` 与本机纯函数**逐字节一致**、
    5 项错误路径符合契约、容器以**非 root（uid 10001）**运行；运行内存 **14.45–17.08 MiB**、CPU 0.01–0.02%；
    镜像内文件树仅 9 行，`docker history` 对密钥模式零命中。
    证据：[`evidence/docker-2026-10-30.md`](evidence/docker-2026-10-30.md)（9/9）＋ [`evidence/raw/docker-2026-10-30/`](evidence/raw/docker-2026-10-30/)（12 个原始输出）。
11. **阶段 14 采集已实现并真跑（2026-10-30 晚）**：`python deploy/evidence/observability_check.py` → **exit 0，39/39 断言**；
    `python deploy/evidence/observability_container_check.py` → **exit 0，24/24 断言**。要点：JSONL 每行可解析、
    并发 0 交错、**请求体 0 命中**、指标与请求账本逐键相等、`/healthz` 与 `/validate` 响应体与默认入口逐字节一致、
    容器内 `platform=Linux` 且 `docker stop` 优雅退出（exit 0）。证据：[`evidence/observability-2026-10-30.md`](evidence/observability-2026-10-30.md)。
12. **`publish-to-uhost.ps1` 静态校验 17/17**：`python deploy/evidence/ps1_static_check.py` → exit 0；
    PowerShell AST 解析 0 错误、参数表 7 项与 `Host` 别名正确、无硬编码凭证、IP 字面量仅 `0.0.0.0` 与文档网段、
    `-DryRun` 在首个 ssh/scp 之前 `exit 0`。**该脚本仍然从未上传过任何主机。**
13. **慢连接缺陷 I-2（= S-5）已修并回归（2026-10-30 晚第二轮）**：`python deploy/evidence/slow_body_check.py`
    → **exit 0，43/43 断言**。修复前对照：声明 `Content-Length: 100` 只发 5 字节 → 14 s 零响应、连接不关、
    本机线程 4→**13**（12 s 后仍 13）、容器 PID 1 线程 1→**10**（12 s 后仍 10），而 `/healthz` 始终 200；
    **修复后**：**10.00 s 返回 408 `REQUEST_TIMEOUT` 并关闭**、本机线程回落 **13→4**、容器 PID 1 **10→1**；
    10 个端点用例修复前后**逐字节零差异**。证据：[`evidence/slow-body-2026-10-30.md`](evidence/slow-body-2026-10-30.md)。
14. **改动后复跑既有回归全部通过**：`observability_check.py` **39/39**、`observability_container_check.py` **24/24**、
    `local_check.py` `parity byte_identical = True`。

### 未验证

1. **容器内的容量与并发特性未验证**：未做负载/压测，容器在真实并发下的延迟与内存曲线未知（见下第 3 条）。
   > **历史备注（原文，在采集时刻为真）**：本条原为"**镜像从未构建**：本机无 docker/podman/WSL/containerd，`docker build` 无法执行。
   > 因此 `python:3.12-slim` 是否可拉取、构建是否成功、`USER giftwise` 与 `HEALTHCHECK` 在容器内是否工作，全部**未验证**。"
   > 该状态已于 2026-10-30 晚被真实构建与容器内运行取代，见"已验证"第 9、10 条与 `evidence/docker-2026-10-30.md`。
2. **从未部署到任何云主机**：`publish-to-uhost.ps1` 的 ssh/scp/docker 远端流程从未真实执行，
   `-DryRun` 只证明参数拼装正确。
3. 未做负载/容量测试：延迟数据来自与客户端同机、每请求新建连接（HTTP/1.0）的测量，
   不能作为容量结论，见 `evidence/20261030-local-run.md` 的延迟表。
4. 未做 TLS/反向代理/鉴权：当前 API 没有认证，任何能访问该端口的人都能调用。
   > **公开风险说明（独立审计 N-2，必须随对外材料一起写）**：可观测入口的 `/metrics` 端点**完全未鉴权**——
   > 匿名请求返回 200、伪造 `Authorization: Basic …` 也返回 200，且响应泄露 `rules_source_sha256`。
   > 本次**不修**（该端点不在默认入口路径上：交付镜像默认 `CMD` 是 `deploy.server`，`/metrics` 不暴露）。
   > 结论口径：**「该端点未鉴权，不得直接暴露公网；如需公网访问须前置反向代理与鉴权」**。
5. `/validate` 的 `INTERNAL_ERROR`（500）分支**未能诱导触发**（`validate()` 内部已捕获所有异常），
   仅做代码走查，未取得运行时证据。
6. ~~**可观测入口尚未成为镜像默认入口**：`deploy/Dockerfile` 的 `CMD` 仍是 `python -m deploy.server`，
   容器内验证用的是"命令覆盖 + 只读挂载"，不是"镜像默认带可观测性"。~~
   → **2026-10-31 01:13:59 已解决"入口进镜像"（PM 夜间指令修 N-1）**：`Dockerfile` 改成 `COPY deploy /app/deploy`，
   交付镜像内含 `observability.py` + `observable_server.py`（`/app` 13 个文件、哈希全对齐）。
   **但"默认入口即可观测入口"这件事按 PM 明确要求不做**：默认 `CMD` 保持 `deploy.server`，
   所以正确表述是"**可观测入口已随镜像交付、但非默认入口**"，不得写成"镜像默认启用可观测性"。
   （2026-10-30 晚第二轮更正：原因为"QA 冻结 `Dockerfile`"，冻结已解除，但当时仍未改 `Dockerfile`。）
7. **日志按天轮转未被真实触发**：`TimedRotatingFileHandler` 只在跨天或长时间运行时才会切割，本次未跑满一天。
8. **`/readyz` 的落点探测只覆盖"可写"路径**：未构造日志目录不可写的失败场景。
9. **可观测入口的 `GIFTWISE_HIDE_PY_VERSION=1`（安全自查 S-4 的最小修复）只有代码路径，未出证据**（默认关闭）。
10. **并发连接数仍无上限（I-2 修复的边界）**：超时让每条连接**有界**，但 `ThreadingHTTPServer` 每连接一线程、
    没有连接数上限 —— 10 秒内建立大量连接仍能把线程数堆高。**未做压测**（与第 3 条同源）。
11. **请求行/请求头的超时仍是静默关闭（不返回 408）**：那是标准库 `handle_one_request` 的既有行为，
    本轮未覆写；只有**正文**超时才返回 408。

### 无法执行（含原因）

1. ~~`docker build` / `docker run`~~ → **已解除（2026-10-30 晚）**：本机已装 Docker Desktop **29.9.2**（引擎 `linux`／`overlayfs`），
   `docker build` 与 `docker run` 均已真实执行成功，见"容器真实运行方式（已实测）"与 `evidence/docker-2026-10-30.md`。
   > **历史记录（在采集时刻为真，不得删除）**：本机 `docker: command not found`，且 Docker Desktop、Rancher Desktop、
   > Podman、containerd、WSL 发行版、`kubectl`/`minikube`/`kind` 全部不存在（逐条命令与原始输出见 `evidence/container-probe.md`，
   > 采集于 2026-10-30 21:2x）。
2. 任何 UCloud 操作（开实例、绑 EIP、改安全组、上传）：按任务边界**不得自行采购或上传**，
   也**没有读取任何云凭证**。

## 安全提醒（摘要）

默认 `GIFTWISE_BIND=0.0.0.0` 意味着服务监听所有网卡；在有公网 IP 的机器上，只要安全组放行即**全网可达**，
而该 API 无鉴权、无请求频率限制。自测请显式绑定 `127.0.0.1`；上云时必须用安全组限制来源。
完整问题清单与最小修复建议见 `security-review.md`。

## 证据与复现

```bash
python deploy/evidence/local_check.py                # 本地运行取证（端点矩阵、延迟、内存、日志）
python deploy/evidence/container_layout_dryrun.py    # 容器布局等价演练（两种文件集）
python deploy/evidence/container_probe.py            # 容器运行时存在性探测
python deploy/evidence/observability_check.py        # 阶段 14：双进程对照 + 39 项断言
python deploy/evidence/observability_container_check.py  # 阶段 14：容器内 24 项断言（需 Docker）
python deploy/evidence/ps1_static_check.py           # 发布脚本静态校验（17 项，不连接任何主机）
python deploy/evidence/slow_body_check.py            # 缺陷 I-2/S-5：半开正文修复前对照 + 修复后回归（42 项，容器阶段需 Docker）
python deploy/evidence/artifact_manifest.py          # 版本快照与文件 sha256
```

原始输出在 `evidence/raw/`，索引见 `evidence/README.md`。所有脚本只做本机操作，不上传、不产生费用。

---

## 当前进度 / 未完成清单 / 阻塞

（本节为 CLOUD-001 收尾状态，2026-10-30 21:30 北京时间；**2026-10-30 晚完成容器化验证后已就地更正**，所有更正处均带日期标注，原记录一律保留）

**当前进度**

- **2026-10-30 晚新增（容器化，真实执行）**：Docker Desktop 29.9.2 安装成功（经 DISM + 官方离线 MSI 绕过 Store 的 `禁止(403)`）
  → `docker build` 成功（镜像 `giftwise-validator:latest`，178 MB＝169.36 MiB；冷 1.72 s／热 0.6 s）
  → 容器内 `/healthz` 200（启动 0.750–0.939 s）、`/validate` 与本机纯函数**逐字节一致**、5 项错误路径符合契约、非 root（uid 10001）。
  完整证据：`evidence/docker-2026-10-30.md`（9/9）＋ `evidence/raw/docker-2026-10-30/`（12 个原始输出）。
- 已完成 Issue #10 的交付物 1、2、4、5 与交付物 3 中"如实记录未构建"的部分，以及任务 3 的安全自查。
  （**2026-10-30 晚更正**：交付物 3 中"如实记录未构建"的部分已由上述真实构建取代，该记录按纪律保留。）
- **2026-10-30 晚第二轮新增（阶段 14 可观测性，真实执行）**：新增 `observability.py` + `observable_server.py`
  （**子类化**；当时 `server.py`/`Dockerfile` 一字未改——**截至 2026-10-31 两者都已改动**：`server.py` 修 I-2 与 N-4，
  `Dockerfile` 改成 `COPY deploy /app/deploy`（可观测入口进镜像）但默认 `CMD` 仍是 `deploy.server`），
  实现结构化 JSONL 日志（不含请求体）、`/metrics`、`/readyz`、
  进程指标（请求数/错误数/延迟分位/RSS）与优雅退出。
  `python deploy/evidence/observability_check.py` → **39/39 通过**；`python deploy/evidence/observability_container_check.py`
  → **24/24 通过**；`python deploy/evidence/ps1_static_check.py` → **17/17 通过**（仍**从未上传**任何主机）。
  完整证据：`evidence/observability-2026-10-30.md` ＋ `evidence/raw/observability-*`、`raw/ps1-static-*`。
- **2026-10-30 晚第三轮新增（缺陷 I-2 = S-5，真实执行）**：QA-001 实验证明"声明 `Content-Length: 100` 只发 5 字节 →
  45 s 零响应、连接永不关闭；9 条连接使容器 PID 1 线程 +9 且不回收，而 `/healthz` 仍 200"。
  > **2026-10-31 口径更正（独立审计 N-5）**：上面引的是 QA-001 的原始观测（客户端一直持有连接的那段时间里确实不回收）；
  > 但**不能**表述为"永久不回收"——准确说法是「线程占用**持续到客户端放弃或进程重启**」：
  > 客户端一关闭，线程在数秒内回落（实测 `raw/slowbody-20261031-011814/` 的 F13：Threads 前/中2s/中12s = 1/10/10，
  > **客户端关闭后 = 1**）。修复后（F6）9 条半开连接 → 408、全部关闭、Threads **1 → 10 → 1**。
  按 PM 派发在 `deploy/server.py` 落地读超时（默认 10 s，`GIFTWISE_READ_TIMEOUT` 可覆盖）+ **总预算**正文读取 +
  **408 `REQUEST_TIMEOUT`**，`deploy/observable_server.py` 同一缺陷一并修复。
  `python deploy/evidence/slow_body_check.py` → **exit 0，43/43 断言**（含修复前对照与容器 PID 1 采样）；
  改完后复跑 `observability_check.py` **39/39**、`observability_container_check.py` **24/24**、
  `local_check.py` `parity byte_identical = True`。证据：[`evidence/slow-body-2026-10-30.md`](evidence/slow-body-2026-10-30.md)
  ＋ `evidence/raw/slowbody-20261030-232005/`（21 个原始输出，最终字节版本）。
- 实际执行过的命令（全部在本机、无网络写操作、无费用）：
  - `python deploy/evidence/local_check.py` → exit 0，产出 `raw/local-check-latest.json`（stamp `20261030-212549`）
    与 `raw/server-8765.log`（215 行服务端日志）。
  - `python deploy/evidence/container_layout_dryrun.py` → exit 0，两种布局均 `/healthz` 200、`/validate` `passed`、
    HEALTHCHECK 等价命令 exit 0。
  - `python deploy/evidence/container_probe.py` → exit 0，18 条探测全部记录原始输出；`docker`/`podman`/`nerdctl`/
    `containerd`/`kubectl`/`minikube`/`kind` 均 `command not found`，`wsl --status` exit 50
    （"未安装适用于 Linux 的 Windows 子系统"）。
  - `powershell -File deploy\publish-to-uhost.ps1 -Host 203.0.113.10 -KeyPath <虚构> -DryRun` → exit 0。
  - `python deploy/evidence/artifact_manifest.py` → git HEAD `89d6624`，12 个关键文件 sha256 已落盘。
  - 修复前对照组：`powershell -File deploy\publish-to-uhost.ps1 -Host ... -KeyPath ...` → exit 1，
    `VariableNotWritable`（该脚本此前**完全无法运行**）。
- 已交付文件：`deploy/README.md`、`deploy/security-review.md`、`deploy/preprod-plan.md`、
  `deploy/observability-collection.md`、`deploy/evidence/`（README + 报告 + 多个校验脚本 + raw 原始输出；
  完整索引与脚本清单见 [`evidence/README.md`](evidence/README.md)）。

**未完成清单（除已标注"已完成"者外，均为计划，无真实执行）**

1. ~~镜像构建与容器内健康检查~~ → **已完成（2026-10-30 晚）**：镜像 `giftwise-validator:latest`（ID `b42f408b4f07`，178 MB；**ID 会漂移，仅辅助**）已构建；
   容器内 `/healthz` 200、`/validate` 与本机纯函数**逐字节一致**、5 项错误路径符合契约。证据：`evidence/docker-2026-10-30.md`（9/9）。
  > **2026-10-31 重建三次并复测**（PM 口径更正 + 独立审计三条 + PM 夜间指令四修）：交付镜像为
  > `giftwise-validator:submission-20261101`（＝`latest`，构建日期 **2026-10-31 01:13:59 +0800**，ID `d9a4a35763ee`，rules `1f389dad…`）。
  > 重建**前**的 `latest`（`23a8c3bed390`）确实三处过时：容器内 `validator/rules.py` = `4782255b…`≠本机、`deploy/server.py` = `cdc4a981…`（**不含 I-2 修复**）、
  > `/app` 只有 3 个文件（不含可观测入口）；半开正文探测 26 s **零响应**。
  > 第 1 次（A 版，ID `8304b047cc71`）：文件哈希逐一对齐、半开正文 **408 / 10.02 s / 连接关闭 / 线程回落**，但 `/app` 仍是 3 个文件。
  > 第 2 次（B 版，ID `c15d1afee2d2`）：加 2 行 COPY + `CMD` 换 `deploy.observable_server` → 9/9；**该 `CMD` 改动已被 PM 夜间指令撤回**。
  > 第 3 次（**当前交付**，ID `d9a4a35763ee`）：`COPY deploy /app/deploy`（N-1）＋ `deploy/server.py` 修 N-4 日志粘连 ＋ **默认 `CMD` 保持 `deploy.server`**
  > → `/app` **13 个文件**且哈希全对齐、镜像一致性 **9/9**、端点矩阵 **10/10 逐字节一致**、并发 60 请求后日志粘连 **0 行**（修复前 7 行）。
  > 证据：[`evidence/image-rebuild-n1n4-2026-10-31.md`](evidence/image-rebuild-n1n4-2026-10-31.md)（原始输出 `raw/image-parity-20261031-011520/`、
  > `raw/image-matrix-20261031-011609/`、`raw/log-interleave-20261031-011548/`；更早的 4/9、8/9、9/9 在 [`evidence/image-audit-2026-10-31.md`](evidence/image-audit-2026-10-31.md)）。
  > **没有 manifest digest**：镜像从未推仓库，`RepoDigests` 只是本地 config digest（≡ 镜像 ID）。
2. `publish-to-uhost.ps1` 的远端上传与启动（计划：拿到真实主机、私钥与端口后执行）。
3. 预发环境端到端验证（计划：Dockerfile → UHost → 安全组 → 公网 `/healthz`）。
4. ~~阶段 14 采集方案的代码实现（`observability-collection.md` 目前只是设计，未写任何采集代码）~~
   → **已完成（2026-10-30 晚）**：`observability.py` + `observable_server.py` 已实现并真跑（39/39 本机、24/24 容器）。
   ~~**残留**：尚未接进 `Dockerfile` 的 `CMD`，故"镜像默认带可观测性"仍未成立。~~
   → **2026-10-31 01:13:59 残留已消除**：`Dockerfile` 改成 `COPY deploy /app/deploy`，
   可观测入口**已随镜像交付**；默认 `CMD` 按 PM 要求仍是 `deploy.server`（非默认入口）。
5. ~~把可观测入口设为镜像默认入口：改 `deploy/Dockerfile` 一行 `CMD`，并重跑容器验证（计划）。~~
   → **2026-10-31 01:13:59 按 PM 夜间指令改口径为"进镜像即可、不设为默认入口"**：`COPY deploy /app/deploy`（缺陷 N-1），
   复测镜像一致性 **9/9**、端点矩阵 **10/10**、`/app` 13 个文件哈希全对齐；默认 `CMD` 保持 `deploy.server`。
   （2026-10-30 晚第二轮更正：原阻塞理由"QA 冻结期不能改"当时已不成立，只是 PM 只派发了 I-2。）
6. 成本数据（计划：拿到 UCloud 当期报价或额度后再填；当前一律记"未知，未测量"）。
7. 鉴权/限流/TLS（计划，尚未决定是否列入比赛范围）。
8. 日志轮转的真实触发与 `/readyz` 失败路径（计划）。
9. **并发连接数上限 / 反向代理**（缺陷 I-2 的"更彻底做法"）：本轮只做了超时兜底，
   未限制同时连接数、未压测。计划：前置反向代理或给 `ThreadingHTTPServer` 加并发上限。

**阻塞**

1. ~~**无容器运行时**~~ → **已解除（2026-10-30 晚）**。真实解除过程（可复现，供答辩与文档引用）：
   ① 提权后执行 `dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart`
   与 `... /featurename:VirtualMachinePlatform /all /norestart` → 均 `操作成功完成`，**exit=3010**（成功，待重启生效）；
   ② `wsl --install --no-distribution` 在本机经 **Store 通道返回 `禁止(403)`**，故改走离线路径：从官方 GitHub Release
   取 **`wsl.3.0.3.0.x64.msi`** 并用 `msiexec /i ... /qn /norestart` 安装 → **exit 0**（不经 Store）；
   ③ 重启后以 `install --quiet --accept-license --backend=wsl-2` 静默安装 **Docker Desktop 29.9.2** → **exit 0**；
   ④ 构建与容器内实测结果见"容器真实运行方式（已实测）"。
   > **历史记录（当时为真，不得删除）**：本机无 docker/podman/WSL/containerd，无法构建镜像；安装需产品负责人授权
   > （估 30–60 分钟下载安装 + 需重启生效，且会改变本机环境）。
2. **无云资源授权**：无 UHost、无 EIP、无额度确认，且按边界不得自行采购；这是任务 4/5 无法闭环的唯一原因。
3. ~~**QA 复核冻结（2026-10-30 晚新增）**~~ → **已解除（2026-10-30 晚第三轮）**：QA-001 结束独立复核并抛出
   缺陷 **I-2**（= S-5：半开正文把线程占住，占用**持续到客户端放弃或进程重启**，不是"永久不回收"），PM 派发修复 → `deploy/server.py` **已按 QA 证据修改**
   （默认入口 10 s 读超时 + 408，可观测入口同步修复），回归 43/43，见 [`evidence/slow-body-2026-10-30.md`](evidence/slow-body-2026-10-30.md)。
   ~~**仍然成立的约束**：`deploy/Dockerfile` 未改，所以"把可观测入口设为镜像默认 CMD"这一步**仍然没有做**；~~
   → **2026-10-31 01:13:59 更正**：`Dockerfile` 已改（`COPY deploy /app/deploy`，可观测入口**已随镜像交付**）；
   但"设为镜像默认 `CMD`"这一步是 **PM 明确要求不做的**（默认入口保持 `deploy.server`），
   所以任何"镜像已默认启用可观测性/监控"的表述**仍然不成立**。
   > **历史记录（当时为真，不得删除）**：`deploy/server.py` 与 `deploy/Dockerfile` 在 QA 出报告前不得修改。
4. **上游未产出 `run_id`**：接入层/Dify 还没把 run id 传进来，本服务的 `run_id` 字段现在只能记 `null`
   （本轮证据里的 run id 是**测试构造值**，不是真实调用链）。
5. ~~**无当前代码的提交**~~ → 历史：本轮收集证据时工作区未提交。
   **2026-10-30 晚第二轮现状**：PM 已把此前的交付推送到分支 `release/2026-11-01-submission`
   （PR [#12](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/12)）；
   但**本轮（阶段 14）新增/修改的文件仍只在工作区，未提交**（按纪律不自行提交，由 PM 统一处理）。
   因此本轮全部证据对应的版本与哈希见 `evidence/raw/artifact-manifest.json`（含 git HEAD 与逐文件 sha256）。
   第 2 条「无云资源授权」**仍然成立**（未采购、未上云）。
