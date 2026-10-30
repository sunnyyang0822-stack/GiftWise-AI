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
- 状态：**纯设计，未实现任何采集代码**。本文件里所有"建议/待实现"都不是已完成的功。

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

### L1（推荐最小实现，约 1–2 小时）：单行 JSON 结构化日志到文件

- 落点：`GIFTWISE_LOG_PATH` 指定文件，默认 `deploy/evidence/runtime/validator-access.jsonl`（容器内可挂载卷）。
- 格式：**每行一个 JSON 对象**（JSONL），字段示例（机器名，语义对应 #5）：

```json
{"ts":"2026-10-30T21:25:49.123+08:00","run_id":null,"stage":null,"service":"giftwise-validator","method":"POST","path":"/validate","http_status":200,"val_status":"passed","all_passed":true,"error_codes":[],"candidates_sha256":"9f1c…","duration_ms":1.42,"model_calls":0,"cost":{"unit":"CNY","amount":0,"source":"deterministic_rules_only"}}
```

- 并发安全：改用 `logging` 模块（`logging.FileHandler` 自带锁）；
  **不再用 `print`**，从根上消除实测到的日志行交错。
- 轮转：按天（`TimedRotatingFileHandler`）或按大小，保留 7 天；容器内 stdout 仍保留一份给 `docker logs`。
- 为什么是 L1：零依赖（只用标准库）、可被 `grep`/`jq` 直接统计、无需新服务、无额外费用。

### L2（阶段 14 汇总，约 2–4 小时）：JSONL → 统计报告

- 落点：`deploy/evidence/runtime/summary-<date>.json` + Markdown。
- 统计项（全部来自 L1 的原始行，不做二次估算）：
  调用总次数、按 `http_status`/`error_codes` 分布、`duration_ms` 的 min/median/p95/max、
  每个 `run_id` 的调用次数、`stage` 分布、`model_calls` 合计、`cost.amount` 合计。
- 实现：一个只读脚本（放在 `deploy/evidence/`），无网络、无第三方依赖。

### L3（可选，未评估成本）：云上集中式采集

- 可选：UCloud 日志服务，或自建 Loki/Prometheus + Grafana。
- **成本未知，未测量**（#5 与 `architecture.md` 明确要求"当前未核实费率或云额度，缺失数据记未知"）。
- 建议：比赛 Demo 阶段**不做 L3**，用 L1+L2 即可满足"关键日志、调用记录或指标"的要求；
  若做，必须在 PPT 里如实标注"未做成本实测"。

## 4. 采集实现点（精确位置，全部在 `deploy/` 内）

| 位置 | 改动 | 说明 |
| --- | --- | --- |
| 新增 `deploy/observability.py` | `record_request(...)`：写一行 JSONL | 新文件，不碰现有契约 |
| `deploy/server.py` `Handler.do_POST` | 进入校验前记 `t0` 与请求头，响应前调用 `record_request` | **需要动 server.py**，本轮**未改**（见第 6 节） |
| `deploy/server.py` `Handler.log_message` | 保持只记方法/路径/状态码，或改为写 JSONL | 现状已"不记录请求内容"，保持不变即可 |
| `deploy/Dockerfile` | 可选 `ENV GIFTWISE_LOG_PATH=/var/log/giftwise/validator-access.jsonl` + `VOLUME` | 容器里日志持久化的落点；未构建验证 |
| `deploy/evidence/summarize_runtime.py` | 读 JSONL 出统计 | 新增脚本，只读 |

**建议的实现顺序**：先写 `observability.py` + 单元测试（用假 handler 直接调 `record_request`），
再接 `server.py` 一行调用，最后写汇总脚本。这样 `server.py` 的改动面只有一行，便于测试验收独立复核。

## 5. 隐私、安全与不记录的内容

