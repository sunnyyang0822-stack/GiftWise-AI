# deploy/evidence —— 运行证据索引（CLOUD-001）

> **最新一轮（2026-10-31 01:13:59）**：PM 夜间指令四修（规则同步 / I-2 / N-1 可观测入口进镜像 / N-4 日志粘连）
> 的主报告是 [`image-rebuild-n1n4-2026-10-31.md`](image-rebuild-n1n4-2026-10-31.md)；
> 交付镜像 `giftwise-validator:submission-20261101`（= `latest`，ID `d9a4a35763ee`，仅辅助）：
> 镜像一致性 **9/9**、端点矩阵 **10/10**、I-2 回归 **43/43**（Threads 1→10→1）、日志粘连 **0 行**（修复前 7 行）。

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
| `slow-body-2026-10-30.md` | 缺陷 I-2（= 安全自查 S-5）：半开正文/慢连接 —— 修复前复现、修复方案、回归证据（当时 42/42；2026-10-31 加 F9b 后为 **43/43**） |
| `pr-draft-line-deploy-cloud-001.md` | **给 PM 审的 PR 草稿**（标题/描述/证据/未做项/提交范围）；**未提交、未开 PR** |
| `image-audit-2026-10-31.md` | **口径更正 + 交付镜像重建与三项审计复测**：镜像从未推仓库→**没有 manifest digest**（稳定标识＝tag+构建日期+`rules_source_sha256`）；重建前 `latest` 三处过时逐条复现，重建后 ①②③ 均已修（③ 先按 B、后按 PM 夜间指令改为 `COPY deploy` 且 `CMD` 不变） |
| `image-rebuild-n1n4-2026-10-31.md` | **PM 夜间指令四修的主报告**：① 规则同步 ② I-2（408 + 关闭 + Threads 1→10→1）③ N-1（`COPY deploy /app/deploy`，可观测入口**已随镜像交付但非默认入口**）+ ps1 上传 3→5 文件 ④ N-4（日志粘连 7→0）；含六项复测原始输出、四处口径更正、N-2/N-3/N-5 三条如实记录 |
| `candidate-Dockerfile-observable` | **候选 Dockerfile（非仓库那份）**：现有 Dockerfile + 2 行 COPY，让镜像内含可观测入口；CMD 不变。用于验证审计第 ③ 条的修法（**保留作对照**；PM 已另定用 `COPY deploy` 整目录） |
| `local_check.py` | 可复现脚本：启动服务、跑端点矩阵、测延迟、测内存、抓日志 |
| `container_layout_dryrun.py` | 可复现脚本：两种文件集的容器布局等价演练 |
| `container_probe.py` | 可复现脚本：`docker`/`podman`/`wsl`/`kubectl` 等 18 条探测 |
| `observability_check.py` | 可复现脚本：阶段 14 双进程对照 + 39 项断言 |
| `observability_container_check.py` | 可复现脚本：阶段 14 容器内 24 项断言（独立 tag + 只读挂载） |
| `ps1_static_check.py` | 可复现脚本：发布脚本静态校验（AST/参数/凭证扫描/DryRun），17 项断言 |
| `slow_body_check.py` | 可复现脚本：缺陷 I-2/S-5 的半开正文回归（修复前对照 + 修复后 + 容器 PID 1 Threads 前后），**43 项断言**（2026-10-31 起 F9 用改前 Dockerfile 字节副本构建对照镜像） |
| `image_source_parity_check.py` | 可复现脚本：**镜像 × 源码一致性核验**（容器内文件哈希 vs 本机、`/healthz` 规则哈希、`/app` 文件树、半开正文 26 s 窗口 + Threads 前中后）；重建前/重建后跑同一个。用法 `python deploy/evidence/image_source_parity_check.py <tag> [<tag>…]` |
| `image_container_matrix_check.py` | 可复现脚本：**交付镜像 × 本机进程的端点矩阵逐字节比对**（10 个用例，复用 `slow_body_check.py` 的用例与工具函数）；`parity-diff.json` 为空即一致 |
| `log_interleave_check.py` | 可复现脚本：**缺陷 N-4 日志粘连**（60 并发后统计 `docker logs` 里"两行粘成一行"的条数）；`--with-prefix` 会先用改前源码树构建对照镜像复现粘连。用法 `python deploy/evidence/log_interleave_check.py [--with-prefix] <tag>` |
| `artifact_manifest.py` | 生成版本快照（git HEAD + 关键文件 sha256） |
| `raw/slowbody-20261030-232005/` | 缺陷 I-2 **最终一轮**原始输出（console、check.json、三份端点矩阵、容器 Threads 采样，21 个文件；对应 `server.py` sha256 `083ed548…`） |
| `raw/slowbody-20261030-231148/` | 缺陷 I-2 第二轮（42/42；与最终轮只差正文读完后的额度恢复那一行） |
| `raw/slowbody-20261030-230911/` | 缺陷 I-2 **首轮（失败，保留现场）**：harness 自身 4 处口径 bug，见 `slow-body-2026-10-30.md` 第 6 节 |
| `raw/slowbody-prefix/server.py.before` | **修复前** `deploy/server.py` 的逐字节副本（对照实验用；sha256 `cdc4a981b688359c…`） |
| `raw/slowbody-prefix/pre-fix-head.txt` | 取该副本时的 `git rev-parse HEAD` 与 `git log -1` |
| `raw/slowbody-latest.txt` | 指向最近一轮半开正文回归输出目录 |
| `raw/image-audit-prerebuild/` | 重建**前**的镜像取证：`00-images.txt`、`01-repodigests.txt`（证明 `RepoDigests` ≡ 镜像 ID）、`02-ids.txt`、`03-app-tree.txt`（`/app` 只有 3 个文件）、`04-old-latest-id.txt`、`05-build-new.txt` |
| `raw/image-parity-20261031-005451/` | 重建前核验 `latest`：**4/9**（审计三条全部复现：规则哈希旧、`server.py` 不含 I-2 修复、半开 26 s 零响应、`/app` 3 文件） |
| `raw/image-parity-20261031-005612/` | 重建后核验 `submission-20261101`：**8/9**（①②已修，③ `/app` 仍 3 文件） |
| `raw/image-parity-20261031-005705/` | 候选 Dockerfile 镜像核验：**9/9**（含可观测入口） |
| `raw/image-parity-20261031-005650/` | 候选 Dockerfile **首次构建失败**现场（行内 `#` 被当成源路径），按纪律保留 |
| `raw/image-parity-candidate/` | 候选镜像内跑可观测入口的原始输出（`/healthz`、`/readyz`、`/metrics?format=json`、JSONL、优雅退出；含 MSYS 改写日志路径的现场） |
| `raw/image-parity-latest.txt` | 指向最近一次镜像核验输出目录 |
| `raw/image-matrix-20261031-010418/` | 交付镜像**端点矩阵逐字节**核验：本机 vs 容器 10/10 一致（`parity-diff.json` 为空） |
| `raw/image-matrix-20261031-010353/` | 该脚本**首次运行失败**现场（`start_local` 返回元组，我按单值用了），保留未删 |
| `raw/image-matrix-latest.txt` | 指向最近一次端点矩阵核验输出目录 |
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
| `raw/artifact-manifest.json` | 本轮证据对应的确切版本与文件哈希（**26 个文件**） |
| `raw/image-parity-20261031-011520/` | **最终交付版**镜像×源码一致性原始输出（**9/9**：`/app` 13 个文件哈希对齐、`/healthz` 规则对齐、半开正文 408/10.01 s/已关闭） |
| `raw/image-matrix-20261031-011609/` | **最终交付版**端点矩阵原始输出（10/10 逐字节，`parity-diff.json` 为空） |
| `raw/log-interleave-20261031-011548/` | **N-4 日志粘连核验**原始输出（修复前对照 **7 行粘连**、最终版 **0 行**；含两侧 `docker logs` 全文） |
| `raw/log-interleave-20261031-011439/` | N-4 核验第一轮（当时脚本把"修复前粘连"判为 FAIL —— 语义写反了，现场保留） |
| `raw/slowbody-20261031-011814/` | I-2 最终回归（**43/43**；含 F6 容器 Threads **1→10→1**、F13 修复前 1→10→10 且**客户端关闭后=1**） |
| `raw/slowbody-20261031-010913/` | I-2 回归**失败现场**（41/42）：Dockerfile 改了 `COPY deploy` 后，F9 用当前 Dockerfile 构建修复前树失败 —— 保留并按纪律修正脚本 |
| `raw/image-rebuild-n1n4/` | PM 夜间指令重建的原始输出（`build.txt`、`build-timing.txt`＝3,662 ms、`inspect.txt`、`app-tree.txt`＝13 个文件） |
| `raw/slowbody-prefix/Dockerfile.before` | **改前 Dockerfile 字节副本**（sha256 `93fac948ab1a9d1b…`）：对照镜像必须用它构建，见 `image-rebuild-n1n4` 报告 §4.1 |
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
- 关键文件 sha256（前 16 位，**2026-10-31 01:24 复核**）：
  - `deploy/server.py` `130cb065db6868c8…`（**本轮已改**：先修 I-2/S-5，再修 N-4 日志粘连；I-2 改后为 `083ed548…`，再往前 `cdc4a981b688359c…` 见 `raw/slowbody-prefix/server.py.before`）
  - `deploy/observable_server.py` `4c11499108bf12ef…`（**已改**，同步修 I-2）
  - `deploy/Dockerfile` `ff0338b03c29f422…`（**本轮已改**：`COPY deploy/server.py` → `COPY deploy /app/deploy`（N-1），**默认 `CMD` 仍是 `deploy.server`**；改前 `93fac948ab1a9d1b…`，副本见 `raw/slowbody-prefix/Dockerfile.before`）
  - `deploy/observability.py` `467f98b88d033fcd…`（未修改）
  - `deploy/evidence/slow_body_check.py` `0ff8fdc51ce76ac9…`（**本轮已改**：F9 改用改前 Dockerfile 字节副本，43 项断言）
  - `deploy/evidence/image_source_parity_check.py` `3c5462368dde9ac7…`（2026-10-31 新增：镜像×源码一致性核验）
  - `deploy/evidence/image_container_matrix_check.py` `4ce8f79e607ee114…`（2026-10-31 新增：交付镜像端点矩阵逐字节核验）
  - `deploy/evidence/log_interleave_check.py` `02426a38babe89a6…`（**2026-10-31 新增**：N-4 日志粘连核验，含修复前对照）
  - `deploy/evidence/image-audit-2026-10-31.md` `3ebefbe571e8943a…`（2026-10-31 新增：口径更正 + 重建与三项复测）
  - `deploy/evidence/image-rebuild-n1n4-2026-10-31.md` `68f25fe93333fbcf…`（**2026-10-31 新增**：PM 夜间指令四修主报告）
  - `deploy/evidence/candidate-Dockerfile-observable` `0718b98aa20254d7…`（保留作对照）
  - `deploy/evidence/observability_check.py` `82b7d5d623195c1a…`（未修改）
  - `deploy/evidence/observability_container_check.py` `9f8490c05706513a…`（未修改）
  - `deploy/evidence/ps1_static_check.py` `4a5902448eb8cb48…`（**本轮已改**：断言上传清单为 5 个文件）
  - `deploy/evidence/container_layout_dryrun.py` `ab71918bad60d5ba…`（**本轮已改**：两种文件树对齐 N-1 后的实际文件集）
  - `deploy/publish-to-uhost.ps1` `6ed53376218787e7…`（**本轮已改**：上传 3 → 5 个文件；仍是**从未上传**）
  - `validator/rules.py` `1f389dad4c2589fb…`（**其他 Agent 改过**；服务启动与 `/healthz` 都会打印该哈希）
