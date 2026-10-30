# PR 草稿（部署线 / Issue #10 CLOUD-001）—— 待 PM 审查

> **状态：草稿，未提交、未推送、未开 PR。**
> 按 `docs/branch-and-pr-process.md` §5，本文件只是**给 PM 审的 PR 文本**；
> 提交、刷新 `line/deploy-cloud-001` 快照、开 PR、合并**全部由 PM 执行**（本 Agent 未做任何 git 操作）。
> 生成时间：2026-10-30 23:4x；**2026-10-31 01:2x 更新**（并入 PM 夜间指令的四修、四处口径更正、三条如实记录与镜像最终版结果）。

## 0. 我自己定的决定（如与你判断不符，改这一节即可）

| # | 问题 | 决定 | 依据 |
| --- | --- | --- | --- |
| 1 | 是否与阶段 14 合并叙述 | **合并成一个 PR** | 你的快照提交 `9dcbb18` 的信息本身就是"快照：#10 部署线在途改动（**阶段 14 可观测入口 + I-2 慢连接缺陷修复**）"——一个快照 = 一个合并决定，所以 PR 叙述也应一次讲完两条 |
| 2 | PR 编号 | **不在本地推断，按分支绑定**：本 PR = `line/deploy-cloud-001` 对应的那个草稿 PR | `docs/branch-and-pr-process.md` §2 把 8 个草稿 PR 按顺序列成 `#17… #24`，但 `workflow/tools/tmp/c6a.md` 记录"规则线 `line/rules-range` ↔ PR **#20**"，与位置顺序（第 1 条=`#17`）矛盾；且本环境无法访问 GitHub（域名解析到非公网地址）核对，故不猜编号 |
| 3 | 合并前是否补"限制并发连接数" | **不补**（保持最小改动） | 你的原指示是最小改动、不做机会式重构；补它要动启动参数/`Dockerfile`，会作废现有证据并需要重跑全部回归，而截止在即。它已作为**未完成项**写进 `security-review.md` 与 `README.md`；若演示期需要长时间公网开放，再单开一轮 |
| 4 | `deploy/Dockerfile` 要不要把可观测入口 COPY 进镜像（审计第 ③ 条） | **已按 PM 夜间指令改定：`COPY deploy /app/deploy`，默认 `CMD` 保持 `deploy.server`**（即"入口已随镜像交付、但非默认入口"） | 你 2026-10-31 夜间指令原文："改成 COPY deploy /app/deploy；**默认 CMD 保持 deploy.server 不变**（即 /metrics 不被默认暴露）"。我先前按你选的「B」（把 `CMD` 换成 `deploy.observable_server`）做过一版（ID `c15d1afee2d2`），**已按该指令撤回** `CMD` 那一行 |
| 5 | `publish-to-uhost.ps1` 的上传清单（同一 N-1） | **3 个文件 → 5 个**（补 `deploy/observability.py`、`deploy/observable_server.py`） | 不补的话，远端构建出的镜像仍不含可观测入口；`ps1_static_check.py` 改后仍 **17/17**（该检查项也同步改成断言 5 个文件） |

---

## 1. 建议标题

**合并版（推荐）**

```
deploy(#10): 阶段 14 可观测入口 + 修复 I-2 半开正文缺陷（= 安全自查 S-5）
            + 交付镜像重建（N-1 入口进镜像 / N-4 日志粘连）
```

**若你决定拆成两个 PR**

```
feat(deploy): 阶段 14 可观测入口（结构化 JSONL 日志 / 指标 / 就绪检查 / 优雅退出）
fix(deploy): 修复半开正文长时间占用线程（QA 缺陷 I-2 = 安全自查 S-5；占用持续到客户端放弃或进程重启）
fix(deploy): 交付镜像重建（规则同步）+ 可观测入口进镜像（N-1）+ 并发日志粘连（N-4）
```

---

## 2. PR 正文（可直接粘贴）

### 2.1 这一半：阶段 14 可观测入口

**交付内容**：`deploy/observability.py` + `deploy/observable_server.py`（**子类化** `deploy.server.Handler`，只覆写钩子）——
结构化请求日志（单行 JSON，含 `request_id`/`run_id`/`route`/`http_status`/`val_status`/`error_codes`/`duration_ms`/`bytes_in`/`bytes_out`，
**不记录请求体**）、`/metrics`（Prometheus 文本 + `?format=json`）、`/readyz`、进程指标（请求数/错误数/延迟分位/RSS）、优雅退出汇总。

