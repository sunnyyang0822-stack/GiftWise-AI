# 容器化证据独立复核报告（CLOUD-001）

> 本报告数字为 2026-10-30 时点真值；后续变更见 `docs/acceptance-criteria.md` 第 13 节。

- 复核角色：GiftWise｜测试验收 Agent（**独立执行**，不以 PM 的汇总表代替证据）
- 复核时间：2026-10-30 晚（Asia/Shanghai）
- 被复核对象：`deploy/evidence/docker-2026-10-30.md`；原始输出 `deploy/evidence/raw/docker-2026-10-30/`
- 复核时仓库版本：`HEAD = 46d1b48`（本地领先 `origin/main` 7 个提交，仍未推送）
- 环境：Docker Desktop **29.9.2**（Client/Server 同版本）、`desktop-linux`、`overlayfs`、CPUs 24、Mem 8179929088
- 本节证据目录：`docs/test-reports/cloud-001/evidence/`（其中 `raw/` 为逐条原始输出）
- 复核脚本：`tests/acceptance/cloud-001/`（`probe_deploy_api.py`、`stall_probe.py`、`startup_probe.py`、`byte_identity_attack.py`、`attack_dockerignore.py`）

## 0. 结论摘要

PM 的「9/9 项通过」**主体成立**（该 9/9 为 10-30 口径；**现行 14 项**，见 `deploy/evidence/docker-2026-10-30.md:57`）：规范构建、规则哈希一致、逐字节一致、状态码契约表、镜像洁净度、非 root、内容级可复现，我都独立复现通过。但存在 **2 项真实缺陷** 与 **6 处口径/证据问题**；另有两处**PM 未覆盖的攻击面**（停滞连接、`.dockerignore` 嵌套模式失效）在我的攻击下暴露。

| 类别 | 数量 | 说明 |
| --- | ---: | --- |
| 我独立复现通过 | 11 组 | 见 §1 |
| 真实缺陷 | 2 | I-1 `.dockerignore` 嵌套模式失效致镜像含字节码；I-2 停滞连接永久占用线程 |
| 证据/口径问题 | 6 | 见 §6 |
| 与 PM 记录不一致 | 6 条 | 见 §7 |
| 无法独立验证 | 4 条 | 见 §7 |

## 1. 逐项回答（PM 要求复核的 6 个问题）

### 问题 1｜规范构建命令是否真的必须为 `docker build -t ... -f deploy/Dockerfile .`？

**是。`context=deploy/` 会构建失败，失败原文如下（我实跑，`evidence/raw/qa6-wrong-context.txt`）：**

```
--------------------
  10 |     
  11 |     WORKDIR /app
  12 | >>> COPY validator /app/validator
  13 |     COPY deploy/server.py /app/deploy/server.py
  14 |     
--------------------
ERROR: failed to build: failed to solve: failed to compute cache key: failed to calculate checksum of ref pl06rs7a0smvdn9h2ekhwdtvu::luhbdl3s0cub0evxt2u39m22t: "/validator": not found
```

原因与 PM 说明一致：`deploy/Dockerfile` 的 `COPY` 路径（`validator`、`deploy/server.py`）是**仓库根相对**路径，以 `deploy/` 为上下文时这两个路径不存在。规范命令我实跑成功，产出镜像 178MB。

**附加确认**：`PATH` 中确实**没有** `C:\Program Files\Docker\Docker\resources\bin`（`which docker` 失败）。不加该路径无法调用 `docker`；这是真实前置条件，PM 的提示成立。

### 问题 2｜「逐字节一致」你是怎么比的？是不是同一个 JSON 被序列化两次的假一致？

**比较方法（三道独立防线，`evidence/api-probe.json`、`evidence/byte-identity-attack.json`）**

1. **字节级**：A 侧 = 容器 HTTP 响应体**原始字节**；B 侧 = 本机**另一个进程**内 `validator.rules.validate(...)`，按服务端口径 `json.dumps(..., ensure_ascii=False, separators=(",", ":"))` 编码。`T01_normal` 实测两侧同为 **271 字节**且逐字节相等。
2. **区分力验证**（证明这个比较不是空转）：同一结果改用 `json.dumps(result)`（默认含空格）→ **不等（303 字节）**；改用 `sort_keys=True` → **不等**。说明该比较确实能分辨不同序列化口径。
3. **解析后深比较**：`json.loads(容器字节) == 进程内结果对象` → 相等。

