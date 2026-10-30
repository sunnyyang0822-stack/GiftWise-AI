# deploy/evidence —— 运行证据索引（CLOUD-001）

本目录是 `deploy/` 部署包的**真实运行证据**。所有内容都在本机产生：
没有上传、没有访问云、没有产生费用。
（2026-10-30 晚起，为取得容器证据，本机安装了 WSL2 与 Docker Desktop；安装过程的原始日志已归档在
`raw/docker-2026-10-30/` 下。云资源与镜像仓库仍然**从未**使用。）

## 两条纪律

1. **只记录真实执行过的命令与原始输出**。没有构建就写"未构建"，没有部署就写"未部署"。
2. **区分容器运行与容器布局**。2026-10-30 晚之前本机没有容器运行时，所以"容器布局等价演练"只验证
   Dockerfile COPY 后的**文件树**能否用同一条 CMD 启动，**不等于构建或运行了镜像**。
   **该限制已于 2026-10-30 晚解除**：镜像已真实构建、容器已真实运行（9/9 项通过），见
   [`docker-2026-10-30.md`](docker-2026-10-30.md) 与 `raw/docker-2026-10-30/`。
   上面的布局演练记录**保留为历史**（当时为真），但**不得再被当作"容器化已具备"的证据**；
   真正的容器证据是新增的 `docker-2026-10-30.md`。

## 文件清单

| 文件 | 内容 |
| --- | --- |
| `20261030-local-run.md` | 主报告：逐条命令、状态码、响应体、延迟、内存、日志（任务 2） |
| `container-probe.md` | 容器/编排运行时存在性实测结论：**未构建**及原因（任务 4） |
| `docker-2026-10-30.md` | PM 执行的容器化真实验证 D-0…D-10（9/9 通过） |
| `observability-2026-10-30.md` | 阶段 14：可观测性实现与真跑证据（本机 39/39、容器 24/24、ps1 静态 17/17） |
| `slow-body-2026-10-30.md` | 缺陷 I-2（= 安全自查 S-5）：半开正文/慢连接 —— 修复前复现、修复方案、回归证据（42/42） |
| `local_check.py` | 可复现脚本：启动服务、跑端点矩阵、测延迟、测内存、抓日志 |
| `container_layout_dryrun.py` | 可复现脚本：两种文件集的容器布局等价演练 |
| `container_probe.py` | 可复现脚本：`docker`/`podman`/`wsl`/`kubectl` 等 18 条探测 |
| `observability_check.py` | 可复现脚本：阶段 14 双进程对照 + 39 项断言 |
| `observability_container_check.py` | 可复现脚本：阶段 14 容器内 24 项断言（独立 tag + 只读挂载） |
| `ps1_static_check.py` | 可复现脚本：发布脚本静态校验（AST/参数/凭证扫描/DryRun），17 项断言 |
| `slow_body_check.py` | 可复现脚本：缺陷 I-2/S-5 的半开正文回归（修复前对照 + 修复后 + 容器 PID 1 Threads 前后），42 项断言 |
| `artifact_manifest.py` | 生成版本快照（git HEAD + 关键文件 sha256） |
| `raw/slowbody-20261030-232005/` | 缺陷 I-2 **最终一轮**原始输出（console、check.json、三份端点矩阵、容器 Threads 采样，21 个文件；对应 `server.py` sha256 `083ed548…`） |
| `raw/slowbody-20261030-231148/` | 缺陷 I-2 第二轮（42/42；与最终轮只差正文读完后的额度恢复那一行） |
| `raw/slowbody-20261030-230911/` | 缺陷 I-2 **首轮（失败，保留现场）**：harness 自身 4 处口径 bug，见 `slow-body-2026-10-30.md` 第 6 节 |
| `raw/slowbody-prefix/server.py.before` | **修复前** `deploy/server.py` 的逐字节副本（对照实验用；sha256 `cdc4a981b688359c…`） |
| `raw/slowbody-prefix/pre-fix-head.txt` | 取该副本时的 `git rev-parse HEAD` 与 `git log -1` |
| `raw/slowbody-latest.txt` | 指向最近一轮半开正文回归输出目录 |
| `raw/observability-20261030-224746/` | 阶段 14 本机最终一轮原始输出（access.jsonl、metrics、check.json） |
| `raw/observability-20261030-224548/` | 阶段 14 本机**首轮**原始输出（27/35）：保留我自己的实现缺陷现场（`/healthz` 的 status 被误采） |
| `raw/observability-container-20261030-224951/` | 阶段 14 容器最终一轮（24/24） |
| `raw/observability-container-20261030-224830/` | 阶段 14 容器**首轮**（18/21）：保留验证脚本口径错误现场 |
| `raw/ps1-static-20261030-225356/` | 发布脚本静态校验原始输出（AST、参数表、DryRun、执行策略、加/不加 Bypass 对照） |
| `raw/observability-latest.txt` / `raw/observability-container-latest.txt` / `raw/ps1-static-latest.txt` | 指向最近一轮输出目录 |
| `raw/local-check-latest.json` | 最近一次运行取证的完整结构化结果（39 KB） |
| `raw/local-check-*.json` | 历史运行结果（`212119` 为延迟最好一次，`212549` 为最终一次） |
| `raw/server-8765.log` / `raw/server-8000.log` | 服务端真实 stdout（只含方法、路径、状态码） |
| `raw/container-probe-latest.json` / `raw/container-probe-*.txt` | 18 条容器探测的原始输出 |
| `raw/container-layout-dryrun-latest.json` + 同名 `.log` | 两种布局的启动与请求结果 |
| `raw/container-layout-healthcheck-*.txt` | HEALTHCHECK 等价命令输出（**0 字节 = 成功**，该命令成功时无输出） |
| `raw/ps1-dryrun.txt` | 修复后 `publish-to-uhost.ps1 -DryRun` 的真实输出 |
| `raw/curl-verify-body.txt` / `raw/curl-verify.txt` | 按 README 示例逐条真跑的真实 `curl` 输出与服务端日志 |
| `raw/_curl-body.json` | 上面 curl POST 用的请求体（由 `workflow/examples` 拼装） |
| `raw/*-console.txt` | 各脚本的控制台输出转录（便于快速阅读） |
| `raw/_git_*.txt`、`raw/_manifest_*.txt`、`raw/_netstat_8000.txt` | 命令原始输出（git 状态、netstat 等） |
| `raw/artifact-manifest.json` | 本轮证据对应的确切版本与文件哈希 |
| `raw/_netstat_8000.txt` | 默认监听地址的 `netstat` 原始输出（40 KB） |

