# 安全与健壮性自查（CLOUD-001 任务 3）

- 自查日期：2026-10-30（北京时间）
- 范围：`deploy/server.py`、`deploy/Dockerfile`、`deploy/.dockerignore`、`deploy/publish-to-uhost.ps1`
- 方法：**真实运行探测**（`python deploy/evidence/local_check.py`，原始结果 `evidence/raw/local-check-latest.json`）
  + **静态代码/属性检查**（`evidence/raw/local-check-latest.json` 的 `server_static` 段）
  + **文本扫描**（`deploy/` 内无凭证）
- 原则：**默认不改坏现有行为**。**首轮口径**：S-1/S-4/S-6/S-7 未改 `server.py`；**同日 S-5（半开正文）已改 `server.py`**，2026-10-31 01:1x 又因 N-4 日志锁再改（**现版 203 行 / sha256 `e8b40f9f…`**），
  因为它是已被独立测试引用、且 `/validate` 契约由 VAL-001 冻结的文件；下面给出的是可直接应用的最小补丁建议，
  由 PM 决定是否在本轮合入。

## 1. 已确认的事实（有实测证据）

| 项 | 实测值 | 证据 |
| --- | --- | --- |
| 默认监听地址 | `0.0.0.0`（所有网卡） | `netstat`：`TCP 0.0.0.0:8000 LISTENING`；源码 `os.environ.get("GIFTWISE_BIND", "0.0.0.0")` |
| 默认端口 | `8000` | 同上 |
| 请求体上限 | 65536 字节，按 `Content-Length` 判定，超限返回 413 | 实测 65549 字节 → 413 `REQUEST_TOO_LARGE` |
| 缺/非法 `Content-Length` | 一律 413（**失败关闭**，不会误读） | 裸 socket 实测 |
| 非 UTF-8 / 非法 JSON | 400 `INVALID_JSON`，不泄露解析细节 | 实测 |
| 堆栈泄露 | 500 分支只返回 `{"error":"INTERNAL_ERROR"}`，不含堆栈；该分支未能在运行时诱导（`validate()` 内部已捕获全部异常），仅代码走查 | `server.py:70-73` |
| 日志内容 | 仅 `地址 - "方法 路径 HTTP/1.1" 状态码 -`，**不含请求体** | `raw/server-8765.log` 共 215 行，全部为此格式 |
| 响应头 | `Server: GiftWiseValidator/0.1 Python/3.12.12`（**泄露 Python 版本**） | 实测响应头 |
| HTTP 协议版本 | `HTTP/1.0`，每个请求新建连接，无 keep-alive | 实测响应行 |
| 连接超时 | ~~**未设置**（`Handler.timeout = None`）~~ → **2026-10-30 晚已修**：`Handler.timeout = READ_TIMEOUT_SECONDS`（默认 10 s，`GIFTWISE_READ_TIMEOUT` 可覆盖），正文读取另加**总预算** | 静态属性检查 → 修复后实测（见 S-5 / I-2） |
| 认证 | **无**（无任何 header/token 校验） | 代码走查 |
| 限流 | **无** | 代码走查 |
| TLS | **无**（明文 HTTP） | 代码走查 + 实测 |
| `deploy/` 凭证扫描 | 无 `api_key`/`secret`/`token`/`password`/私钥文件命中 | `grep -rniE` 扫描结果为空 |

## 2. 问题清单与最小修复建议

