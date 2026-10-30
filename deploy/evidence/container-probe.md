> ## 后续更正（2026-10-30 晚）
>
> **本文结论已被后续真实构建取代，但本文内容一字不改地保留**——它在采集时刻（2026-10-30 21:2x）是真实的。
> 文中"镜像未构建／本机不具备任何容器运行时"的逐条探测结果，是当时本机环境的真实记录，**不是错误，也不得删除**。
>
> 后续事实（2026-10-30 晚，同一台机器）：
> - 已安装 **Docker Desktop 29.9.2**（引擎 `linux`／`overlayfs`，24 核／8.0 GiB）。路径：提权后 `dism /online /enable-feature`
>   启用 `Microsoft-Windows-Subsystem-Linux` 与 `VirtualMachinePlatform`（均 `操作成功完成`、**exit=3010** 成功待重启）
>   → 因 `wsl --install --no-distribution` 经 **Store 通道返回 `禁止(403)`**，改从官方 GitHub Release 离线安装
>   `wsl.3.0.3.0.x64.msi`（`msiexec /i ... /qn /norestart` → **exit 0**）
>   → 重启后 `install --quiet --accept-license --backend=wsl-2`（**exit 0**）。
> - `docker build -t giftwise-validator:latest -f deploy/Dockerfile .` **成功**；镜像 ID `b42f408b4f07`（**ID 会漂移，仅辅助**），`docker images` **178 MB**（inspect 169.4 MB）。
>   **口径更正（2026-10-31）**：该 ID 只是当时的 config digest；镜像从未推仓库，**没有 manifest digest**。稳定标识用 tag + 构建日期 + `/healthz` 的 `rules_source_sha256`（见 [`image-audit-2026-10-31.md`](image-audit-2026-10-31.md) §1）。
> - 容器内 `/healthz` 200（启动 **0.75–1.01 s**）、`/validate` 与本机纯函数**逐字节一致**、5 项错误路径符合契约、以**非 root（uid 10001）**运行。
>
> 新的完整证据：[`docker-2026-10-30.md`](docker-2026-10-30.md)（汇总 9/9；**后补采 D-9…D-13＝14 项**）＋ [`raw/docker-2026-10-30/`](raw/docker-2026-10-30/)（24 个原始输出（19 份 D 系输出 ＋ 5 份 Docker/WSL 安装日志）文件）。
> 另请注意区分：`container_layout_dryrun.py` 只是**目录布局等价演练**（用同一条 HEALTHCHECK 命令跑本机进程），**不是**镜像构建，其结论不受本次修订影响。

# 容器构建实测记录（CLOUD-001 任务 4）

- 采集日期：2026-10-30 21:2x（北京时间）
- 结论：**镜像未构建。本机不具备任何容器/编排运行时，`docker build` 无法执行。**
- 原始输出：`raw/container-probe-*.txt`（逐条命令原文）、`raw/container-probe-latest.json`
- 复现命令：`python deploy/evidence/container_probe.py`

> 本文不含"构建通过"之类的表述。没有任何镜像被构建，也没有任何容器被运行。

## 1. 直接尝试构建（真实命令与输出）

```bash
$ cd /c/Users/lenovo/Desktop/giftwise
$ docker build -t giftwise-validator:local -f deploy/Dockerfile .
'docker' 不是内部或外部命令，也不是可运行的程序
或批处理文件。
[exit 1]

$ docker --version
'docker' 不是内部或外部命令，也不是可运行的程序
或批处理文件。
[exit 1]

$ docker info
'docker' 不是内部或外部命令，也不是可运行的程序
或批处理文件。
[exit 1]

$ docker compose version
'docker' 不是内部或外部命令，也不是可运行的程序
或批处理文件。
[exit 1]

$ where docker
信息: 用提供的模式无法找到文件。
[exit 1]
```

补充：`deploy/Dockerfile` 的 `HEALTHCHECK`、`USER giftwise`、`COPY` 结果在容器内是否成立，
**本轮无法取得任何运行时证据**。

## 2. 全部运行时探测结果

