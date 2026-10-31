# QA #51 / REV-QA-001-BUG-001 生成物过期修复

日期：2026-10-31，Asia/Shanghai。最新 fetch 后基线为 `ce5fd11af5581a8f10f82dc995ec24bfd1b3e4b1`，包含规则 PR #48 和接入 PR #50。新独立 worktree `gw-workflow-qa51`、分支 `line/nov01-workflow-qa51`，创建时干净。旧工作区未跟踪 probes 文件完整保留，不 reset/stash/清理。主工作区未修改。

已读 AGENTS、Issue #1、PM 增量契约、QA PR #51 正文及其报告。QA 报告尚未合入 release，通过只读 fetch `pull/51/head` 的 `origin/qa51-review` 读取原报告。未从 QA 分支合并实现或修改 QA 期望。

## 实际命令与结果

环境：指定 Python312 实际为 3.12.10，`PYTHONIOENCODING=utf-8`。执行 `python docs/test-reports/nov01-workflow/qa51/run_offline.py`，该脚本逐项执行以下命令并按原始字节归档 stdout/stderr：

| 项目 | 实际命令 | 结果 |
| --- | --- | --- |
| 构建 | Python312 `workflow/build_code_node.py` | PASS，机械生成5份Python及manifest |
| 独立哈希 | hashlib读取原始字节，比较manifest每个字段 | PASS，4份源码+5个产物，共9项相等 |
| 历史探针 | Python312 `workflow/verify_local.py` | PASS，46项 |
| 新版探针 | Python312 `workflow/verify_local.py --nov01` | PASS，22项 |
| stage C | Python312 `-m unittest discover -s tests/acceptance/stage_c -v` | PASS，39项中36通过、3跳过；C5四项全部通过，含C5-02 manifest一致性 |
| 语义探针 | 脚本直接调用公开check/report/recheck | PASS，区间下限仅警告、零元通过、原事实/推断/未知保留、未替选、正常修订0次、异常最多1次且持续失败停止 |
| 格式 | `git diff --check` | PASS |

最终证据在 `20261031T112607116906+0800/`。首轮 `20261031T112549546854+0800/` 临时副本未复制 docs/intake-contract.md，stage C 2个执行ERROR；补齐副本文件后重跑，首轮输出原样保留。3个SKIP来自副本没有旧契约缺口/旧独立Dify证据，不是本版线上验证。没有改断言来修绿。

历史探针及stage C仅在临时副本运行，探针指针、索引、构建产物都只写临时目录；只归档本轮新输出。原历史证据、规则、适配、runtime、前端、QA文件和构建脚本无修改。临时git HEAD固定被测基线，且文件来源明确为本线重建后的副本；不把该HEAD单独当产物版本，精确版本见hashes.json。

## 指纹

- validator/rules.py：`f548f9554176dbcf3f4729dfba67898ccac8a4a7cd8020e20a123c5bf86a4258`
- workflow/intake.py：`776fea6bf6269d554cd66b666be7115cdaa0b11b90dbd5bcf62adf6b7cacb381`
- workflow/runtime.py：`32661d60ae1dafb1b7d17a8bb902a408419cbf7b3d2ecaad3aab252a99947683`
- labels及5份产物完整SHA256见每次运行的hashes.json；均实际重新读取并比较，不只依赖构建退出码。

## 范围与限制

本次只提交 generated/** 与新报告/本线验证脚本。没有改变产品主叙事：三个礼物、为什么适合、如何比较、等待用户选择；修订仅一次异常兜底。22项新版探针包含固定夹具字段断言，不能证明识别器语义、注入拦截或新版E2E。

新报告实际核对礼物本身预算文案、完整预算区间、低于下限warning及可选性、零元方向、原始请求和事实保留、事实/推断/未知文案分离、不自动选择和修订额度。未改共享口径。JS other自定义文本与Python intake的不兼容仍属PM协调项，本次不处理。

QA #51 其余错误路径/旧零预算预期失败不在修复范围，未顺手重写或修绿，待PM/QA裁决。本次不签发新版产品最终通过。

**本地生成物已验证，不等于新版Dify已发布或真实模型链路已验证。** Dify/模型/部署全部SKIP，线上调用数0；token、模型延迟、成本测量全部未执行。未生成或导入DSL。