**反例尝试（主动构造可能分歧的输入，共 78 例）**

覆盖：10 个关系 ID、预算边界（`0`/`0.00`/`-1`/`-0`/`200.00`/`200.01`/`1e3`/全角/千位分隔符/`.5`/`1.`/400 位/huge）、期限（0/1/2/365/-1/100000）、空 interests、未知标签、可信度错配、
Unicode 攻击面（全角字母数字、土耳其 `İ/ı`、德语 `ß`、NFKC 连字、圈号、组合字符、ZWJ emoji、肤色修饰符、RTL、零宽空格、NBSP、NUL、UTF-8 BOM、孤立代理 `\ud800`）、
结构异常（null 根/数组根/2 候选/4 候选/重复 ID/120 层深嵌套）、超长字段（2 万、7 万字符）、类型混淆（bool/null/array/object 当金额）、原始字节层（截断 JSON、重复键、BOM、非法 UTF-8、数组顶层、`NaN` 字面量）。

**结果：78 例中 73 例双侧均为 200，全部逐字节一致；分歧 0 例；容器从未返回 500。**
其余 4 例为原始字节层被受控拒绝（400），1 例为请求体超 65536 字节（413，请求层限制，本机无此限制属预期）。

**额外的稳定性攻击（`evidence/raw/qa15-hashseed-attack.txt`）**

若输出顺序源自集合/字典迭代，字节会随哈希种子漂移。我用一个"三条候选各有多个违规"的多错误输入，在 **6 个不同 `PYTHONHASHSEED`**（`0/1/2/42/12345/random`）下各起一个容器：

| 种子 | 响应字节 | sha256 前缀 | 与本机逐字节相同 |
| --- | ---: | --- | --- |
| 0 | 716 | `be214f9d3d4aeb07e8b2d8f2` | 是 |
| 1 | 716 | 同上 | 是 |
| 2 | 716 | 同上 | 是 |
| 42 | 716 | 同上 | 是 |
| 12345 | 716 | 同上 | 是 |
| random | 716 | 同上 | 是 |

**六种种子下字节完全相同**，排除哈希随机化导致的顺序泄漏。

**结论**：**不是假一致。** 我在 78 例对抗输入 + 6 个哈希种子下都**没能找到反例**；该结论成立。

> 但我必须指出 PM 证据的形式问题：`raw/docker-2026-10-30/d4-validate.txt` 里 `--- container ---` 是**紧凑格式**、`--- local ---` 是**带空格格式**，两行**并不同字节**。该文件自身不能证明"逐字节一致"，且未记录比较方法（见 §6 K-4）。

补充说明环境差异：本机 Python **3.12.12**、容器 **3.12.16**；`unicodedata` 两侧均为 **15.0.0**。上述 Unicode 攻击面正是为覆盖这处版本差而设计，未发现分歧。

### 问题 3｜无 Content-Length 返回 413 时会不会挂起/半开连接？

**不会挂起，也不会半开。** 全部用**原始 socket**（自己拼字节，不让任何 http 客户端替我补头）：

| 场景 | 结果 |
| --- | --- |
| `HTTP/1.0`，无 `Content-Length`，无 body | **0.0s** 返回 `HTTP/1.0 413 Request Entity Too Large` + `{"error":"REQUEST_TOO_LARGE"}`（245 字节），**对端主动关闭**（`closed_by_peer=true`） |
| `HTTP/1.1` + `Connection: keep-alive`，无 `Content-Length` | 同上，响应仍为 `HTTP/1.0` 且**关闭连接**（服务端不协商 keep-alive） |
| `HTTP/1.1` + `Transfer-Encoding: chunked`（有 body 无长度） | 同上，413 后关闭，**未留下未读 body 造成协议不同步** |
| `Content-Length: -5` | 413（`int()` 前先判负） |
| `Content-Length: abc` | 413（解析失败按 -1 处理） |
| `Content-Length: 0` | 400 `INVALID_JSON`（不是 413，也不挂起） |

**但是**：`Content-Length` **大于实发字节**时是另一回事——见 §3 的 I-2，那是真实缺陷，PM 的 D-5 未覆盖该场景。

