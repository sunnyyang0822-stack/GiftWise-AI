# 推荐阶段 Dify 配置与交接

2026-10-29。按当前用户要求工作流先行。完整设计仍见 workflow-spec.md；本文件是本轮实现及操作说明，不变更共享核心规范。源码和固定样例已可本地运行，线上状态见本轮报告。

## 真实导出基线与工具

本轮只读检查被 gitignore 排除的 `Giftwise.ifpkg`：ZIP 内为 manifest.yaml 与 app.yaml；SHA256 `0c487c1617905c981ceed7c8b0e1a72e63d9f0f2c0dd82d11d68ff3c5ed0227d`。结构为 start→llm→end，Start 只有 recipient_relation，未发现 code 节点；导出 DSL version=0.7.0，不等于 Dify Cloud 产品版本。未公开原始提示词、模型配置或凭证。环境未安装 PyYAML，本轮通过 zipfile 与结构行读取核实，不声称完整 YAML 语义导入验证。

安装了局部 playwright-core，工具与隔离浏览器配置只存 workflow/tools（整体忽略，仅 .gitignore 公开），不复用个人浏览器配置。Dify 登录需要用户在专属窗口完成，凭证不进入聊天或仓库。不安装来路不明的 Dify MCP，不把普通 Workflow 执行 Key 误当编辑后台的权限。

## 单一规则源码构建

在仓库根运行：

```powershell
python workflow/build_code_node.py
python workflow/verify_local.py
```

构建程序逐字读取 validator/rules.py，只移除调用方的本地模块 import，合并 labels、intake、runtime，生成 `workflow/generated/*_node.py` 和 manifest.json。绝不要求云端 import 本地仓库包；业务规则仍仅维护 validator/rules.py。每次规则更新重建并比对来源哈希，四个节点必须使用同一 manifest 版本；生成文件不手改。它们是 Python 源码，不是 Dify 导入 DSL。