**证据**：`deploy/evidence/observability-2026-10-30.md`；原始输出 `deploy/evidence/raw/observability-20261030-232152/`（本机）、
`deploy/evidence/raw/observability-container-20261030-232002/`（容器）、`deploy/evidence/raw/ps1-static-20261030-225356/`（发布脚本静态校验）。

```bash
python deploy/evidence/observability_check.py              # 39/39
python deploy/evidence/observability_container_check.py    # 24/24（需 Docker）
python deploy/evidence/ps1_static_check.py                 # 17/17（不连接任何主机）
```

要点：JSONL 154 行零交错全部可解析、**请求体哨兵串 0 命中**、指标与请求账本逐键相等、
`/healthz` 与 `/validate` 响应体与默认入口**逐字节一致**、容器内 `platform=Linux` 且 `docker stop` exit 0。

**这一半没做到的**：`deploy/Dockerfile` 未改，可观测入口**不是**镜像默认 `CMD` ——
容器验证用的是"命令覆盖 + 只读挂载"，因此**不得**表述为"镜像默认带可观测性/监控"。

### 2.2 另一半：修复 I-2（= 安全自查 S-5）半开正文长时间占用线程

**缺陷（QA-001 实验证明）**：`deploy/server.py` 原本完全没有 socket 超时（`Handler.timeout = None`），
`do_POST` 直接 `self.rfile.read(Content-Length)`。于是 `Content-Length: 100` 却只发 5 字节的连接会**一直挂住**：
45 秒零响应、连接永不关闭；9 条此类连接让容器 PID 1 的线程数 +9，而 `/healthz` 仍 200（健康检查掩盖了线程泄漏）。
> **口径（2026-10-31，独立审计 N-5）**：占用是「**持续到客户端放弃或进程重启**」，不是"永久不回收"——
> 客户端一关闭，线程数秒内回落（实测 `raw/slowbody-20261031-011814/` F13：Threads 1 → 10 → 10，**客户端关闭后 = 1**）。

**修法（最小改动，只动 `deploy/**`）**

| 文件 | 改动 |
| --- | --- |
| `deploy/server.py` | 新增 `READ_TIMEOUT_SECONDS`（默认 10 s，`GIFTWISE_READ_TIMEOUT` 可覆盖，`<=0` 启动即报错）；`Handler.timeout` 据此给连接设超时；新增 `_read_body()`（**总预算**读取 + 读完恢复额度）；新增 `_send_request_timeout()`（**408 `REQUEST_TIMEOUT`** + 关闭连接）；`do_POST` 改用 `_read_body()` 并新增 `except TimeoutError` 分支 |
| `deploy/observable_server.py` | **同一缺陷一并修**：`_peek_body()` 原本也是裸 `rfile.read` 且吞异常（只会变成父类的"静默关闭"或错误的 400），现复用父类 `_read_body()`，超时显式走同一个 408 路径 |
| `deploy/evidence/slow_body_check.py`（新增） | **43 项断言**的回归脚本：修复前对照 / 修复后 / 短超时辅助场景 / 可观测入口 / 容器 PID 1 Threads 前中后（含 ③ 要求 1→10→1 与"客户端关闭后回落"） |
| `deploy/evidence/slow-body-2026-10-30.md`（新增） | 缺陷、修法、证据、影响面与未做项的完整报告 |
| `deploy/security-review.md` | S-5 行、现状表"连接超时"、阶段 14 影响表、未完成清单、阻塞全部更新 |
| `deploy/README.md` | 状态码契约新增 `408 REQUEST_TIMEOUT` 行 + 超时口径；已验证/未验证/未完成/阻塞/复现命令更新 |
| `deploy/evidence/README.md`、`artifact_manifest.py`、`deploy/preprod-plan.md` | 索引、版本哈希、预发含义同步 |

**为什么不是"加一行 `timeout = 10`"**：socket 超时只是**单次 recv** 的期限，"每 9 秒发 1 字节"的滴流能一直续命 →
正文读取用**总预算**，两种拖法都被同一个上限截断（实测滴流 3.0 s 被截断并返回 408）。

**兼容性**：`/healthz`、`/`、`GET` 全部路径、`Server` 头、HTTP/1.0 单响应、501 HTML、业务失败仍 200 —— 全部不变；
`Content-Length` 缺失/非法/超限仍是 413 且不读正文。**新增的唯一契约**是"正文读不完 → 408"。

