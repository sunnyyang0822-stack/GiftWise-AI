# 需要避免的 / 以前送过什么：工作流离线交付

基线：`3890aa5`，包含已合入PR #55。独立worktree `gw-context-nov01`，分支 `codex/workflow-avoid-history`，开始时干净。主工作区及其他工作区修改保留。开工已读AGENTS、公开Issue #1、交付变更契约、intake契约、workflow-spec及现有提示词。用户本轮指令覆盖旧预算额外确认表述。

目标是帮助用户判断送什么、为什么适合、如何比较。自动修订只作一次失败兜底，不是核心卖点。本次不接旧前端。

## 修改和字段映射

- Python `workflow/intake.py` 接受previous_gifts:string，选填默认空；纯空白归空、合法原文不裁剪；非字符串INVALID_TYPE，超过1000码点LIMIT_EXCEEDED，路径intake.previous_gifts。v2同名冻结，旧版未传时消费者默认空，不改变旧请求形状。
- dislikes字段不改名，中文文案改为“需要避免的”，空白归空。没有预算重复确认门禁，合法预算可通过基础适配。
- previous_gifts作为独立用户历史上下文，不拼入dislikes、不提升为facts或收礼人喜好、不生成forbidden_*；历史明确“不要再送”需要独立排除确认入口，不能以notes替代。
- 更新生成/修订/呈现/识别提示词，规定过敏风险不降格为偏好，尺码未知不猜尺码、模糊表达先澄清。无法表达的风险用既有unmapped阻塞，不新增错误码/标签。
- workflow-spec追加本轮离线边界；workflow/examples/avoid-history提供虚构示例、执行探针与PM同步清单。
- generated/**全部由既有build_code_node.py生成，无手改，构建脚本与.gitattributes未改。

## 实际命令与结果

统一Python为`C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe`，3.12.10，PYTHONIOENCODING=utf-8。

构建并提交实现`e3e5125d0068cc8b987810236c6e05e5c0a58c15`后，运行`python docs/test-reports/avoid-history/verify_committed.py`。该脚本先git archive该提交到全新临时副本；**重建前原件9/9指纹PASS**，之后才运行命令。

| 命令（Python312前缀） | 实际结果 |
| --- | --- |
| workflow/build_code_node.py | PASS；重建后9/9指纹一致，产物及manifest逐字节未变 |
| -m unittest discover -s tests -q | PASS 337项 |
| workflow/verify_local.py | PASS 46项 |
| workflow/verify_local.py --nov01 | PASS 29项 |
| -m unittest discover -s tests/acceptance/stage_c -v | PASS 39项 |
| workflow/examples/avoid-history/verify.py | PASS 26项 |

原始stdout/stderr、重建前/后expected/actual分开保存于bytes-20261031T125528129101+0800。所有旧探针写操作在临时副本，历史证据未覆盖。新验证工具在后续证据提交入库，不声称其已在被测实现提交中。

26项覆盖缺省/空/纯空白、历史原意和首尾空格、错误类型/1000及1001码点、普通历史不成硬禁忌、显式排除/注入原文不变且预算事实未改、固定过敏/尺码/模糊unmapped信封实际checker阻断、正常用户选择和预算无需额外确认。

## PASS与BLOCKED必须分开

- PASS：字段类型/限额/保留、固定信封checker阻断、代码检查不改冻结约束、预算/零元/事实推断未知/选择/一次修订回归，以及提交原件和重建产物指纹。
- BLOCKED：JS服务端还未支持previous_gifts及空白dislikes新口径；历史中明确“不要再送”的来源绑定/用户确认/冻结入口未实现；信息缺口独立机器结构尚未冻结；因此不能宣称跨端对等或ready-to-recommend。
- SKIP：真实语义识别、Dify/线上模型、前端独立预览联调、部署、DSL导入/发布；token、模型延迟和成本测量未执行，线上调用0。没有用固定夹具冒充真实模型。

基础Python ready只说明基础字段合法，不表示允许对有未确认风险的请求推荐。本线未用正则猜语义，不声称仅靠词匹配能识别全部过敏原/材质风险。模型收到正确未映射结果的能力仍未验证。

## 给PM/前端/接入线

最小契约建议和具体文件见`workflow/examples/avoid-history/README.md`：docs/intake-contract.md及API契约、web/server/intake.mjs白名单/校验/冻结，pipeline/provider传递与快照/幂等指纹、exclusion-checker/provider来源字段绑定、同页确认和独立信息缺口结构。PM指定负责人后再同步；本线未改这些共享文件，也未连接旧前端。

界面要求：标签“需要避免的”，placeholder“讨厌的东西，过敏，衣服尺码未知”；独立选填“以前送过什么？”。删除预算额外确认不取消排除项确认。历史默认软偏好，明确禁止重复应转确认/澄清，不能伪造为普通字面词已全面可靠拦截。

本PR仅离线工作流准备，待PM审查及跨端契约协调，不自行合并。