本地加载构建物的 exec 只用于开发探针，不在 Dify 节点执行动态模型文本。节点内无网络、文件读取或 API。真实沙箱仍须验证 decimal、unicodedata、re.ASCII 等，本地标准库可用不能证明云端可用。[Dify 官方 Code 文档](https://docs.dify.ai/en/cloud/use-dify/nodes/code)说明 main 返回声明的变量，沙箱隔离且有输出限制；目标租户的实际限制以实测为准。

## 先执行无模型沙箱探针

在 Dify Cloud 工作室新建任务专用草稿，勿覆盖原应用；添加 Python Code 节点，粘贴 sandbox_probe.py；无输入，声明输出 `compatible: Boolean`、`details_json: String`。只运行该节点，预期 compatible=true 且四项标准库为 true。

如 import 或输出变量报错，保留脱敏节点错误和时间，确认 Python 模式与输出类型；不要将异常改为默认 passed。先交 PM 协调适配；若必须修改 validator 或新建 API，另行定范围，本任务不擅自扩张。

随后用真实 Code 节点单独运行本地证据中的虚构请求/候选，验证正常、超预算、禁忌和无效 JSON；这些节点调试不需要模型。确认租户版本、代码长度、输入/输出字符串容量及 Number 类型是否会将整数变成浮点；repair_count 必须是 0/1 整数，不静默取整。确认后再配置模型；当前没有自动付费调用授权。

## 节点接线（配置说明，不是已导入 DSL）

为减少嵌套对象限制，报告、校验和快照都跨节点传 JSON 字符串；在 Dify UI 逐项声明输入/输出，变量通过选择器绑定，不能用文本拼接未经转义的 JSON。

| 节点 | 代码或提示词 | 输入 | 输出与连接 |
| --- | --- | --- | --- |
| Start | 用户输入 | intake_json: String | 绑定 N1；可信服务端持有 task/run 标识与已有 repair_count |
| N1 | generated/intake_node.py | intake_json: String | request_json、errors_json、status: String；status=ready 才到 N2，否则中文补充提示，零模型调用 |
| N2 | prompts/generate.md | N1.request_json | LLM 原始 text 即 candidates_json；不剥围栏、不自动修 JSON |
| N3 | generated/check_node.py | N1.request_json、N2.text、repair_count: Number（首轮可信常量 0，已有任务取服务端记录） | envelope_json/status/validation_json/preserved_candidates_json: String；all_passed/repairable: Boolean；repair_count: Number |
| N4 | If/Else | N3.all_passed / repairable | all_passed→N7a；repairable→占用额度后 N5；其他→N7a |
| N5 | prompts/repair.md | N1.request_json、N2.text、N3.validation_json、N3.preserved_candidates_json | 只生成一次；自动重试关闭，失败不重新发起 |
| N6 | generated/recheck_node.py | request_json=N1、previous_candidates_json=N2、candidates_json=N5.text、repair_count=N3 原计数 | 复用相同 validate、计数变 1、检查原通过项未改；输出 envelope_json/status/all_passed/repairable/repair_count |
| N7a | generated/report_node.py | state_json=N3.envelope_json | 未修订报告，输出同上另有 report_text: String |
| N7b | generated/report_node.py | state_json=N6.envelope_json | 修订报告，独立分支避免引用未执行节点变量 |
| End A / End B | 分支各自输出 | 各自 N7.envelope_json / report_text | 两者都保持 selected_candidate_id=null，不连包装模型 |

N5 进入前可信任务先把次数占用为 1；N6 的 repair_count 参数仍引用 N3 的原计数，用于校验本轮是否获准。N5 超时/凭证错误则走错误终止分支，可信记录仍为 1，不调用 N6 或回到 N5。该跨调用可信持久化属于后续服务端任务，不能靠 Dify 参数或浏览器自行提交次数实现防篡改；本轮提供单次执行的本地控制与接线约束。

N2 超时/凭证不可用：中文“暂时无法生成推荐，请检查模型连接后重试”，不自动切为模拟成功。Code 节点运行失败：中文“暂时无法完成检查”，禁止选择。正常报告由代码渲染，不增加报告 LLM；report_text 作为纯文本展示，前端不能执行其中 HTML 或把用户原文当富文本代码。

原通过项按完整 JSON 对象比较，键序无关；删除、改写、加扩展字段都会拒绝整次修订选择。批次有顶层结构错误时不提取通过项，允许重建。底层 validation 保留真实结果；workflow_errors 单独记录保护拒绝，即使底层 all_passed=true，报告 all_passed=false、可选列表为空。

## 线上待执行与排错

1. 登录 Dify Cloud，确认目标工作区权限；记录租户可见版本/托管信息（查不到版本则记未知）。
2. 新建专用草稿并运行 sandbox_probe，不接模型；源码过长或输出类型不匹配时记录实际错误，不臆造解决结果。
3. 按上表配置 Code 输入输出；本地 `node-input-*.json` 是两字符串通用入口 code_node.py 的调试输入，专用入口则直接提取对应原始字段。
4. 无模型快照运行正常、超预算、禁忌、损坏 JSON、修订保护，记录实际节点输入输出。预期与本地 evidence 一致。
5. 模型供应商在平台设置配置，密钥不写提示词；核实模型、费用/额度和调用授权。权限或额度不足保留具体阻塞，不公开密钥。
6. 授权后各跑一次正常和真实修订。若自然生成全部通过，标注测试注入超预算触发修订；记录 N2 原始输出、注入差异、N5 真实输出、两次 Code 输出和计数，不能称自然模型违规。持续失败可用明确标注的故障注入检查停止。
7. 保存脱敏真实导出后才基于其格式制作可导入文件，重新导入任务专用副本验证；不从现有最小骨架编造未验证 DSL。

本轮不实现前端页面、API、包装阶段或云部署，不自动发布草稿。没有真实 Dify 轨迹与实际模型修订时，Issue #3 整项集成不能关闭。