1. **不记录请求体**（现状如此，继续保持）：请求里可能含用户填写的对方爱好、关系、禁忌等信息。
2. **不记录凭证**：不记录任何 header 中的 `Authorization`/Cookie；若将来加认证，只记"是否通过"。
3. 只记录**摘要与哈希**：`candidates_sha256` 用于比对版本，不可逆推内容。
4. `run_id` 若由接入层生成，必须是非个人信息标识（不得含手机号、邮箱、姓名）——语义以 #5 为准。
5. 日志文件权限：容器内 `0600`，仅 `giftwise` 用户可读。
6. 公网部署时（见 `security-review.md` S-3），日志**不得**回传外部分析服务。

## 6. 为什么本轮没有实现（以及需要谁批准）

- 实现必须给 `deploy/server.py` 加调用点。该文件的 `/validate` 行为已被独立测试与 VAL-001 契约固定，
  本轮集中做"如实取证"，**同一轮改代码会让证据与版本对应关系变模糊**，因此我选择不改，
  把改动点、字段来源与落点写成可执行方案，交由 PM 排期。
- `deploy/` 属于我负责范围，因此代码改动**无需他人文件授权**；但需要与测试验收 Agent 约定回归范围
  （至少要复跑 `/validate` 的 200/400/413/404 契约与 `validator` 保留测试）。

## 7. 如何证明采集真的在工作（验收方法）

1. 启动服务 → 连续发 20 次 `POST /validate`（含 3 次故意 400、1 次 413）。
2. 断言：JSONL 行数 **== 21**（20 次 + 1 次健康检查可另行计数）、
   `http_status` 分布 == `{200: 17, 400: 3, 413: 1}`、`duration_ms` 全部 > 0、
   `error_codes` 中出现预期代码、`model_calls` 合计 == 0。
3. 汇总脚本输出与手算一致 → 才算"采集已验证"。
4. 对比 `docker logs`（若在容器内运行）与 JSONL 行数一致。

---

## 当前进度 / 未完成清单 / 阻塞

**当前进度**：交付物 5 的**方案**已完成（本文件）。实际执行过的命令与真实结果：

- `python deploy/evidence/local_check.py` → exit 0：取得"现状可观测性"的真实基线——
  服务端日志 215 行、格式仅 `地址 - "方法 路径" 状态码`、并发下出现行交错粘连、
  无延迟/无运行 ID/无成本字段（即本文件第 1 节全部为实测，不是推测）。
- 该次运行同时证明本服务 `model_calls = 0`、无外部网络依赖（源码只 import 标准库 + `validator.rules`）。
- 采集代码：**未写**（第 4 节的 `observability.py`、`summarize_runtime.py` 均不存在）。

**未完成清单（计划，未实现）**：

1. `deploy/observability.py` 的 `record_request()` 与单元测试。
2. `deploy/server.py` 的一行接入点（计时 + 记 run_id 透传）。
3. JSONL 轮转配置、容器内日志卷与权限（`0600`）。
4. `deploy/evidence/summarize_runtime.py` 汇总脚本与阶段 14 报告模板。
5. 第 7 节的验收方法实跑一次。
6. 与 ARCH-001 的文件名/权威位置对齐结果（等 PM 指定）。
7. 云端集中式采集（L3）的成本评估（**未知，未测量**）。

**阻塞**：

1. **依赖上游字段的产出方**：`run_id`、`stage`、修订计数、模型用量与成本由接入层/Dify/模型层产出，
   本服务只能透传记录；在接入层未实现之前，这些字段只能记 `null`，无法产生有意义的调用链证据。
2. **优先级**：阶段 14 排在阶段 12 之后，而阶段 12 卡在容器/云资源授权（见 `preprod-plan.md`）。
3. **无法取得平台级追踪**：该 Dify 租户 `trace-runs` 为 `not_collected`（ARCH-001 结论），
   因此"调用链追踪"只能用自建 JSONL 替代，需要 PM 认可这一替代路径。