### 问题 4｜镜像内是否真的没有密钥、没有 .git/tests/docs/workflow？非 root（uid 10001）是否真的生效？

**成立。** 我在 `docker run --rm` 里直接查（`evidence/raw/qa9-image-content.txt`）：

- 路径自查：`.git` / `tests` / `docs` / `workflow` / `web` / `.env` / `.ssh` **全部 absent**。
- 全盘查找（排除 `/usr`、`/etc/ssl`、`/proc`、`/sys`）`*.pem` / `*.key` / `id_rsa*` / `.env`：**零命中**。
- `/app` 全量文本扫描 `api[_-]?key|secret|password|token|sk-|dify|credential`：**零命中**。
- 镜像 `ENV` 只有解释器与 `GIFTWISE_PORT`/`GIFTWISE_BIND`，无任何凭证。
- `docker exec ... id` → **`uid=10001(giftwise) gid=10001(giftwise)`**，`Config.User=giftwise`，非 root 生效。
- `HEALTHCHECK` 存在且指向回环 `/healthz`。

**同时发现一处 PM 未标出的问题**：镜像内**含有 `validator/__pycache__/*.pyc`**（见 I-1）。这不影响"无密钥/无违禁路径"的结论，但说明 `.dockerignore` 的排除承诺未达成。

### 问题 5｜两份 .dockerignore 不一致，会不会**误排除** `validator/` 或 `deploy/server.py`，造成"镜像缺文件但服务看起来正常"？（**重点攻击**）

**结论：不会误排除；而且即使发生误排除，失败也是"响亮的"，不是"看起来正常"。** 我用**真实的 `deploy/Dockerfile`**（`-f deploy/Dockerfile`，未修改该文件）配我在 `tests/` 下自建的**同构上下文**做了三组实验（`evidence/dockerignore-attack.json`）。

**实验 E-A：逐模式敏感性（16 个模式全覆盖）**
把两份文件里出现的 16 个模式**各自单独**放进 `.dockerignore`，逐一构建并列出镜像内文件：

> **没有任何一个模式排除掉 `validator/rules.py`、`validator/__init__.py` 或 `deploy/server.py`。**
> `E-A_conclusion.any_pattern_excludes_a_copy_source == []`

**实验 E-C：两份文件的差异是否有实际后果**

| 使用的忽略规则 | 构建 | 镜像内文件 |
| --- | --- | --- |
| 仓库根 `.dockerignore`（现行生效） | rc=0 | `deploy/server.py`、`validator/rules.py`、`validator/__init__.py` + 2 个 pyc |
| `deploy/.dockerignore` | rc=0 | **完全相同** |
| 空忽略规则（对照） | rc=0 | **完全相同** |
| 两份并集 | rc=0 | **完全相同** |

四个变体产物**逐项相同**。即：两份文件的不一致只体现在与两个 COPY 源**无关**的条目上（根多 `.gitignore`/`*.pyo`/`*.msi`/`*.exe`，deploy 多 `.dockerignore`）；且规范命令下**只有仓库根那份会被读取**，`deploy/.dockerignore` 是惰性的（该文件注释已自述）。

**实验 E-B：故意制造误排除，看失效模式（关键）**

| 场景 | 构建结果 | 服务结果 |
| --- | --- | --- |
| 排除整个 `validator/` | **失败 rc=1**：`"/validator": not found` | 无镜像 |
| 排除 `deploy/server.py` | **失败 rc=1** | 无镜像 |
| 排除整个 `deploy/` | **失败 rc=1** | 无镜像 |
| **只排除 `validator/rules.py`（部分排除）** | **成功 rc=0** | 镜像文件只剩 `deploy/server.py`、`validator/__init__.py` 和 **2 个 pyc**；容器**启动即退出 `exit=1`**，`/healthz` **永不 200** |

部分排除场景的容器日志原文：

```
  from validator.rules import validate
  File "/app/validator/__init__.py", line 3, in <module>
    from .rules import validate
ModuleNotFoundError: No module named 'validator.rules'
```

**这一条尤其重要，它同时否证了两个担忧**：

1. **镜像里虽然留着陈旧的 `rules.cpython-312.pyc`，但 Python 不会在源码缺失时从 `__pycache__` 导入** → 不会"用陈旧规则静默服务"。失败是 `ModuleNotFoundError`，容器直接退出。
2. **"缺文件但服务看起来正常"不可能发生**：三种误排除都导致构建失败或容器健康检查失败。

