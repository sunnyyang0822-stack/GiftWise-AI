# 安全与健壮性自查（CLOUD-001 任务 3）

- 自查日期：2026-10-30（北京时间）
- 范围：`deploy/server.py`、`deploy/Dockerfile`、`deploy/.dockerignore`、`deploy/publish-to-uhost.ps1`
- 方法：**真实运行探测**（`python deploy/evidence/local_check.py`，原始结果 `evidence/raw/local-check-latest.json`）
  + **静态代码/属性检查**（`evidence/raw/local-check-latest.json` 的 `server_static` 段）
  + **文本扫描**（`deploy/` 内无凭证）
- 原则：**默认不改坏现有行为**。`deploy/server.py` 本次**一个字都没有改**，
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
| 连接超时 | **未设置**（`Handler.timeout = None`） | 静态属性检查 |
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
| S-5 | 未设置 socket 超时：慢连接会长期占用线程（`ThreadingHTTPServer` 每连接一线程，线程数无上限） | 中 | `Handler.timeout = None` | 类属性加 `timeout = 10`；更彻底的做法是限制并发连接数或前置反向代理 | 否（1 行，待 PM 批准） |
| S-6 | `HEAD`/`PUT` 等返回 501 且响应体是**标准库 HTML 错误页**，与"所有错误都是 JSON"的既有风格不一致 | 低 | 裸报文实测：`Content-Type: text/html;charset=utf-8` | 覆写 `send_error()` 统一返回 `{"error": ...}` JSON；或显式实现 `do_HEAD` | 否 |
| S-7 | 路径匹配用 `self.path` 原串：`GET /healthz?x=1` → 404 | 低 | 实测 404 | 用 `urllib.parse.urlsplit(self.path).path` 比较 | 否（注意：会改变现有行为，需与测试验收协调） |
| S-8 | 不支持 `Transfer-Encoding: chunked`，返回 413 | 低（可接受） | 裸报文实测 | 保持现状：失败关闭比误读更安全；在 README 写明"必须带 `Content-Length`" | 否（已在 README 说明） |
| S-9 | 并发下日志行交错粘连（多线程同时 `print`），无请求耗时、无运行 ID，无法用于排障与阶段 14 统计；且 `print` 不 flush，不设 `PYTHONUNBUFFERED` 时强杀会丢日志 | 中 | `raw/server-8765.log` 可见 `200 -127.0.0.1 - ...` 粘连；`raw/curl-verify.txt` 只剩启动行 | 改为单行 JSON 结构化日志（含运行 ID、耗时、状态码）并带 flush，见 `observability-collection.md` | 否（阶段 14 交付物） |
| S-10 | `publish-to-uhost.ps1` **完全无法运行**：参数名 `Host` 与 PowerShell 只读自动变量 `$Host` 冲突 | **高**（功能完全不可用） | 实测：`VariableNotWritable`，exit 1，脚本无任何输出 | 重命名为 `$SshHost` 并保留 `-Host` 别名 | **已修复**并 `-DryRun` 实测通过 |
| S-11 | `publish-to-uhost.ps1` 端口规格写错：`-p 0.0.0:$ServicePort`:8000` 展开为 `0.0.0:8000:8000`（非法地址） | **高**（远端 `docker run` 必失败） | 旧参数块干跑实测展开值 `0.0.0:8000:8000` | 改为 `-p 0.0.0.0:${ServicePort}:8000` | **已修复**，`-DryRun` 实测输出 `0.0.0.0:8000:8000` |
| S-12 | 发布脚本把容器端口发布到 `0.0.0.0`，且脚本本身不校验安全组 | 中 | 脚本内容 + `-DryRun` 输出 | 保留 `0.0.0.0`（演示需要外部可达），但在 README 与脚本输出中明确要求安全组限制来源；管理端口 22 不得对全网开放 | 部分（脚本已加提示行，README 已写明） |
| S-13 | 发布脚本 `ssh` 未设置 `StrictHostKeyChecking`，非交互环境遇到未知主机键会直接失败 | 低 | 代码走查 | 不加 `accept-new`（会引入中间人风险）；改为在 README 写明先用 `ssh-keyscan` 核对主机指纹 | 否（README 待补一行，属文档） |
| S-14 | 构建上下文原本包含 `.tmp`（PM 临时产物与原始日志）等 10.29 MiB 内容 | 低 | 静态估算 | `.dockerignore` 增加 `workflow`、`web`、`.tmp`、`deploy/evidence`、`*.log` | **已改**，静态估算降至 0.05 MiB（未构建验证） |

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

未改：`deploy/server.py`（S-1、S-4、S-5、S-6、S-7 全部只给建议）。原因：该文件的 `/validate` 行为已由独立测试与
VAL-001 契约固定，本轮同时改它会污染"证据对应哪一份代码"的追溯性。

## 4. 给 PM 的判断

- **必须在演示前决定**：S-1（默认监听地址）与 S-2（谁能访问）。本机演示用 `GIFTWISE_BIND=127.0.0.1` 即可规避；
  一旦上云，安全组就是唯一防线。
- **建议顺手改（低风险、1 行）**：S-4（`sys_version = ""`）、S-5（`timeout = 10`）。
  两处都不触碰 `/validate` 契约，但会改变 `Server` 响应头与慢连接行为，需与测试验收 Agent 同步后再改。
- **本轮不要动**：S-7（查询串匹配），因为它会改变既有 404 行为，属于契约变更。

---

## 当前进度 / 未完成清单 / 阻塞

**当前进度**：任务 3 自查完成，14 项问题已列明严重度、证据与最小修复方案。实际执行过的命令与真实结果：

- `python deploy/evidence/local_check.py` → exit 0；取得 S-1/S-3/S-4/S-6/S-8/S-9 的实测证据
  （默认 `0.0.0.0:8000` LISTENING、`Server: …Python/3.12.12`、501 HTML 体、chunked→413、日志粘连）。
- `python deploy/evidence/container_probe.py` → exit 0（与安全相关的运行时缺失事实）。
- `powershell -File deploy\publish-to-uhost.ps1 -Host … -KeyPath …` → **exit 1，`VariableNotWritable`**（S-10 复现）。
- `powershell -File deploy\publish-to-uhost.ps1 -Host … -KeyPath … -DryRun` → **exit 0**，输出 `-p 0.0.0.0:8000:8000`（S-10/S-11 修复验证）。
- `grep -rniE "api[_-]?key|secret|token|password|PRIVATE KEY" deploy/` → 无命中；`deploy/` 内无 `.env`、无密钥文件。

**未完成清单（计划，未执行）**：

1. S-1/S-4/S-5/S-6/S-7 的代码修改（**故意未改**，等 PM 决策与测试验收同步）。
2. 无认证/无限流场景下的真实压测（例如 1 万次调用是否会拖垮演示机）。
3. 安全组与公网可达性的真实验证（需要云主机）。
4. TLS 前置方案（若决定公网长期开放）。
5. `deploy/server.py` 改动后的 `/validate` 契约回归（应由测试验收 Agent 独立复核）。

**阻塞**：S-1/S-2 的最终处置取决于是否上云、以及演示时是否公网可达，这需要产品负责人先回答
`preprod-plan.md` 里的确认事项；无云主机时无法验证安全组与公网暴露面。