| # | 问题 | 严重度 | 依据 | 最小修复建议 | 本次是否已改 |
| --- | --- | --- | --- | --- | --- |
| S-1 | 默认监听 `0.0.0.0`：在有公网 IP 的机器上，安全组一放行即**全网可达**，而服务无认证 | **高** | `netstat` 实测 + 源码默认值 | 把源码默认值改为 `127.0.0.1`（本机自测即安全）；容器场景由 `Dockerfile` 的 `ENV GIFTWISE_BIND=0.0.0.0` 显式覆盖 | **未改 server.py**；Dockerfile 的 ENV **已加**，使该改法不会打断容器端口映射 |
| S-2 | 无认证、无限流：任何人都能反复调用 `/validate` 消耗 CPU | 中 | 代码走查 | 演示期用安全组限制来源 IP（推荐，零代码改动）；若必须公网开放，加一个共享密钥 header + 简单令牌桶 | 否（需 PM 决策，涉及契约） |
| S-3 | 无 TLS：公网明文传输，可被读取/篡改 | 中 | 代码走查 | 演示期只用虚构数据（AGENTS.md 已要求）；如需公网长期开放，前置 Nginx/Caddy 终止 TLS | 否（部署层决策） |
| S-4 | `Server` 响应头泄露 Python 版本（`Python/3.12.12`） | 低 | 实测响应头 | 在 `Handler` 中加一行 `sys_version = ""`（`server_version` 保留，便于运维识别服务） | 否（1 行，待 PM 批准） |
| S-5（QA 缺陷号 **I-2**） | 未设置 socket 超时：慢连接会长期占用线程（`ThreadingHTTPServer` 每连接一线程，线程数无上限） | 中 | **QA-001 实验**：`Content-Length: 100` 只发 5 字节 → 45 s 零响应、连接永不关闭；9 条此类连接使容器 PID 1 线程 +9 且 10 s 不回收，而 `/healthz` 仍 200（被健康检查掩盖） | 类属性加 `timeout = 10`，并把正文读取改成带**总预算**的循环，超时返回 **408** 后关闭连接；更彻底的做法是限制并发连接数或前置反向代理 | **是（2026-10-30 晚，本轮）**：默认入口与可观测入口均已修；本机+容器回归 **43/43**（2026-10-31 复跑），含修复前对照。证据：[`evidence/slow-body-2026-10-30.md`](evidence/slow-body-2026-10-30.md)、`evidence/raw/slowbody-*` |
| S-6 | `HEAD`/`PUT` 等返回 501 且响应体是**标准库 HTML 错误页**，与"所有错误都是 JSON"的既有风格不一致 | 低 | 裸报文实测：`Content-Type: text/html;charset=utf-8` | 覆写 `send_error()` 统一返回 `{"error": ...}` JSON；或显式实现 `do_HEAD` | 否 |
| S-7 | 路径匹配用 `self.path` 原串：`GET /healthz?x=1` → 404 | 低 | 实测 404 | 用 `urllib.parse.urlsplit(self.path).path` 比较 | 否（注意：会改变现有行为，需与测试验收协调） |
| S-8 | 不支持 `Transfer-Encoding: chunked`，返回 413 | 低（可接受） | 裸报文实测 | 保持现状：失败关闭比误读更安全；在 README 写明"必须带 `Content-Length`" | 否（已在 README 说明） |
| S-9 | 并发下日志行交错粘连（多线程同时 `print`），无请求耗时、无运行 ID，无法用于排障与阶段 14 统计；且 `print` 不 flush，不设 `PYTHONUNBUFFERED` 时强杀会丢日志 | 中 | `raw/server-8765.log` 可见 `200 -127.0.0.1 - ...` 粘连；`raw/curl-verify.txt` 只剩启动行 | 改为单行 JSON 结构化日志（含运行 ID、耗时、状态码）并带 flush，见 `observability-collection.md` | 否（阶段 14 交付物） |
| S-10 | `publish-to-uhost.ps1` **完全无法运行**：参数名 `Host` 与 PowerShell 只读自动变量 `$Host` 冲突 | **高**（功能完全不可用） | 实测：`VariableNotWritable`，exit 1，脚本无任何输出 | 重命名为 `$SshHost` 并保留 `-Host` 别名 | **已修复**并 `-DryRun` 实测通过 |
| S-11 | `publish-to-uhost.ps1` 端口规格写错：`-p 0.0.0:$ServicePort`:8000` 展开为 `0.0.0:8000:8000`（非法地址） | **高**（远端 `docker run` 必失败） | 旧参数块干跑实测展开值 `0.0.0:8000:8000` | 改为 `-p 0.0.0.0:${ServicePort}:8000` | **已修复**，`-DryRun` 实测输出 `0.0.0.0:8000:8000` |
| S-12 | 发布脚本把容器端口发布到 `0.0.0.0`，且脚本本身不校验安全组 | 中 | 脚本内容 + `-DryRun` 输出 | 保留 `0.0.0.0`（演示需要外部可达），但在 README 与脚本输出中明确要求安全组限制来源；管理端口 22 不得对全网开放 | 部分（脚本已加提示行，README 已写明） |
| S-13 | 发布脚本 `ssh` 未设置 `StrictHostKeyChecking`，非交互环境遇到未知主机键会直接失败 | 低 | 代码走查 | 不加 `accept-new`（会引入中间人风险）；改为在 README 写明先用 `ssh-keyscan` 核对主机指纹 | 否（README 待补一行，属文档） |
| S-14 | 构建上下文原本包含 `.tmp`（PM 临时产物与原始日志）等 10.29 MiB 内容 | 低 | 静态估算 | `.dockerignore` 增加 `workflow`、`web`、`.tmp`、`deploy/evidence`、`*.log` | **已改**，静态估算降至 0.05 MiB → **实测 170.5 kB**（修复 I-1 前 196.0 kB；见 `evidence/docker-2026-10-30.md` I-1 节） |

## 3. 已实施的改动（附真实命令与结果）

```bash
# 修复前：脚本原样执行（这是修复前的对照组）
$ powershell -NoProfile -ExecutionPolicy Bypass -File deploy\publish-to-uhost.ps1 \
    -Host "203.0.113.10" -KeyPath "C:\keys\id_ed25519"