**额外的守卫验证（陈旧规则）**：我把 `validator/rules.py` 追加一行注释后重建，`/healthz` 报出 `45f56c55…`，与仓库当前 `4782255b…` **不同** → `/healthz` 的 `rules_source_sha256` 是内容派生的，**能发现被替换/陈旧的规则**（D-3 的机制本身也是有效的陈旧性守卫）。

### 问题 6｜无缓存重建与热构建的耗时差异，是否与 PM 记录一致？

我的实测（`evidence/raw/qa16-staleness-and-timing.txt`，每次都重新落盘计时）：

| 方式 | 第 1 次 | 第 2 次 |
| --- | ---: | ---: |
| `--no-cache`（冷） | **1.541 s** | **1.428 s** |
| 命中缓存（热） | **1.089 s** | **1.369 s** |

PM 的 D-1 与 D-8 都记 **0.6 s**。**结论：量级接近但数值不一致，差异来自口径而非造假。**

我从同一次冷构建的 BuildKit 分步输出里读到：

```
#9 DONE 0.3s      (RUN useradd + chown)
#10 DONE 0.2s     (exporting to image)
其余步骤 DONE 0.0s
```

即 **builder 自报的步骤耗时合计约 0.5–0.6 s**，与我用墙钟测得的 1.1–1.5 s 相差的正是 Windows 上 Docker CLI→daemon 的往返与镜像导出开销。**PM 的 0.6 s 更接近 builder 步耗时；我的数字是墙钟。两者不矛盾，但 PM 未注明口径。**

另需注意：**PM 用 D-8「二次构建可复现」的证据（`d8-rebuild.txt`）全程 `CACHED`，是一次什么都没重做的空转**，不能证明"从零可复现"。我用 `--no-cache` 重建并逐文件比对 sha256 独立证明了内容级可复现：

| 文件 | PM 基线镜像 | 我 `--no-cache` 构建 |
| --- | --- | --- |
| `/app/deploy/server.py` | `cdc4a981b688359c…` | **相同** |
| `/app/validator/__init__.py` | `f94446ea4292f37b…` | **相同** |
| `/app/validator/rules.py` | `4782255bb9c9ab48…` | **相同** |
| `__pycache__/__init__.cpython-312.pyc` | `90e7e233f4441d00…` | **相同** |
| `__pycache__/rules.cpython-312.pyc` | `2360bda0fd4b0a56…` | **相同** |

（注意：`#5 WORKDIR` 这类**元数据指令**即使加 `--no-cache` 也显示 `CACHED`，这是正常的，不能拿它判断是否真的重建。）

**另：镜像 ID 不是可复现性判据。** PM 的 D-1/D-7 记 `b1fe2847…`，而实际镜像 ID 是 `b42f408b4f07`（`b1fe2847…` 是 **manifest-list digest**）。同一份内容在不同时刻构建会得到不同 ID（config 摘要含构建时间戳）。我的三次构建分别得到 `b42f408b4f07` / `61321052b48b` / `258bce73d7f0`，但**内容哈希完全一致**。

## 2. 其他独立复现代理通过的项

| 项 | 我的方法 | 结果 |
| --- | --- | --- |
| D-3 规则哈希 | 容器 `/healthz` vs 本机 `sha256(validator/rules.py)` | 两侧同为 `4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3`；`Content-Length: 135` 与实际字节数相符 |
| D-5 状态码契约表 | 对活容器逐行发真实请求 | 非法 JSON=400 `INVALID_JSON`；类型错/缺字段/非对象/null 字段=400 `INVALID_PAYLOAD`；未知路径 GET/POST=404 `NOT_FOUND`；`GET /`=200；业务不通过=**200**；65537 字节=413；**65536 字节本身不算超长**；`HEAD`=501 |
| 启动到就绪 | `docker run -d` → 首次 HTTP 200，每次探测 1s 超时，3 轮 | **0.454 / 0.500 / 0.469 s**（中位 **0.469 s**） |
| 内容级可复现 | `--no-cache` 重建后逐文件 sha256 | 5 个文件全部相同（见 §1 问题 6） |
| 镜像只在本机 | 镜像仓库前缀、本地镜像清单、证据中推送命令检索 | 全部为本地名（无 registry 域名前缀）；证据中无 `docker push`/`docker login`（唯一 "registry" 命中是 WSL 注册表项检查） |
| 实际上下文体积 | 用仓库根 `.dockerignore` + stdin Dockerfile 实测 | **196.0K**（PM README 称 0.05 MiB） |

