# REV-WF-001 字段契约统一验证

基线：`3dfb186`（release/2026-11-01-submission，已包含 PR #54）；分支：`line/nov01-contract`。本报告只记录离线运行，不访问 Dify、不调用模型、不生成 DSL。

## 统一行为

- `recipient_relation=other` 时要求非空 `recipient_relation_custom`；服务端请求同时保留 `recipient_relation_id=other`、显示文本和 custom 原文。
- `occasion=other` 时要求非空 `occasion_custom`，同样原样保留。
- 非 `other` 时携带任一 custom 字段返回 `INTAKE_UNKNOWN_FIELD`，路径分别为 `intake.recipient_relation_custom` / `intake.occasion_custom`。
- 空字符串、全空格、非字符串和超过 1000 Unicode 码点的 custom 值拒绝；缺失 `other` custom 返回 `INTAKE_CLARIFICATION_REQUIRED`。
- 新预算使用 `budget_mode`、`budget_range.min/max` 和派生 `budget_amount=max`；金额格式和范围由既有 validator 继续裁决。
- `deadline_days` 适配为 `available_days`，仍为明确整数；`hard_exclusions` 映射为 `forbidden_tags`、`forbidden_terms`，原文保留在扩展上下文。

本轮仅同步 Python intake 行为到已合入的 JS `web/server/intake.mjs`；未改 validator 语义、前端、视觉或 Dify 文件。

## 实际命令

```text
C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe -m unittest discover -s tests -q
```

337 项通过，0 失败。

```text
C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe workflow/build_code_node.py
```

成功，重建五份 `workflow/generated/*.py` 和 `manifest.json`。

```text
C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe workflow/verify_local.py
```

旧离线探针：46 项通过，0 失败。

```text
C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe workflow/verify_local.py --nov01
```

新版离线探针：29 项通过，0 失败；`cloud_not_verified=true`、`model_calls=0`。

`git diff --check` 通过。生成物指纹由构建输出和 `manifest.json` 记录；源码与五个产物均实际重新计算 SHA256，不能仅凭构建退出码判定。

## 未执行

真实 Dify、线上模型、token、延迟、成本、部署、DSL 导入和发布均未执行。离线通过不代表新版 Dify 发布或真实模型链路通过。