## 复现方式

```bash
cd <仓库根>
python deploy/evidence/local_check.py                     # 约 15 秒
python deploy/evidence/container_layout_dryrun.py         # 约 5 秒
python deploy/evidence/container_probe.py                 # 约 3 秒
python deploy/evidence/observability_check.py             # 约 10 秒（39 项断言）
python deploy/evidence/observability_container_check.py   # 约 90 秒（24 项断言，需 Docker）
python deploy/evidence/ps1_static_check.py                # 约 20 秒（17 项断言，不连接任何主机）
python deploy/evidence/slow_body_check.py                 # 约 3 分钟（42 项断言；容器阶段需 Docker）
python deploy/evidence/artifact_manifest.py               # 约 1 秒
```

脚本只请求 `127.0.0.1`。`local_check.py` 会用一个**临时子进程**（端口 8765）跑端点矩阵，
并短暂用默认配置在 8000 端口启动一次以证明默认监听地址，随后立即终止。

## 本轮证据对应的版本

（2026-10-30 晚第三轮刷新；完整逐文件 sha256 见 `raw/artifact-manifest.json`）

- **缺陷 I-2 / S-5 这一轮**：修复前源码副本取自 HEAD `d9f494a737363a7cbc7843b17be1f1fd4bdb4930`
  （2026-10-30 23:02:06，记录在 `raw/slowbody-prefix/pre-fix-head.txt`）；42/42 回归运行时两边的
  `rules_source_sha256` 都是 `1f389dad4c2589fb…`（写在 `raw/slowbody-*/A-endpoint-matrix.json` 的
  `/healthz` 响应体里），因此**逐字节对照的两侧用的是同一份校验规则**。
- 本文档刷新时的 git HEAD：`3be437ba469764be11c5660ab08e7c11da6731b4`（PM 正在并发提交/推送）。
  工作区仍有 57 个已修改、48 个未跟踪条目（含其他 Agent 的文件）。
- **诚实说明（并发改动）**：`validator/rules.py` 与 `tests/test_cases.json` 在 23:11 由**其他 Agent** 修改
  （不是本轮部署改动）。这不影响 I-2 的结论（超时是 socket 层行为，与校验规则无关），
  且本轮所有对照实验的两侧都读取同一份规则（见上一段）。
- 关键文件 sha256（前 16 位）：
  - `deploy/server.py` `083ed548e8bbb056…`（**本轮已改**，修 I-2/S-5；改前为 `cdc4a981b688359c…`，副本见 `raw/slowbody-prefix/server.py.before`）
  - `deploy/observable_server.py` `4c11499108bf12ef…`（**本轮已改**，同步修 I-2）
  - `deploy/Dockerfile` `93fac948ab1a9d1b…`（**未修改**）
  - `deploy/observability.py` `467f98b88d033fcd…`（未修改）
  - `deploy/evidence/slow_body_check.py` `8297e619c08bbcc3…`（本轮新增）
  - `deploy/evidence/observability_check.py` `82b7d5d623195c1a…`（未修改）
  - `deploy/evidence/observability_container_check.py` `9f8490c05706513a…`（未修改）
  - `deploy/evidence/ps1_static_check.py` `e20a96f6a0cd661a…`（未修改）
  - `deploy/publish-to-uhost.ps1` `cce9c8aa23748053…`（修复后，**从未上传**）
  - `validator/rules.py` `1f389dad4c2589fb…`（**其他 Agent 改过**；服务启动与 `/healthz` 都会打印该哈希）
