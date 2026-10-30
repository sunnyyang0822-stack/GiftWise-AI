# deploy/ —— GiftWise 规则 API 部署包（CLOUD-001）

本目录只负责**部署确定性规则 API**（`POST /validate`、`GET /healthz`）。
它不包含 Dify 凭证、不调用模型、不访问外部网络、不含真实商品数据。

负责人：GiftWise｜部署 Agent（Issue [#10](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/10) CLOUD-001，阶段 12 + 14）。
本目录此前不属于任何文件线，本 Issue 即认领声明。

## 目录内容与状态

| 文件 | 职责 | 真实验证状态 |
| --- | --- | --- |
| `server.py` | 最小 HTTP 规则 API，复用 `validator/rules.py` | **已在真实进程运行并请求**（本次未修改） |
| `Dockerfile` | `python:3.12-slim` + 非 root 用户 + HEALTHCHECK | **已构建成功并真实运行**（2026-10-30 晚）：镜像 `giftwise-validator:latest`／ID `b42f408b4f07`／`docker images` **178 MB**；冷构建 2.2 s、热构建 0.6 s；容器内 `/healthz` 200、`/validate` 与本机纯函数逐字节一致；证据 [`evidence/docker-2026-10-30.md`](evidence/docker-2026-10-30.md) |
| `.dockerignore` | 收窄构建上下文 | **已随真实构建实测生效**：Docker 只读取**构建上下文根目录**的 `.dockerignore`，因此实际生效的是**仓库根 `.dockerignore`**（本次新增：排除 `.git`、`.tmp`、`tests`、`workflow`、`docs`、`web`、`deploy/evidence`、`*.msi`、`*.exe` 等）；原 `deploy/.dockerignore` **保留**并加指向说明，仅在 context = `deploy/` 时才起作用 |
| `publish-to-uhost.ps1` | 上传三个文件到 UHost 并远端构建启动 | **从未上传过任何主机**；本次修复两个致命缺陷并用 `-DryRun` 实测参数拼装 |
| `evidence/` | 运行证据、探针脚本与原始输出 | 本次新增，见 `evidence/README.md` |
| `observability-collection.md` | 阶段 14 采集与落点实现方案 | 本次新增，纯设计，未实现代码 |
| `preprod-plan.md` | 预发候选方案、成本、风险与待确认事项 | 本次新增，纯方案，未采购未部署 |
| `security-review.md` | 安全与健壮性自查 | 本次新增，含实测证据 |

## 依赖

- Python **3.12**（实测 3.12.12；仓库自带测试与 CI 均按 3.12）。
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

也可以直接用 `python deploy/server.py`。环境变量：

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
# 实测：冷构建 2.2 s（含拉取基础镜像）；热构建 0.6 s；二次构建可复现成功
# 镜像：giftwise-validator:latest  ID b42f408b4f07  docker images 178 MB（inspect 169.4 MB）
# 基础镜像：python:3.12-slim  digest sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159

# 2) 运行（只绑回环，供本机演示）
docker run -d --name gw-val -p 127.0.0.1:8000:8000 giftwise-validator:latest
# 实测：启动到 /healthz 返回 200 耗时 0.75–1.01 s；运行内存 14.41–17.86 MiB；CPU 0.01%

# 3) 健康检查（打到容器）
curl -sS http://127.0.0.1:8000/healthz
```

`/healthz` 返回的 `rules_source_sha256` 与本机 `validator/rules.py` 的 sha256 `4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3` **一致**。

`POST /validate` 的容器响应与**同一进程内**调用 `validator.rules.validate(...)` 的结果**逐字节一致**（`all_passed = true`）。

容器内错误路径 5 项**全部符合契约**：非法 JSON → `400 INVALID_JSON`；载荷类型错误 → `400 INVALID_PAYLOAD`；未知路径 → `404 NOT_FOUND`；**无 `Content-Length`（原始 socket 写入）→ `413 REQUEST_TOO_LARGE`**；超长请求体 → `413 REQUEST_TOO_LARGE`。

镜像内容与安全：镜像内文件树仅 **9 行**，不含 `.git`／`tests`／`docs`／`workflow`／`web`／`deploy/evidence`；`docker history` 对 `sk-`／`gho_`／`PRIVATE KEY` **零命中**；容器以**非 root（uid 10001）**运行。

完整 9/9 汇总见 [`evidence/docker-2026-10-30.md`](evidence/docker-2026-10-30.md)；12 个原始输出文件见 [`evidence/raw/docker-2026-10-30/`](evidence/raw/docker-2026-10-30/)。

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
| `POST /<其它路径>` | 404 | `{"error":"NOT_FOUND"}` |
| `HEAD` / `PUT` 等未实现方法 | 501 | 标准库 HTML 错误页（**不是** JSON） |

注意：**业务校验不通过时仍是 HTTP 200**，失败信息在响应体的 `status`/`all_passed`/`errors` 里
（实测 `{"request_json":"{}"}` → 200 + `status=needs_input`）。这一点与 `validator.rules.validate` 的契约一致，
调用方不能只看 HTTP 状态码。

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
9. **镜像已真实构建并成功运行（2026-10-30 晚）**：`docker build -t giftwise-validator:latest -f deploy/Dockerfile .` 成功；
   冷构建 2.2 s（含拉取基础镜像）、热构建 0.6 s；镜像 ID `b42f408b4f07`，`docker images` **178 MB**（inspect 169.4 MB）；
   基础镜像 `python:3.12-slim` digest `sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159`。
10. **容器内端点矩阵真实通过**：`/healthz` 200（启动到可接受连接 **0.75–1.01 s**）、`/validate` 与本机纯函数**逐字节一致**、
    5 项错误路径符合契约、容器以**非 root（uid 10001）**运行；运行内存 **14.41–17.86 MiB**、CPU 0.01%；
    镜像内文件树仅 9 行，`docker history` 对密钥模式零命中。
    证据：[`evidence/docker-2026-10-30.md`](evidence/docker-2026-10-30.md)（9/9）＋ [`evidence/raw/docker-2026-10-30/`](evidence/raw/docker-2026-10-30/)（12 个原始输出）。

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
5. `/validate` 的 `INTERNAL_ERROR`（500）分支**未能诱导触发**（`validate()` 内部已捕获所有异常），
   仅做代码走查，未取得运行时证据。

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
python deploy/evidence/artifact_manifest.py          # 版本快照与文件 sha256
```

原始输出在 `evidence/raw/`，索引见 `evidence/README.md`。所有脚本只做本机操作，不上传、不产生费用。

---

## 当前进度 / 未完成清单 / 阻塞

（本节为 CLOUD-001 收尾状态，2026-10-30 21:30 北京时间；**2026-10-30 晚完成容器化验证后已就地更正**，所有更正处均带日期标注，原记录一律保留）

**当前进度**

- **2026-10-30 晚新增（容器化，真实执行）**：Docker Desktop 29.9.2 安装成功（经 DISM + 官方离线 MSI 绕过 Store 的 `禁止(403)`）
  → `docker build` 成功（镜像 `giftwise-validator:latest`，ID `b42f408b4f07`，178 MB；冷 2.2 s／热 0.6 s）
  → 容器内 `/healthz` 200（启动 0.75–1.01 s）、`/validate` 与本机纯函数**逐字节一致**、5 项错误路径符合契约、非 root（uid 10001）。
  完整证据：`evidence/docker-2026-10-30.md`（9/9）＋ `evidence/raw/docker-2026-10-30/`（12 个原始输出）。
- 已完成 Issue #10 的交付物 1、2、4、5 与交付物 3 中"如实记录未构建"的部分，以及任务 3 的安全自查。
  （**2026-10-30 晚更正**：交付物 3 中"如实记录未构建"的部分已由上述真实构建取代，该记录按纪律保留。）
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
  `deploy/observability-collection.md`、`deploy/evidence/`（README + 报告 + 3 个脚本 + raw 输出）。

**未完成清单（除已标注"已完成"者外，均为计划，无真实执行）**

1. ~~镜像构建与容器内健康检查~~ → **已完成（2026-10-30 晚）**：镜像 `giftwise-validator:latest`（ID `b42f408b4f07`，178 MB）已构建；
   容器内 `/healthz` 200、`/validate` 与本机纯函数**逐字节一致**、5 项错误路径符合契约。证据：`evidence/docker-2026-10-30.md`（9/9）。
2. `publish-to-uhost.ps1` 的远端上传与启动（计划：拿到真实主机、私钥与端口后执行）。
3. 预发环境端到端验证（计划：Dockerfile → UHost → 安全组 → 公网 `/healthz`）。
4. 阶段 14 采集方案的代码实现（`observability-collection.md` 目前只是设计，未写任何采集代码）。
5. 成本数据（计划：拿到 UCloud 当期报价或额度后再填；当前一律记"未知，未测量"）。
6. 鉴权/限流/TLS（计划，尚未决定是否列入比赛范围）。

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
3. **无当前代码的提交**：工作区有 48 条未提交改动（含其他 Agent 的文件），本轮按纪律未 `git add`/未提交，
   因此上述证据对应的是**工作区状态 + git HEAD `89d6624`**，不是某个提交。
   > **更正（2026-10-30 晚）**：该限制已解除。全部工作已提交并推送到分支
   > `release/2026-11-01-submission`（PR [#12](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/12)），
   > 容器化证据随该分支一并提交。上面第 2 条「无云资源授权」**仍然成立**（未采购、未上云）。
