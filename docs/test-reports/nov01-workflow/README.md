# REV-WF-001 离线报告

日期：2026-10-31（Asia/Shanghai）。本报告只使用虚构数据；新版线上 Dify 与模型未调用。

## 实际命令

使用 Python 3.12：

```text
C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe -m unittest discover -s tests -q
```

结果：329 项通过，0 失败。

```text
C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe workflow/verify_local.py --nov01
```

结果：17 项断言通过；`local_verified=true`、`cloud_not_verified=true`、`online_model_calls=0`、成本未测。最新 JSON 结果与本报告同目录，文件名含 Asia/Shanghai 时间戳。

```text
git diff --check
```

结果：通过。敏感信息扫描没有命中凭证模式。

## 覆盖范围

- `budget_range` 100–300 与 `budget_amount=300` 保持一致。
- 3–5 天映射为 5 天。
- 零元三种方向只描述已有资源、已有内容或征询意愿，不把采购材料说成免费。
- “不要香水”的排除项候选包含白名单标签、原文连续 `source_span`、固定 `evidence`，不输出可信约束字段。
- 未映射和注入式文本进入澄清，不默认为无禁忌。
- 新呈现包含 `contract_version`、style、色调、贺卡、赠送建议和未知；没有报价、材料步骤或额外费用字段。
- 一次修订仍失败时停止，保留冻结请求；新版报告只使用礼物本身估价口径。

生成物未重建：规则/适配 PR 尚未进入集成基线，按任务门禁等待 PM 合入后再执行 `build_code_node.py`。没有真实 Dify 节点、模型、token、延迟或费用数据。
