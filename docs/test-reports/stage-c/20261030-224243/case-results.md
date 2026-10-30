# 阶段 C 逐例证据（QA-001 独立复核）

> 本报告数字为 2026-10-30 时点真值；后续变更见 `docs/acceptance-criteria.md` 第 13 节。

- 运行时间：2026-10-30T22:42:43.883631+08:00 → 2026-10-30T22:42:44.006693+08:00（Asia/Shanghai）
- 命令：`python tests/acceptance/stage_c/run_stage_c.py`
- Git HEAD：`46d1b48c8bbeac2ef11d4fc74405e57a76d4b92e`（工作区有 21 项未提交改动，逐项见 JSON）
- Python：3.12.12；平台：Windows-11-10.0.26200-SP0
- 用例：39 项，通过 39，失败 0
- 模型调用：0（真实未调用）；cloud_verified：False

| 编号 | 分组 | 用例 | 预期 | 实际（摘要） | 判定 |
| --- | --- | --- | --- | --- | --- |
| C1-01 | C1 沙箱兼容探针 | 本地标准库探针 compatible=true | {'compatible': True} | `{"compatible": true, "details_json": "{\"json\": true, \"re_ascii\": true, \"unicodedata_nfkc\": true, \"decimal\": true, \"mode\": \"stdlib_probe_only\"}"}` | 通过 |
| C1-02 | C1 沙箱兼容探针 | 真实 Dify Code 节点沙箱执行成功（独立捕获） | {'code_node_succeeded': True, 'code_node_error_null': True, 'code_node_output_compatible_true': True, 'details_json_all_true': True, 'details_json_declared_string': True, 'zero_tokens': True, 'no_exceptions': True} | `{"code_node_succeeded": true, "code_node_error_null": true, "code_node_output_compatible_true": true, "details_json_all_true": true, "details_json_declared_string": true, "zero_tokens": true, "no_exceptions": true}` | 通过 |
| C1-03 | C1 沙箱兼容探针 | 记录真实节点耗时与 token（不写零成本） | run_id 非空；elapsed_time 为真实浮点数；total_tokens 必须为 0（无模型调用） | `{"run_id": "0cdef527-3504-4635-a338-58f985f8f216", "code_node_elapsed_time": 0.094046, "workflow_elapsed_time": 0.1543920770054683, "total_tokens": 0}` | 通过 |
| C2-01 | C2 契约缺口 | 『追求对象』已有独立机器值 pursuit | pursuit 存在且为『追求对象』；partner 为『恋人』；colleague 保留（仅技术回归） | `{"pursuit_present": true, "pursuit_text": "追求对象", "partner_text": "恋人", "colleague_present": true, "total_ids": 10, "labels_sha256": "e3128d298808fecf900974b2dcb12d33034204701175614cdb43fc4a17f67910"}` | 通过 |
| C2-02 | C2 契约缺口 | pursuit 与 partner 并列互斥且都可通过 intake | 两者均 ready；中文分别为『追求对象』/『恋人』；机器值 pursuit/partner 且互不相同 | `{"pursuit_status": "ready", "partner_status": "ready", "pursuit_relation_text": "追求对象", "pursuit_relation_id": "pursuit", "partner_relation_text": "恋人", "partner_relation_id": "partner"}` | 通过 |
| C2-03 | C2 契约缺口 | 变更前 pursuit 确实被拒（逐字节固定夹具复现） | 夹具 sha256 与记录一致；固定版本无 pursuit；提交 pursuit 得到 needs_input + INTAKE_UNKNOWN_LABEL 且不返回可用请求 | `{"fixture_sha256": "333ad9761d9278c7421c0cdd1c8d43ebbef7b6a6c164dfc54896ec653520d916", "fixture_sha256_as_recorded": true, "before_relations_has_pursuit": false, "status": "needs_input", "codes": ["INTAKE_UNKNOWN_LABE…` | 通过 |
| C2-04 | C2 契约缺口 | interest_confidence=unknown 被拒 | needs_input + INTAKE_CONFIDENCE_MISMATCH，且不返回可用请求 | `{"status": "needs_input", "codes": ["INTAKE_CONFIDENCE_MISMATCH"], "request_json": null}` | 通过 |
| C2-05 | C2 契约缺口 | 可信度多余键被拒 | needs_input + INTAKE_CONFIDENCE_MISMATCH（多余键） | `{"status": "needs_input", "codes": ["INTAKE_CONFIDENCE_MISMATCH"]}` | 通过 |
| C2-06 | C2 契约缺口 | interests 中的 unknown 机器值被拒 | needs_input + INTAKE_UNKNOWN_LABEL（不存在 interests 的 unknown 机器值） | `{"status": "needs_input", "codes": ["INTAKE_UNKNOWN_LABEL"]}` | 通过 |
| C2-07 | C2 契约缺口 | 前端提交 recipient_relation_id 被拒 | needs_input + INTAKE_UNKNOWN_FIELD（该字段只由服务端产出） | `{"status": "needs_input", "codes": ["INTAKE_UNKNOWN_FIELD"]}` | 通过 |
| C2-08 | C2 契约缺口 | colleague 仅作技术回归仍可通过 | ready；中文『同事』；机器值 colleague（仅技术回归，产品面不得出现） | `{"status": "ready", "relation_text": "同事", "relation_id": "colleague"}` | 通过 |
| C2-09 | C2 契约缺口 | 新增 recipient_relation_id 不破坏既有校验 | 两种请求的校验状态与错误码集合一致（validator 对 request 无字段白名单） | `{"with_id_status": "failed", "without_id_status": "failed", "with_id_codes": ["MISSING_FIELD"], "without_id_codes": ["MISSING_FIELD"]}` | 通过 |
| C2-10 | C2 契约缺口 | INTERNAL_ERROR 已补入契约错误码表 | 契约错误码表已补入 INTERNAL_ERROR 并标注出处 | `{"INTERNAL_ERROR_in_contract": true, "INTERNAL_ERROR_in_error_table": true, "has_source_reference": true}` | 通过 |
| C2-11 | C2 契约缺口 | 契约文档与冻结关系枚举一致 | 契约含 pursuit；colleague 标注『仅技术回归』；partner 中文为『恋人』 | `{"pursuit_in_contract": true, "colleague_marked_regression": true, "partner_text_lianren": true, "old_partner_wording_gone": true}` | 通过 |
| C3-01 | C3 候选校验 | 正常基线：三项候选全部通过 | status=passed、all_passed=true、c1/c2/c3 全通过、无错误、恰好三个候选 | `{"status": "passed", "all_passed": true, "passed_ids": ["c1", "c2", "c3"], "error_codes": [], "count": 3}` | 通过 |
| C3-02 | C3 候选校验 | 超预算边界：200.00 通过 | 预算边界恰好 200.00 应通过 | `{"boundary_total": "200.00", "c1_passed": true, "c1_errors": [], "all_passed": true}` | 通过 |
| C3-03 | C3 候选校验 | 超预算 200.01 失败且不牵连其他项 | c1 因 OVER_BUDGET 失败，c2/c3 仍通过（只失败项不可选） | `{"total": "200.01", "c1_passed": false, "c1_errors": ["OVER_BUDGET"], "other_passed": ["c2", "c3"]}` | 通过 |
| C3-04 | C3 候选校验 | 禁忌标签 alcohol 被拦截 | FORBIDDEN_TAG | `{"c1_passed": false, "c1_errors": ["FORBIDDEN_TAG"]}` | 通过 |
| C3-05 | C3 候选校验 | 字面禁忌词『酒』被拦截 | FORBIDDEN_TERM（字面词『酒』） | `{"c1_passed": false, "c1_errors": ["FORBIDDEN_TERM"]}` | 通过 |
| C3-06 | C3 候选校验 | 全角变体字面禁忌不被绕过 | NFKC 归一化后命中 FORBIDDEN_TERM | `{"c1_passed": false, "c1_errors": ["FORBIDDEN_TERM"], "term": "alcohol", "description": "…ＡＬＣＯＨＯＬ…（全角）"}` | 通过 |
| C3-07 | C3 候选校验 | 候选 JSON 损坏 → 可修订的错误 | status=error、INVALID_JSON、repairable=true（值得一次修订） | `{"status": "error", "codes": ["INVALID_JSON"], "repairable": true}` | 通过 |
| C3-08 | C3 候选校验 | 请求缺必填时损坏候选也不进入修订 | 请求本身缺预算 → 不可修订（不拿模型修订掩盖输入问题） | `{"repairable": false, "validation_status": "error", "request_codes": ["INVALID_JSON", "MISSING_FIELD"]}` | 通过 |
| C3-09 | C3 候选校验 | 币种不一致拒绝且不换汇 | CURRENCY_MISMATCH，不做汇率换算、不修改金额 | `{"c1_passed": false, "c1_errors": ["CURRENCY_MISMATCH"], "total_unchanged": "150.00"}` | 通过 |
| C4-01 | C4 修订与保护 | 首检超预算可进入一次修订 | repairable=true、repair_count=0、保留已通过项 c2/c3 | `{"repairable": true, "repair_count": 0, "preserved": ["c2", "c3"]}` | 通过 |
| C4-02 | C4 修订与保护 | 一次修订后复检通过并计入额度 | 复检全部通过、repair_count=1（额度已占用）、无 workflow_errors | `{"all_passed": true, "repair_count": 1, "workflow_errors": []}` | 通过 |
| C4-03 | C4 修订与保护 | 额度用尽后不可再次修订 | repair_count=1 时不可再修订（全局最多一次） | `{"first_repairable": true, "second_repairable": false}` | 通过 |
| C4-04 | C4 修订与保护 | 持续失败不伪装通过且额度不重置 | 持续失败：all_passed=false、remaining_repairs=0、仍可选 c2/c3、报告如实说明 1/1 | `{"all_passed": false, "repair_count": 1, "remaining_repairs": 0, "selectable": ["c2", "c3"], "report_status": "failed", "mentions_repair_count": true}` | 通过 |
| C4-05 | C4 修订与保护 | 全部失败无可选项 | 全部失败时无可选方案，中文如实提示人工处理 | `{"selectable": [], "status": "failed", "text_tail": "当前没有可选方案，请人工调整或检查错误；未继续自动修订。"}` | 通过 |
| C4-06 | C4 修订与保护 | 修订改动已通过项被保护拒绝 | PASSED_CANDIDATE_CHANGED；整次修订拒绝用于选择；selectable 为空 | `{"workflow_errors": ["PASSED_CANDIDATE_CHANGED"], "selectable": [], "status": "failed", "all_passed": false}` | 通过 |
| C4-07 | C4 修订与保护 | JSON 键序重排不误判为篡改 | 键序变化不算篡改，无 PASSED_CANDIDATE_CHANGED | `{"workflow_errors": [], "all_passed": true}` | 通过 |
| C4-08 | C4 修订与保护 | 无需修订时拒绝未经授权的修订 | 首检已全通过 → REPAIR_NOT_ALLOWED，不采用新候选 | `{"workflow_errors": ["REPAIR_NOT_ALLOWED"], "repairable": false}` | 通过 |
| C4-09 | C4 修订与保护 | 报告不替用户选择且标注数据未核实 | selected_candidate_id 保持 null；business_data_verification=not_verified | `{"selected_candidate_id": null, "selectable": ["c1", "c2", "c3"], "business_data_verification": "not_verified"}` | 通过 |
| C4-10 | C4 修订与保护 | 禁忌项不可选但其他合格项可选 | 禁忌项不可选，仍可选 c2/c3 | `{"selectable": ["c2", "c3"], "c1_errors": ["FORBIDDEN_TAG"], "report_marks_c1_unselectable": true}` | 通过 |
| C5-01 | C5 生成节点与仓库适配一致 | 四个 Dify 入口节点真实执行并与仓库逻辑一致 | intake=ready；check repairable；recheck 通过且 repair_count=1；report 通过且未替选 | `{"intake": "ready", "check": true, "recheck_all_passed": true, "recheck_repair_count": 1, "report_all_passed": true, "report_selected_is_null": true}` | 通过 |
| C5-02 | C5 生成节点与仓库适配一致 | 生成物与 manifest 哈希一致（无 STALE） | manifest.format=python-source-not-dsl；5 个生成物哈希全部匹配 | `{"format": "python-source-not-dsl", "entries": {"code_node.py": {"expected": "67f2d2002e38eb91ccbd0042d39f818c42bff3ad5041447d4eced315e19f59a0", "actual": "67f2d2002e38eb91ccbd0042d39f818c42bff3ad5041447d4eced315e19f5…` | 通过 |
| C5-03 | C5 生成节点与仓库适配一致 | 节点入口收到空输入时不放行任何候选 | status=error、all_passed=false、repairable=false、无候选结果被放行 | `{"status": "error", "all_passed": false, "repairable": false, "repair_count": 0, "validation_codes": ["INVALID_JSON"], "candidate_results": []}` | 通过 |
| C5-04 | C5 生成节点与仓库适配一致 | 调度器异常为中文受控失败且不重试 | WORKFLOW_INPUT_ERROR 中文受控失败、不放行、repair_count 记为 1（不无限重试） | `{"broken_payload": {"status": "error", "all_passed": false, "repairable": false, "repair_count": 1, "envelope": {"status": "error", "errors": [{"code": "WORKFLOW_INPUT_ERROR", "path": "$", "message": "工作流变量无效或执行异常，未放行…` | 通过 |
| C6-01 | C6 调用次数／延迟／成本记录方案 | 记录调用次数／延迟／成本（离线真实测量） | model_calls=0（真实未调用）；每阶段有 monotonic 实测秒数；cost 记 not_measured 不填 0；cloud_verified=false | `{"mode": "offline-fixed-snapshots-no-model", "model_calls": 0, "cloud_verified": false, "cost": "not_measured", "stages": [{"stage": "intake", "seconds": 0.0}, {"stage": "check_first", "seconds": 0.0}, {"stage": "rech…` | 通过 |
| C6-02 | C6 调用次数／延迟／成本记录方案 | Dify 运行可追溯且 trace 缺口如实记录 | 有可追溯 run id；平台 trace 为 not_collected 需如实记录；节点 last-run 接口 200 | `{"workflow_run_id": "0cdef527-3504-4635-a338-58f985f8f216", "trace_runs_status": "not_collected", "node_last_run_http": 200, "raw_log_present": true}` | 通过 |