### 2.3 证据在哪（I-2 的验收要求逐条对应）

| QA 要求 | 证据 |
| --- | --- |
| ① 截断且有确定错误码 + 连接关闭 | 10.00 s 返回 `HTTP/1.0 408 Request Timeout` / `{"error":"REQUEST_TIMEOUT"}`，9/9 连接已关闭（修复前：14 s 零响应、9/9 未关闭） |
| ② 线程数回落 | 容器 PID 1 `/proc/1/status`：修复前 **1→10（12 s 后仍 10）**，修复后 **1→10→1**；本机 4→13→4 |
| ③ `/healthz` 仍 200 | 9 条半开连接**进行中**仍 200，且响应体与基线逐字节一致 |
| ④ 正常请求与既有 5 条错误路径未回退 | 10 个端点用例在修复前/修复后/容器内三份矩阵**逐字节零差异**；另含"无 Content-Length → 413" |

- 报告：`deploy/evidence/slow-body-2026-10-30.md`
- 原始输出（21 个文件，最终字节版本）：`deploy/evidence/raw/slowbody-20261030-232005/`
  （`console.txt`、`slowbody-check.json`、`A-endpoint-matrix.json`、`C-prefix-endpoint-matrix.json`、
  `D-parity-diff.json`、`F1-threads.txt`、`F2-threads.txt`、docker build/run/stop 输出）
- 修复前源码逐字节副本：`deploy/evidence/raw/slowbody-prefix/server.py.before`
  （sha256 `cdc4a981b688359c…`，与改前 `git HEAD:deploy/server.py` 一致）+ `pre-fix-head.txt`（HEAD `d9f494a7`）
- 首轮失败现场（**保留未删**，失败在验证脚本自身）：`deploy/evidence/raw/slowbody-20261030-230911/`
- 版本快照：`deploy/evidence/raw/artifact-manifest.json`（19 个文件 sha256，HEAD `3be437ba`）

```bash
python deploy/evidence/slow_body_check.py                  # exit 0，43/43 断言
python deploy/evidence/observability_check.py              # exit 0，39/39（改动后复跑）
python deploy/evidence/observability_container_check.py    # exit 0，24/24（改动后复跑）
python deploy/evidence/local_check.py                      # exit 0，parity byte_identical = True
python deploy/evidence/artifact_manifest.py                # exit 0，19 文件哈希落盘
```

### 2.3.1 交付镜像：口径更正 + 重建 + 审计三条复测（2026-10-31 00:5x）

**口径更正（你指出的）**：我先前写的"归档重建后的 manifest digest"**做不到**——镜像**从未推送任何仓库**，
`docker inspect` 的 `RepoDigests` 只是**本地 config digest**（与镜像 ID 同值），**真正的 manifest digest 当前不存在**。
现在一律用 **`tag` + 构建日期 + `/healthz` 的 `rules_source_sha256`** 作稳定标识，镜像 ID 只作辅助并注明**会漂移**
（本机实测：`b42f408b4f07` → `ed3fbe912571` → `23a8c3bed390` → `8304b047cc71`；审计记录过的 `61321052b48b` 现已不在本机）。
`deploy/` 下 5 处旧口径（`docker-2026-10-30.md`、`20261030-local-run.md`、`container-probe.md`、`README.md`、`observability-2026-10-30.md`）已逐条加更正。

**审计三条**：我用 `evidence/image_source_parity_check.py`（新增，可复跑）**独立复现**后重建，逐条结果：

| 审计发现 | 复现（重建前 `latest`） | 重建后 |
| --- | --- | --- |
| ① `/app/validator/rules.py` 旧 | `4782255b…` ≠ 本机 `1f389dad…`（`/healthz` 也报 `4782255b…`） | **一致** `1f389dad…` |
| ①′ `deploy/server.py` 旧（我补查） | `cdc4a981…`（**不含 I-2 修复**） | **一致** `083ed548…` |
| ② 半开正文无修复 | 26 s 观察窗**零响应、服务端不关闭**（Threads 1/2/1） | **408 / 10.02 s / 已关闭 / Threads 回落** |
| ③ 镜像不含可观测入口 | `/app` 只有 3 个文件 | **仍是 3 个**（`Dockerfile` 只 COPY `validator` + `deploy/server.py`）→ 候选 Dockerfile **9/9** |