| 探测 | 命令 | 退出码 | 真实输出摘要 |
| --- | --- | --- | --- |
| docker CLI | `where docker` | 1 | 用提供的模式无法找到文件 |
| docker 版本 | `docker --version` | 1 | 'docker' 不是内部或外部命令 |
| docker 守护 | `docker info` | 1 | 'docker' 不是内部或外部命令 |
| **构建** | `docker build -t giftwise-validator:local -f deploy/Dockerfile .` | 1 | 'docker' 不是内部或外部命令 |
| compose | `docker compose version` | 1 | 'docker' 不是内部或外部命令 |
| podman | `where podman` / `podman --version` | 1 / 1 | 未找到 / 不是内部或外部命令 |
| nerdctl | `where nerdctl` / `nerdctl --version` | 1 / 1 | 未找到 / 不是内部或外部命令 |
| containerd | `where containerd` | 1 | 用提供的模式无法找到文件 |
| buildkitd | `where buildkitd` | 1 | 用提供的模式无法找到文件 |
| **WSL 状态** | `wsl --status` | **50** | 未安装适用于 Linux 的 Windows 子系统。可通过运行 "wsl.exe --install" 进行安装。 |
| WSL 发行版 | `wsl -l -v` | 1 | 同上 |
| WSL 版本 | `wsl --version` | 1 | 同上 |
| kubectl | `kubectl version --client` | 1 | 'kubectl' 不是内部或外部命令 |
| minikube | `minikube version` | 1 | 'minikube' 不是内部或外部命令 |
| kind | `kind version` | 1 | 'kind' 不是内部或外部命令 |
| Windows 服务 | `Get-Service com.docker.service,docker,containerd,com.docker.build` | 1 | 输出为空 → 这些服务都不存在 |
| 非 PATH 安装 | `Test-Path` 四个常见路径 | 0 | Docker Desktop / docker.exe / Rancher Desktop / Podman 全部 `False` |
| Windows 可选功能 | `Get-WindowsOptionalFeature Containers,…` | 0 | 三个功能均"查询失败: 请求的操作需要提升"（需管理员权限，本轮未提权） |
| WSL Appx 包 | `Get-AppxPackage MicrosoftCorporationII.WindowsSubsystemForLinux` | 0 | `appx_found=False` |
| WSL 发行版注册表 | `HKCU:\…\Lxss` | 0 | 路径不存在 |
| Hyper-V 运行状态 | `vmcompute` 服务状态 | 0 | 服务不存在；`C:\Windows\System32\lxss` 目录存在 |

**结论**：不仅 `docker` 不在 `PATH`，Docker Desktop、Rancher Desktop、Podman 的安装目录也不存在，
WSL 没有安装（连 Appx 与注册表项都没有），Hyper-V 的计算服务 `vmcompute` 也不存在。
因此**即使把 Docker CLI 手动加进 PATH，也没有可用的容器引擎**。
唯一未取得的信息是"Windows 可选功能 Containers 的启用状态"，因为该查询需要管理员权限（未提权，故未取得）。

## 3. 退而求其次：容器布局等价演练（**不是**容器运行）

脚本：`deploy/evidence/container_layout_dryrun.py`（`python deploy/evidence/container_layout_dryrun.py` → exit 0）

| 布局 | 文件树 | 启动到可连接 | `GET /healthz` | `POST /validate` | HEALTHCHECK 等价命令 |
| --- | --- | --- | --- | --- | --- |
| `repo_copy`（= Dockerfile 的 COPY 结果） | `deploy/server.py`、`validator/__init__.py`、`validator/rules.py` | 565.8 ms | **200** | HTTP 200 / `status=passed` / `all_passed=true` | exit 0 |
| `upload_minimal`（= `publish-to-uhost.ps1` 实际上传的 3 个文件中的运行时文件） | `deploy/server.py`、`validator/rules.py` | 577.3 ms | **200** | HTTP 200 / `status=passed` / `all_passed=true` | exit 0 |

这条演练能证明的：**COPY 之后的文件树足以启动服务**，且不需要 `deploy/__init__.py`
（Python 3.3+ 命名空间包），`from validator.rules import validate` 在没有 `validator/__init__.py` 时也能工作。

这条演练**不能**证明的：镜像能否构建、`python:3.12-slim` 是否可拉取、非 root 用户是否可写、
容器网络与端口映射、HEALTHCHECK 在容器内的真实行为、任何云环境的可达性。

## 4. 静态分析（不是构建）

1. **基础镜像**：`FROM python:3.12-slim`，本机 Python 为 3.12.12，语言版本一致；
   但该标签能否拉取**未验证**（无运行时、无网络拉取）。
2. **`python -m deploy.server` 不依赖 `deploy/__init__.py`**：已由布局演练验证。
3. **`validator/rules.py` 只用标准库**（`json`、`re`、`unicodedata`、`decimal`），无第三方依赖，
   与 `python:3.12-slim` 兼容性风险低（静态判断，未在镜像内验证）。
4. **构建上下文体积**（按 `.dockerignore` 静态估算，非 `docker build` 实测）：

   | 版本 | 文件数 | 体积 |
   | --- | --- | --- |
   | 原 `.dockerignore` | 223 | 10.29 MiB（`.tmp` 6.21、`workflow` 3.54、`web` 0.18） |
   | 本次修改后 | 13 | **0.05 MiB** |

   本次新增排除：`workflow`、`web`、`.tmp`、`deploy/evidence`、`*.log`、`.dockerignore`。
   镜像内容不变（只 COPY `validator/` 与 `deploy/server.py`），只是不再把本地大文件与原始日志
   传给 docker daemon。**该改动同样未经构建验证。**