## 延迟与调用记录（实际测量）

| 阶段 | 秒 | 说明 |
| --- | ---: | --- |
| intake | 0.0 | 离线固定快照，无模型调用 |
| check_first | 0.0 | 离线固定快照，无模型调用 |
| recheck | 0.0 | 离线固定快照，无模型调用 |
| report | 0.0 | 离线固定快照，无模型调用 |
| 合计 | 0.0 | 单调时钟 time.monotonic |

Dify 真实运行（只有 Code 节点，无模型）：

- run id：`0cdef527-3504-4635-a338-58f985f8f216`
- Code 节点耗时：0.094046 s
- 工作流耗时：0.1543920770054683 s
- token：0
- 注：无模型调用的探针耗时，不可当作业务延迟

## 完整输入与输出

### C1-01｜本地标准库探针 compatible=true

```json
{
  "input": {},
  "expected": {
    "compatible": true
  },
  "actual": {
    "compatible": true,
    "details_json": "{\"json\": true, \"re_ascii\": true, \"unicodedata_nfkc\": true, \"decimal\": true, \"mode\": \"stdlib_probe_only\"}"
  }
}
```

### C1-02｜真实 Dify Code 节点沙箱执行成功（独立捕获）

```json
{
  "input": {
    "evidence": "docs/test-reports/stage-c/evidence/dify-run-evidence.json"
  },
  "expected": {
    "code_node_succeeded": true,
    "code_node_error_null": true,
    "code_node_output_compatible_true": true,
    "details_json_all_true": true,
    "details_json_declared_string": true,
    "zero_tokens": true,
    "no_exceptions": true
  },
  "actual": {
    "code_node_succeeded": true,
    "code_node_error_null": true,
    "code_node_output_compatible_true": true,
    "details_json_all_true": true,
    "details_json_declared_string": true,
    "zero_tokens": true,
    "no_exceptions": true
  }
}
```