- 重建：`docker build --no-cache -t giftwise-validator:submission-20261101 -f deploy/Dockerfile .` + `docker tag … latest`
  → **交付标识 = `giftwise-validator:submission-20261101`（= `latest`）+ 构建日期 2026-10-31 + rules `1f389dad…`**；
  重建前的 `latest`（ID `23a8c3bed390`）仍在本地可按 ID 取回（仅不再有 tag 指向）。
- 原始输出：`raw/image-audit-prerebuild/`、`raw/image-parity-20261031-005451/`（重建前 4/9）、
  `…005612/`（重建后 8/9）、`…005650/`（候选首次构建失败现场）、`…005705/`（候选 9/9）、`raw/image-parity-candidate/`
- 报告：[`image-audit-2026-10-31.md`](image-audit-2026-10-31.md)

命令：`python deploy/evidence/image_source_parity_check.py giftwise-validator:submission-20261101`（或 `candidate-observable`）
　　　`python deploy/evidence/image_container_matrix_check.py giftwise-validator:submission-20261101`

**交付镜像行为逐字节核验（补充）**：文件哈希一致只说明"内容相同"，所以我再用同一套 10 个用例**同时打本机进程与交付镜像容器**：
**10/10 逐字节一致**（正常 `/validate` 200、字段非字符串 400、非法 JSON 400、超长正文 413、未实现方法 501、`/nope` 404、无 `Content-Length` 413），
`parity-diff.json` 为空（原始输出 `raw/image-matrix-20261031-010418/`）。

### 2.3.2 交付镜像最终版：PM 夜间指令一次修四件事（2026-10-31 01:13:59）

PM 夜间指令要求一次修四件事并逐条复测，全部完成（完整报告：[`image-rebuild-n1n4-2026-10-31.md`](image-rebuild-n1n4-2026-10-31.md)）：

| # | 要求 | 改动 | 复测（原始输出） |
| --- | --- | --- | --- |
| ① | 容器内规则同步 | 重建 | `/healthz` 的 `rules_source_sha256` == 本机 `1f389dad…` ✅（`raw/image-parity-20261031-011520/`） |
| ② | I-2 半开正文 → 约 10 s 返回 408 且关闭连接 | 已在 `server.py`（本 PR 前一半） | **408 / 10.01 s / 服务端关闭=True**；9 条并发全部 408 且全部关闭 ✅ |
| ③ | N-1 可观测入口进镜像（**非默认入口**） | `Dockerfile`：`COPY deploy/server.py` → **`COPY deploy /app/deploy`**，`CMD` **保持** `deploy.server`；`publish-to-uhost.ps1` 上传 3 → 5 个文件 | `/app` **13 个文件**（含 `observability.py`、`observable_server.py`）、哈希全对齐 ✅ |
| ④ | N-4 并发日志粘连 | `server.py`：裸 `print()` → `_LOG_LOCK` + `_log_line()`（整行一次 write + flush） | 60 并发：修复前 **7 行粘连** → 修复后 **0 行** ✅（`raw/log-interleave-20261031-011548/`） |

**六项复测汇总**：① 规则哈希一致 ✅ ② 408 + 关闭（首字节 10.01 s）✅ ③ 容器 Threads **1 → 10 → 1** ✅（`raw/slowbody-20261031-011814/`，43/43）
④ `/app` 含两个可观测模块 ✅ ⑤ 粘连 0 行 ✅ ⑥ tag `submission-20261101`(=latest) / 178 MB = **169.66 MiB** / 冷构建 **3,662 ms** ✅。
另：端点矩阵 **10/10 逐字节一致**；`ps1_static_check.py` **17/17**；`container_layout_dryrun.py` 两种文件树都含可观测入口且 `/healthz` 200、HEALTHCHECK exit 0。

**口径（四处更正，已落到 `deploy/**` 全部相关文档）**

| 项 | 旧（错） | 新（对） |
| --- | --- | --- |
| 交付标识 | "manifest digest" | **tag + 构建日期 + `/healthz` 的 `rules_source_sha256`**；**没有 manifest digest**（从未推仓库，`RepoDigests` ≡ 镜像 ID） |
| 镜像 ID | 当稳定标识用 | 仅辅助、**会漂移**（`b42f408b4f07` → `61321052b48b` → `23a8c3bed390` → `8304b047cc71` → `c15d1afee2d2` → 当前 `d9a4a35763ee`） |
| I-2 线程占用 | "永久不回收" | 「**持续到客户端放弃或进程重启**」（客户端关闭后回落 = 1） |
| 可观测入口 | "没进镜像" / "已是默认入口" | 「**已随镜像交付、但非默认入口**」 |