## 3. 真实缺陷（报告给 PM，由 `deploy/` 线修；**我未修改 `deploy/**`**）

### I-1【中】`.dockerignore` 的 `__pycache__` / `*.pyc` 对嵌套目录无效，镜像混入编译字节码

**现象**：`docker build --no-cache` 后镜像内仍有 `/app/validator/__pycache__/__init__.cpython-312.pyc` 与 `rules.cpython-312.pyc`。

**根因（已用最小实验确证，`evidence/raw/qa4-dockerignore-experiment.txt`）**：`.dockerignore` 模式**锚定在上下文根**，`__pycache__` 只匹配顶层 `__pycache__`、`*.pyc` 只匹配顶层 `*.pyc`，都不匹配 `validator/__pycache__/rules.cpython-312.pyc`。

| 实验 | `*.pyc`（顶层） | `sub/__pycache__/mod.cpython-312.pyc`（嵌套） |
| --- | --- | --- |
| `.dockerignore` 写 `__pycache__` + `*.pyc`（= 仓库现状） | 被排除 ✅ | **仍在内 ❌** |
| 改成 `**/__pycache__` + `**/*.pyc` | 被排除 | 被排除 ✅ |

**决定性证据**：镜像内 pyc 的 sha256（`90e7e233…`、`2360bda0…`）与本机 `validator/__pycache__/` 同名文件**完全相同**，且镜像已设 `PYTHONDONTWRITEBYTECODE=1`（容器内 `sys.dont_write_bytecode=True`、文件时间戳为构建日）→ 只能来自构建上下文 COPY，**不可能是运行时生成**。

**同类影响**：`deploy/__pycache__/server.cpython-312.pyc` 也进入了构建上下文（未被排除），只是没被 COPY 进镜像。**连带修正 PM README 的数据**：实测上下文 **196.0K**，不是"0.05 MiB"。

**PM 自己的证据里已有反例但未标出**：`raw/docker-2026-10-30/d6-image-files.txt` 的 9 行清单第 7、8 行就是这两个 pyc。

**建议修法**（由部署线决定）：把两条规则改为 `**/__pycache__`、`**/*.pyc`、`**/*.pyo`，两份 `.dockerignore` 同步改（该文件注释已提醒"修正时请同时修改根 .dockerignore，勿只改一处"）。

### I-2【中】声明 `Content-Length` 大于实发字节时，服务端**无限等待并永久占用线程**，且被健康检查掩盖

**现象**（原始 socket，`evidence/stall-probe.json`）：

- 发送 `POST /validate HTTP/1.0` + `Content-Length: 100`，实际只发 5 字节后停住 →
  **45 秒内没有任何响应，连接也未被关闭**（`server_blocked_indefinitely: true`）。
- 再打开 8 条同类连接后，容器内 `PID 1` 线程数 **+9**，**10 秒后仍不回收**；客户端关闭后线程才释放。
- 同时 `/healthz` **仍返回 200**（`service_still_responsive: true`）。

**根因**：`deploy/server.py` 中 `settimeout`／`timeout`／`protocol_version` **全部未出现**（只有 `Content-Length` 取值与 `self.rfile.read(size)`）。`ThreadingHTTPServer` 每连接一线程且无读超时，`rfile.read(size)` 在客户端不补足字节时永久阻塞。

**影响**：慢速/恶意客户端可用极低成本**无上限耗尽线程**；而 Docker `HEALTHCHECK` 只探回环 `/healthz`（另一个线程仍可服务），**据此判定容器 healthy，故障被掩盖**。

**复现**：
```bash
python tests/acceptance/cloud-001/stall_probe.py http://127.0.0.1:18000 gw-qa 45
```

**PM 的 D-5 为何没发现**：D-5 只测了"**没有** `Content-Length`"（该场景立即 413，我已复现通过），**未测"声明长度大于实发"**。这是**覆盖缺口**，不是虚假声明。