## 5. 若要真的构建镜像，前置条件与工作量（决策建议，未执行）

| 路线 | 需要什么 | 预估耗时 | 风险 |
| --- | --- | --- | --- |
| A. 本机装 Docker Desktop | 产品负责人授权；约 1.5 GB 下载；开启 WSL2 或 Hyper-V；通常需重启 | 30–90 分钟（含重启） | 改变本机环境；需管理员权限；重启会打断其他 Agent 工作 |
| B. 直接租 UCloud UHost 并在云上构建 | 产品负责人开通账号/额度、创建 UHost + EIP、安全组放行、SSH 私钥 | 30–60 分钟（含控制台操作） | **产生费用**；不需要改动本机 |
| C. 只用布局演练 + 明确声明"未构建" | 无 | 0 | 赛道 B「云原生架构与技术选型 15 分」中 Docker 相关证据只有设计，没有构建产物 |

选 A 还是 B 属于产品负责人决策，见 `../preprod-plan.md`。

---

## 当前进度 / 未完成清单 / 阻塞

**当前进度**：任务 4 已按"如实记录未构建"完成。实际执行过的命令与真实结果：

- `docker build -t giftwise-validator:local -f deploy/Dockerfile .` → **exit 1**，`'docker' 不是内部或外部命令，也不是可运行的程序或批处理文件。`
- `docker --version` / `docker info` / `docker compose version` / `where docker` → 全部 exit 1，同类错误。
- `wsl --status` → **exit 50**，`未安装适用于 Linux 的 Windows 子系统。可通过运行 "wsl.exe --install" 进行安装。`
- `python deploy/evidence/container_probe.py` → exit 0，18 条探测原始输出落盘（`raw/container-probe-*.txt`）。
- `python deploy/evidence/container_layout_dryrun.py` → exit 0，两种布局启动成功、`/healthz` 200、`/validate` passed、HEALTHCHECK exit 0。
- 静态统计：构建上下文 10.29 MiB → 0.05 MiB（按 `.dockerignore` **估算，非构建实测**）。
- **更正（2026-10-30 23:4x）**：真实构建实测为 **170.5 kB**（旧构建器口径）；修复 I-1（`.dockerignore` 嵌套 `__pycache__` 失效）前为 **196.0 kB**。详见 `docker-2026-10-30.md` 的 I-1 节与 `raw/d15-context-size-after-fix.txt`。

**未完成清单（计划，未执行）**：

1. `docker build` 真实构建与镜像信息（`docker images` / `docker inspect`）。
2. 容器内 `HEALTHCHECK` 真实结果、容器内 `/validate` 请求。
3. 非 root 用户 `giftwise` 的写权限与 `PYTHONDONTWRITEBYTECODE` 行为验证。
4. `docker run -p 0.0.0.0:8000:8000` 端口映射的真实连通性验证。
5. Windows 可选功能 Containers 的启用状态（需管理员权限，未提权）。

**阻塞**：本机无 docker/podman/WSL/containerd/Hyper-V 计算服务，且安装 Docker 需产品负责人授权（含可能的重启）；
云上构建需先有 UHost 与额度授权。**在没有上述任一条件前，本任务无法取得构建证据。**

---

## 更正（2026-10-30 23:0x，架构 Agent §9 A-11 复核发现）

上文"更早版本"中的三处数字**当时无原始归档或单位有误**，现按补采并归档的真实测量更正（**原文保留不删**）：

| 原记述 | 真值（有归档） |
| --- | --- |
| 冷构建 **2.2 s** | **1.720 s**（`docker build --no-cache`，`raw/docker-2026-10-30/d9-coldbuild.txt`） |
| 启动 **0.75–1.01 s** | **0.750–0.939 s（10-30 基线）｜交付镜像 **0.668 s**（均值）**（`d7-baseline.txt` 0.7506 s；`d11-startup-memory.txt` 5 次 0.786–0.939 s） |
| 运行内存 **14.41–17.86 MiB** | **14.45–17.08 MiB**（`d7-baseline.txt` 14.45；`d11` 15.5–17.08） |
| `inspect 169.4 MB` | **169.36 MiB**（177,582,258 字节；`docker images` 的 178 MB 是十进制 MB） |
| 镜像 ID `b42f408b4f07` 作为标识 | **ID 每次重建都会变**（`d12-image-id-drift.txt`：同内容三次重建＝三个 ID）。判据用基础镜像 digest、`rules_source_sha256`、字节数。<br>**口径更正（2026-10-31）**：ID 是 **config digest**；镜像未推仓库，**manifest digest 不存在**，`RepoDigests` 里那个与 ID 同值。稳定标识＝tag + 构建日期 + `rules_source_sha256` |

结论不变：容器化**已实测**成立（`/healthz` 规则哈希与本机一致、`/validate` 与纯函数逐字节一致、非 root uid 10001、镜像内无密钥）。
