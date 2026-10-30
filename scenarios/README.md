# scenarios/ — 场景走查代码

本目录是**场景质量与决策链验证线**的代码与用例数据。报告在 `../docs/scenarios/`。

## 用法

```bash
cd <仓库根>

python scenarios/run_all.py         # 全量：13 场景 + 4 边界 + 9 探针，落盘原始输出
python scenarios/lib/chain.py       # 官方虚构样例的链路冒烟
python scenarios/lib/critique.py    # 9 条规则层产品级质疑探针
```

## 文件

| 文件 | 职责 |
| --- | --- |
| `run_all.py` | 总入口；写 `docs/scenarios/evidence/`；末尾跑不变量自检 |
| `lib/chain.py` | `run_case()`：intake → `adapt_intake` → request → 候选 → `validate`，返回结构化结果 |
| `lib/scenario_support.py` | 适配/校验调用封装、契约化候选构造 `cand()`、`batch()` |
| `lib/cases.py` | 13 个场景（S01–S13）+ 4 个边界（B01–B04）的用例数据 |
| `lib/critique.py` | 9 条产品级质疑探针（Q1–Q9），每条都返回真实规则层输出 |

## 设计原则

1. **零第三方依赖**：只用标准库。
2. **零模型调用**：从不调用 Dify 或任何模型。候选来源在用例里显式声明
   （`evidence` = 仓库既有产物；`authored` = 按契约人工构造，非模型产出）。
3. **只读调用**：`import` 使用 `workflow.intake.adapt_intake` 与 `validator.rules.validate`，
   **不修改任何规则或适配代码**。发现问题写报告，由对应线决定是否修。
4. **原始输出必落盘**：每个用例的适配结果、请求、候选、规则层返回原样写入
   `docs/scenarios/evidence/*.json`，便于复核。

## 复核提示

- 想确认"真的没调模型"：`grep -rnE "requests\.|urllib|http|fetch\(|api\.dify|httpx" scenarios/` 应为空。
- 想确认判定来自真实规则层：`docs/scenarios/evidence/scenarios-raw.json` 里每个用例都有
  `request` / `validation` / `candidate[].errors[].code` 的完整字段。
- 想看"只放行合法方案"是否真成立：看 `run_all.py` 末尾的自检输出（应为"全部一致 ✅"）。