- 采集时工作区有大量未提交改动；**本轮的部署相关文件只在工作区、未提交**（按纪律不自行提交，由 PM 统一处理），
  因此证据对应的是**工作区状态 + 上述 HEAD**。

---

## 当前进度 / 未完成清单 / 阻塞

**当前进度**：证据目录已完成。实际执行过的命令与真实结果：

| 命令 | 真实结果 |
| --- | --- |
| `python deploy/evidence/local_check.py` | exit 0；14 个端点用例 + 5 条原始报文边界；`/healthz` 200、`/validate` 200 且与进程内 `validate()` 逐字节一致、400 `INVALID_PAYLOAD`、400 `INVALID_JSON`、413 `REQUEST_TOO_LARGE`、404 `NOT_FOUND`、501（HEAD/PUT）；默认绑定实测 `TCP 0.0.0.0:8000 LISTENING` |
| `python deploy/evidence/container_layout_dryrun.py` | exit 0；布局 `repo_copy` 与 `upload_minimal` 均 `/healthz` 200、`/validate` `passed`、HEALTHCHECK 等价命令 exit 0 |
| `python deploy/evidence/container_probe.py` | exit 0；`docker`/`podman`/`nerdctl`/`containerd`/`kubectl`/`minikube`/`kind` 全部 `command not found`；`wsl --status` exit 50「未安装适用于 Linux 的 Windows 子系统」 |
| `python deploy/evidence/artifact_manifest.py` | exit 0；**19 个文件** sha256 落盘（含本轮新增的 `slow_body_check.py` 与修复前源码副本）；git HEAD `3be437ba` |
| `python deploy/evidence/observability_check.py` | **exit 0，39/39 断言**；JSONL 154 行零交错、哨兵串 0 命中、指标与账本逐键相等、`/healthz`+`/validate` 与冻结实现逐字节一致 |
| `python deploy/evidence/observability_container_check.py` | **exit 0，24/24 断言**；容器 healthy、非 root、`platform=Linux`、`docker stop` exit 0；请求数 `9 = 6+1+1+1` 完全对账 |
| `python deploy/evidence/ps1_static_check.py` | **exit 0，17/17 断言**；AST 0 错误、参数表 7 项 + `Host` 别名、无硬编码凭证、`-DryRun` 在首个 ssh/scp 前 exit 0 |
| `python deploy/evidence/slow_body_check.py` | **exit 0，42/42 断言**；修复前：14 s 零响应、连接不关、本机 Threads 4→13（12 s 后仍 13）、容器 PID 1 1→10（12 s 后仍 10）；修复后：**10.00 s 返回 408 `REQUEST_TIMEOUT` 并关闭**、Threads 回落 13→4 / 容器 10→1；10 个端点用例逐字节零差异 |
| `python deploy/evidence/observability_check.py`（I-2 修复后复跑） | **exit 0，39/39 断言**（回归未破坏） |
| `python deploy/evidence/observability_container_check.py`（I-2 修复后复跑） | **exit 0，24/24 断言**（回归未破坏） |
| `python deploy/evidence/local_check.py`（I-2 修复后复跑） | exit 0；`parity byte_identical = True`、`T01_normal` 200/`all_passed=True` |
| `curl -sS -i http://127.0.0.1:8000/healthz` 等 4 条（照 README 示例原样执行） | 200 / 200 / 400 / 404，输出见 `raw/curl-verify-body.txt` |

**未完成清单（计划，未执行）**：把可观测入口接进 `Dockerfile` 的 `CMD`（**本轮仍未改 `Dockerfile`**）；
UHost 上传与远端启动；预发端到端验证；成本实测；日志轮转的真实触发；延迟在真实客户端/真实负载下的复测。
**I-2 的残留**：并发连接数仍无上限（只做了超时兜底，未限流、未压测）；请求行/请求头超时仍是标准库的静默关闭。

**阻塞**：`deploy/Dockerfile` 仍未改动（因此"镜像默认带可观测性"尚不成立；`deploy/server.py` 的 QA 冻结已解除，
S-5 已修）；无云资源与授权（无 UHost/EIP/额度，不得自行采购）；本轮部署相关改动只在工作区（未提交，由 PM 统一处理）。