### C1-03｜记录真实节点耗时与 token（不写零成本）

```json
{
  "input": {},
  "expected": "run_id 非空；elapsed_time 为真实浮点数；total_tokens 必须为 0（无模型调用）",
  "actual": {
    "run_id": "0cdef527-3504-4635-a338-58f985f8f216",
    "code_node_elapsed_time": 0.094046,
    "workflow_elapsed_time": 0.1543920770054683,
    "total_tokens": 0
  }
}
```

### C2-01｜『追求对象』已有独立机器值 pursuit

```json
{
  "input": {},
  "expected": "pursuit 存在且为『追求对象』；partner 为『恋人』；colleague 保留（仅技术回归）",
  "actual": {
    "pursuit_present": true,
    "pursuit_text": "追求对象",
    "partner_text": "恋人",
    "colleague_present": true,
    "total_ids": 10,
    "labels_sha256": "e3128d298808fecf900974b2dcb12d33034204701175614cdb43fc4a17f67910"
  }
}
```

### C2-02｜pursuit 与 partner 并列互斥且都可通过 intake

```json
{
  "input": {},
  "expected": "两者均 ready；中文分别为『追求对象』/『恋人』；机器值 pursuit/partner 且互不相同",
  "actual": {
    "pursuit_status": "ready",
    "partner_status": "ready",
    "pursuit_relation_text": "追求对象",
    "pursuit_relation_id": "pursuit",
    "partner_relation_text": "恋人",
    "partner_relation_id": "partner"
  }
}
```