- 采集时工作区有大量未提交改动；**本轮的部署相关文件只在工作区、未提交**（按纪律不自行提交，由 PM 统一处理），
  因此证据对应的是**工作区状态 + 上述 HEAD**。
- **交付镜像的稳定标识（2026-10-31 口径）**：`giftwise-validator:submission-20261101`（＝`latest`）
  + 构建日期 **2026-10-31 01:13:59（+08:00）** + `/healthz` 的 `rules_source_sha256` = `1f389dad4c2589fb…`
  + 体积 178 MB（= 169.66 MiB，`docker inspect` 177,918,474 B）+ 冷构建 3,662 ms。
  镜像 ID（当前 `d9a4a35763ee`；此前 `b42f408b4f07` / `61321052b48b` / `23a8c3bed390` / `8304b047cc71` / `c15d1afee2d2`）
  **只作辅助，会随重建漂移**；
  镜像**从未推送任何仓库**，所以 **`docker inspect` 的 `RepoDigests` 不是 manifest digest**（它与镜像 ID 同值），
  **真正的 manifest digest 当前不存在**——要它必须先把镜像推到仓库，**需要另行授权**。

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
| `python deploy/evidence/slow_body_check.py` | **exit 0，43/43 断言**（2026-10-31 01:18 复跑）；修复前：14 s 零响应、连接不关、本机 Threads 4→13（12 s 后仍 13）、容器 PID 1 1→10（12 s 后仍 10，**客户端关闭后回落 1**）；修复后：**10.00 s 返回 408 `REQUEST_TIMEOUT` 并关闭**、Threads 回落 13→4 / 容器 **1→10→1**；10 个端点用例逐字节零差异 |
| `python deploy/evidence/observability_check.py`（I-2 修复后复跑） | **exit 0，39/39 断言**（回归未破坏） |
| `python deploy/evidence/observability_container_check.py`（I-2 修复后复跑） | **exit 0，24/24 断言**（回归未破坏） |
| `python deploy/evidence/local_check.py`（I-2 修复后复跑） | exit 0；`parity byte_identical = True`、`T01_normal` 200/`all_passed=True` |
| `curl -sS -i http://127.0.0.1:8000/healthz` 等 4 条（照 README 示例原样执行） | 200 / 200 / 400 / 404，输出见 `raw/curl-verify-body.txt` |
| `python deploy/evidence/image_source_parity_check.py giftwise-validator:latest`（**重建前**） | exit 1，**4/9**：容器内 `rules.py` `4782255b…`≠本机 `1f389dad…`；`server.py` `cdc4a981…`（不含 I-2 修复）；`/app` 只有 **3** 个文件；半开正文 **26 s 零响应、服务端不关**（Threads 1/2/1）；`RepoDigests` ≡ 镜像 ID |
| `docker build --no-cache -t giftwise-validator:submission-20261101 -f deploy/Dockerfile .` + `docker tag … latest` | exit 0，构建时间 **2026-10-31 00:55:47**；新 ID `8304b047cc71`（旧 `latest` ID `23a8c3bed390` 归档） |
| `python deploy/evidence/image_source_parity_check.py giftwise-validator:submission-20261101`（**重建后**） | 8/9：文件哈希逐一对齐、`/healthz` 规则哈希对齐、半开正文 **408 / 10.02 s / 已关闭 / Threads 1/2/1**；**③ `/app` 仍 3 个文件**（Dockerfile 未改） |
| `python deploy/evidence/image_source_parity_check.py giftwise-validator:candidate-observable`（候选 Dockerfile） | **9/9**：`/app` 5 个文件且哈希全对齐；并在镜像内实跑 `python -m deploy.observable_server`（`/healthz` 200、`/readyz` ready、`/metrics` 可用、JSONL + 优雅退出） |
| `python deploy/evidence/image_container_matrix_check.py giftwise-validator:submission-20261101` | **exit 0，10/10 逐字节一致**：正常 `/validate` 200、字段非字符串 400、非法 JSON 400、超长正文 413、未实现方法 501、`/nope` 404、无 `Content-Length` 413 —— 本机进程 vs 交付镜像容器，`parity-diff.json` 为空 |
| `python deploy/evidence/image_source_parity_check.py giftwise-validator:submission-20261101`（**最终版重建后，2026-10-31 01:15**） | **exit 0，9/9**：`/app` **13 个文件**哈希逐一对齐（含 `observability.py`/`observable_server.py`）、`/healthz` 规则 `1f389dad…` 对齐、半开正文 **408 / 10.01 s / 已关闭 / Threads 1/2/1` |
| `python deploy/evidence/log_interleave_check.py --with-prefix giftwise-validator:submission-20261101` | **exit 0，2/2 阶段**：修复前对照 60 并发 → **7 行粘连**（复现 N-4）；最终版镜像 60 并发 → **0 行粘连** |
| `python deploy/evidence/container_layout_dryrun.py`（N-1 改后复跑） | 两种文件树（`repo_copy` / `upload_minimal`）**都含可观测入口**；`/healthz` 200、`/validate` 200、HEALTHCHECK 等价命令 exit 0 |
| `python deploy/evidence/ps1_static_check.py`（上传清单改 5 个文件后复跑） | **exit 0，17/17 断言**（含"脚本纯 ASCII 且无 BOM"——第一版写中文注释就是被这一条抓出来的） |

**未完成清单（计划，未执行）**：~~把可观测入口接进 `Dockerfile`~~ → **2026-10-31 01:13:59 已完成**（`COPY deploy /app/deploy`；
默认 `CMD` 按 PM 要求**保持** `deploy.server`，故正确表述是"**可观测入口已随镜像交付、但非默认入口**"）；
推送镜像到仓库（**需另行授权**，也是"真正的 manifest digest"的前提）；
UHost 上传与远端启动；预发端到端验证；成本实测；日志轮转的真实触发；延迟在真实客户端/真实负载下的复测；
`/metrics` 鉴权（N-2，本次按 PM 指令不修，已写公开风险说明）；S-4 的隐藏 Python 版本开关（默认关闭，容器仍报 `Python/3.12.16`）。
**I-2 的残留**：并发连接数仍无上限（只做了超时兜底，未限流、未压测）；请求行/请求头超时仍是标准库的静默关闭。
**口径**：镜像相关一律用 **tag + 构建日期 + `rules_source_sha256`**；镜像 ID 会漂移，**没有** manifest digest（未推仓库）。
**线程占用口径（N-5）**：I-2 的占用应表述为「**持续到客户端放弃或进程重启**」，不是"永久不回收"。

**阻塞**：~~`deploy/Dockerfile` 仍未改动~~ → **已改（2026-10-31 01:13:59）**，"入口进镜像"这件事已完成，
但按 PM 要求**不设为默认入口**（因此仍**不得**表述为"镜像默认带可观测性"）；
无云资源与授权（无 UHost/EIP/额度，不得自行采购）；推仓库（真 manifest digest 的前提）需授权；
本轮部署相关改动只在工作区（未提交，由 PM 统一处理）。
