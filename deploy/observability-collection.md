# 阶段 14 可观测性：采集与落点实现方案（CLOUD-001 交付物 5）

- 编写日期：2026-10-30（北京时间）
- 本文件**只定义"怎么采集、落到哪里"**，**不定义字段语义**。
- 字段语义的权威来源（不要在本文件重复定义、也不要在这里改）：
  1. Issue [#5](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/5)（ARCH-001）交付物 4：
     「运行 ID、候选版本、校验输出、修订计数、错误码、调用记录的具体字段与落点（与阶段 14 对齐）」。
  2. `docs/architecture.md` 末段：「运行记录包括阶段、请求和候选版本、节点状态、全局修订次数、错误、耗时、调用数、用量与成本依据。两阶段分别计时计费。」
- 文件名协调：#10 要求"新增可观测性方案文档须先与 ARCH-001 协调文件名"。任务单已指定本题使用
  `deploy/observability-collection.md`；架构 Agent 的对应内容在 `docs/architecture.md`（**我没有修改该文件**）。
  如需单一权威位置，请 PM 指定，我按指示合并或改名。
- **状态（2026-10-30 晚更新）：L1 与 L2 已实现并真跑通过**，L3 未做。
  - 实现：`deploy/observability.py`（`Metrics` / `AccessLog` / `summarize_jsonl`）、
    `deploy/observable_server.py`（可观测入口，**子类化** `deploy/server.py` 的 `Handler`，未修改原文件）。
  - 证据：`deploy/evidence/observability-2026-10-30.md`；本机 **39/39** 断言、容器内 **24/24** 断言通过；
    原始输出在 `deploy/evidence/raw/observability-2026-10-30-*`。
  - **尚未接入镜像**：`deploy/Dockerfile` 的 `CMD` 仍是 `python -m deploy.server`（QA 冻结期不能改），
    容器内验证用的是"命令覆盖 + 只读挂载"。**不得表述为"镜像已默认启用可观测性"。**
  - 下文第 1、3、4、6、7 节保留为设计记录；与实现不一致处已就地标注日期。

## 1. 现状（实测，非设计）

| 项 | 现状 | 证据 |
| --- | --- | --- |
| 日志格式 | 纯文本单行：`地址 - "方法 路径 HTTP/1.1" 状态码 -` | `evidence/raw/server-8765.log`（215 行） |
| 日志内容 | **不含**请求体、请求头、延迟、运行 ID、成本 | 同上 |
| 并发安全 | **不安全**：多线程 `print` 会交错粘连（实测出现 `200 -127.0.0.1 - …` 同一行） | `evidence/raw/server-8765.log` |
| 缓冲行为 | `log_message` 用 `print` 且**不 flush**：不设 `PYTHONUNBUFFERED` 时若进程被强杀，访问日志会丢失（实测只剩启动行；`Dockerfile` 里设了该变量，故容器内不受影响） | `evidence/raw/curl-verify.txt` |
| 追踪能力 | 该 Dify 租户 `trace-runs` 返回 `not_collected`（ARCH-001 已核实），**无平台级追踪** | Issue #5 正文 |
| 模型调用 | `deploy/server.py` **0 次模型调用**、0 Token、0 成本 | `deploy/server.py` 源码；`/healthz` 仅返回规则哈希 |
| 落点 | 只有容器/进程 stdout | 同上 |

结论：当前可观测性**不足以支撑评分规则 1.2「可观测性证据：关键日志、运行状态、调用记录或指标」**，
也不足以支撑「成本、性能与工程化分析」里的"调用记录"。需要下面的最小实现。

> **2026-10-30 晚更新**：上表是**改造前**的真实基线（自 `deploy/server.py` 这条路径采集）。
> 新入口 `deploy/observable_server.py` 已把前四行问题修掉，实测：154 行 JSONL **零交错**、
> 每行带 `duration_ms`/`request_id`/`run_id`/成本字段、并新增 `/metrics` 指标与 `/readyz`。
> 但**冻结中的 `deploy/server.py` 本身未改**，所以走 `python -m deploy.server` 时仍是上表的旧行为。

## 2. 采集字段的来源分工（语义见 #5，本表只说明"谁产出、谁采集"）

| 字段（语义权威：#5 / `architecture.md`） | 由谁产出 | 本服务（validator API）能否产出 | 采集方式 |
| --- | --- | --- | --- |
| 运行 ID（run ID） | 接入层/Dify（生成规则以 #5 为准） | **不能**（服务是无状态的，不发明 ID） | 接入层在请求头 `X-GiftWise-Run-Id` 传入；服务端**只透传记录**，缺失记 `null` |
| 调用次数 | 本服务 | **能**：每次 `POST /validate` 记 1 | 在 `do_POST` 成功进入校验分支时自增；同时写日志行 |
| 端到端延迟 | 接入层（跨组件）/ 本服务（本次处理） | **能**（后者）：处理耗时 ms | 进入 handler 记 `t0`，发送响应前算 `t1-t0` |
| 错误码 | 本服务（HTTP 层）+ `validator.rules`（业务层） | **能** | 直接记录既有稳定代码，**不新建映射表** |
| 校验输出摘要 | `validator.rules.validate` | **能**（摘要） | 记 `status`、`all_passed`、`errors[].code` 计数；**不记完整请求体** |
| 候选版本 | 工作流/接入层（候选的生成与修订版本） | **不能**（服务只看到字符串） | 可选：记 `sha256(candidates_json)` 作为指纹便于比对，**不解释其语义** |
| 修订计数 | 工作流层（全局最多一次自动修订） | **不能** | 由接入层/Dify 记录；本服务只记"第 N 次校验调用"，**不要**把它当修订计数 |
| 用量与成本依据 | 模型/Dify 层 | **不能**（本服务不调模型） | 本服务的成本记录固定为 `model_calls=0`、`cost=0`；模型成本由接入层写 |
| 阶段（两阶段区分） | 接入层 | **不能** | 请求头可带 `X-GiftWise-Stage`；服务端透传记录 |

> 关键纪律：**本服务不得发明 run ID、不得推断修订次数、不得估算模型成本**。
> 这些字段的权威在其他组件；本服务只做"记录自己确实知道的事"。

## 3. 落点方案（三档，按实现成本递增）

### L1（**已实现**，2026-10-30 晚）：单行 JSON 结构化日志到文件

- 落点：`GIFTWISE_ACCESS_LOG` 指定文件（**默认不落文件，只写 stdout**，避免在只读镜像里静默失败）；
  容器内可挂载卷或写 `/tmp`（本次容器验证写的 `/tmp/access.jsonl`）。
- 实现位置：`deploy/observability.py` 的 `AccessLog`（`TimedRotatingFileHandler`，按天、默认保留 7 天）。
- 格式：**每行一个 JSON 对象**（JSONL），字段示例（机器名，语义对应 #5）：

```json
{"ts":"2026-10-30T21:25:49.123+08:00","run_id":null,"stage":null,"service":"giftwise-validator","method":"POST","path":"/validate","http_status":200,"val_status":"passed","all_passed":true,"error_codes":[],"candidates_sha256":"9f1c…","duration_ms":1.42,"model_calls":0,"cost":{"unit":"CNY","amount":0,"source":"deterministic_rules_only"}}
```

- 并发安全：改用 `logging` 模块（`logging.FileHandler` 自带锁）；
  **不再用 `print`**，从根上消除实测到的日志行交错。
- 轮转：按天（`TimedRotatingFileHandler`）或按大小，保留 7 天；容器内 stdout 仍保留一份给 `docker logs`。
- 为什么是 L1：零依赖（只用标准库）、可被 `grep`/`jq` 直接统计、无需新服务、无额外费用。

### L2（**已实现**，2026-10-30 晚）：JSONL → 统计报告

- 实现：`deploy/observability.summarize_jsonl()`（只读、无网络、无第三方依赖）。
  另外 `/metrics?format=json` 直接给出运行中的同一份统计（`raw/observability-*/metrics-summary*.json`）。
- **未做**：把统计渲染成固定格式的"阶段 14 报告模板"（数据已可得，模板未定）。

### L3（可选，未评估成本）：云上集中式采集

- 可选：UCloud 日志服务，或自建 Loki/Prometheus + Grafana。
- **成本未知，未测量**（#5 与 `architecture.md` 明确要求"当前未核实费率或云额度，缺失数据记未知"）。
- 建议：比赛 Demo 阶段**不做 L3**，用 L1+L2 即可满足"关键日志、调用记录或指标"的要求；
  若做，必须在 PPT 里如实标注"未做成本实测"。

## 4. 采集实现点（**实际实现**，2026-10-30 晚；全部在 `deploy/` 内）

| 位置 | 实际改动 | 说明 |
| --- | --- | --- |
| 新增 `deploy/observability.py` | `Metrics`、`AccessLog`、`summarize_jsonl`、`process_rss_bytes`、`route_label`、`sanitize_path` | 新文件，不碰任何既有契约 |
| 新增 `deploy/observable_server.py` | `ObservableHandler(BaseHandler)`：覆写 `handle_one_request`／`parse_request`／`send_response`／`end_headers`／`_send`／`log_message`／`do_GET`／`do_POST`；新增 `/metrics`、`/readyz`；SIGTERM 优雅退出 | **不改 `deploy/server.py`**：响应体仍由父类产出，可逐字节回归 |
| `deploy/server.py` | **未改动**（`git diff --quiet` 通过） | 冻结期纪律；原入口行为完全不变 |
| `deploy/Dockerfile` | **2026-10-31 01:13:59 已改**：`COPY deploy /app/deploy`（可观测入口进镜像），**默认 `CMD` 保持 `python -m deploy.server`** | **已定**：可观测入口**已随镜像交付、但非默认入口**；要用显式 `python -m deploy.observable_server`（`/metrics` 未鉴权，不得默认暴露） |
| 新增 `deploy/evidence/observability_check.py` | 本机双进程对照 + 39 项断言 | 期望值来自"实际请求账本"，不写死规格 |
| 新增 `deploy/evidence/observability_container_check.py` | 容器内 24 项断言（独立 tag + 只读挂载 + 命令覆盖） | 不修改 Dockerfile 也能验证新入口 |

**为什么不用"改 `server.py` 加一行"的路线**：该文件正被 QA 独立复核（含无缓存重建），改动会让复核失效。
子类化路线把改动面收敛到新文件，同时用"三方逐字节一致"证明契约未被破坏。

## 5. 隐私、安全与不记录的内容

1. **不记录请求体**（现状如此，继续保持）：请求里可能含用户填写的对方爱好、关系、禁忌等信息。
2. **不记录凭证**：不记录任何 header 中的 `Authorization`/Cookie；若将来加认证，只记"是否通过"。
3. 只记录**摘要与哈希**：`candidates_sha256` 用于比对版本，不可逆推内容。
4. `run_id` 若由接入层生成，必须是非个人信息标识（不得含手机号、邮箱、姓名）——语义以 #5 为准。
5. 日志文件权限：容器内 `0600`，仅 `giftwise` 用户可读。
6. 公网部署时（见 `security-review.md` S-3），日志**不得**回传外部分析服务。
7. **指标标签基数保护（已实现）**：`method`/`route`/`status` 只取已知路由
   （`/`、`/healthz`、`/validate`、`/metrics`、`/readyz`，未匹配一律 `__unmatched__`），
   避免被任意 URL 打爆指标内存。
8. **日志注入防护（已实现）**：日志里的 `path` 字段剔除控制字符（ESC/CR/LF/TAB）并限长 160，
   实测 `/a\x1bb` 被记为 `/a?b`，因此**恶意路径无法伪造或截断 JSONL 行**。
9. **不记录的身份信息**：只记 `remote`（对端 IP）与调用方自带的 `run_id`/`stage`；不记 `Authorization`/Cookie。

## 6. 原"未实现"的原因，以及本轮如何绕开（2026-10-30 晚更新）

- 原计划需要给 `deploy/server.py` 加调用点；但该文件正被 QA 独立复核，**任何改动都会让复核失效**。
- 因此改为**子类化**：新入口只覆写钩子，响应体仍由父类原样产出。
  已用三方逐字节对比（冻结实现 / 可观测实现 / 进程内纯函数）证明契约未变。
- ~~残留：`Dockerfile` 的 `CMD` 未改（同样处于冻结期），所以**镜像默认入口仍是不可观测的那条**。~~
  → **2026-10-31 01:13:59 更新**：`Dockerfile` 已改成 `COPY deploy /app/deploy`，可观测入口**已随镜像交付**；
  但**默认 `CMD` 仍是 `deploy.server`**（PM 明确要求），所以"镜像默认入口 = 可观测入口"这一步**不做**，
  要用得显式 `python -m deploy.observable_server`（`/metrics` 未鉴权，不得默认暴露）。

## 7. 如何证明采集真的在工作（验收方法）

**本节的方法已在 2026-10-30 晚实跑**（规模比原设计更大）：本机 69 个串行请求 + 80 个并发请求，
容器内 9 个请求。实际采用的断言（比原设计更严）：

1. 请求方法/路由/状态码/预期错误码/预期校验结果**随每次请求登记成账本**，再与 `/metrics?format=json` 逐键比对
   —— 全部相等才算通过（不写死人工规格，避免"用错的期望去验证实现"）。
2. `/metrics` 的计数**不含它自身**（渲染在前、记账在后），因此断言写成"账本 + 本次抓取"。
3. 关机汇总（`"event":"shutdown"`）在**所有请求之后**输出，用它做最终口径：`requests_total == JSONL 行数`。
4. **不记录请求体**用哨兵串证明：把 `SENTINEL_...` 注入 `notes` 与 `facts[0].text`，
   跑完后在整份 JSONL 里 grep —— 必须 **0 命中**（同时检查 `request_json`/`candidates_json` 字段名 0 命中）。
5. 并发下"零交错"的判据：**每一行都能 `json.loads`**（旧实现会出现两行粘连，必然解析失败）。
6. 容器内额外验证：`platform=Linux`（证明 `/proc` 分支真跑）、HEALTHCHECK healthy、
   `docker stop` 后 exit code 0 且打印末次汇总。
7. 明细与原始输出：`deploy/evidence/observability-2026-10-30.md`。

---

## 当前进度 / 未完成清单 / 阻塞

（本节 2026-10-30 晚按实现后的真实结果重写；上方设计内容原样保留）

**当前进度**：交付物 5 的**方案 + L1/L2 实现 + 真跑证据**均已完成。

- `python deploy/evidence/observability_check.py` → **exit 0，39/39 断言通过**（本机双进程对照）。
  产出 `raw/observability-20261030-224746/`：`access.jsonl` 154 行零交错、`metrics-prometheus.txt`、
  `metrics-summary.json`、`metrics-summary-after-concurrency.json`、`observability-check.json`、两服务端日志。
  关键真实数字：`/validate` p50 0.781 ms / p95 1.816 ms / p99 2.979 ms / max 4.018 ms；
  并发 8×10 = 80 请求 / 0.659 s（≈121 rps，同机客户端、HTTP/1.0 每请求新建 TCP，非容量结论）；
  RSS 26.96 MiB；`requests_total 154`、`errors_total 22`（可完全对账）；哨兵串 **0 命中**。
- `python deploy/evidence/observability_container_check.py` → **exit 0，24/24 断言通过**（容器内）。
  镜像 `giftwise-validator:obs-check`／`61bdb8815bd9`／178 MB（0.8 s 构建，**独立 tag，未改 Dockerfile**）；
  `user=giftwise`、HEALTHCHECK healthy、`platform=Linux`、RSS 27.82 MiB、
  `docker stop` → **exit 0** 且打印末次汇总。请求数完全对账：`9 = 我发起 6 + 抓取 1 + 探活 1 + 容器 HEALTHCHECK 1`。
- 首轮真跑暴露并修掉了我自己的一个**实现缺陷**（把 `/healthz` 的 `{"status":"ok"}` 误采为校验结果，
  指标 34/6 与账本 31/3 不符）与两个**验证脚本口径错误**；首轮记录保留在
  `raw/observability-20261030-224548/`（27/35）与 `raw/observability-container-20261030-224830/`（18/21），未删除。

**未完成清单（计划，未执行）**

1. **把可观测入口接进镜像**：改 `deploy/Dockerfile` 的 `CMD` 一行 —— 卡在 QA 冻结，**不能做**。
   在此之前，任何"镜像已默认启用可观测性/监控"的说法都是不成立的。
2. 阶段 14 报告模板（`summarize_jsonl()` 数据已可得，固定格式未定）。
3. 日志按天轮转的真实触发（未跑满一天）。
4. `/readyz` 的**失败**路径（日志目录不可写）未构造。
5. `GIFTWISE_HIDE_PY_VERSION=1`（安全自查 S-4 的最小修复）未出证据。
6. L3 云端集中式采集与成本评估（**未知，未测量**）。
7. 与 ARCH-001 的文件名/权威位置对齐结果（等 PM 指定）。

**阻塞**

1. **QA 复核冻结**：`deploy/server.py` 与 `deploy/Dockerfile` 在 QA 出报告前不可改 →
   "新入口成为镜像默认 CMD"与"server.py 原生埋点"两条路都不能走。
2. **上游未产出 `run_id`/`stage`/修订计数**：本服务只能透传记录，缺失记 `null`；
   本轮证据里的 run id 是测试构造值，**不得当作真实调用链证据**。
3. **平台级追踪不可用**：该 Dify 租户 `trace-runs` 为 `not_collected`（ARCH-001 结论），
   调用链只能用自建 JSONL 替代，需 PM 认可这一替代路径。
4. **无云资源授权**：L3 与云端成本无法推进（不采购、不开通、不上传）。