### C2-03｜变更前 pursuit 确实被拒（逐字节固定夹具复现）

```json
{
  "input": {},
  "expected": "夹具 sha256 与记录一致；固定版本无 pursuit；提交 pursuit 得到 needs_input + INTAKE_UNKNOWN_LABEL 且不返回可用请求",
  "actual": {
    "fixture_sha256": "333ad9761d9278c7421c0cdd1c8d43ebbef7b6a6c164dfc54896ec653520d916",
    "fixture_sha256_as_recorded": true,
    "before_relations_has_pursuit": false,
    "status": "needs_input",
    "codes": [
      "INTAKE_UNKNOWN_LABEL",
      "INVALID_TYPE"
    ],
    "request_json_released": false,
    "drift": {
      "current_has_pursuit": true,
      "current_partner_text": "恋人",
      "before_partner_text": "伴侣"
    }
  }
}
```

### C2-04｜interest_confidence=unknown 被拒

```json
{
  "input": {},
  "expected": "needs_input + INTAKE_CONFIDENCE_MISMATCH，且不返回可用请求",
  "actual": {
    "status": "needs_input",
    "codes": [
      "INTAKE_CONFIDENCE_MISMATCH"
    ],
    "request_json": null
  }
}
```

### C2-05｜可信度多余键被拒