**建议修法**（由部署线决定）：给 handler 设 `timeout`（如 `BaseHTTPRequestHandler.timeout = 10`），或在读前校验 `Content-Length` 上限并对超时连接主动关闭；`HEALTHCHECK` 可增加并发/存活线程检查。

## 4. 已核实 / 未核实 / 与 PM 记录不一致

### 已核实（我自己执行）

1. `PATH` 前置条件真实；规范构建命令成功；`context=deploy/` 确会失败（原文见 §1 问题 1）。
2. 容器 `/healthz` 的 `rules_source_sha256` == 本机 `validator/rules.py` 的 sha256；该哈希也是有效的**陈旧规则守卫**。
3. `/validate` 与进程内 `validate()` 逐字节一致：**78 例对抗输入 + 6 个哈希种子，零反例**；且比较方法经区分力、深比较、变异测试验证。
4. `deploy/README.md` 状态码契约表逐行成立（含 65536/65537 边界、`HEAD`=501、业务失败仍 200）。
5. 无 `Content-Length` 时立即 413 且连接被对端关闭，**无挂起、无半开**（三种 HTTP 变体）。
6. 镜像内无密钥、无 `.git/tests/docs/workflow/web/.env`；`uid=10001` 非 root 生效。
7. 内容级可复现（5 文件 sha256 全同）；启动到就绪中位 **0.469 s**；上下文实测 **196.0K**。
8. **`.dockerignore` 不会误排除 COPY 源**（16 模式逐个验证 + 4 变体产物相同）；即使误排除也**响亮失败**而非静默。

### 未核实 / 无法独立验证及原因

1. **"未上传任何 registry、未产生云资源费用"**：我只能证明**本机**无推送痕迹（无 registry 前缀、证据中无 `docker push`/`docker login`）。远端 registry 与云账单侧无凭据可查，**无法独立确认**。
2. **PM 的精确构建值 0.6 s 与启动值 0.75 s**：我测得冷 1.43–1.54 s／热 1.09–1.37 s、启动 0.469 s。同量级但**无法复现其精确数值**（口径不同，见 §1 问题 6）。
3. **D-0…D-10 的完整命令序列**：`raw/` 只归档了输出、未归档命令本身，**无法逐步重放**。
4. **镜像体积口径**（`178MB`／`177582258`／`169.4MB`／`43.3MB`）：多平台 manifest 与 attestation 会造成不同口径，我未深究差异来源。

### 与 PM 记录不一致（逐条）

| # | PM 记录 | 我的实测 | 性质 |
| --- | --- | --- | --- |
| 1 | README：`.dockerignore` 静态估算 → **0.05 MiB** | 上下文实测 **196.0K** | 估算失准（且未识别嵌套漏排除） |
| 2 | D-6 隐含"排除规则有效" | `validator/__pycache__`、`deploy/__pycache__` **均未排除** | 字面断言（无密钥/无违禁路径）成立，但排除承诺未达成 |
| 3 | D-1／D-7 记镜像 ID `b1fe2847…` | 实际镜像 ID `b42f408b4f07`；`b1fe2847…` 是 manifest-list digest | 口径错误，且镜像 ID 本不适合作可复现判据 |
| 4 | D-8「二次构建可复现」附 `d8-rebuild.txt` | 该文件**全程 CACHED**（空转），不支撑该结论；结论本身经我独立验证成立 | 证据强度不足 |
| 5 | D-4「逐字节一致（实测 367 字节）」 | 同夹具实测 **271 字节**；且 `d4-validate.txt` 两行并不同字节 | 数字来源未注明 + 证据不自证 |
| 6 | D-5「错误路径全部符合契约」 | **覆盖不完整**：未覆盖"声明长度>实发"，该场景实为缺陷 I-2 | 覆盖缺口 |

## 5. 我自己的方法学更正（如实记录）

1. **首轮 D5 我误报"契约不符"**：是我手写的 `Content-Length` 与实际字节数不符（如声明 41、实际 42），服务端严格按声明长度读取后截断成非法 JSON。改为由 `len(body)` 计算后 **D5-01 通过**——服务端行为本身正确。
2. **首轮我把启动耗时测成 21.8 s**：是我的**无超时 `curl`** 在 Docker Desktop 端口尚未转发时被静默阻塞所致。改用带 1 秒超时的探测后为 **0.469 s（中位）**，与 PM 的 0.75 s 一致。**我先前的高值是测量缺陷，PM 的声明成立。**
3. **反例穷举首轮误报 `RAW-BOM` 分歧**：服务端 `json.loads(bytes)` 会正确识别并剥离 UTF-8 BOM 并返回 200，是我方未按 `utf-8-sig` 解码而误判。已修正后 78 例零分歧。

