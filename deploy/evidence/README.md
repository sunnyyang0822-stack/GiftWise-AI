# deploy/evidence —— 运行证据索引（CLOUD-001）

本目录是 `deploy/` 部署包的**真实运行证据**。所有内容都在本机产生：
没有上传、没有访问云、没有安装软件、没有产生费用。

## 两条纪律

1. **只记录真实执行过的命令与原始输出**。没有构建就写"未构建"，没有部署就写"未部署"。
2. **区分容器运行与容器布局**。本机没有 Docker，所以"容器布局等价演练"只验证
   Dockerfile COPY 后的**文件树**能否用同一条 CMD 启动，**不等于构建或运行了镜像**。

## 文件清单

| 文件 | 内容 |
| --- | --- |
| `20261030-local-run.md` | 主报告：逐条命令、状态码、响应体、延迟、内存、日志（任务 2） |
| `container-probe.md` | 容器/编排运行时存在性实测结论：**未构建**及原因（任务 4） |
| `local_check.py` | 可复现脚本：启动服务、跑端点矩阵、测延迟、测内存、抓日志 |
| `container_layout_dryrun.py` | 可复现脚本：两种文件集的容器布局等价演练 |
| `container_probe.py` | 可复现脚本：`docker`/`podman`/`wsl`/`kubectl` 等 18 条探测 |
| `artifact_manifest.py` | 生成版本快照（git HEAD + 关键文件 sha256） |
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
python deploy/evidence/local_check.py                # 约 15 秒
python deploy/evidence/container_layout_dryrun.py    # 约 5 秒
python deploy/evidence/container_probe.py            # 约 3 秒
python deploy/evidence/artifact_manifest.py          # 约 1 秒
```

脚本只请求 `127.0.0.1`。`local_check.py` 会用一个**临时子进程**（端口 8765）跑端点矩阵，
并短暂用默认配置在 8000 端口启动一次以证明默认监听地址，随后立即终止。

## 本轮证据对应的版本

- git HEAD：`89d662483febbb90ab7fd579e05052b309700b91`（`artifact-manifest.json`）
- 关键文件 sha256（完整列表见 `raw/artifact-manifest.json`）：
  - `deploy/server.py` `cdc4a981b688359c…`（本次**未修改**）
  - `deploy/Dockerfile` `93fac948ab1a9d1b…`（本次新增 `GIFTWISE_BIND`，未构建）
  - `deploy/publish-to-uhost.ps1` `cce9c8aa23748053…`（本次修复，未上传）
  - `validator/rules.py` `4782255bb9c9ab48…`（未修改；服务启动时打印该哈希）
- 证据采集时工作区有 48 条未提交改动，因此证据对应**工作区状态 + 上述 HEAD**，不是一个提交。

---

## 当前进度 / 未完成清单 / 阻塞

**当前进度**：证据目录已完成。实际执行过的命令与真实结果：

| 命令 | 真实结果 |
| --- | --- |
| `python deploy/evidence/local_check.py` | exit 0；14 个端点用例 + 5 条原始报文边界；`/healthz` 200、`/validate` 200 且与进程内 `validate()` 逐字节一致、400 `INVALID_PAYLOAD`、400 `INVALID_JSON`、413 `REQUEST_TOO_LARGE`、404 `NOT_FOUND`、501（HEAD/PUT）；默认绑定实测 `TCP 0.0.0.0:8000 LISTENING` |
| `python deploy/evidence/container_layout_dryrun.py` | exit 0；布局 `repo_copy` 与 `upload_minimal` 均 `/healthz` 200、`/validate` `passed`、HEALTHCHECK 等价命令 exit 0 |
| `python deploy/evidence/container_probe.py` | exit 0；`docker`/`podman`/`nerdctl`/`containerd`/`kubectl`/`minikube`/`kind` 全部 `command not found`；`wsl --status` exit 50「未安装适用于 Linux 的 Windows 子系统」 |
| `python deploy/evidence/artifact_manifest.py` | exit 0；12 个文件 sha256 落盘 |
| `curl -sS -i http://127.0.0.1:8000/healthz` 等 4 条（照 README 示例原样执行） | 200 / 200 / 400 / 404，输出见 `raw/curl-verify-body.txt` |

**未完成清单（计划，未执行）**：镜像构建；UHost 上传与远端启动；预发端到端验证；成本实测；
延迟在真实客户端/真实负载下的复测。

**阻塞**：本机无任何容器运行时（无法构建）；无云资源与授权（无法部署）；
按纪律未提交，证据绑定的是工作区状态。