```json
{
  "input": {},
  "expected": "needs_input + INTAKE_CONFIDENCE_MISMATCH（多余键）",
  "actual": {
    "status": "needs_input",
    "codes": [
      "INTAKE_CONFIDENCE_MISMATCH"
    ]
  }
}
```

### C2-06｜interests 中的 unknown 机器值被拒

```json
{
  "input": {},
  "expected": "needs_input + INTAKE_UNKNOWN_LABEL（不存在 interests 的 unknown 机器值）",
  "actual": {
    "status": "needs_input",
    "codes": [
      "INTAKE_UNKNOWN_LABEL"
    ]
  }
}
```

### C2-07｜前端提交 recipient_relation_id 被拒

```json
{
  "input": {},
  "expected": "needs_input + INTAKE_UNKNOWN_FIELD（该字段只由服务端产出）",
  "actual": {
    "status": "needs_input",
    "codes": [
      "INTAKE_UNKNOWN_FIELD"
    ]
  }
}
```

### C2-08｜colleague 仅作技术回归仍可通过

```json
{
  "input": {},
  "expected": "ready；中文『同事』；机器值 colleague（仅技术回归，产品面不得出现）",
  "actual": {
    "status": "ready",
    "relation_text": "同事",
    "relation_id": "colleague"
  }
}
```

### C2-09｜新增 recipient_relation_id 不破坏既有校验

```json
{
  "input": {},
  "expected": "两种请求的校验状态与错误码集合一致（validator 对 request 无字段白名单）",
  "actual": {
    "with_id_status": "failed",
    "without_id_status": "failed",
    "with_id_codes": [
      "MISSING_FIELD"
    ],
    "without_id_codes": [
      "MISSING_FIELD"
    ]
  }
}
```

### C2-10｜INTERNAL_ERROR 已补入契约错误码表

```json
{
  "input": {},
  "expected": "契约错误码表已补入 INTERNAL_ERROR 并标注出处",
  "actual": {
    "INTERNAL_ERROR_in_contract": true,
    "INTERNAL_ERROR_in_error_table": true,
    "has_source_reference": true
  }
}
```

