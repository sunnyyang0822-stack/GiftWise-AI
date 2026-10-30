# QA-001 独立复核报告：Dify Code 节点、阶段 C 测试与契约／文档一致性

> 本报告数字为 2026-10-30 时点真值；后续变更见 `docs/acceptance-criteria.md` 第 13 节。

- 日期：2026-10-30（北京时间，Asia/Shanghai +08:00）
- 复核人：**GiftWise｜测试验收 Agent**
- 依据：[Issue #1](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/1)（定位唯一权威）、[Issue #3](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/3)、[Issue #4](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/4)、`AGENTS.md`、[`docs/requirements-analysis.md`](../requirements-analysis.md)（SC-1…SC-9／OPEN-1…OPEN-9）、[`docs/pm-reviews/stage-2-acceptance-checklist-2026-10-30.md`](../pm-reviews/stage-2-acceptance-checklist-2026-10-30.md)、[`docs/pm-reviews/contract-decisions-draft-2026-10-30.md`](../pm-reviews/contract-decisions-draft-2026-10-30.md)、[`docs/intake-contract.md`](../intake-contract.md)、[`docs/acceptance-criteria.md`](../acceptance-criteria.md)
- 环境：Python 3.12.12；Node v24.21.0；Git HEAD `89d6624`（领先 `origin/main` 3 个提交，属临时提交、未验收）
- 本报告只记录**我自己执行**得到的证据。开发方与 PM 的声明一律另行核实后才引用。

## 0. 结论摘要

| 复核对象 | 我的判定 | 依据 |
| --- | --- | --- |
| Dify Cloud 版本 1.18.0 | **已核实** | `GET /console/api/version` → 200 `{"version":"1.18.0"}` |
| 草稿 `GiftWise｜推荐工作流开发草稿` 未发布 | **已核实** | 服务端 `tool_published: false`；UI「未发布」；**我未点击发布** |
| 草稿只有 2 节点 1 边、无结束节点、工作流级输出 `{}` | **已核实** | 服务端 draft 实读 + 我自己触发的运行 SSE |
| Code 节点在真实 Dify 沙箱执行成功，`compatible: true`、四项标准库能力全 true | **已核实（独立复跑，未引用 PM 数字）** | 我自己的两次「测试运行」，含完整节点级 SSE 轨迹 |
| `0 Tokens`／无模型调用 | **已核实** | `total_tokens: 0`、`exceptions_count: 0` |
| 该租户未启用 trace 采集 | **已核实** | `GET /trace-runs/workflow/<run_id>` → 200 `{"status":"not_collected"}` |
| 本地 46 项探针 / 322 项 unittest | **已核实（含变更后重跑）** | 见 §4 |
| `pursuit` 机器值 | **已落地**（复核期间落地，时间戳见 §3.1） | `workflow/labels.py` 当前含 `pursuit`＝追求对象 |
| 「提交 `pursuit` 会被拒」 | **变更前成立（已用 HEAD 版本复现）；当前已不成立** | §3.2 |
| 「`interest_confidence: "unknown"` 会被拒」 | **已核实仍成立** | §3.2 |
| 「`INTERNAL_ERROR` 未补入契约错误码表」 | **已不再成立**（复核期间已补） | §3.3 |
| 阶段 C 其余项（真实模型三候选、真实一次修订、持续失败、调用／延迟／成本） | **未开始（未执行）** | §5 未核实清单 |

**核心结论：PM 关于 Dify Code 节点沙箱兼容的结论成立，我已独立复跑验证；但 PM 报告中的具体耗时数字（节点 0.462s）我无法复现为稳定值，我实测为 0.079s 与 0.094046s。**

> **并发改动提示**：本轮复核期间工作流线与前端线同时在改动工作区（详见 §9 末）。所有结论均绑定观测时刻与文件哈希；特别是 `pursuit`／`recipient_relation_id`／`INTERNAL_ERROR` 在我复核中途才落地（§3.1）。

## 1. 独立复核 Dify Code 节点（QA-001 任务 1）

### 1.1 我实际执行的命令

```bash
# 测试专属浏览器执行器（不改 workflow/，证据落 docs/test-reports/）
node tests/acceptance/stage_c/dify-qa-runner.cjs tests/acceptance/stage_c/qa-steps-codeprobe.json
node tests/acceptance/stage_c/dify-qa-runner.cjs tests/acceptance/stage_c/qa-steps-run2.json
# 规范化证据（机械提取，不修改数值）
python tests/acceptance/stage_c/extract_dify_evidence.py
```

浏览器：项目专用配置目录 `workflow/tools/dify-browser-profile-chrome`，**单一会话**，用完由脚本 `context.close()` 退出。
开工前核实：无 `SingletonLock`；`tasklist` 无该配置目录的 Chrome 进程。会话结束后再次核实无 `SingletonLock`，`Last Browser` 时间戳为 20:49。
**未读取**个人 Chrome 配置、Cookie、API Key 或任何凭证（个人 Chrome 进程使用 `AppData\Local\Google\Chrome\User Data`，与本任务无关，未干预）。**未点击发布、未创建版本。**

### 1.2 服务端实读的草稿（`GET /console/api/apps/<app_id>/workflows/draft` → 200）

- `tool_published: false`；`updated_at = 1793362854` → **2026-10-30 20:20:54 (+08:00)**（运行前）
- **节点 2 个、边 1 条、无 `end` 节点**（`hasEndNode: false`）
- 节点 1：`start`，ID `1793273634593`，标题「用户输入」，`variables: []`
- 节点 2：`code`，ID `1793357958534`，标题「代码执行」，`code_language: python3`
  - `variables: []`（空数组）
  - `outputs: {"compatible": {"type": "boolean"}, "details_json": {"type": "string"}}`
  - `code`：**453 字符 / 9 行**，首行 `"def main():"`，**无前导空白**

节点代码（服务端实读原文）：

```python
def main():
    import json
    import re
    import unicodedata
    from decimal import Decimal
    assert Decimal("0.1") + Decimal("0.2") == Decimal("0.3")
    assert unicodedata.normalize("NFKC", "ＡＬＣＯＨＯＬ").casefold() == "alcohol"
    assert re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?", "200.00", re.ASCII)
    return {"compatible": True, "details_json": json.dumps({"json": True, "re_ascii": True, "unicodedata_nfkc": True, "decimal": True})}
```

截图：`docs/test-reports/stage-c/evidence/shots/01-draft-before-run.png`、`03-node-panel.png`

### 1.3 我自己点的「测试运行」——真实结果

**运行 1（2026-10-30 20:48:25）**

| 层级 | 状态 | 运行时间 | Token | 输出 |
| --- | --- | ---: | ---: | --- |
| 工作流 | 成功 | 0.154s | 0 Tokens | `{}`（无结束节点） |
| 节点「上次运行」（`role=tab` 名为"上次运行"） | 成功 | **0.079s** | 0 Tokens | `{"compatible": true, "details_json": "{\"json\": true, \"re_ascii\": true, \"unicodedata_nfkc\": true, \"decimal\": true}"}` |

节点面板原文另含：输入 `{}`、数据处理 `{}`、执行人 `N/A`、开始时间 `2026-10-30 20:48:25`、运行步数 2。
截图：`02-after-test-run.png`、`04-node-last-run.png`、`05-final.png`

**运行 2（2026-10-30 20:49:23）—— 我进一步捕获了节点级 SSE 轨迹**

`POST /console/api/apps/5abdb13c-a633-4a9c-96c3-dabd44072511/workflows/draft/run` → 200，请求体 `{"inputs":{},"files":[]}`。
`workflow_run_id = 0cdef527-3504-4635-a338-58f985f8f216`。响应为 SSE 事件流，逐字要点：

```json
{"event":"node_finished","data":{"node_id":"1793357958534","node_type":"code","title":"代码执行",
 "inputs":{},"process_data":{},
 "outputs":{"compatible":true,"details_json":"{\"json\": true, \"re_ascii\": true, \"unicodedata_nfkc\": true, \"decimal\": true}"},
 "status":"succeeded","error":null,"elapsed_time":0.094046,"outputs_truncated":false}}
{"event":"workflow_finished","data":{"status":"succeeded","outputs":{},"error":null,
 "elapsed_time":0.1543920770054683,"total_tokens":0,"total_steps":2,"exceptions_count":0}}
```

同时，节点「上次运行」DOM（`04-node-last-run.png` / `06-run2-last-run.png`）显示 **0.094s**，与 SSE 的 `elapsed_time: 0.094046` 一致。

**结构化接口交叉验证**：`GET /console/api/apps/<app_id>/workflows/draft/nodes/1793357958534/last-run` → **200**，返回同一份输出、`status: "succeeded"`、`error: null`、`elapsed_time: 0.094046`。

**追踪能力**：`GET /console/api/apps/<app_id>/trace-runs/workflow/0cdef527-3504-4635-a338-58f985f8f216` → **200**
`{"status":"not_collected","source_kind":"workflow","source_id":"0cdef527-…","provider":null,"trace_id":null,"span_count":null,"error_code":null}` → **该租户未启用 trace 采集，无平台级节点追踪。**

### 1.4 机械断言（`extract_dify_evidence.py` 输出的 18 项，全部为 true）

```text
draft_http_200, draft_unpublished, two_nodes_one_edge, no_end_node,
code_node_variables_empty, code_node_code_453_chars, code_node_first_line_no_indent,
workflow_succeeded, code_node_succeeded, code_node_error_null,
code_node_output_compatible_true, details_json_all_true, details_json_declared_string,
zero_tokens, no_exceptions, workflow_level_outputs_empty,
trace_not_collected, version_1_18_0        → checks not-true: none
```

证据文件：`docs/test-reports/stage-c/evidence/dify-run-evidence.json`、原始日志 `qa-runner-log.jsonl`

### 1.5 与 PM 声明的逐项比对（含差异）

| 项目 | PM 声明 | 我的独立结果 | 判定 |
| --- | --- | --- | --- |
| Dify 版本 | 1.18.0 | `{"version":"1.18.0"}` | **一致** |
| 草稿发布状态 | 未发布 | `tool_published: false`、UI「未发布」 | **一致** |
| 节点/边/结束节点 | 2 节点 1 边、无结束节点 | 同 | **一致** |
| 工作流级输出 | `{}` | `{}` | **一致** |
| Code 节点 `variables` | `[]` | `[]` | **一致** |
| Code 节点 `outputs` | `compatible(bool)`、`details_json(string)` | 同 | **一致** |
| Code 节点代码 | 453 字符 / 9 行，首行 `def main():` 无缩进 | 同（字节一致） | **一致** |
| 节点执行结论 | 成功，`compatible: true` | 成功，`compatible: true`，`error: null` | **一致** |
| 四项标准库能力 | 全 true | 全 true（`details_json` 解析后） | **一致** |
| Token／模型调用 | 0 Tokens，无模型调用 | `total_tokens: 0`，工作流内无 LLM 节点 | **一致** |
| trace 采集 | `not_collected` | `not_collected` | **一致** |
| **节点耗时** | **0.462s**（20:20:54） | **0.079s**（20:48:25）、**0.094046s**（20:49:23） | **数字不一致（见下）** |
| 工作流耗时 | 0.162s | 0.154s、0.154392s | 量级一致，具体值不同 |
| 失败记录 | `TypeError: main() got an unexpected keyword argument 'arg1'`，`exit status 255` | **未复现**（属历史记录） | **未核实** |

**关于耗时差异的说明（重要，避免误读）**：这不是"PM 造假"。三次是**不同次运行**，无模型探针的耗时本身抖动大（0.079–0.462s）。但结论是：**`0.462s` 不能作为该配置的稳定耗时基线**，任何对外材料引用单次探针耗时都不合适（WF-002 §"不可当作业务延迟"的提醒是对的）。

**关于 `arg1` 失败记录**：这是修复前的历史事件。复现需要在该 Code 节点重新引入 `arg1`/`arg2` 声明，即**修改线上草稿**；本轮未获授权修改草稿，因此**未复现，如实标为未核实**。我不能替 PM 的这条记录背书。

### 1.6 我的新发现（PM 报告未覆盖）

1. **`POST .../workflows/draft/run` 的 SSE 响应体是比"上次运行"DOM 更强的证据源**：它逐节点给出 `status`、`error`、`elapsed_time`、`outputs`、`inputs`、`process_data`，无需依赖页面渲染，可用脚本机械断言。建议工作流线在 WF-002 中改用同一证据源。
2. **`GET /console/api/apps/<app_id>/workflow-runs` 由页面 `fetch()` 直接调用返回 401**：`{"code":"unauthorized","message":"CSRF token is missing or invalid."}`。Dify 的控制台接口需要页面自身携带的 CSRF 头；取证必须依赖页面自身发起的请求或对页面 fetch 装钩子。**这是取证方法的限制，不构成接口故障，不应写进缺陷。**
3. **点击「测试运行」本身会触发草稿自动保存**：观测到 `POST /workflows/draft` → 200 紧随「测试运行」发生（20:48:27、20:49:24），`updated_at` 随之刷新（20:20:54 → 20:48:25 → 20:49:22），**即使我没有修改任何内容**。因此 `updated_at` 不能作为"内容是否变更"的判据——这一点印证并强化了 WF-002 的自动保存提醒。

## 2. 阶段 C 测试的设计与落地（QA-001 任务 2）

新增独立套件 `tests/acceptance/stage_c/`（**不改** `tests/test_validator.py` 与 `tests/test_cases.json`）：

| 分组 | 用例数 | 覆盖 |
| --- | ---: | --- |
| C1 沙箱兼容探针 | 3 | 本地标准库探针；真实 Dify Code 节点（**独立捕获**）；真实耗时与 token |
| C2 契约缺口 | 11 | `pursuit` 存在性与互斥、HEAD 版本复现被拒、`unknown` 可信度、`interests` 的 `unknown`、前端越界提交、`colleague` 技术回归、新字段不破坏校验、`INTERNAL_ERROR` 入表 |
| C3 候选校验 | 9 | 正常三方案、超预算边界 200.00/200.01、禁忌标签与字面词、全角变体、候选 JSON 损坏、缺必填不修订、币种不换汇 |
| C4 修订与保护 | 10 | 首检可修订、修订成功占额度、额度用尽、持续失败、全部失败无可选、已通过项篡改、键序重排不误判、无谓修订拒绝、不替用户选择、禁忌项不可选 |
| C5 生成节点一致性 | 4 | 四个 Dify 入口节点真实执行、生成物与 manifest 哈希、空输入不放行、调度器异常中文受控且不重试 |
| C6 记录方案 | 2 | 离线全链路实测延迟 + `model_calls=0` + 成本 `not_measured`；Dify 运行可追溯且 trace 缺口如实记录 |

**实际结果：39 项通过、0 失败**（`python -m unittest discover -s tests/acceptance/stage_c -q` → `Ran 39 tests … OK`）。
逐例证据：`docs/test-reports/stage-c/20261030-205323/case-results.md` 与 `stage-c-results.json`。

**"调用次数／延迟／成本"记录方案（已实测落地，非设计稿）**：

| 项 | 实际取值 | 说明 |
| --- | --- | --- |
| `model_calls` | **0** | 全链路未调用任何模型；离线固定快照 |
| `cloud_verified` | **false** | 未做云端闭环 |
| `cost` | **`not_measured`** | 无计费即无费率依据，**缺数据记未知，不填 0** |
| 延迟时钟 | `time.monotonic` | 逐阶段实测（intake / check_first / recheck / report） |
| Dify 真实运行 | 记录 `workflow_run_id`、节点耗时、`total_tokens` | 探针耗时注明**不可当作业务延迟** |
| trace 缺口 | `not_collected` | 如实记录"无平台级追踪"，不伪造 |

**仍属"未开始"的阶段 C 项**（不得据本套件推断为通过）：真实模型三候选、真实一次修订轨迹、真实持续失败路径、业务延迟／token／成本、选择后呈现阶段、前端与部署。

## 3. 契约缺口验证（QA-001 任务 4）

### 3.1 时间戳很重要：复核期间发生了并发改动

| 时间（+08:00） | 观测 | `workflow/labels.py` sha256 前缀 | `pursuit` |
| --- | --- | --- | --- |
| 复核早期（早于 20:45，未逐秒记录） | 我首次读取 | `333ad976…` | **无**；`partner`＝"伴侣"；`intake-contract.md` 78 行，错误码表**无** `INTERNAL_ERROR` |
| 20:50:09 | 工作区出现 12 项未提交改动（`M workflow/labels.py`、`M workflow/intake.py`、`M docs/intake-contract.md`、`M workflow/workflow-spec.md` 等）与新增 `workflow/examples/intake-colleague.json` | `e3128d29…` | **有**，＝"追求对象"；`partner`＝"恋人" |

**因此：PM 在 Issue #1 评论中"新增 `pursuit` 待落地"的描述在**复核早期（早于 20:45）**仍然成立；到 20:50 已由工作流线落地。我后续所有断言都在 20:50 之后的版本上执行并已重跑回归。**

### 3.2 我实测的断言（全部真实执行，非引用）

| 断言 | 输入 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| `pursuit` 有机器值 | `workflow/labels.py` 当前版本 | `pursuit` → 追求对象；`partner` → 恋人；`colleague` 保留并注明"仅技术回归" | **通过** |
| `pursuit` 与 `partner` 互斥且都可用 | 同输入分别提交 `pursuit`/`partner` | 均 `ready`；`recipient_relation`＝"追求对象"/"恋人"；`recipient_relation_id`＝`pursuit`/`partner` | **通过** |
| **变更前 `pursuit` 会被拒** | 用 `git show HEAD:workflow/labels.py` 的 `RELATIONS` 替换后提交 `pursuit` | `needs_input` + `INTAKE_UNKNOWN_LABEL`，`request_json: null` | **通过（PM 声明成立）** |
| `interest_confidence: "unknown"` 被拒 | `{"coffee_food":"unknown","design_art":"inferred"}` | `needs_input` + `INTAKE_CONFIDENCE_MISMATCH`，不返回可用请求 | **通过** |
| 可信度多余键被拒 | 增加 `travel_exploration` 键 | `needs_input` + `INTAKE_CONFIDENCE_MISMATCH` | **通过** |
| `interests` 中的 `unknown` 机器值被拒 | `["coffee_food","unknown"]` | `needs_input` + `INTAKE_UNKNOWN_LABEL` | **通过** |
| 前端不得提交 `recipient_relation_id` | 表单附带该字段 | `needs_input` + `INTAKE_UNKNOWN_FIELD` | **通过** |
| `colleague` 仅技术回归仍可用 | 关系改 `colleague` | `ready`；"同事"/`colleague` | **通过** |
| 新增字段不破坏既有校验 | 带/不带 `recipient_relation_id` 的同一 request | 校验 `status` 与错误码集合完全一致 | **通过** |

### 3.3 `INTERNAL_ERROR` 是否已补入契约错误码表

- 复核早期（早于 20:45）我读到 `docs/intake-contract.md` 共 78 行，错误码表（`## 错误及调用边界`）**没有** `INTERNAL_ERROR` → PM 的判断当时成立。
- 20:50 之后该文件为 11497 字节，错误码表已新增一行：`INTERNAL_ERROR | workflow/intake.py:130：适配后送原校验器复核时，校验器自身返回 status=error（基础设施/内部异常）。不是输入问题，不泄露堆栈，不回显用户原文`。
- **判定：已补入，位置与代码出处一致（`workflow/intake.py:130` 确实抛出该码）。**
### 3.4 一段"看起来像夸大、实则准确"的表述（我独立核实后予以澄清）

`workflow/workflow-spec.md` 声明 7 个错误码 `INVALID_SELECTION`、`STALE_RECOMMENDATION`、`UNTRUSTED_RECOMMENDATION`、`CANDIDATE_NOT_PASSED`、`PRESENTATION_INVALID`、`TOTAL_MISMATCH`、`REPAIR_LIMIT_REACHED` 在代码中"均无实现点"。
**我逐项 grep 核实：7 个码在 `validator/`、`workflow/` 下各出现 0 次**；实际可用的是 `REPAIR_NOT_ALLOWED`、`PASSED_CANDIDATE_CHANGED`、`WORKFLOW_INPUT_ERROR`。
→ **该声明准确，不是夸大，可采信。**

## 4. 回归结果

在**当前工作区版本**（含工作流线 20:50 落地的改动）上重跑：

| 命令 | 实际输出 | 退出码 | 判定 |
| --- | --- | ---: | --- |
| `python workflow/verify_local.py` | `local probes: 46 passed; 0 failed; model calls: 0; cloud verified: false`；`format: python-source-not-dsl`；`cloud_verified: false` | 0 | **通过**（PM 的 46/0 复现成功） |
| `python -m unittest discover -s tests -q` | `Ran 322 tests in 0.155s` / `OK` | 0 | **通过**（PM 的 322 复现成功） |
| `python -m unittest discover -s tests/acceptance/stage_c -q` | `Ran 39 tests` / `OK` | 0 | **通过（本套件新增）** |
| `git status --short`（验证前后） | 未产生新的 tracked 改动（生成物重写后逐字节相同） | 0 | **通过** |

生成物未 STALE：`workflow/generated/manifest.json` 的 5 个 `artifacts_sha256` 与实际文件哈希**逐一匹配**（阶段 C C5-02 用例断言）。

## 4A. 前端接入层预备观察（有界冒烟，**不构成 WEB-001 验收判定**）

**背景与定性**：`web/` 于 **2026-10-30 20:56** 才在我复核过程中出现（12 个文件：`web/public/index.html`、`styles.css` 与 `web/server/*.mjs` 10 个），属前端线在飞工作，**未向我交付**。鉴于任务要求"优先复核能影响现场 Demo 的路径（三方案→校验→选择→呈现的中文状态与失败路径）"，我做了一次**只读、有界**的冒烟，结论必须带哈希与时间戳，**不代表该线已验收**。

**方法**：`GW_MODE=mock GW_PORT=8791 node web/server/server.mjs`（非默认端口，避免干扰他人），HTTP 覆盖 Demo 主路径与失败路径，**全程 mock，不调用 Dify、不调用任何模型**；结束后 `terminate()`，`8791` 已无 LISTENING 连接。

**实际结果：14 项通过、0 失败**（`docs/test-reports/stage-c/evidence/web-demo-path-smoke-20261030-205816.json`，服务端日志 `web-smoke-server.log`）。

| 编号 | 用例 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| W-01 | 服务启动并响应 `/healthz` | 200，启动可测 | 通过 |
| W-02 | 模式披露与凭证边界 | `mode=mock`；`notices.mock_mode` 有显著模拟说明；`dify_published_verified=false`；响应无密钥字段 | 通过 |
| W-03 | 追求对象基线 intake | `ready`；**不回显派生 `request_json`** | 通过 |
| W-04 | `interest_confidence: unknown` | `needs_input` + `INTAKE_CONFIDENCE_MISMATCH`，中文提示 | 通过 |
| W-05 | 缺预算 | `needs_input`，中文提示补充预算，不静默补值 | 通过 |
| W-06 | `colleague` 技术回归 | 记录实际行为（产品面推荐路径不使用同事） | 通过（信息性） |
| W-07 | 正常路径 | 恰好 3 个候选；`selected_candidate_id=null`；`repair_count=0`；`selectable=["c1","c2","c3"]`；`business_data_verification=not_verified` | 通过 |
| W-08 | 损坏模型 JSON | `status=failed`；`validation.all_passed=false`；`repair_count=1`；`remaining_repairs=0`；`selectable=[]`；**明确说明修订只调整未通过项、已通过项不变** | 通过 |
| W-09 | 未选择就请求呈现 | 4xx + `INVALID_SELECTION`（"系统不会替你选择"） | 通过 |
| W-10 | 不存在的候选 | 4xx + 明确标识错误 | 通过 |
| W-11 | 未知运行 ID | 404 | 通过 |
| W-12 | 有效选择后的呈现 | 200；含**配色／包装／贺卡／赠送**四个中文段落 | 通过 |
| W-13 | 呈现阶段超预算 | 如实失败（409/非 completed），**不自动替用户换方案** | 通过 |
| W-14 | 首页 | 200；中文界面；无密钥痕迹 | 通过 |

**诚实性核查（正面）**：该线**未伪造能力**——`config.mjs` 明确写"⚠ 模拟数据模式：Dify 侧尚未发布可用的礼赠工作流（草稿只有「用户输入 → 代码执行」，无模型、无结束节点），本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify"；`cloud_verified=false`；`business_data_verification=not_verified`。这与我的独立观测一致。

**新观察（低，信息性）**：`publicReport`（`web/server/store.mjs:83`）**未在顶层暴露 `all_passed`**，而 `docs/intake-contract.md` 的报告字段清单把它列为顶层字段（实际值在 `validation.all_passed`）。因为该线尚未交付，且 `status` + `selectable_candidate_ids` 已能表达同一语义，我只登记为**契约字段对齐项**，不判缺陷；建议前端线交付时与契约协调统一。

**方法学更正（透明度）**：首次冒烟（`web-demo-path-smoke-20261030-205739.json`）报 12 通过／2 失败，经核查是**我自己的断言写错**（把 `notices.mock_mode` 写成顶层 `mock_notice`；把顶层 `all_passed` 当成存在），**不是产品缺陷**；已修正断言后在 20:58:16 重跑为 14/14。两份证据均保留。

## 5. 缺陷清单（含复现步骤）

### D-1｜【中】`docs/demo-script.md` 首演示场景仍为"同事"，与冻结决定冲突

- 位置：`docs/demo-script.md:7`、`:8`、`:17`
- 证据：
  ```
  $ grep -n "同事" docs/demo-script.md
  7:| 0:00–0:25 | "…给同事、亲友、朋友或恋人送礼…"
  8:| 0:25–0:50 | "今天以给同事送生日礼物为例：喜欢咖啡、风格简洁，预算两百元…"
  17:首验收场景为青年用户给同事送生日礼物，它是切口，不限制产品其他关系。
  ```
- 冲突对象：`docs/acceptance-criteria.md:12`「**同事完全移出产品场景**：不出现在界面、导航、**演示脚本**和验收案例中」；Issue #1 评论 2026-10-30 决定（D-3 选 b）；`docs/requirements-analysis.md:105`「同事生日不作为产品主场景与验收案例，仅作技术回归」。
- 影响：**现场 Demo 的口径与验收标准直接冲突**，评委可据此质疑一致性；这是能影响现场 Demo 的路径。
- 复现：`grep -n 同事 docs/demo-script.md`
- 归属：发布线（`docs/demo-script.md` 不在测试验收 Agent 文件边界内）。**本轮只报告，未修改。**
- 建议：首场景改为「追求对象节日 / 恋人生日」，同事脚本文案整体删除（技术回归夹具另置）。

### D-2｜【中】`deploy/` 无任务单、无验收，但已具备可执行部署包

- 证据：
  ```
  $ ls deploy/
  .dockerignore  Dockerfile  README.md  __init__.py  publish-to-uhost.ps1  server.py
  ```
  `docs/development-process.md:11–:16` 的四线文件边界只列 `web/`、`validator/`、`workflow/`、`docs/test-plan.md` + `tests/acceptance/` + `docs/test-reports/`，**`deploy/` 不属任何一线**；同文件 `:30` `CLOUD-001` 状态仍为「未开始；赛题和资源未知」。
- 影响：存在**无人负责、无验收记录**的可执行产物（含 UCloud 发布脚本 `publish-to-uhost.ps1`）。OPEN-7 继续成立。
- 复现：`ls deploy/ && grep -n "CLOUD-001" docs/development-process.md`
- 归属：PM（阶段 6 任务拆分）。**未修改。**

### D-3｜【低】`workflow/evidence/WF-001-2026-10-29.md:24` 把未入库文件列为"本任务新增文件"

- 证据：
  ```
  $ git log --all --oneline -- workflow/tools/.gitignore
  (空)
  $ git ls-files workflow/tools/
  (空)
  $ git status --short workflow/tools/
  ?? workflow/tools/.gitignore
  ```
  文件确实存在于磁盘（2026-10-29 19:16 创建，内容 `*` + `!.gitignore`），但**从未被提交**。
- 问题：该行未标注"未入库"，读者会理解为已交付到仓库。WF-001 文末虽写「未提交、未推送」，但该行本身含糊，**属表述不准**。
- 影响：低（不影响功能），但会影响"交付物清单"的可核验性。
- 复现：`git log --all -- workflow/tools/.gitignore; git ls-files workflow/tools/`

### D-4｜【低】`workflow/verify_local.py` 对受限环境无回退，崩溃点在校验之后易被误读

- 现象：在**禁止匿名管道**（`CreatePipe` 被拒）的环境中执行 `python workflow/verify_local.py`，会在**全部 46 项探针执行完毕之后**、构造 `record_data` 时抛出：
  ```
  PermissionError: [WinError 5] 拒绝访问。
  ```
  触发链：`platform.platform()` → `win32_ver()` → `_syscmd_ver()` → `subprocess.check_output(..., encoding="locale")`；以及同行的 `subprocess.check_output(["git","rev-parse","HEAD"])`。
  结果是**既不打印汇总行、也不写 `results.json`**，看上去像"探针失败"。
- 复现：在禁止匿名管道的沙箱中运行该命令；在正常权限下同一命令输出 `local probes: 46 passed; 0 failed`。
- 影响：低（不是产品缺陷，是环境可移植性/可观测性问题），但会让复核者得出错误结论。
- 建议：把 git SHA 与 `platform` 采集包在 `try/except` 中，失败降级为 `null`，并保证汇总行先打印或先写 `results.json`。
- 归属：工作流线。**未修改**（仅新增不改 `workflow/` 的替代复跑脚本 `tests/acceptance/stage_c/run_verify_local_nopipe.py`）。

### D-5｜【信息，非缺陷】Dify 控制台 `workflow-runs` 接口需 CSRF

`GET /console/api/apps/<app_id>/workflow-runs` 由页面 `fetch()` 直接调用返回 **401** `{"code":"unauthorized","message":"CSRF token is missing or invalid."}`。页面自身发起的同类请求为 200。**不应据此判定接口故障**，但取证脚本需改用响应钩子（本套件已如此实现）。

### D-6｜【已修复】`docs/test-plan.md` 状态自相矛盾

原标题为「# 可复现测试计划：尚无执行结果」，正文第 3 行却写「推荐阶段离线结果现已记录在阶段 B 报告」；且第 7 行、`:37` 仍以"同事生日"为首验收场景。**本轮已由我修正**（该文件属测试验收 Agent 边界）：标题状态行改为分阶段状态表、基线改为**追求对象**、补充关系口径、新增 T24/T25 与阶段 C 用例表。详见 `docs/test-plan.md`。

## 6. 文档一致性复核（QA-001 任务 3）

| 复核点 | 我的核实结果 | 判定 |
| --- | --- | --- |
| `docs/acceptance-criteria.md:49` 是否真的改对 | 现文为「**待交付**：可运行闭环、中文状态、异常处理、真实测试记录和 README（当前**不存在**可运行闭环，不得对外读作已完成）」 | **已改对**（C-2／OPEN-9 关闭成立） |
| 四份文档状态行是否统一更正 | `product-requirements.md`、`user-stories.md`、`product-flow.md`、`acceptance-criteria.md` 第 3 行均为「产品对齐完成，契约决定已记录；缺口 G-1…G-4 待补」 | **已改对**（C-1 关闭成立），与 D-1 决定自洽 |
| `workflow/workflow-spec.md` 同事口径 | 已被工作流线改为「首个验收案例采用**青年给追求对象（或恋人）送生日礼物**…**同事已完全移出产品场景**」，示例 `recipient_relation` 已改为「追求对象」+ `recipient_relation_id: pursuit` | **已解决**（约 20:52 复核） |
| `docs/demo-script.md` 同事口径 | 仍为同事首场景（`:7`、`:8`、`:17`） | **未解决 → 缺陷 D-1** |
| `docs/test-plan.md` 同事口径 | 原为同事基线 | **已由我修复**（D-6） |
| `workflow/evidence/WF-001-2026-10-29.md:24` 的 `.gitignore` 声明 | 路径从未被提交 | **表述不准 → 缺陷 D-3** |
| `deploy/` 边界与 `CLOUD-001` | `deploy/` 无归属任务单；`CLOUD-001` 未开始 | **成立 → 缺陷 D-2** |
| `workflow/workflow-spec.md` 的 7 个"未实现错误码"声明 | 逐项 grep，各 0 次出现 | **声明准确，非夸大** |
| `docs/intake-contract.md` 与 `workflow/labels.py` 的 `pursuit` 一致性 | 文档与代码均为 8 个稳定 ID + `pursuit`；`colleague` 标注"仅技术回归" | **一致** |

## 7. 三段清单

### 7.1 已核实（我自己执行并取得证据）

1. Dify Cloud 版本 **1.18.0**（`/console/api/version` → 200）。
2. 草稿 `GiftWise｜推荐工作流开发草稿`（App ID `5abdb13c-a633-4a9c-96c3-dabd44072511`）**未发布**；`tool_published: false`；**我未点击发布、未创建版本**。
3. 草稿为 **2 节点 1 边、无结束节点**，工作流级输出 `{}`。
4. Code 节点（ID `1793357958534`）：`variables: []`、`outputs {compatible: boolean, details_json: string}`、`code` **453 字符 / 9 行**、首行 `def main():` 无前导空白。
5. **Code 节点在真实 Dify 沙箱执行成功**：`status: succeeded`、`error: null`、`elapsed_time: 0.094046`、输出 `compatible: true` 且 `details_json` 四项能力全 true。**这是我自己点「测试运行」得到的，未引用 PM 数字。**
6. **`0 Tokens`，无模型调用**；`exceptions_count: 0`。
7. **该租户未启用 trace 采集**：`trace-runs/workflow/<run_id>` → 200 `{"status":"not_collected"}`。
8. 节点级 `last-run` 接口 → 200，与页面「上次运行」一致，可作结构化证据。
9. 本地回归：`verify_local.py` → **46 项通过、0 失败、model_calls=0、cloud_verified=false**；unittest → **Ran 322 tests / OK**（含工作流线 20:50 改动后重跑）。
10. 生成物与 `manifest.json` 的 5 个哈希逐一匹配，**无 STALE**。
11. `pursuit`（追求对象）已是独立机器值，与 `partner`（恋人）互斥、均可通过 intake；中文口径已统一为"恋人"。
12. **变更前**提交 `pursuit` 确实被拒为 `INTAKE_UNKNOWN_LABEL`（用 `git show HEAD:workflow/labels.py` 复现）。
13. `interest_confidence: "unknown"`、可信度多余键、`interests` 中的 `unknown` 均被拒（`INTAKE_CONFIDENCE_MISMATCH` / `INTAKE_UNKNOWN_LABEL`）。
14. 前端提交 `recipient_relation_id` 被拒为 `INTAKE_UNKNOWN_FIELD`；新增该字段不破坏既有校验。
15. `INTERNAL_ERROR` 已补入 `docs/intake-contract.md` 错误码表，出处标注正确。
16. `docs/acceptance-criteria.md:49` 的夸大表述**已改对**；四份文档状态行**已统一更正**。
17. `workflow/workflow-spec.md` 关于 7 个错误码"代码中无实现点"的声明**经我 grep 核实为准确**。
18. 阶段 C 套件 **39 项通过、0 失败**；延迟／调用／成本记录方案已实测落地（`model_calls=0`、`cost=not_measured`）。

### 7.2 未核实（无真实证据，或未获授权执行）

1. **`TypeError: main() got an unexpected keyword argument 'arg1'` / `error: exit status 255`** 这条失败记录：属修复前历史事件；复现需修改线上草稿（重新引入 `arg1`），**未获授权，未做**。
2. PM 记录的**节点耗时 `0.462s`、工作流 `0.162s`、`0.191s`、`0.162s`** 等具体数值：我只验证了"存在该量级"，**无法复现同一数值**。
3. PM 记录的 **20:15:04 之前 IndentationError 修复过程**、20:18:23 / 20:19:35 两次 `POST /workflows/draft` 的具体请求体：未复核。
4. PM 量化描述的**"自动保存延迟约 10–20 秒"**：我观测到「测试运行」会触发 `POST /workflows/draft` → 200 且刷新 `updated_at`，但**未测延迟区间**。
5. **阶段 C 其余项全部未开始**：真实模型三候选、真实一次修订轨迹、真实持续失败路径、**业务延迟／token／成本**、选择后呈现阶段（包装／配色／贺卡／赠送方式）。
6. **真实商品数据**（价格、库存、物流）：完全没有。
7. **前端**（`web/`）：**在本轮复核末尾（2026-10-30 20:56）才出现 12 个文件**，属前端线在飞工作，**未向我交付**；我只做了有界预备观察（见 §4A），**不构成 WEB-001 验收判定**。E2E 与页面中文状态（SC-1、SC-8、T19–T22）仍未验收。
8. Dify 草稿的 N1–N7 完整业务工作流接线、`intake_node`/`check_node`/`recheck_node`/`report_node` **上云**：未执行。**当前草稿只有 Code 探针节点，端到端业务闭环不存在。**
9. 约 60 秒输入目标、真实用户耗时：无真实用户测量。

### 7.3 与开发方／PM 声明不一致（含表述夸大）

| 编号 | 声明方 | 声明 | 我的实际结果 | 性质 |
| --- | --- | --- | --- | --- |
| X-1 | WF-002（PM 引用） | 节点运行时间 **0.462s**（20:20:54） | 我实测 **0.079s**（20:48:25）、**0.094046s**（20:49:23） | **数值不一致**：非同次运行，故非造假；但该值**不可复现为稳定基线** |
| X-2 | WF-001:24 | `workflow/tools/.gitignore` 列为"本任务新增文件" | 该路径**从未被提交**（`git log --all` 与 `git ls-files` 均为空） | **表述不准／夸大交付范围** |
| X-3 | PM 阶段 2 清单 D-2/D-4 与 OPEN-1/OPEN-2 | "截至复查时" 无 `pursuit` 机器值、`INTERNAL_ERROR` 未入表 | **20:50 后已落地**（并发改动） | **时间差，非声明错误**；但任何引用必须带时间戳 |
| X-4 | （反向澄清） | `workflow-spec.md` 的 7 个未实现错误码 | 经核实**确实 0 次出现** | **声明准确，未夸大** |

## 8. 阻塞与风险

1. **端到端业务闭环不存在**：Dify 草稿只有 1 个 Code 探针节点，N1–N7 未接线、无结束节点。任何"Dify 工作流已跑通"的说法都不成立。→ SC-2/SC-3/SC-6/SC-7 无线上证据。
2. **模型调用未授权**（OPEN-5）：真实三候选、真实修订、成本／延迟全部被阻塞。阶段 C 无法继续推进到"真实模型"层。
3. **trace 未启用**：无法给出平台级 Agent 链路轨迹证据（赛道 B「工具调用轨迹」得分点）。建议向 PM 上报，评估是否在 Dify 租户开启 trace 采集。
4. **前端仍未交付验收**（`web/` 在 20:56 才出现，可能仍在编辑）：SC-1、SC-8 与 T22 中文状态检查的正式验收仍阻塞；§4A 的 14 项冒烟只是预备观察，不能替代 WEB-001 验收。
5. **`deploy/` 无任务单**（D-2）：部署产物存在但无人负责、无验收，`CLOUD-001` 未开始。
6. **时间**：提交截止 2026-11-01 10:30（北京时间），剩余不足 2 天，上述 1–4 项均需真实运行时间。

## 9. 本轮我修改／新增的文件（均为测试验收 Agent 边界内）

**修改：**
- `docs/test-plan.md`（测试 Agent 自有文件）：修正"尚无执行结果"与已执行结论的矛盾；基线由"同事生日"改为**追求对象**；补关系口径（8 个稳定 ID、`pursuit`/`partner` 互斥、同事移出、兴趣未知非机器值）；新增 T24/T25 与阶段 C 用例表；补阶段 A–E 状态表与实测指标取值。

**新增：**
- `tests/acceptance/stage_c/`：`cases.json`、`test_stage_c_workflow.py`（39 用例）、`run_stage_c.py`、`extract_dify_evidence.py`、`dify-qa-runner.cjs`、`qa-steps-*.json`、`qa-js/`、`run_verify_local_nopipe.py`、`probe_web_demo_path.py`、`README.md`
- `docs/test-reports/stage-c/`：本报告、`20261030-205323/case-results.md`、`20261030-205323/stage-c-results.json`、`evidence/dify-run-evidence.json`、`evidence/qa-runner-log.jsonl`、`evidence/shots/*.png`（6 张）、`evidence/web-demo-path-smoke-*.json`、`evidence/web-smoke-server.log`

**关于并发改动的重要说明**：本轮复核期间，**工作流线与前端线同时在改工作区**（20:50 出现 `workflow/` 12 项改动与 `workflow/evidence/local-2026-10-30/`；20:56 出现 `web/` 12 个文件）。因此：

- 本报告所有结论都**绑定到观测时刻与文件哈希**；引用时请带时间戳。
- §4 的回归（46／322／39）是在 20:50 的 `workflow/` 版本上重跑的。
- §4A 的冒烟绑定到 20:58 的 `web/` 哈希（保存在该证据 JSON 的 `web_file_hashes` 字段）。
- 我**没有**修改 `workflow/`、`validator/`、`web/` 的任何文件；`git status` 中它们的 `M` 标记全部来自其他线。

**必须披露的副作用**：按任务要求执行 `python workflow/verify_local.py` 时，该脚本**按设计重写**了它自己的未跟踪证据文件 `workflow/evidence/local-2026-10-29/results.json`（时间戳、`head`、`platform` 随之更新）。这不是我对他人文件的编辑，而是该命令的既定行为；重写后内容语义未变（同一 46 项探针、同一 HEAD `89d6624`、`passed=46 / failed=0 / model_calls=0 / cloud_verified=false`）。如需完全避免，应在复跑前备份该目录——建议后续由 PM 决定是否把该目录纳入纳入版本管理或改为写入新时间戳目录。

**未修改（明确遵守边界）：** `tests/test_validator.py`、`tests/test_cases.json`、`workflow/`（含 `WF-002-2026-10-30.md`）、`validator/`、`web/`、`docs/requirements-analysis.md`、`docs/product-requirements.md`、`docs/acceptance-criteria.md`、`docs/user-stories.md`、`docs/product-flow.md`、`docs/intake-contract.md`、`docs/demo-script.md`。
**未提交、未推送、未 `git add .`、未发布 Dify 草稿、未创建版本、未调用任何付费模型。**

## 10. 复现全部证据的命令

```bash
# 1. 本地基线与合同
python workflow/verify_local.py
python -m unittest discover -s tests -q

# 2. 阶段 C 独立套件（39 用例）
python -m unittest discover -s tests/acceptance/stage_c -q
python tests/acceptance/stage_c/run_stage_c.py

# 3. 真实 Dify 复核（需项目专用浏览器配置目录、单一会话；会点一次「测试运行」，不会发布）
node tests/acceptance/stage_c/dify-qa-runner.cjs tests/acceptance/stage_c/qa-steps-codeprobe.json
node tests/acceptance/stage_c/dify-qa-runner.cjs tests/acceptance/stage_c/qa-steps-run2.json
python tests/acceptance/stage_c/extract_dify_evidence.py

# 4. 受限沙箱下的等效复跑（不修改 workflow/）
python tests/acceptance/stage_c/run_verify_local_nopipe.py
```