## 6. 证据/口径问题（不构成功能缺陷，但影响可复核性）

- **K-1**：`.dockerignore` 的收窄承诺与实际不符（同 I-1）。
- **K-2**：`deploy/README.md` 引用的响应体 **367 字节**与实测 **271 字节**不符，未注明取自哪个夹具。
- **K-3**：`deploy/README.md` 称 Dockerfile "从未构建成功"，而本次已构建成功——该行需更新（属文档时效，非缺陷）。
- **K-4**：D-4 的归档证据（`d4-validate.txt`）两行序列化口径不同，**不能自证**逐字节一致；建议改为归档响应体原始字节的 sha256 并写明口径。
- **K-5**：`raw/` 只有输出没有命令，无法逐步重放。
- **K-6**：镜像内 `deploy/` 只有 `server.py`、无 `__init__.py`，`python -m deploy.server` 依赖 PEP 420 命名空间包；实测可用但较脆弱，建议显式 `COPY deploy/__init__.py`。

## 7. 边界与副作用

- **未修改** `deploy/**`、`validator/**`、`workflow/**`、`web/**`、`docs/architecture/**`。所有发现均以报告形式提交，由对应文件线修。
- 本轮新增：`tests/acceptance/cloud-001/`（5 个探针脚本）、`docs/test-reports/cloud-001/`（本报告与证据）。
- 为不破坏 PM 产物：先 `docker tag` 保全其镜像为 `giftwise-validator:pm-baseline-20261030`（`b42f408b4f07`），复核结束后已把 `latest` **还原**指向该镜像。QA 自建容器与测试镜像已全部清理（`raw/qa13-cleanup.txt`）。
- "整仓库上下文体积测量"与实验构建均通过 **stdin（`-f -`）**或 `tests/` 下的自建上下文完成，**未在仓库内新增或改动任何构建文件**；临时上下文 `tests/acceptance/cloud-001/_ctx` 已在仓库外清理。
- **未执行** `builder prune`／`system prune`：属破坏性操作，未获授权。
- **并发提示**：复核期间 `deploy/observability.py` 新出现（部署线并发工作，非本 Agent 所加）。因此 **I-1／I-2 的重测必须在部署线停止改动 `deploy/` 之后进行**；本报告全部结论绑定 `HEAD=46d1b48` 与上述镜像摘要。

## 8. 证据索引

| 文件 | 内容 |
| --- | --- |
| `evidence/api-probe.json` | 12 项接口探针（D3/D4/D5/原始 socket）与原始 socket 明细 |
| `evidence/byte-identity-attack.json` | 78 例逐字节反例穷举（含 73 例双侧 200 比对） |
| `evidence/stall-probe.json` | 停滞连接量化（45s 无响应、线程 +9） |
| `evidence/startup-probe.json` | 启动耗时 3 轮 |
| `evidence/dockerignore-attack.json` | E-A/E-B/E-C 三组误排除实验 |
| `evidence/raw/qa4-dockerignore-experiment.txt` | 嵌套模式最小实验 |
| `evidence/raw/qa6-wrong-context.txt` | `context=deploy/` 失败原文 |
| `evidence/raw/qa8-healthz.txt` | 规则哈希两侧对比 |
| `evidence/raw/qa9-image-content.txt` | 镜像洁净度、非 root、ENV |
| `evidence/raw/qa10-context-size.txt` | 上下文实测 196.0K 与漏排除清单 |
| `evidence/raw/qa12-repro-and-boundary.txt` | 内容级可复现逐文件 sha256 |
| `evidence/raw/qa14-env-diff.txt` | 两侧 Python／unicodedata 版本 |
| `evidence/raw/qa15-hashseed-attack.txt` | 6 个哈希种子下的字节稳定性 |
| `evidence/raw/qa16-staleness-and-timing.txt` | 陈旧规则守卫 + 冷热构建耗时 |