### C2-11｜契约文档与冻结关系枚举一致

```json
{
  "input": {},
  "expected": "契约含 pursuit；colleague 标注『仅技术回归』；partner 中文为『恋人』",
  "actual": {
    "pursuit_in_contract": true,
    "colleague_marked_regression": true,
    "partner_text_lianren": true,
    "old_partner_wording_gone": true
  }
}
```

### C3-01｜正常基线：三项候选全部通过

```json
{
  "input": {
    "candidates": "cases.json baseline_candidates"
  },
  "expected": "status=passed、all_passed=true、c1/c2/c3 全通过、无错误、恰好三个候选",
  "actual": {
    "status": "passed",
    "all_passed": true,
    "passed_ids": [
      "c1",
      "c2",
      "c3"
    ],
    "error_codes": [],
    "count": 3
  }
}
```

### C3-02｜超预算边界：200.00 通过

```json
{
  "input": {
    "c1.estimated_total": "200.00"
  },
  "expected": "预算边界恰好 200.00 应通过",
  "actual": {
    "boundary_total": "200.00",
    "c1_passed": true,
    "c1_errors": [],
    "all_passed": true
  }
}
```

### C3-03｜超预算 200.01 失败且不牵连其他项

```json
{
  "input": {
    "c1.estimated_total": "200.01"
  },
  "expected": "c1 因 OVER_BUDGET 失败，c2/c3 仍通过（只失败项不可选）",
  "actual": {
    "total": "200.01",
    "c1_passed": false,
    "c1_errors": [
      "OVER_BUDGET"
    ],
    "other_passed": [
      "c2",
      "c3"
    ]
  }
}
```

### C3-04｜禁忌标签 alcohol 被拦截

```json
{
  "input": {
    "c1.tags": [
      "alcohol"
    ]
  },
  "expected": "FORBIDDEN_TAG",
  "actual": {
    "c1_passed": false,
    "c1_errors": [
      "FORBIDDEN_TAG"
    ]
  }
}
```

### C3-05｜字面禁忌词『酒』被拦截

```json
{
  "input": {
    "c1.description": "…酒类饮品…"
  },
  "expected": "FORBIDDEN_TERM（字面词『酒』）",
  "actual": {
    "c1_passed": false,
    "c1_errors": [
      "FORBIDDEN_TERM"
    ]
  }
}
```

### C3-06｜全角变体字面禁忌不被绕过

```json
{
  "input": {
    "c1.description": "…ＡＬＣＯＨＯＬ…"
  },
  "expected": "NFKC 归一化后命中 FORBIDDEN_TERM",
  "actual": {
    "c1_passed": false,
    "c1_errors": [
      "FORBIDDEN_TERM"
    ],
    "term": "alcohol",
    "description": "…ＡＬＣＯＨＯＬ…（全角）"
  }
}
```

### C3-07｜候选 JSON 损坏 → 可修订的错误

```json
{
  "input": {
    "candidates_json": "{\"candidates\":[{\"id\":\"c1\","
  },
  "expected": "status=error、INVALID_JSON、repairable=true（值得一次修订）",
  "actual": {
    "status": "error",
    "codes": [
      "INVALID_JSON"
    ],
    "repairable": true
  }
}
```

### C3-08｜请求缺必填时损坏候选也不进入修订

```json
{
  "input": {
    "request": "{\"currency\":\"CNY\"}",
    "candidates": "bad-json"
  },
  "expected": "请求本身缺预算 → 不可修订（不拿模型修订掩盖输入问题）",
  "actual": {
    "repairable": false,
    "validation_status": "error",
    "request_codes": [
      "INVALID_JSON",
      "MISSING_FIELD"
    ]
  }
}
```

### C3-09｜币种不一致拒绝且不换汇

```json
{
  "input": {
    "c1.currency": "USD"
  },
  "expected": "CURRENCY_MISMATCH，不做汇率换算、不修改金额",
  "actual": {
    "c1_passed": false,
    "c1_errors": [
      "CURRENCY_MISMATCH"
    ],
    "total_unchanged": "150.00"
  }
}
```

### C4-01｜首检超预算可进入一次修订

