# 交付镜像重建（一次修四件事：规则同步 / I-2 / N-1 / N-4）+ 三项口径更正（2026-10-31）

- 角色：GiftWise｜部署 Agent（Issue [#10](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/10) CLOUD-001，分支 `line/deploy-cloud-001`）
- 触发：PM 夜间指令「镜像重建的四修、口径更正、与必须立刻回报」
- 边界：只改 `deploy/**`；**未做任何 git 分支操作**（提交/PR/合并由 PM 统一处理）；未采购、未上云、**未推任何镜像仓库**；未消耗模型额度。
- 本文件所有数字都来自本机真实执行，原始输出目录逐条给出。

## 0. 交付镜像稳定标识（口径见 §2）

| 项 | 值 |
| --- | --- |
| tag | `giftwise-validator:submission-20261101`（`latest` 指向同一个镜像） |
| 构建日期 | **2026-10-31 01:13:59 +0800**（`docker inspect` 的 `Created` = `2026-10-30T17:13:59.527621865Z`） |
| `/healthz` 的 `rules_source_sha256` | **`1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500`**（= 本机 `validator/rules.py`） |
| 镜像 ID（**仅辅助，会漂移**） | `d9a4a35763ee`（完整 `sha256:d9a4a35763eeff67a34702c1ee7028c081d57b21ced1814d16ff07f6f0528169`） |
| 体积 | `docker images` 显示 **178 MB**；`docker inspect` 精确 **177,918,474 字节 = 169.66 MiB** |
| 冷构建耗时 | **3,662 ms**（`docker build --no-cache`，见 `raw/image-rebuild-n1n4/build-timing.txt`） |
| manifest digest | **不存在**（从未推仓库） |

> **为什么没有 manifest digest**：只有 `docker push` 到某个 registry 才会产生 manifest，`RepoDigests` 在没有 push 时
> 只是本地 config digest、与镜像 ID **同值**。所以"归档重建后的 manifest digest"这条做不到，已按 PM 口径改为
> **tag + 构建日期 + `rules_source_sha256`**；镜像 ID 只作辅助并注明**会漂移**（本轮之前已漂过
> `b42f408b4f07` → `61321052b48b` → `23a8c3bed390` → `8304b047cc71` → `c15d1afee2d2` → 本轮的 `d9a4a35763ee`）。

## 1. 四件事：改了什么 + 复测原始输出

### 1.1 ① 内嵌规则同步

- 改法：无需改代码，重新构建即可（旧 `latest` 内嵌的是 `4782255b…`，本机早已是 `1f389dad…`）。
- 复测：容器内 `/healthz` 的 `rules_source_sha256` **= `1f389dad4c2589fb…`**，与本机 `validator/rules.py` 一致；
  容器内文件 `/app/validator/rules.py` 的 sha256 与本机逐字节相同（`image_source_parity_check.py` 的逐文件比对）。
- 原始输出：`raw/image-parity-20261031-011520/`（`console.txt` 的 ①②③④ 行）。

### 1.2 ② I-2 半开正文：约 10 秒 408 + 服务端关闭；③ 线程 1 → 10 → 1

- 改法：`deploy/server.py` 的 `Handler.timeout = READ_TIMEOUT_SECONDS`（默认 10 s，`GIFTWISE_READ_TIMEOUT` 可覆盖）
  ＋ `_read_body()` 的**总预算**循环读取，超时回 **408 `REQUEST_TIMEOUT`** 并关闭连接；`deploy/observable_server.py` 同一缺陷一并修。
- 复测（容器、9 条并发半开连接）：

| 要求 | 实测（原始输出） |
| --- | --- |
| 半开正文返回 408 | `HTTP/1.0 408 Request Timeout`，首字节 **10.01 s**（`image-parity` ②；`wrapper` 窗口 26 s 内） |
| 连接被服务端关闭 | `服务端关闭=True`（同上） |
| 线程数 1 → 10 → 1 | `慢回归 F6`：`{'前': 1, '中': 10, '后': 1}`（`raw/slowbody-20261031-011814/`） |
| 9 条全部 408 且全部关闭 | `F4`：`{'状态码集合': [408], '全部关闭': True}` |
| 修复前对照（同一镜像构建流程） | `F12`：14 s 内 9 条**零响应**、9 条**仍打开**；`F13`：Threads 1 → 10 → 10、**客户端关闭后 = 1** |
| 半开期间 `/healthz` 仍 200（健康检查会掩盖） | `F5`：`{'状态': 200, 'Threads 中': 10}` |

- 回归：`python deploy/evidence/slow_body_check.py` → **exit 0，43/43 断言通过**（原始输出 `raw/slowbody-20261031-011814/`）。

### 1.3 ③ N-1：可观测入口进镜像（**但不设为默认入口**）

- 改法（按 PM 指令）：`deploy/Dockerfile` 的 `COPY deploy/server.py /app/deploy/server.py`
  → **`COPY deploy /app/deploy`**（上下文根的 `.dockerignore:22` 已排除 `deploy/evidence`，实测排除生效、镜像里没有证据文件）；
  **默认 `CMD` 保持 `["python", "-m", "deploy.server"]`**。
- 连带改（同一缺陷的第二处）：`deploy/publish-to-uhost.ps1` 的上传清单 3 个文件 → **5 个文件**（加 `deploy/observability.py`、
  `deploy/observable_server.py`），否则远端构建出的镜像仍不含它们。改后 `ps1_static_check.py` **17/17**。
- 复测（要求 ④ 容器内 `/app` 文件树，`raw/image-rebuild-n1n4/app-tree.txt`）：

```
/app/deploy/.dockerignore          /app/deploy/observability-collection.md
/app/deploy/Dockerfile             /app/deploy/observability.py          ← 新增
/app/deploy/README.md              /app/deploy/observable_server.py      ← 新增
/app/deploy/__init__.py            /app/deploy/preprod-plan.md
/app/deploy/security-review.md     /app/deploy/server.py
/app/deploy/publish-to-uhost.ps1   /app/validator/__init__.py
                                   /app/validator/rules.py
--- 文件数 --- 13
```

- 逐文件 sha256（容器 vs 本机）：`deploy/server.py`、`deploy/observability.py`、`deploy/observable_server.py`、
  `validator/rules.py`、`validator/__init__.py` **全部对齐**；`image_source_parity_check.py` **9/9**。
- 交付镜像端点矩阵：`image_container_matrix_check.py` → **10/10 逐字节一致**（`raw/image-matrix-20261031-011609/`）。
- 正确表述（请架构线/材料/PPT 采用）：**「可观测入口已随镜像交付，但非默认入口」**。
  `/metrics`、`/readyz` 默认**不暴露**；要启用需显式
  `docker run --rm -p 8000:8000 giftwise-validator:submission-20261101 python -m deploy.observable_server`。
  **不得**写成"镜像默认启用可观测性"。

### 1.4 ④ N-4：并发日志粘连（可复现）→ 已修

- 根因：`deploy/server.py` 的 `log_message` 用裸 `print()`——`print` 分两次写（先正文、再 `"\n"`），两次写之间被其他线程插入。
- 复现（修复前源码树构建的对照镜像，60 并发）：`docker logs` **55 行 → 7 行粘连**，样例：
  `172.17.0.1 - "POST /validate HTTP/1.1" 200 -172.17.0.1 - "POST /validate HTTP/1.1" 200 -`
  （与 PM 报的现象同型）。
- 改法：`server.py` 新增模块级 `_LOG_LOCK = threading.Lock()` 与 `_log_line(text)`——**整行（含换行）在一次
  `write()` 里写出并立即 flush，且全程持锁**；`log_message` 与启动行都改走它（`observability.py` 里已有同类锁范本）。
- 复测（同一脚本两阶段，`raw/log-interleave-20261031-011548/`）：

| 阶段 | docker logs 行数 | 粘连行 |
| --- | --- | --- |
| 修复前（裸 `print`） | 55（正常 47 + 启动 1 + 粘连 7） | **7**（复现缺陷 ✅） |
| **当前交付镜像** | 62（正常 61 + 启动 1） | **0**（已修复 ✅） |

- 脚本：`python deploy/evidence/log_interleave_check.py --with-prefix giftwise-validator:submission-20261101` → **2/2 阶段通过**。

## 2. 口径更正（已落到 `deploy/**` 各处）

| 项 | 旧（错） | 新（对） |
| --- | --- | --- |
| 交付标识 | "归档重建后的 manifest digest" | **tag + 构建日期 + `/healthz` 的 `rules_source_sha256`**；ID 仅辅助且注明会漂移；**不存在 manifest digest** |
| 镜像 ID | 被当作稳定标识 | 已漂过 `b42f408b4f07` / `61321052b48b` / `23a8c3bed390` / `8304b047cc71` / `c15d1afee2d2` → 本轮 `d9a4a35763ee` |
| I-2 线程占用 | "永久不回收" | 「**持续到客户端放弃或进程重启**」（客户端关闭后数秒回落，实测 = 1） |
| 可观测入口 | "尚未进镜像" / "已是默认入口" | 「**已随镜像交付、但非默认入口**」 |

已同步更正的文件：`README.md`、`security-review.md`、`preprod-plan.md`、`evidence/docker-2026-10-30.md`、
`evidence/20261030-local-run.md`、`evidence/container-probe.md`、`evidence/observability-2026-10-30.md`、
`evidence/slow-body-2026-10-30.md`、`evidence/image-audit-2026-10-31.md`、`evidence/pr-draft-line-deploy-cloud-001.md`。
**非本线文件里的旧口径**（我按纪律没改，只报 PM）：`docs/architecture/adr/ADR-003-cloud-native-tradeoffs.md:68,81`、
`docs/architecture/ARCH-001-report-2026-10-30.md:92,101`、`docs/architecture.md:336,493,578,592`、
`docs/competition/qa-bank/_evidence/数字核对.md:90`。

## 3. 三条如实记录（不美化）

### N-2 `/metrics` 完全未鉴权（**本次不修**，但必须写进公开风险说明）

- 事实：匿名请求 **200**；伪造 `Authorization: Basic …` 也 **200**；响应泄露 `rules_source_sha256`。
- 不修的理由：它不在默认入口路径上（默认 `CMD` = `deploy.server`，`/metrics` 不暴露）。
- 文档落点：`README.md`（未做到清单 4 的公开风险说明）、`security-review.md`（S-3 附近的提醒块）。
- 对外必须写的口径：**「该端点未鉴权，不得直接暴露公网；如需公网访问须前置反向代理与鉴权」**。

### N-3 `Server` 头泄露的 Python 版本与文档写的**不一致且会漂移**

- 事实：交付容器内 `Server: GiftWiseValidator/0.1 Python/**3.12.16**`；而本机与文档里写的是 **3.12.12**。
- 原因：基础镜像 `python:3.12-slim` 随上游打补丁，容器内解释器版本不由本仓库决定。
- 文档落点：`README.md` 依赖节、`security-review.md`（S-4 行）、`evidence/observability-2026-10-30.md`、
  `evidence/container-probe.md`（已加"容器实测 3.12.16"的更正）。

### N-5 I-2 线程占用的准确表述

- 见 §2 第 3 行；证据 `raw/slowbody-20261031-011814/` 的 F13（客户端关闭后 = 1）与 F6（1 → 10 → 1）。

## 4. 本轮连带发现与修正（都留了原始输出）

1. **回归脚本 F9 被我的 Dockerfile 改动带崩**：`slow_body_check.py` 原来用**当前** Dockerfile 去构建"修复前源码树"，
   新的 `COPY deploy /app/deploy` 在该树里找不到文件 → 构建失败（第一次跑出 **41/42**，失败场景保留在
   `raw/slowbody-20261031-010913/`）。修法：把改前的 Dockerfile 也做成**字节副本**
   （`raw/slowbody-prefix/Dockerfile.before`，sha256 `93fac948ab1a9d1b…` = `git show HEAD:deploy/Dockerfile`），
   对照镜像用它构建，并新增断言 **F9b** 检查该 Dockerfile 的 `CMD` 确实是 `deploy.server`。
   修完 **43/43**。注意：**不能**把当前 `observable_server.py` 配修复前 `server.py`（前者依赖后者的 `_read_body()`）。
2. **`.ps1` 里不能写中文**：我第一版把中文注释写进 `publish-to-uhost.ps1`，PowerShell 5.1 按 ANSI 解析，
   结果 DryRun 少列了一个上传文件、`ps1_static_check.py` 掉到 **15/17**（该检查项正是"纯 ASCII 且无 BOM"）。
   改成英文注释后 **17/17**。这条检查抓得对，已写进脚本文档。
3. **`slow_body_check.py` 缺 `import hashlib`**（我在新增的 F2 里用它读 Dockerfile 副本），`NameError` → 已补。
4. **B 决定被夜间指令取代**：上一轮 PM 选的 "B"（`CMD` 换成 `deploy.observable_server`）现已**撤回**，
   交付镜像默认入口回到 `deploy.server`；`raw/image-parity-20261031-010844/`、`raw/image-matrix-20261031-010905/`
   是那一版的证据，保留可查（ID `c15d1afee2d2`）。

## 5. 六项复测汇总（PM 第四条要求）

| # | 要求 | 结果 | 原始输出 |
| --- | --- | --- | --- |
| ① | `/healthz` 的 `rules_source_sha256` == 本机 `1f389dad…` | ✅ 一致 | `raw/image-parity-20261031-011520/` |
| ② | 半开正文 408 + 服务端关闭（首字节约 10 s） | ✅ `408`、10.01 s、`服务端关闭=True` | 同上 |
| ③ | 线程 1 → 10 → 1 | ✅ `1/10/1`（9 条并发半开） | `raw/slowbody-20261031-011814/`（F6）+ 上述 parity |
| ④ | 容器内 `/app` 文件树含 `deploy/observability.py`、`deploy/observable_server.py` | ✅ 13 个文件，逐文件哈希对齐 | `raw/image-rebuild-n1n4/app-tree.txt`、`raw/image-parity-20261031-011520/` |
| ⑤ | 并发日志不再粘连 | ✅ 60 并发 → 粘连 **0** 行（修复前 7 行） | `raw/log-interleave-20261031-011548/` |
| ⑥ | tag、体积、冷构建耗时 | ✅ `submission-20261101`(=latest) / 178 MB = **169.66 MiB** / **3,662 ms** | `raw/image-rebuild-n1n4/` |

另：端点矩阵 **10/10 逐字节一致**（`raw/image-matrix-20261031-011609/`）；`ps1_static_check` **17/17**；
布局演练两种文件树都含可观测入口且 `/healthz` 200、HEALTHCHECK 等价命令 exit 0
（`raw/container-layout-dryrun-latest.json`：`repo_copy` 392 文件、`upload_minimal` 5 文件）。

## 6. 命令清单（复现用）

```bash
# 1) 重建（冷构建并计时）
docker build --no-cache -t giftwise-validator:submission-20261101 -f deploy/Dockerfile .
docker tag giftwise-validator:submission-20261101 giftwise-validator:latest

# 2) 六项复测
python deploy/evidence/image_source_parity_check.py giftwise-validator:submission-20261101   # ①②③④ → 9/9
python deploy/evidence/slow_body_check.py                                                    # ③ 容器 Threads → 43/43
python deploy/evidence/image_container_matrix_check.py giftwise-validator:submission-20261101 # 端点矩阵 → 10/10
python deploy/evidence/log_interleave_check.py --with-prefix giftwise-validator:submission-20261101  # ⑤ → 2/2
python deploy/evidence/ps1_static_check.py                                                   # ps1 静态 → 17/17
python deploy/evidence/container_layout_dryrun.py                                            # 两种文件树含可观测入口
python deploy/evidence/artifact_manifest.py                                                  # 证据清单刷新
```

## 7. 本轮没做到的

1. **没有推仓库**：镜像仍未进任何 registry，所以**没有 manifest digest**（需授权后才能做）。
2. **没有上云**：`publish-to-uhost.ps1` 从未真实执行（只跑了 `-DryRun` 与静态校验）。
3. **`/metrics` 仍未鉴权**（N-2，按 PM 指令本次不修，已写公开风险说明）。
4. **S-4（`Server` 头隐藏 Python 版本）仍未改**：开关 `GIFTWISE_HIDE_PY_VERSION` 默认关闭，故交付镜像仍泄露版本；
   本机与容器版本还不同（3.12.12 / 3.12.16）。
5. **并发连接数仍无上限**：I-2 修的是"读完正文"的超时，不是并发上限；无反向代理/连接数限制。
6. **负载测试未做**：延迟数据仍是单机、每请求新建连接的测量，不能当容量结论。

## 当前进度 / 未完成清单 / 阻塞

**当前进度**：PM 夜间指令的四件事**全部完成并已复测**——① 规则同步 ✅ ② I-2（408 + 关闭 + Threads 1→10→1）✅
③ N-1（`COPY deploy /app/deploy`，可观测入口随镜像交付、默认入口不变）✅ ④ N-4（日志粘连 7 → 0）✅；
口径四处更正已落到 `deploy/**` 全部相关文档；N-2/N-3/N-5 三条如实记录已写明。
交付镜像：`giftwise-validator:submission-20261101`（= `latest`），构建 **2026-10-31 01:13:59 +0800**，
rules `1f389dad…`，178 MB = 169.66 MiB，冷构建 3.66 s，ID `d9a4a35763ee`（**仅辅助、会漂移**）。

**未完成清单**：并发上限/反向代理（未做）；S-4 的开关默认关闭；`/metrics` 鉴权（N-2，本次不修）；
推仓库拿真 digest（需授权）；上云与预发端到端验证（需授权）；负载测试。

**阻塞**：无。需要授权才能推进的只有两件：**推镜像仓库**（才能有 manifest digest）与**云资源**
（UHost/安全组/公网 `/healthz`）。其余都已在工作树里，等 PM 提交/开 PR。