**三条如实记录（不美化）**

- **N-2 `/metrics` 完全未鉴权**：匿名 200、伪造 `Authorization: Basic …` 也 200、泄露 `rules_source_sha256`。
  **本次不修**（不在默认入口路径上）。对外必须写：**「该端点未鉴权，不得直接暴露公网；如需公网访问须前置反向代理与鉴权」**
  （已写进 `README.md` 与 `security-review.md`）。
- **N-3 `Server` 头版本漂移**：交付容器内实测 `Python/3.12.16`，而文档写 3.12.12（基础镜像随上游打补丁，会继续漂移）→ 文档已更正。
- **N-5 线程占用表述**：见上表第 3 行。

### 2.4 还剩什么没做到（如实）

1. **并发连接数仍无上限**：超时只让每条连接**有界**，不是限流；10 秒内仍可建立大量连接把线程数堆高。
   更彻底的做法（限并发或前置反向代理）**本轮未做**（见 §0 第 3 条决定），已登记未完成清单。
2. **未做压测**：没有 1 万连接 / 1 万调用下的延迟与内存曲线（与安全自查 S-2 的未完成项同一条）。
3. **请求行/请求头超时仍是"静默关闭"**（不返回 408）：标准库 `handle_one_request` 的既有行为，本轮未覆写。
4. **未在任何云端验证**（无账号、无额度、按边界不采购）；未上传任何主机、未推送任何镜像仓库。
5. **`GIFTWISE_READ_TIMEOUT` 的非默认值只在本机验证**（容器内用的是默认 10 s）。
6. ~~**`deploy/Dockerfile` 仍未改**~~ → **已改（2026-10-31 01:13:59，PM 夜间指令修 N-1）**：`COPY deploy /app/deploy`，
   交付镜像**含**可观测入口；**默认 `CMD` 按 PM 要求保持 `deploy.server`**（`/metrics` 不默认暴露）。
7. **没有 manifest digest**：镜像未推仓库，`RepoDigests` 与镜像 ID 同值；要真 digest 必须先推仓库（需授权）。
8. **`/metrics` 未鉴权（N-2）本次不修**；**S-4 的隐藏 Python 版本开关默认关闭**，交付镜像仍泄露 `Python/3.12.16`（N-3）。

### 2.5 边界声明

- 只修改 `deploy/**`；未触碰 `docs/architecture/**`、`workflow/**`、`web/**`、`tests/**`。
- **未做任何 git 操作**（无 commit / 无分支 / 无 push）；改动全部留在工作区，由 PM 统一提交。
- 未采购、未开通云资源、未上传、未推送镜像。

---

## 3. PM 独立复核建议（不接受"应该好了"）

```bash
python deploy/evidence/slow_body_check.py     # 43/43，含修复前对照，约 3 分钟（容器阶段需 Docker）
python deploy/evidence/image_source_parity_check.py giftwise-validator:submission-20261101   # 镜像×源码一致性 → 9/9（①②③④）
python deploy/evidence/image_container_matrix_check.py giftwise-validator:submission-20261101 # 端点矩阵 → 10/10 逐字节
python deploy/evidence/log_interleave_check.py --with-prefix giftwise-validator:submission-20261101  # N-4 → 2/2（修复前再现粘连、修复后 0 行）
python deploy/evidence/ps1_static_check.py    # 17/17（上传清单现为 5 个文件，且脚本仍是纯 ASCII）
```

或只看最关键的一条（先 `python -m deploy.server` 起服务，再用任意 Python 跑）：

```python
import socket, time
s = socket.create_connection(("127.0.0.1", 8000), timeout=20)
s.sendall(b"POST /validate HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n" + b'{"a"')  # 声明 100，只发 5
t = time.monotonic()
data = b""
while True:
    chunk = s.recv(4096)
    if not chunk:
        print("服务端已关闭连接"); break
    data += chunk
print(round(time.monotonic() - t, 2), "秒 ->", data.split(b"\r\n")[0].decode())
# 期望：约 10 秒 -> HTTP/1.0 408 Request Timeout；且随后连接被关闭（不再一直挂住）
```

---

## 4. 快照状态与提交范围（给 PM）