```json
{
  "input": {
    "c1.estimated_total": "250.00"
  },
  "expected": "repairable=true、repair_count=0、保留已通过项 c2/c3",
  "actual": {
    "repairable": true,
    "repair_count": 0,
    "preserved": [
      "c2",
      "c3"
    ]
  }
}
```

### C4-02｜一次修订后复检通过并计入额度

```json
{
  "input": {},
  "expected": "复检全部通过、repair_count=1（额度已占用）、无 workflow_errors",
  "actual": {
    "all_passed": true,
    "repair_count": 1,
    "workflow_errors": []
  }
}
```

### C4-03｜额度用尽后不可再次修订

```json
{
  "input": {
    "repair_count": [
      0,
      1
    ]
  },
  "expected": "repair_count=1 时不可再修订（全局最多一次）",
  "actual": {
    "first_repairable": true,
    "second_repairable": false
  }
}
```

### C4-04｜持续失败不伪装通过且额度不重置

```json
{
  "input": {
    "revised c1": "230.00"
  },
  "expected": "持续失败：all_passed=false、remaining_repairs=0、仍可选 c2/c3、报告如实说明 1/1",
  "actual": {
    "all_passed": false,
    "repair_count": 1,
    "remaining_repairs": 0,
    "selectable": [
      "c2",
      "c3"
    ],
    "report_status": "failed",
    "mentions_repair_count": true
  }
}
```

### C4-05｜全部失败无可选项

```json
{
  "input": {
    "all totals": "999.00"
  },
  "expected": "全部失败时无可选方案，中文如实提示人工处理",
  "actual": {
    "selectable": [],
    "status": "failed",
    "text_tail": "当前没有可选方案，请人工调整或检查错误；未继续自动修订。"
  }
}
```

### C4-06｜修订改动已通过项被保护拒绝

```json
{
  "input": {
    "c2.estimated_total": "120.00 → 119.00"
  },
  "expected": "PASSED_CANDIDATE_CHANGED；整次修订拒绝用于选择；selectable 为空",
  "actual": {
    "workflow_errors": [
      "PASSED_CANDIDATE_CHANGED"
    ],
    "selectable": [],
    "status": "failed",
    "all_passed": false
  }
}
```

### C4-07｜JSON 键序重排不误判为篡改

```json
{
  "input": {},
  "expected": "键序变化不算篡改，无 PASSED_CANDIDATE_CHANGED",
  "actual": {
    "workflow_errors": [],
    "all_passed": true
  }
}
```

### C4-08｜无需修订时拒绝未经授权的修订

```json
{
  "input": {},
  "expected": "首检已全通过 → REPAIR_NOT_ALLOWED，不采用新候选",
  "actual": {
    "workflow_errors": [
      "REPAIR_NOT_ALLOWED"
    ],
    "repairable": false
  }
}
```

### C4-09｜报告不替用户选择且标注数据未核实

```json
{
  "input": {},
  "expected": "selected_candidate_id 保持 null；business_data_verification=not_verified",
  "actual": {
    "selected_candidate_id": null,
    "selectable": [
      "c1",
      "c2",
      "c3"
    ],
    "business_data_verification": "not_verified"
  }
}
```

### C4-10｜禁忌项不可选但其他合格项可选

```json
{
  "input": {
    "c1.tags": [
      "alcohol"
    ]
  },
  "expected": "禁忌项不可选，仍可选 c2/c3",
  "actual": {
    "selectable": [
      "c2",
      "c3"
    ],
    "c1_errors": [
      "FORBIDDEN_TAG"
    ],
    "report_marks_c1_unselectable": true
  }
}
```

### C5-01｜四个 Dify 入口节点真实执行并与仓库逻辑一致

```json
{
  "input": {},
  "expected": "intake=ready；check repairable；recheck 通过且 repair_count=1；report 通过且未替选",
  "actual": {
    "intake": "ready",
    "check": true,
    "recheck_all_passed": true,
    "recheck_repair_count": 1,
    "report_all_passed": true,
    "report_selected_is_null": true
  }
}
```

### C5-02｜生成物与 manifest 哈希一致（无 STALE）

