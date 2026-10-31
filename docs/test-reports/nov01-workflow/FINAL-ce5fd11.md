# REV-WF-001 工作流收尾：待 PM 审查

2026-10-31，Asia/Shanghai。独立 worktree `gw-workflow-nov01`，新分支 `line/nov01-workflow-final`，基线 `ce5fd11`。原 PR #47 已合入；本次为后续真实开发差异，不是历史快照。

主工作区未修改。原 worktree 中未跟踪的 `probes-20261031T095156+0800.json` 保留，不纳入本次提交。

## 门禁核实

通过授权的 gh-cred.py 只读核对并 fetch 集成分支：规则 PR #48、排除项 PR #45、接入 PR #50 均已合入。基线包含 `check_budget_range`、零元/区间校验、Python v2 intake、JS 自定义 other 文本冻结。源码不是从他人 worktree 复制。

## 实际命令与断言

环境 `PYTHONIOENCODING=utf-8`，解释器统一为 `C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe`。

1. `python workflow/build_code_node.py`：实际成功，机械重建 generated 的五份 Python 和 manifest；未修改构建脚本、规则或适配源码。
2. `python docs/test-reports/nov01-workflow/finalize_probe.py`：实际成功。核对 manifest 的 4 份源码和 5 个产物 SHA256 全部一致，并实测 JS 自定义输入→冻结请求→生成后的 Code 校验→报告保持原值。
3. 该脚本在临时副本中实际运行 `python workflow/verify_local.py`：46 项通过、0 失败、退出码0。旧探针会构建并写指针，所有写操作仅在临时副本。新结果归档到本线 `final-baseline-ce5fd11`，没有覆盖旧证据。
4. 同一临时副本中实际运行 `python workflow/verify_local.py --nov01`：22 项通过、0 失败、退出码0。不是之前分支上未合入的28项版本；以最终基线中的脚本和真实输出为准。
5. `git diff --check`：通过。逐文件核对 diff，生成物未手修；主线提示词增加“三个礼物、为什么选、如何比较”、自定义原文不补值和一次失败兜底约束。

命令/输出、完整虚构探针、实际校验与报告、manifest 指纹见 [final-baseline-ce5fd11](final-baseline-ce5fd11/)。22项中部分是负例夹具字段/预期检查，不是实际AI checker执行；不能据此声称语义识别、注入拦截或新版接入E2E通过。没有运行全量 verify_all。

## 自定义输入差异：交 PM

实测 fixture：recipient_relation=`other`，recipient_relation_custom=`社团搭档`；occasion=`other`，occasion_custom=`项目收尾感谢`；budget_mode=`other`，budget_range=125.50–275.75，派生 budget_amount=275.75，deadline_days=5。都是虚构明确输入，不新增 custom 枚举。

JS `adaptIntake` 实际返回 ready，冻结后的关系/场合原文、区间与标量均保持；该冻结 request_json 经 generated/code_node.py 校验 passed，再经 report 原样保留，显示“礼物本身估价”，没有重算包装费用或相加三候选。

Python `adapt_intake` 对同一 intake 实际返回 needs_input，拒绝 `recipient_relation_custom` 和 `occasion_custom` 未声明字段。因此 **JS先适配、Code只校验冻结request路径可传递；将原始自定义intake直接交 generated/intake_node.py 不兼容**。请 PM 指定适配负责人协调共享契约/实现。本线不改 intake.py、JS 或 rules.py。禁止通过删掉自定义文本使请求“通过”。

生成物准确反映当前源码，但该差异未解决前不应宣称所有输入路径通用或上线可用。旧真实Dify记录不是本版证据。

## 未执行与边界

| 项目 | 状态 |
| --- | --- |
| 离线规则/报告及生成物指纹 | 已执行，结果如上 |
| 真实 Dify 验证 | 未执行，未访问 |
| 线上模型生成/识别/修订 | 未执行；调用数0 |
| token 数据 | 未执行，无数据 |
| 端到端模型延迟 | 未执行，无数据 |
| 调用成本/额度消耗测量 | 未执行；不以0成本冒充测量值 |
| 新版 DSL 导入、发布、部署 | 未执行；产物仅Python源码 |

下一步由 PM 审查自定义路径差异，并安排 QA 独立复跑。若适配源码更新，须再从合入基线重建并核对指纹。前端/接入继续先识别/确认 dislikes，再冻结约束，之后生成三个候选，等待明确选择。修订仅为最多一次失败兜底，不用于正常润色或自动替选。