无法覆盖变量 Host，因为该变量为只读或常量。
[exit 1]

# 修复后：干跑（不做任何 ssh/scp）
$ powershell -NoProfile -ExecutionPolicy Bypass -File deploy\publish-to-uhost.ps1 \
    -Host "203.0.113.10" -KeyPath "C:\keys\id_ed25519" -DryRun
[DryRun] No ssh/scp/docker will be executed. Planned commands:
  remote host   : root@203.0.113.10 (ssh port 22, key C:\keys\id_ed25519)
  ...
  ssh build/run : ssh -i C:\keys\id_ed25519 -p 22 root@203.0.113.10 "set -e; cd '/opt/giftwise-validator';
                  docker build -t giftwise-validator:local -f deploy/Dockerfile .; ...
                  docker run -d --name giftwise-validator --restart unless-stopped -p 0.0.0.0:8000:8000 giftwise-validator:local"
[exit 0]
```

其余已改：`Dockerfile` 增加 `ENV GIFTWISE_BIND=0.0.0.0`（显式固定既有默认值，防止日后改默认值静默打断端口映射）；
`.dockerignore` 增加排除项。**这三处改动都没有容器构建验证**（本机无 Docker），已在各自文档中标注。

未改（**截至 2026-10-30 晚第二轮已部分变化**）：`deploy/server.py` 原本 S-1、S-4、S-5、S-6、S-7 全部只给建议。
原因：该文件的 `/validate` 行为已由独立测试与 VAL-001 契约固定，本轮同时改它会污染"证据对应哪一份代码"的追溯性。

> **2026-10-30 晚第二轮更正**：QA-001 用实验证明 S-5 = 缺陷 **I-2**（半开正文长期占住线程），
> 并派发修复。因此 **S-5 已在 `deploy/server.py` 落地**（`timeout = 10` + 总预算读取 + 408），
> 这是本轮唯一被修改原入口的地方，改动前后做了逐字节回归（10 个用例零差异）与三方对照。
> 其余条目（S-1、S-4、S-6、S-7）仍未改。证据：[`evidence/slow-body-2026-10-30.md`](evidence/slow-body-2026-10-30.md)。

## 4. 给 PM 的判断

- **必须在演示前决定**：S-1（默认监听地址）与 S-2（谁能访问）。本机演示用 `GIFTWISE_BIND=127.0.0.1` 即可规避；
  一旦上云，安全组就是唯一防线。
- **建议顺手改（低风险、1 行）**：S-4（`sys_version = ""`）、S-5（`timeout = 10`）。
  两处都不触碰 `/validate` 契约，但会改变 `Server` 响应头与慢连接行为，需与测试验收 Agent 同步后再改。
  > **2026-10-30 晚第二轮**：**S-5 已完成**（QA-001 派发 I-2，已同步并回归）；S-4 仍未改（新入口有开关，默认关闭）。
- **本轮不要动**：S-7（查询串匹配），因为它会改变既有 404 行为，属于契约变更。

## 2026-10-30 晚：阶段 14 新入口对以上条目的影响

新入口 `deploy/observable_server.py`（**不改** `deploy/server.py`）落地了其中几条低风险项，
但**没有改变默认行为**——`python -m deploy.server` 这条路径的一切结论仍然成立：

| 条目 | 新入口的处理 | 证据 |
| --- | --- | --- |
| S-4（`Server` 头暴露 Python 版本） | 提供开关 `GIFTWISE_HIDE_PY_VERSION=1` 时才清空 `sys_version`；**默认关闭**，保持与冻结实现一致 | 代码路径存在；**未出实测证据**（已登记为未完成） |
| S-9（日志并发粘连、无耗时、不 flush） | **已修**：改用 `logging`（自带锁 + flush）写单行 JSON，含 `request_id`/`duration_ms`/状态码 | 154 行零交错、强杀/优雅退出均不丢；见 `evidence/observability-2026-10-30.md` |
| S-9 衍生（日志注入） | **已修**：`path` 字段剔除控制字符并限长，恶意路径无法伪造/截断 JSONL 行 | 实测 `/a\x1bb` → 记录为 `/a?b` |
| 指标被打爆（新面） | **已防**：指标标签只取已知路由，未匹配归 `__unmatched__`（基数保护） | `route_label()` 与 4096 上限的采样窗口 |
| S-1 / S-2 / S-3（默认监听、无鉴权、公网暴露） | **未处理**：新入口沿用 `GIFTWISE_BIND` 默认 `0.0.0.0`，同样无鉴权；容器验证时只绑 `127.0.0.1` | 仍需产品负责人决策 |
| S-5（`Handler.timeout` 未设置） | **已修（2026-10-30 晚第二轮，QA 缺陷 I-2）**：默认入口 `Handler.timeout = 10`（`GIFTWISE_READ_TIMEOUT` 可覆盖）＋ `_read_body()` 总预算读取，超时 **408 `REQUEST_TIMEOUT`** 并关闭连接；**可观测入口同步修复**（同一缺陷） | 本机 43/43（含修复前对照 Threads 13→13 不回收 vs 修复后 13→4 回落）；容器 PID 1：修复前 1→10→10，修复后 1→10→**1**；见 [`evidence/slow-body-2026-10-30.md`](evidence/slow-body-2026-10-30.md)。**2026-10-31 口径更正（N-5）**：修复前的"不回收"应表述为「占用**持续到客户端放弃或进程重启**」——客户端关闭后实测回落到 1（`raw/slowbody-20261031-011814/` F13） |
| S-7（查询串匹配） | **未处理**（契约变更） | —— |

> 提醒：`/metrics` 是**无鉴权**的只读端点，会暴露请求量、错误率、路由与进程内存。
> **2026-10-31 独立审计 N-2 确认**：该端点**完全未鉴权**——匿名请求 200，伪造 `Authorization: Basic …` 也 200，
> 且响应泄露 `rules_source_sha256`。**本次不修**（它不在默认入口路径上：交付镜像默认 `CMD` 是 `deploy.server`，
> `/metrics` 不暴露）。**公开风险说明（必须写进对外材料）**：
> 「该端点未鉴权，不得直接暴露公网；如需公网访问须前置反向代理与鉴权」。
> 一旦公网可达（S-3），它同样需要靠安全组限制来源；**不要**把它当成"内部端点所以安全"。

---

## 当前进度 / 未完成清单 / 阻塞

**当前进度**：任务 3 自查完成，14 项问题已列明严重度、证据与最小修复方案。实际执行过的命令与真实结果：

- `python deploy/evidence/local_check.py` → exit 0；取得 S-1/S-3/S-4/S-6/S-8/S-9 的实测证据
  （默认 `0.0.0.0:8000` LISTENING、`Server: …Python/3.12.12`、501 HTML 体、chunked→413、日志粘连）。
- `python deploy/evidence/container_probe.py` → exit 0（与安全相关的运行时缺失事实）。
- `powershell -File deploy\publish-to-uhost.ps1 -Host … -KeyPath …` → **exit 1，`VariableNotWritable`**（S-10 复现）。
- `powershell -File deploy\publish-to-uhost.ps1 -Host … -KeyPath … -DryRun` → **exit 0**，输出 `-p 0.0.0.0:8000:8000`（S-10/S-11 修复验证）。
- `grep -rniE "api[_-]?key|secret|token|password|PRIVATE KEY" deploy/` → 无命中；`deploy/` 内无 `.env`、无密钥文件。
- **2026-10-30 晚新增（阶段 14）**：`python deploy/evidence/ps1_static_check.py` → **17/17 通过**
  （硬编码凭证扫描 0 命中；IP 字面量仅 `0.0.0.0` 与 RFC 5737 文档网段；`-DryRun` 在首个 ssh/scp 之前 `exit 0`；
  另实测本机 `LocalMachine=Restricted`，不加 `-ExecutionPolicy Bypass` 会被拒）。
  以及 `observability_check.py`（39/39）与 `observability_container_check.py`（24/24）——
  其中"S-9 已修""日志注入已防""指标基数保护"三条即由此取得实测证据。

- **2026-10-30 晚第二轮新增（缺陷 I-2 = S-5）**：`python deploy/evidence/slow_body_check.py` → **42/42 通过**（2026-10-31 加 F9b 断言后复跑为 **43/43**）。
  修复前对照（git HEAD 字节副本）：`Content-Length: 100` 只发 5 字节 → 14 s 零响应、连接不关、
  本机 Threads **4→13（12 s 后仍 13）**、容器 PID 1 **1→10（12 s 后仍 10）**，而 `/healthz` 始终 200。
  修复后：**10.00 s 返回 408 `REQUEST_TIMEOUT` 并关闭**，本机 Threads **13→4**、容器 PID 1 **10→1**；
  端点矩阵（10 个用例）修复前后**逐字节零差异**。原始输出：`evidence/raw/slowbody-20261030-232005/`。
- **同一轮回归复跑**（证明改 `server.py` 没有破坏既有证据）：`observability_check.py` **39/39**、
  `observability_container_check.py` **24/24**、`local_check.py` `parity byte_identical = True`。

**未完成清单（计划，未执行）**：

1. S-1/S-4/S-6/S-7 在原入口的代码修改（**故意未改**，等 PM 决策与测试验收同步）。
   ~~S-5~~ → **已修（2026-10-30 晚第二轮）**；**2026-10-31 已随镜像重建进入交付镜像**（旧 `latest` 里没有）。
   **默认入口**：`deploy/Dockerfile` 现已含可观测入口，但**默认 `CMD` 仍是 `deploy.server`**（2026-10-31 夜间指令修 N-1：
   `COPY deploy /app/deploy`），因此 S-4 与 S-9 虽随镜像交付、却**不在默认路径上**（要用得显式
   `python -m deploy.observable_server`）；S-4 的开关本身也**默认关闭**，
   所以"整个服务已修复 S-4/S-9"这一表述**仍不成立**（S-4 需显式开 `GIFTWISE_HIDE_PY_VERSION=1`）。
2. 无认证/无限流场景下的真实压测（例如 1 万次调用是否会拖垮演示机）。
   （**部分相关**：S-5 修复后慢连接不再长期占住线程（修复前占用**持续到客户端放弃或进程重启**），但**并发连接数仍无上限**，
   `ThreadingHTTPServer` 仍可被大量真实连接耗尽线程——这是本轮**未做**的部分。）
3. 安全组与公网可达性的真实验证（需要云主机）。
4. TLS 前置方案（若决定公网长期开放）。
5. **限制并发连接数 / 前置反向代理**（S-5 的"更彻底做法"，本轮只做了超时兜底；未做，也未压测）。
6. `/metrics` 暴露面的处置（与 S-3 绑定：公网可达时必须靠安全组限制来源）。

**阻塞**：S-1/S-2 的最终处置取决于是否上云、以及演示时是否公网可达，这需要产品负责人先回答
`preprod-plan.md` 里的确认事项；无云主机时无法验证安全组与公网暴露面。
**2026-10-30 晚第一轮**：`deploy/server.py` 与 `deploy/Dockerfile` 曾处于 QA 复核冻结期，
因此 S-1/S-4/S-5/S-7 在原入口的修复当时不能做；新入口已落地的 S-4/S-9 也**尚未成为默认入口**。
**2026-10-30 晚第二轮更正**：QA-001 结束复核并提出缺陷 I-2（= S-5），PM 派发修复 →
**`server.py` 的冻结已解除，S-5 已修复并回归**；`deploy/Dockerfile` 当时**仍未改动**
（因此「可观测入口成为镜像默认 CMD」这件事当时仍未做；**该版已于 2026-10-31 01:13:59 撤回**，见下）。
> **2026-10-31 01:08 更正**：`deploy/Dockerfile` **已改**（PM 决定 B）——可观测入口已成为镜像默认 `CMD`。

**2026-10-31 00:5x 补充（交付镜像重建 + 独立审计三条）**：独立审计实测交付镜像 `latest` **三处过时**，
我逐条独立复现后重建：旧 `latest`（ID `23a8c3bed390`，**ID 会漂移，仅辅助**）容器内
`validator/rules.py`=`4782255b…`≠本机 `1f389dad…`、`deploy/server.py`=`cdc4a981…`（**不含 S-5/I-2 修复**）、
`/app` 只有 3 个文件（不含可观测入口），半开正文 **26 s 零响应**。
重建后：`giftwise-validator:submission-20261101`（＝`latest`，构建日期 2026-10-31，rules `1f389dad…`）
文件哈希逐一对齐、**S-5 修复已在镜像内**（半开正文 408 / 10.02 s / 连接关闭 / 线程回落）。
**③ 也已修**：2026-10-31 01:13:59 按 PM 夜间指令改 `deploy/Dockerfile`——`COPY deploy /app/deploy`（可观测入口进镜像），
**默认 `CMD` 保持 `deploy.server`**（先按 "B" 把 `CMD` 换成 `deploy.observable_server` 的那版已按该指令撤回），
重建后镜像一致性 **9/9**、交付镜像端点矩阵 **10/10 逐字节一致**、`/app` 13 个文件哈希全对齐，见
[`evidence/image-rebuild-n1n4-2026-10-31.md`](evidence/image-rebuild-n1n4-2026-10-31.md) §1.3；
另**口径**：镜像从未推仓库 → **没有 manifest digest**，稳定标识用 tag + 构建日期 + `rules_source_sha256`；
**N-2**：可观测入口的 `/metrics` 未鉴权（匿名 200），本次不修，已在 `README.md` 写明公开风险说明。