```json
{
  "input": {},
  "expected": "manifest.format=python-source-not-dsl；5 个生成物哈希全部匹配",
  "actual": {
    "format": "python-source-not-dsl",
    "entries": {
      "code_node.py": {
        "expected": "67f2d2002e38eb91ccbd0042d39f818c42bff3ad5041447d4eced315e19f59a0",
        "actual": "67f2d2002e38eb91ccbd0042d39f818c42bff3ad5041447d4eced315e19f59a0",
        "match": true
      },
      "intake_node.py": {
        "expected": "8bddff5fbb2cfd3d0c74f7b37c83592ba62721321a3f709db0f168d81477c892",
        "actual": "8bddff5fbb2cfd3d0c74f7b37c83592ba62721321a3f709db0f168d81477c892",
        "match": true
      },
      "check_node.py": {
        "expected": "4a977aa47ca1ffd6ce9357ddba9759a83e67af8e9fa82d6dc103f673e920f135",
        "actual": "4a977aa47ca1ffd6ce9357ddba9759a83e67af8e9fa82d6dc103f673e920f135",
        "match": true
      },
      "recheck_node.py": {
        "expected": "db5c823ced5d6aa877b3f8f971343f8f6776e48a14dde61da3e219f257b619fa",
        "actual": "db5c823ced5d6aa877b3f8f971343f8f6776e48a14dde61da3e219f257b619fa",
        "match": true
      },
      "report_node.py": {
        "expected": "a5f0641f8a9f738562326fbdd29adefe01bcbdc8f4382bcf1ce2b80422fb573d",
        "actual": "a5f0641f8a9f738562326fbdd29adefe01bcbdc8f4382bcf1ce2b80422fb573d",
        "match": true
      }
    },
    "mismatches": []
  }
}
```

### C5-03｜节点入口收到空输入时不放行任何候选

```json
{
  "input": {
    "args": [
      "",
      "",
      0
    ]
  },
  "expected": "status=error、all_passed=false、repairable=false、无候选结果被放行",
  "actual": {
    "status": "error",
    "all_passed": false,
    "repairable": false,
    "repair_count": 0,
    "validation_codes": [
      "INVALID_JSON"
    ],
    "candidate_results": []
  }
}
```

### C5-04｜调度器异常为中文受控失败且不重试

```json
{
  "input": {
    "payload_json": "{"
  },
  "expected": "WORKFLOW_INPUT_ERROR 中文受控失败、不放行、repair_count 记为 1（不无限重试）",
  "actual": {
    "broken_payload": {
      "status": "error",
      "all_passed": false,
      "repairable": false,
      "repair_count": 1,
      "envelope": {
        "status": "error",
        "errors": [
          {
            "code": "WORKFLOW_INPUT_ERROR",
            "path": "$",
            "message": "工作流变量无效或执行异常，未放行候选"
          }
        ]
      }
    },
    "bad_action": {
      "status": "error",
      "envelope": {
        "status": "error",
        "errors": [
          {
            "code": "WORKFLOW_INPUT_ERROR",
            "path": "$",
            "message": "工作流变量无效或执行异常，未放行候选"
          }
        ]
      }
    }
  }
}
```

### C6-01｜记录调用次数／延迟／成本（离线真实测量）

```json
{
  "input": {},
  "expected": "model_calls=0（真实未调用）；每阶段有 monotonic 实测秒数；cost 记 not_measured 不填 0；cloud_verified=false",
  "actual": {
    "mode": "offline-fixed-snapshots-no-model",
    "model_calls": 0,
    "cloud_verified": false,
    "cost": "not_measured",
    "stages": [
      {
        "stage": "intake",
        "seconds": 0.0
      },
      {
        "stage": "check_first",
        "seconds": 0.0
      },
      {
        "stage": "recheck",
        "seconds": 0.0
      },
      {
        "stage": "report",
        "seconds": 0.0
      }
    ],
    "total_seconds": 0.0,
    "all_passed": true
  }
}
```

### C6-02｜Dify 运行可追溯且 trace 缺口如实记录

```json
{
  "input": {},
  "expected": "有可追溯 run id；平台 trace 为 not_collected 需如实记录；节点 last-run 接口 200",
  "actual": {
    "workflow_run_id": "0cdef527-3504-4635-a338-58f985f8f216",
    "trace_runs_status": "not_collected",
    "node_last_run_http": 200,
    "raw_log_present": true
  }
}
```