**你的快照 `9dcbb18`（2026-10-30 23:30:33）已覆盖本 PR 的绝大部分内容**：
`deploy/server.py`（`083ed548…`，**与工作区逐字节一致，已核对**）、`observable_server.py`、`slow_body_check.py`、
`slow-body-2026-10-30.md` 与三个 `raw/slowbody-2026*` 目录**都已进去**。
以下是快照之后产生的，刷新时一并纳入（都还在 `deploy/` 下）：

| 类型 | 路径 |
| --- | --- |
| 新增 | `evidence/image_source_parity_check.py`、`evidence/image_container_matrix_check.py`、`evidence/log_interleave_check.py`、`evidence/image-audit-2026-10-31.md`、`evidence/image-rebuild-n1n4-2026-10-31.md`、`evidence/candidate-Dockerfile-observable`、`evidence/pr-draft-line-deploy-cloud-001.md` |
| 新增（原始输出） | `evidence/raw/image-audit-prerebuild/`、`evidence/raw/image-parity-20261031-005451/`、`…005612/`、`…005650/`、`…005705/`、`…010844/`、`…011520/`、`evidence/raw/image-matrix-20261031-010353/`、`…010418/`、`…010905/`、`…011609/`、`evidence/raw/log-interleave-20261031-011439/`、`…011548/`、`evidence/raw/image-rebuild-n1n4/`、`evidence/raw/slowbody-20261031-010913/`、`…011814/`、`evidence/raw/image-parity-candidate/`、`evidence/raw/image-parity-latest.txt`、`evidence/raw/image-matrix-latest.txt`、`evidence/raw/log-interleave-latest.txt` |
| 改动 | `Dockerfile`（`COPY deploy /app/deploy`）、`publish-to-uhost.ps1`（上传 3→5 文件）、`server.py`（I-2 + N-4）、`observable_server.py`（I-2）、`README.md`、`security-review.md`、`preprod-plan.md`、`evidence/README.md`、`evidence/docker-2026-10-30.md`、`evidence/20261030-local-run.md`、`evidence/container-probe.md`、`evidence/observability-2026-10-30.md`、`evidence/slow-body-2026-10-30.md`、`evidence/slow_body_check.py`（F9 用改前 Dockerfile 副本）、`evidence/container_layout_dryrun.py`、`evidence/ps1_static_check.py`、`evidence/artifact_manifest.py`、`evidence/raw/artifact-manifest.json`、`evidence/raw/_manifest_*.txt` |

（`deploy/observability.py` **未再改动**（停在 `467f98b8…`）；`deploy/server.py` 本轮因 N-4 又改过一次，
当前哈希见 `evidence/README.md` 与 `raw/artifact-manifest.json`。）

```bash
BASE=$(git rev-parse release/2026-11-01-submission)
idx=.git/tmp-idx
GIT_INDEX_FILE=$idx git read-tree "$BASE"
GIT_INDEX_FILE=$idx git add -A -- deploy            # 本线全部改动都在 deploy/ 下
tree=$(GIT_INDEX_FILE=$idx git write-tree)
commit=$(git commit-tree "$tree" -p "$BASE" -m "快照：#10 部署线在途改动（阶段 14 可观测入口 + I-2 慢连接缺陷修复）")
git update-ref refs/heads/line/deploy-cloud-001 "$commit"
```

⚠️ **不要把 `tests/**` 与 `validator/**` 的改动并进本线**：`git status` 里
`validator/rules.py`、`tests/test_cases.json`、`tests/acceptance/**` 的改动是**其他 Agent** 在
2026-10-30 23:11 前后改的，与本轮部署改动无关（本轮所有对照实验的两侧都读取同一份规则，
证据里的 `/healthz` 响应体记录了当时的 `rules_source_sha256 = 1f389dad…`）。

---

## 5. 自查清单（对照 `docs/branch-and-pr-process.md` §3 合并条件）

- [x] 交付物已在工作区，报告给出**真实命令与原始输出**
- [x] 口径诚实：未做的（并发上限、压测、请求头超时响应、云端、真 digest、`/metrics` 鉴权、S-4）逐条写明
- [x] PR 描述写清三件事：改了什么 / 证据在哪 / 还剩什么没做到
- [x] 已快照到 `line/deploy-cloud-001`（PM 的 `9dcbb18`），需按 §4 补夜间这一轮的改动
- [ ] **PM 独立复核**（`slow_body_check.py`）
- [ ] 开/刷新 PR → 合并决定（**已合并** 或 **已关闭并写明原因**，不允许挂着不管）
