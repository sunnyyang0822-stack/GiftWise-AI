# VAL-001 契约决定：PM 确认版

决定日期：2026-10-29（北京时间）。适用任务：[Issue #2](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/2)。本文补充工作流规范中的未决边界；就以下六项，以本文为准。它们是应用规则，不代表已完成开发或已验证 Dify 沙箱兼容。

## 1. 多错误状态优先级

对能够安全检测到的错误，整体状态按以下顺序决定：意外内部异常或 JSON 解析错误 → `error`；请求字段错误 → `needs_input`；候选或批次错误 → `failed`；没有错误且三个候选全部通过 → `passed`。前三级的 `all_passed` 均为 `false`。不返回 `blocked` 业务状态。

先检查参数类型和原始 UTF-8 字节上限，超限参数不继续解析；仅对合格大小的字符串严格解析。任一已执行解析出现损坏 JSON、重复键或非标准常量，整体为 `error` / `INVALID_JSON`；不能因另一侧缺字段而掩盖解析错误。不要求继续解析超限数据来寻找更高优先级错误。无法编码为合法 UTF-8 的字符串按 `INVALID_JSON` 处理。

请求参数不是字符串、请求根不是对象或请求字段无效：`needs_input`；根错误用 `INVALID_REQUEST`，字段按现有错误码。候选参数不是字符串或根不是对象：`failed` / `INVALID_TYPE`。意外执行异常用 `INTERNAL_ERROR`，不暴露堆栈。可安全检查的独立字段尽量聚合错误；格式错误字段不参与数值比较。请求有错误时不必执行依赖它的候选约束检查，不应伪造逐候选通过结果。

## 2. 未知标签

已知词表沿用工作流规范。字符串标签使用 NFKC、去除首尾空白、大小写折叠后匹配；不将未知标签默认为 `other`，不自动猜同义词。

> **适用范围（2026-10-30 CONTRACT-001 裁决，两项）**：下列两条只约束**直接调用 `validate()` 的入参**，不约束经 `workflow/intake.py` 适配层的输入——适配层自成一层，其错误码由 [intake 契约](./intake-contract.md) 承载。
>
> 1. **归一化**：适配层使用**精确匹配**（大小写敏感、不去首尾空白、不做 NFKC），命中即发 `INTAKE_UNKNOWN_LABEL`（`intake.py:53`／`:76`／`:114`）。实测 `hard_exclusions.tags = ["ALCOHOL"]` 经适配层被拒，而同值直接作为 `request.forbidden_tags` 传入则通过。这是既定的两层分工，**校验器行为不因本次补记而放宽**。
> 2. **非字符串标签**：适配层对 `tags = [1]`、`tags = [""]` 会**同时**发出 `INTAKE_UNKNOWN_LABEL` 与 `INVALID_TYPE`（两码聚合），不采纳本文「非字符串不归为未知标签」的归类。裁决为**接受聚合现状、不改代码**，前端按 `errors` 数组展示。

- 请求 `forbidden_tags` 含词表外字符串：`needs_input` / `UNKNOWN_TAG`，中文提示用户确认禁忌类别。
- 候选 `tags` 含词表外字符串：该候选不通过，整体 `failed` / `UNKNOWN_TAG`（无更高优先级错误时），交给工作流处理候选修订。
- 标签非字符串属于 `INVALID_TYPE`，不归为未知标签。

## 3. 候选 ID

三个候选的 ID 集合必须恰好为 `c1`、`c2`、`c3`，输入顺序不限，ID 大小写敏感且不自动修剪或改写。

- 缺失 ID：`MISSING_FIELD`；ID 非字符串：`INVALID_TYPE`。
- 重复 ID 沿用 `DUPLICATE_ID`。
- 其他字符串 ID（含空字符串）：新增 `INVALID_CANDIDATE_ID`。

此类批次问题阻止 `all_passed`；没有更高优先级错误时整体为 `failed`。不强求在不存在对应对象时补造缺失 ID 的逐候选结果。

## 4. 重复内容

本轮仅做可复现的文本重复检查：分别将候选 `name`、`description` 做 NFKC、大小写折叠、首尾去空白并将连续 Unicode 空白折叠为一个空格；两个字段的标准化二元组同时相同才判重复。只对字段均合法的候选执行。

不同 ID 的相同二元组：所有参与重复的候选均不通过，新增 `DUPLICATE_CANDIDATE_CONTENT`，路径指向各自候选对象；没有更高优先级错误时整体 `failed`。不调用模型或向量服务做语义判重。改写文本但思路相同的情况由工作流评估与人工验收，代码未检出不能证明三种思路确实不同。

## 5. 金额字符串

使用 ASCII 全匹配：`(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?`，匹配后用 Decimal 比较。请求预算和候选金额应用同一格式。

允许 `0`、`0.0`、`0.00`、`12`、`12.3`、`12.30`；零预算或零估算允许，但不等于证明现实中免费，正估算仍不能超过零预算。

> **2026-10-30 修订（CONTRACT-001 裁决，已落地）**：新增**请求预算取值范围 [1, 10000]（含端点）**。`request.budget_amount` 为 `0`/`0.00`、负数或超过 10000 的值一律拒绝，错误码复用 `LIMIT_EXCEEDED`、请求侧 `needs_input`。本项**修订**上一段的「零预算允许」：零预算不再可作为请求预算提交。但**候选 `estimated_total` 仍允许 `0`**（零估算不等于证明免费，正估算仍不能超过零预算），上述格式规则对请求与候选两侧继续同一套。该范围已于 2026-10-30 在 `validator/rules.py:131–132`（预算）与 `:133–134`（可用天数）落地；范围只在请求侧调用点检查，**候选侧不受约束**。PM 独立探针与 329 项单元测试均通过；测试验收线的独立边界用例**已交付并通过**（boundary 套件 **45 / 45**，见 `docs/acceptance-criteria.md:47` 的 329＋275＋39＋45＝688 口径）。

拒绝前导零（如 `00`、`01.00`）、正负号（含 `-0`）、指数、千位分隔符、币种符号、全角数字、首尾空白、`.5`、`1.`、超过两位小数和 NaN/Infinity。非字符串用 `INVALID_TYPE`，不符合格式用 `INVALID_AMOUNT`，不自动修剪、换算或舍入。未知价格不能填零来代替。

## 6. 正式启用应用层长度限制

- 每个原始 JSON 参数分别最多 32,768 UTF-8 字节，等于上限允许；这是字节数而非字符数。
- 解析后的每个字段字符串最多 1,000 个 Unicode 码点（Python `len`），不适用于外层承载 JSON 的两个参数字符串。
- 每个输入业务数组最多 20 项；`candidates` 数量仍必须恰好 3，用 `INVALID_CANDIDATE_COUNT`，不以通用列表错误取代。
- 超出其他任一上限新增 `LIMIT_EXCEEDED`；请求侧为 `needs_input`，候选侧为 `failed`，两侧都有时采用第 1 节优先级。错误路径指向实际参数或字段，不回显完整内容。
- **可用天数范围 [0, 365]（含端点，2026-10-30 裁决，已落地于 `:133–134`）**：`request.available_days` **保留 `0`**（表示当天可用准备时间），超过 365 拒绝，错误码复用 `LIMIT_EXCEEDED`、请求侧 `needs_input`。候选 `estimated_preparation_days` 仍只要求非负 JSON 整数，其与可用天数的比较由 `PREPARATION_TOO_LONG` 承担。范围检查加在请求侧调用点，**未下沉**到与候选侧共用的 `_days`。
- 所有明确边界都要测试上限及上限加一。Dify 实际平台若存在更低限制，后续另做兼容性检查，不宣称该应用上限已经过沙箱实测。

## 交付与测试口径

规则开发 Agent 按本决定补齐断言与实现，不再将六项作为未决契约。测试验收 Agent 增补独立边界用例；业务结果仍需实际执行后记录。T01–T23 全部适用项均为完整 MVP 验收范围，按功能交付分阶段执行；尚未实现的阶段记阻塞，不能以离线单测替代集成测试，基础设施故障须用受控方式验证，不要求真实付费故障。

## 7. validator 实际发出的错误码全量清单（2026-10-30 独立复核补）

Issue #6 CONTRACT-001 用 AST 静态提取加逐码动态探针清点，`validator/rules.py` 实际发出 **19 个**错误码，**19/19 均已在本地实际触发**（固定快照、无模型调用）。本文第 2–6 节只定义了其中一部分，本表为全量出处，供工作流与前端按码对齐。

| 错误码 | 代码位置 | 触发条件 | 所属状态 |
| --- | --- | --- | --- |
| `INVALID_TYPE` | `rules.py:33`、`:74`、`:81`、`:90`、`:102`、`:140`、`:145`、`:171`、`:182`、`:193`、`:219`、`:227` | 参数非字符串、字段类型错误、标签数组元素非字符串、候选 `tags` 为空数组 | 参数/请求侧 `needs_input`，候选侧 `failed` |
| `INVALID_JSON` | `rules.py:38`、`:47` | 无法编码为合法 UTF-8、损坏 JSON、重复键、非标准常量（含嵌套过深触发解析递归上限） | `error` |
| `LIMIT_EXCEEDED` | `rules.py:41`、`:57`、`:60`、`:132`、`:134` | 参数字符串超 32768 UTF-8 字节、字段字符串超 1000 码点、业务数组超 20 项；**以及数值超范围**（`request.budget_amount` ∉ [1, 10000]、`request.available_days` > 365，2026-10-30 已在 `:132`／`:134` 落地，见第 5、6 节） | 请求侧 `needs_input`，候选侧 `failed` |
| `MISSING_FIELD` | `rules.py:69`、`:223` | `request` 或候选缺必填字段、批次缺 `candidates` | 请求侧 `needs_input`，候选侧 `failed` |
| `INVALID_AMOUNT` | `rules.py:93` | 金额非 ASCII 全匹配格式（见第 5 节） | 同字段所属侧 |
| `INVALID_REQUEST` | `rules.py:121` | `request` 根节点非对象 | `needs_input` |
| `UNSUPPORTED_CURRENCY` | `rules.py:136` | `request.currency` 非 `CNY`（大小写敏感） | `needs_input` |
| `DUPLICATE_ID` | `rules.py:151`、`:238` | `request.facts` 的 ID 重复、候选 ID 重复（适配层标签重复用同一码） | 请求侧 `needs_input`，候选侧 `failed` |
| `UNKNOWN_TAG` | `rules.py:157`、`:196` | 请求 `forbidden_tags` 或候选 `tags` 含词表外字符串 | 请求侧 `needs_input`，候选侧 `failed` |
| `INVALID_CANDIDATE_ID` | `rules.py:186` | 候选 ID 为字符串但不是 `c1`/`c2`/`c3`（含空串、大小写变体） | `failed` |
| `OVER_BUDGET` | `rules.py:200` | 候选估算总额超过请求预算（`>`，含零预算配正估算） | `failed` |
| `PREPARATION_TOO_LONG` | `rules.py:202` | 候选估算准备天数超过可用天数（`>`） | `failed` |
| `CURRENCY_MISMATCH` | `rules.py:204` | 候选币种与请求币种不一致 | `failed` |
| `FORBIDDEN_TAG` | `rules.py:207` | 候选 `tags` 命中请求 `forbidden_tags`（标准化后匹配） | `failed` |
| `UNKNOWN_FACT_REF` | `rules.py:210` | 候选 `fact_refs` 引用了原始请求不存在的事实 ID | `failed` |
| `FORBIDDEN_TERM` | `rules.py:213` | 候选文本命中请求 `forbidden_terms` 字面词 | `failed` |
| `INVALID_CANDIDATE_COUNT` | `rules.py:230` | 候选数量不是恰好 3；**不**以通用列表错误取代 | `failed` |
| `DUPLICATE_CANDIDATE_CONTENT` | `rules.py:247` | 不同候选的 `name`+`description` 标准化二元组相同（见第 4 节） | `failed` |
| `INTERNAL_ERROR` | `rules.py:276` | 未预期执行异常兜底，`path` 为 `$`，不暴露堆栈 | `error` |

> **行号基准（截至 2026-10-31 00:09 复核）**：本表对应 `validator/rules.py` **278 行**（`splitlines` 计数）版本。规则线新增请求侧范围校验共 5 行（`:130–134`，含 1 行注释），因此**第 130 行之后的行号较此前版本整体 +5**，第 130 行之前（`:33`–`:121`）不受影响。`LIMIT_EXCEEDED` 的既有三处（`:41`、`:57`、`:60`）未位移，该次改动另在 `:132`、`:134` 新增两处范围拒绝点，**已列入本表**。行号漂移由探针 `probe_doc_parity.py` 自动对账（当前 19 个码零偏差）。**注意**：`workflow/workflow-spec.md:96` 内另有 `validator/rules.py:181`、`:242` 两处引用未随本次位移更新（实际为 `:186`、`:247`），属该文件线，已上报。

工作流包装层另有 `workflow/runtime.py` 的 `REPAIR_NOT_ALLOWED`（`:40`）、`PASSED_CANDIDATE_CHANGED`（`:53`、`:55`）、`WORKFLOW_INPUT_ERROR`（`:135`），它们属于包装层而非纯校验器，已由 `workflow/workflow-spec.md:166` 记载。`workflow/tools/verify-container.py` 的 `INVALID_PAYLOAD` 属演示 HTTP 容器，不在本契约范围。

**文档差集**：`workflow/workflow-spec.md:96` 的「既有错误代码」清单列了 18 个码，**缺 `LIMIT_EXCEEDED`**（第 6 节已定义该码）。该文件不在本轮可改边界，已上报对应文件线。

## 8. 边界与解析行为的实测补记（2026-10-30）

本节把第 6 节的上限结论补上实测证据；「期望」列即第 6 节已冻结的口径。

| 边界 | 期望（第 6 节口径） | 实测结果 | 结论 |
| --- | --- | --- | --- |
| 参数字节 32768 / 32769 | 等于上限允许，上限+1 拒 | `request_json` 恰 32768 字节正常解析（报 `INVALID_REQUEST`，**未**报超限）；恰 32769 字节 → `LIMIT_EXCEEDED` | 一致 |
| 字段字符串 1000 / 1001 码点 | 上限含，上限+1 拒 | `notes` 1000 码点 `passed`、1001 码点 → `LIMIT_EXCEEDED`；1000 个 emoji（各 1 码点）通过，1001 个被拒；家族 emoji 按 5 码点计，201 个 = 1005 码点被拒 → 确认为 Python 码点数而非字形数 | 一致 |
| 业务数组 20 / 21 项 | 上限含，上限+1 拒 | 候选 `unknowns` 20 项 `passed`、21 项 → `LIMIT_EXCEEDED` | 一致 |
| `candidates` 顶层 21 项 | 用 `INVALID_CANDIDATE_COUNT`，不以通用列表错误取代 | 只出现候选类错误码，**无** `LIMIT_EXCEEDED`；`_batch` 的 `_limits` 调用有意排除 `candidates` 键 | 一致 |
| 候选 ID 集合合法性 | 必须恰好为 `c1`/`c2`/`c3` | 逐个校验 ID 且拒绝重复，二者的组合在 3 项约束下等价于集合相等；`c1,c2,c4` → `INVALID_CANDIDATE_ID`，`c1,c2,c2` → `DUPLICATE_ID` | 一致 |
| 重复内容标准化 | NFKC + 大小写折叠 + 空白折叠 + 首尾去空白，二元组同时相同才判重 | 全角字母/全角空格/制表符/大小写差异均正确判 `DUPLICATE_CANDIDATE_CONTENT`；仅「无空格 vs 有空格」不判重（折叠不等于删除） | 一致 |
| 金额边界 | 第 5 节格式允许 `0`/`0.0`/`0.00`/`12`/`12.3`/`12.30`；**2026-10-30 修订**：请求预算 ∈ [1, 10000]，候选估算仍允许 0 | 请求预算 `"0"`/`"0.00"` → `needs_input` + `LIMIT_EXCEEDED`（`:132`）；`"1"`/`"10000"`/`"10000.00"` 通过；`"10000.01"`/`"10001"` → `LIMIT_EXCEEDED`；`"-1"`/`"1e3"` 等格式错仍为 `INVALID_AMOUNT`（**格式优先于范围**）；候选 `"0"`/`"0.00"` 仍 `passed` | ✅ 已落地（`:131–132`），候选侧未受影响 |
| 零天数与 365 上界 | 第 6 节：`0` 允许（裁决保留），上界 365 | 可用 0 天 + 准备 0 天 → `passed`；`1`/`365` → `ready`；`366`/`10^20` → `LIMIT_EXCEEDED`（`:134`）；`-1`/`True` 仍 `INVALID_TYPE` | ✅ 已落地（`:133–134`），`0` 保持允许 |
| 无法编码为合法 UTF-8 | 按 `INVALID_JSON` | 孤立代理项参数 → `error` / `INVALID_JSON` | 一致 |
| JSON 嵌套深度 | 第 6 节未定义 | **无显式深度限制**：约 2000 层（约 12 KB）可正常解析；约 3000 层（约 18 KB）触发 `INVALID_JSON`（捕获 `RecursionError`，错误文案含「嵌套过深」）；实测上限受 32768 字节约束，与 Python 递归限制共同决定 | 需补充：深层嵌套由解析递归上限兜底并归 `INVALID_JSON`，不写死层数 |
| 请求侧错误与候选约束 | 请求有错误时不必执行依赖它的候选约束 | 请求错误时 `context` 为 `None`，跳过预算/天数/币种/禁忌/事实引用比较，逐候选 `passed` 为 `false`；请求侧错误不参与候选比较 | 一致 |
| 资源与调用 | 纯函数、无 I/O | 固定快照执行 0 次模型调用、无网络与文件写入 | 一致 |

## 9. CONTRACT-001 对账补记：跨层冲突与裁决

Issue #6 复核结论：本文第 1–6 节与实现**逐条一致**，无第 7 节清单之外的遗漏码，无上限口径偏差。但复核发现两处**跨层语义冲突**——本文只约束 `validator/rules.py`，而真实链路会先经过 `workflow/intake.py`。两项均已于 2026-10-30 裁决为「明确适用范围、接受适配层聚合现状、零代码改动」：

| # | 冲突 | 证据 | 裁决（2026-10-30，已生效） |
| --- | --- | --- | --- |
| 1 | 第 2 节要求标签「NFKC、去首尾空白、大小写折叠后匹配」，适配层却是**精确匹配** | `hard_exclusions.tags = ["ALCOHOL"]` 经适配层 → `INTAKE_UNKNOWN_LABEL`；同一标签直接传入 `request.forbidden_tags` → `passed`。第 2 节的归一化规则在真实链路中不生效 | **采纳文档口径**：已在第 2 节写明「归一化只适用于直接调用 `validate()` 的入参；经适配层的输入以精确匹配为准」。不改 `workflow/intake.py`，也不放宽校验器行为 |
| 2 | 第 2 节规定「标签非字符串属于 `INVALID_TYPE`，不归为未知标签」，适配层对非字符串元素**同时**发 `INTAKE_UNKNOWN_LABEL` 与 `INVALID_TYPE` | `hard_exclusions.tags = [1]` → 两个码；`tags = [""]` 同样双码 | **接受聚合现状**：两码如实记录，不改 `workflow/intake.py`；前端按 `errors` 数组展示，验收断言按多码编写 |

此外，`workflow/intake.py` 的错误码与本文的分工已由 [intake 契约](./intake-contract.md) 承载，两文互相交叉引用。适配层不做错误去重（同一根因可产生 2–3 条错误），属其已记载且**已裁决接受**的行为。

## 10. 可复现探针套件（CONTRACT-001 复核证据，已入库）

本轮复核所用探针已入库，不再依赖会话临时目录；任何人可在仓库内**一条命令**复现：

```bash
python docs/test-reports/contract-001/tools/run_all.py
```

| 探针（均位于 `docs/test-reports/contract-001/tools/`） | 单独运行 | 对账内容 | 当前结果 |
| --- | --- | --- | --- |
| `probe_error_codes.py` | `python docs/test-reports/contract-001/tools/probe_error_codes.py` | AST 静态清点 + 逐码动态触发 | validator **19/19**、intake **9/9**、runtime **3/3** |
| `probe_boundaries.py` | `python docs/test-reports/contract-001/tools/probe_boundaries.py` | 边界值矩阵实测（含数值范围裁决、候选侧不受约束） | 边界场景 **47/47** |
| `probe_doc_parity.py` | `python docs/test-reports/contract-001/tools/probe_doc_parity.py` | 字段白名单、第 7 节全量清单与**行号引用**双向对账 | 双向差集为空；仅 `LIMIT_EXCEEDED` 的 `:132`／`:134` 登记为已知豁免 |

脚本只读调用公开函数，**不写仓库文件、不访问网络、不调用模型**；退出码 0 表示通过、1 表示失败，可直接作为门禁使用。

> **状态口径（截至 2026-10-31 00:09）**：请求侧数值范围校验已于 2026-10-30 在 `validator/rules.py` 落地（预算 [1,10000]、可用天数 [0,365]，超出复用 `LIMIT_EXCEEDED`；范围**只在请求侧调用点检查**，见 `:131–134`，**候选侧不受约束**）。PM 独立探针与 329 项单元测试均通过；测试验收线的独立边界用例**已交付并通过**（boundary 套件 **45 / 45**，见 `docs/acceptance-criteria.md:47` 的 329＋275＋39＋45＝688 口径）。本套件 `probe_boundaries.py` 47/47 通过，`probe_doc_parity.py` 行号对账零偏差。
