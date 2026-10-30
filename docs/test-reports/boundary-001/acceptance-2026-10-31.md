# 请求侧数值范围与跨层门禁独立复核报告

> 本报告数字为 2026-10-31 时点真值；后续变更见 `docs/acceptance-criteria.md` 第 13 节。

- 复核角色：GiftWise｜测试验收 Agent（**独立执行**；不以开发方探针或声明代替证据）
- 复核时间：2026-10-31（Asia/Shanghai）
- 复核依据：`docs/validator-contract-decisions.md` §5（2026-10-30 修订：请求预算 `[1,10000]` 含端点）、§6（可用天数 `[0,365]` 含端点，保留 `0`）、§7（错误码全量清单）
- 复核对象：`validator/rules.py`（规则层）、`workflow/intake.py`（适配层）、`web/server/checker.mjs`（JS 接入层，只读）
- 复核套件：`tests/acceptance/boundary/`（**自建夹具，不复用规则线的 `tests/test_cases.json`**）
- 证据目录：`docs/test-reports/boundary-001/evidence/`

## 0. 结论摘要

| 项 | 结论 |
| --- | --- |
| 请求侧预算范围 `[1,10000]` | ✅ 端点含、越界拒，**格式优先于范围**成立 |
| 请求侧天数范围 `[0,365]` | ✅ `-1` 为 `INVALID_TYPE`、`0` 保留、`366`/`10^20` 为 `LIMIT_EXCEEDED` |
| **范围未下沉到候选侧** | ✅ 候选 `0` 仍通过；候选 20000 与 `'9'*999`（天文数值）**只**报 `OVER_BUDGET` |
| 边界业务语义（`>` 比较） | ✅ `budget=1` 配 `1.01` → `OVER_BUDGET`；`days=0` 配 1 天 → `PREPARATION_TOO_LONG` |
| 错误组合与优先级 | ✅ 多错并存全部上报不去重；JSON 数字型越界金额**只**报 `INVALID_TYPE`（范围正确跳过）；字段缺失只报 `MISSING_FIELD` |
| `>1000` 码点金额 | ✅ 范围检查被跳过（`_amount` 静默返回 None），但**由长度规则兜住**，码与路径相同，**无越界值漏过** |
| 跨层门禁（R-1） | ✅ intake 拒绝、`/validate` 放行，**两层都正确**（PM 已定性为分层设计） |
| 断言判别力 | ✅ 6/6 判别用例在"内存摘除范围校验"后行为改变；2/2 对照用例两侧一致 |
| **🔴 镜像未同步（最高严重度）** | **运行中的 `giftwise-validator:latest` 缺那 5 行范围校验**：`POST /validate` 对 `budget=10000.01`／`10001`／`0`／`days=366`／`days=2^53-1` **全部返回 `passed`**。镜像 273 行、工作区 278 行，diff 恰为该 5 行 |
| **🟠 JS 侧未同步** | `web/server/checker.mjs` 同样缺范围校验；**穷举 60 例中 16 例为接受性分歧**（一侧通过、另一侧拒绝），含上下界隔离与对照组 |
| `INTERNAL_ERROR` 输入可达性 | ✅ 我用 5 类极端输入**尝试推翻**"只能由内部故障触发"，**全部失败**——该结论被加强 |
| 回归 | `discover -s tests` **329 OK**；stage_c **39 OK**；boundary **45 OK**；contract **87 OK**；本地探针 **46 passed / 0 failed / 0 次模型调用** |

**我未修改** `validator/**`、`workflow/**`、`web/**`、`deploy/**` 或任何契约文档；全部发现以报告与用例形式提交。

> **本轮重点**：任务清单要求的边界与跨层验证已完成（§1–§3、§5、§6）。此后我**主动加做了一轮深挖**（§7 深水区、§8 穷举分歧矩阵、§9 镜像同步性），因为自查发现三处此前被放过或结论不牢的地方——
> 其中**§9 镜像未同步是本轮最严重的发现**：它说明"测试全绿"与"交付件行为"当前是脱节的。


## 1. 任务 1：独立边界套件

**文件**：`tests/acceptance/boundary/`（**45 项**，自建夹具；`test_boundary_ranges.py` 19 项 + `test_cross_layer_gate.py` 6 项 + `test_error_composition.py` 20 项）
**运行命令与原始输出**（`evidence/run-boundary-suite.txt`）：

```
$ python -m unittest discover -s tests/acceptance/boundary -q
----------------------------------------------------------------------
Ran 45 tests in 0.024s

OK
exit=0
```

（45 = 19 项边界 + 6 项跨层 + 20 项深水区，见 §3、§7；逐例名与结果见 `evidence/boundary-suite-run.txt`。）

**断言三要素**：每条都断言 **错误码 + 字段路径 + status**，例如：

```python
self.assert_code_at(result, "LIMIT_EXCEEDED", "request.budget_amount", "budget=10001")
self.assert_status(result, "needs_input", "budget=10001")
self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", "budget='01.00' 只应为格式错误")
```

### 1.1 预算 `request.budget_amount`

| 用例 | 实测 |
| --- | --- |
| `"0"`／`"0.0"`／`"0.00"` | `needs_input` + `LIMIT_EXCEEDED` @ `request.budget_amount` |
| `"1"`／`"1.00"` | 不报范围码（**下限含**） |
| `"10000"`／`"10000.00"` | 不报范围码（**上限含**） |
| `"10000.01"`／`"10001"` | `needs_input` + `LIMIT_EXCEEDED` @ `request.budget_amount` |

### 1.2 格式优先于范围（**本组是精心挑选的判别器**）

`"-1"`、`"-0"`、`"1e5"`、`"10000.001"`、`"00"`、`"01.00"`、`" 200"`、`"1,000"`
→ **全部** `INVALID_AMOUNT` @ `request.budget_amount`，且 **任何位置都不得出现 `LIMIT_EXCEEDED`**。

为什么这组能真正判别：`"01.00"`（数值 = 1）与 `"1,000"`（数值 = 1000）都**落在 `[1,10000]` 区间内**。
若实现"先做数值比较、再做格式校验"，它们会因格式不合法而先被解析失败或反而通过；只有**先格式、后范围**
才会统一得到 `INVALID_AMOUNT`。`"1e5"`（=100000）、`"-1"`、`"10000.001"` 则同时越界，用于确认范围检查
**没有抢在格式检查之前**报 `LIMIT_EXCEEDED`。

### 1.3 天数 `request.available_days`

| 用例 | 实测 |
| --- | --- |
| `-1`／`true`／`1.0`／`"3"`／`null` | `INVALID_TYPE` @ `request.available_days` |
| `0`／`1`／`365` | 通过（**`0` 保留**：当天可用准备时间） |
| `366`／`10**20` | `needs_input` + `LIMIT_EXCEEDED` @ `request.available_days` |

### 1.4 反向断言：范围**没有下沉**到与候选侧共用的 `_amount`/`_days`（**最重要**）

`validator/rules.py` 的注释自述"请求侧范围只在调用点检查；`_amount`/`_days` 与候选侧共用，范围约束不得进入共用函数"。
我用行为验证该承诺，而不是采信注释：

| 用例 | 期望 | 实测 |
| --- | --- | --- |
| 候选 `estimated_total = "0"` | 仍全部通过 | `passed`，无 `LIMIT_EXCEEDED`、无 `OVER_BUDGET` |
| 候选 `estimated_preparation_days = 0` | 仍全部通过 | `passed`，无 `LIMIT_EXCEEDED`、无 `PREPARATION_TOO_LONG` |
| 候选估算 `20000`／`999999`／`10000.01` | **只**出现 `OVER_BUDGET` | `failed` + `OVER_BUDGET`，**任何位置无 `LIMIT_EXCEEDED`** |
| 候选准备 5000 天 | **只**出现 `PREPARATION_TOO_LONG` | `failed` + `PREPARATION_TOO_LONG`，无 `LIMIT_EXCEEDED` |
| 候选格式（`２００`／`01.00`／`-1`） | 仍 `INVALID_AMOUNT` | 一致（格式规则两侧同一套） |

> **若范围被误写进共用函数**，候选 `0` 会被误拒、候选大额会混入 `LIMIT_EXCEEDED`。上述 5 组全部通过，
> 证明范围**只在请求侧调用点生效**。

### 1.5 边界业务语义

| 用例 | 实测 |
| --- | --- |
| `budget=1` 配候选 `1.01` | `OVER_BUDGET`（且 `budget=1` 本身不报范围码）；`failed` |
| `budget=1` 配候选 `1` | `passed`（比较用 `>`，不是 `>=`） |
| `days=0` 配准备 1 天 | `PREPARATION_TOO_LONG`；`failed` |
| `days=0` 配准备 0 天 | `passed` |
| `days=365` 配准备 366 天 | `PREPARATION_TOO_LONG`（且 `days=365` 本身不报范围码） |
| 请求越界 + 候选越界 | `needs_input`（§1 优先级：请求字段错误高于候选错误），`all_passed=false` |

### 1.6 我特意记录的一个探针缺陷（避免后来者重踩）

候选级错误码位于 `candidate_results[i].errors`，**不在顶层 `errors`**。我首轮只读顶层，
导致 13 项误报"没有错误码"。改为聚合顶层 + 候选级后全部通过。**这是我的探针缺陷，被测行为正确。**

## 2. 判别力证明：通过 ≠ 断言有牙

**为什么必须做**：一套边界断言在功能**缺失**时也可能"通过"（例如断言写错、或根本没走到该分支）。
所以我把范围校验当作被测功能，用**受控变异**验证断言能发现它缺失。

**做法**：只读 `validator/rules.py` 源码，在**内存中**整块摘除请求侧范围校验那 4 行（含缩进体），
`exec` 成临时模块后重跑同一批输入。**不写入 `validator/rules.py`**，全程只读。

命令：`python tests/acceptance/boundary/prove_discrimination.py`
输出：`evidence/discrimination-proof.txt`

| 类别 | 结果 |
| --- | --- |
| **判别用例**（越界值，须拒） | **6/6 有判别力** |
| 对照用例（范围内端点，须通过） | **2/2 两侧一致** |

摘除后的行为变化（关键行）：

| 探针 | A 真实实现 | B 摘除范围校验后 |
| --- | --- | --- |
| `budget=0` | `needs_input` / `['LIMIT_EXCEEDED']` | `failed` / `['OVER_BUDGET']` |
| `budget=0.00` | `needs_input` / `['LIMIT_EXCEEDED']` | `failed` / `['OVER_BUDGET']` |
| `budget=10000.01` | `needs_input` / `['LIMIT_EXCEEDED']` | **`passed` / `[]`** |
| `budget=10001` | `needs_input` / `['LIMIT_EXCEEDED']` | **`passed` / `[]`** |
| `days=366` | `needs_input` / `['LIMIT_EXCEEDED']` | **`passed` / `[]`** |
| `days=10**20` | `needs_input` / `['LIMIT_EXCEEDED']` | **`passed` / `[]`** |
| `budget=10000`（对照） | `passed` / `[]` | `passed` / `[]`（应相同） |
| `days=365`（对照） | `passed` / `[]` | `passed` / `[]`（应相同） |

**结论**：若缺少范围校验，我的 `test_just_above_upper_bound_is_rejected`、
`test_366_and_astronomically_large_are_limit_exceeded`、`test_zero_and_zero_decimals_are_rejected`
会分别失败。断言**有牙**。两个"对照用例"本就应该在两侧都通过（它们是区间的**含端点**），
不承担判别职责，记录在此以免被误读为缺口。

## 3. 任务 4：跨层用例（R-1 已定性为分层设计）

**文件**：`tests/acceptance/boundary/test_cross_layer_gate.py`（6 项）

| 层 | 输入：未知关系值 + 伪造的 `recipient_relation_id` | 实测 |
| --- | --- | --- |
| intake 适配层 `adapt_intake` | 客户端直接提交该对象 | `needs_input` + `INTAKE_UNKNOWN_LABEL`（未知关系）+ `INTAKE_UNKNOWN_FIELD`（伪造的服务端专属字段），**不释放 `request_json`** |
| 规则层 `validate`（**容器 `/validate` 暴露的就是它**） | 同一语义作为 `request_json` | **`passed`**、`all_passed=true`、无任何错误码 |

用例内以断言形式固化定性：

```python
self.assertEqual("needs_input", intake_status)
self.assertEqual("passed", rule_status)
self.assertNotEqual(intake_status, rule_status,
    "两层对本输入本就应当不同：intake 管契约、规则层管规则。"
    "若两者相同，说明有一层的职责被扩大或丢失。")
```

**落档口径**：**intake 适配层必须前置；不得把 `/validate` 的 `passed` 当作"输入符合 intake-v1 契约"。**

**闭环佐证**（证明分层不是靠放宽任何一侧实现）：适配层对**合法**输入的产物
（`recipient_relation="追求对象"`、`recipient_relation_id="pursuit"`）送进规则层仍然 `passed`。

另含枚举成员集冻结断言：`RELATIONS` 恰为 **10** 项 = 8 个产品值（`partner`/`pursuit`/`friend`/`family`/`classmate`/`mentor`/`client_partner`/`other`）
\+ `colleague`（技术回归夹具）+ `unknown`（界面未确认态）；且 `partner` 与 `pursuit` 的显示文本**不相同**。

## 4. 独立发现：JS 侧 `web/server/checker.mjs` **尚未同步**请求侧范围校验

**现象**：Python 已落地的请求侧范围在 JS 接入层缺失。**我没有采信任何声明，而是把同一批输入同时送进两侧对照。**

**复现命令**

```bash
python tests/acceptance/boundary/run_js_parity_probe.py     # 内部调用 node tests/acceptance/boundary/js_range_probe.mjs
```

**环境**：node **v24.21.0**；JS 侧只调用其公开导出 `validate`，**未修改 `web/**`**。

**对照结果**（`evidence/js-range-parity.txt`、`evidence/js-range-parity.json`）

| 用例 | Python | JS | 判定 |
| --- | --- | --- | --- |
| `budget=10000.01` | `needs_input` / `['LIMIT_EXCEEDED']` | **`passed` / `[]`** | **分歧** |
| `budget=10001` | `needs_input` / `['LIMIT_EXCEEDED']` | **`passed` / `[]`** | **分歧** |
| `days=366` | `needs_input` / `['LIMIT_EXCEEDED']` | **`passed` / `[]`** | **分歧** |
| `budget=0` | `needs_input` / `['LIMIT_EXCEEDED']` | `failed` / `['OVER_BUDGET']` | **分歧**（同为拒绝，但码与 status 不符契约） |
| `budget=0.00` | `needs_input` / `['LIMIT_EXCEEDED']` | `failed` / `['OVER_BUDGET']` | **分歧**（同上） |
| `days=10**20` | `needs_input` / `['LIMIT_EXCEEDED']` | `error` / `['INVALID_JSON']` | **分歧** |
| 格式 `-1` / `01.00` | `INVALID_AMOUNT` | `INVALID_AMOUNT` | 一致 |
| 候选 20000（只应 `OVER_BUDGET`） | `failed` / `['OVER_BUDGET']` | `failed` / `['OVER_BUDGET']` | 一致 |
| 候选 prep=0（须通过） | `passed` / `[]` | `passed` / `[]` | 一致 |
| `budget=10000`（端点） | `passed` / `[]` | `passed` / `[]` | 一致 |

**合计 6/14 分歧。** 与任务所述一致：`budget=10000.01`／`10001`／`days=366` 在 JS 侧**会被判定为通过**。

### 4.1 `web/tools/parity-check.mjs` 的绿灯**不能**当作 JS 侧已同步的证据

我独立核查了样例生成器 `web/tools/gen-parity-fixtures.mjs`（只读）。命令与输出：`evidence/parity-blindspot.txt`

```bash
grep -nE '"10000"|"10001"|10000\.01|available_days: 366|deadline_days: 366' web/tools/gen-parity-fixtures.mjs
# → 0 命中
```

该生成器的 intake 样例只覆盖：缺预算、`budget_amount: "100-200"`（**格式**错误）、非 CNY、未知关系、
未知标签、重复兴趣、超长补充说明、超限兴趣数组；候选侧只覆盖"刚好等于预算""超一天"等。
**其中没有任何请求侧数值越界样本**，因此该样例集**结构性看不见**本次范围变更——
parity 报"0 差异"是盲区，不是同步证据。

### 4.2 `days=10**20` 在 JS 报 `INVALID_JSON` 的根因（**已查清；我此前的猜测是错的**）

我早先在本报告里写过"可能是我的探针用 `JSON.stringify` 序列化大整数所致"。**该猜测已被推翻**，根因在 JS 解析器源码：

```javascript
// web/server/jsonstrict.mjs:168
if (!Number.isSafeInteger(value)) this.fail("整数超出安全范围");
```

即 JS 严格解析器**主动**拒绝任何超过 `Number.MAX_SAFE_INTEGER = 2^53-1 = 9007199254740991` 的整数，
判为 JSON 非法 → `INVALID_JSON`。这是**刻意的设计规则**，不是我的探针问题，也不是 JS 的缺陷。

实测边界（`evidence/js-grid-divergence.txt`）：

| `available_days` 字面量 | Python | JS |
| --- | --- | --- |
| `9007199254740991`（2^53-1，**可安全表示**） | `needs_input` + `LIMIT_EXCEEDED` | **`passed`**（解析成功，但无范围校验） |
| `9007199254740992`（2^53，不可安全表示） | `needs_input` + `LIMIT_EXCEEDED` | `error` + `INVALID_JSON`（解析期拒绝） |
| `10^20` | `needs_input` + `LIMIT_EXCEEDED` | `error` + `INVALID_JSON`（解析期拒绝） |

**意义**：这说明 JS↔Python 的分歧有**两个独立来源**——
① JS 缺范围校验（**接受性**分歧，严重）；
② JS 解析器的安全整数规则（**码/状态**分歧，两侧都拒绝，判定结论一致，严重度较低）。
修复 ① 时不要误把 ② 当成同一问题。

## 5. 任务 2：`docs/test-reports/contract-001/` 的处置

**未删除或改写任何原始结论**，只做了「加作废范围声明 + 标注取代关系 + 2 处更正」：

| 动作 | 内容 |
| --- | --- |
| 顶部新增 | 《⚠️ 作废范围声明（2026-10-31 补，不改原始结论）》——列出被取代的结论、以 `validator-contract-decisions.md` §5/§7 为准、并说明 `:151`/`:155` 行号引用**已悬空** |
| 就地标注 | §0 第 2/3/4 条、§2.1 的 `"0"`/`"0.00"` 行、§2.1 的 400 位行、§2.2 的 `100000` 行、§3 的 runtime 计数、§4 的未核实第 1 条，均加引用块或 ⚠️ 标记，**原文保留** |
| **更正 ①** | `workflow/runtime.py` **实发 3 个码**（`REPAIR_NOT_ALLOWED`、`PASSED_CANDIDATE_CHANGED`、`WORKFLOW_INPUT_ERROR`）。原记 4 个是把 `:16`／`:17` 两处**仅作比较**的 `INTERNAL_ERROR` 误算为实发。附行号与复现 grep |
| **更正 ②** | `INTERNAL_ERROR` **已从"未核实"移出**：用受控故障注入实际触达两条路径，附复现命令与原始输出 |
| 新增章节 | 《R-1 定性落档》——把 PM 的定性写成可复跑的跨层证据，并声明原"建议二选一"措辞已被取代 |

### 5.1 更正 ② 的复现命令与原始输出

```bash
python tests/acceptance/boundary/probe_internal_error.py
```

```
=== 基线（不注入）===
  validator: status=passed codes=[]
  intake   : status=ready codes=[]

=== 注入后：validator/rules.py 顶层 except → path='$' ===
  status=error all_passed=False
  codes=[('INTERNAL_ERROR', '$')]
  business_data_verification=not_verified
  响应中含堆栈文本=False（必须为 False）

=== 注入后：workflow/intake.py status=='error' → path='intake' ===
  status=needs_input codes=[('INTERNAL_ERROR', 'intake')]
  是否释放 request_json=False（必须为 False）

=== 还原后自证 ===
  _norm 已还原=True
  validator: status=passed codes=[]

两条路径均已触达=True
```

| 路径 | 代码位置 | 结果 | 附带确认 |
| --- | --- | --- | --- |
| 规则层兜底 | `validator/rules.py:270–273` | `status="error"`，`INTERNAL_ERROR` @ `path="$"` | **不泄露堆栈**；`business_data_verification="not_verified"` |
| 适配层兜底 | `workflow/intake.py:134–135` | `status="needs_input"`，`INTERNAL_ERROR` @ `path="intake"` | **不释放 `request_json`** |

注入方式：把 `validator.rules._norm` 在内存中替换为抛 `RuntimeError` 的函数（一次注入同时走通两条真实路径），
`finally` 中还原并**自证还原成功**。仍成立的说明是：`INTERNAL_ERROR` **不能由任何输入触发**，只能由内部故障触发——这本身是设计意图。

## 6. 任务 5：`test_c2_03` 为什么被改（纪律说明）

完整说明已写入 `docs/test-plan.md` 的《C2-03 用例修订说明（过时断言，不是为了让测试通过而改测试）》。
摘要如下，供 PM 核对：

| 项 | 内容 |
| --- | --- |
| 改了哪条 | `tests/acceptance/stage_c/test_stage_c_workflow.py::test_c2_03` |
| 原断言 | 用 `git show HEAD:workflow/labels.py` 取"变更前版本"，断言其中**不含** `pursuit` |
| 为什么失效 | 该断言把历史基线挂在 **`HEAD` 这个会移动的引用**上。DEC-1 已把 `pursuit` 加入枚举（自 `959aa6a` 起），`HEAD` 前移后 `git show HEAD:...` 返回**新版本**，断言必然失败。**失败原因是"基线取错"，不是产品行为回退** |
| 依据裁决 | DEC-1 / `workflow/workflow-spec.md:9`：`partner` 与 `pursuit` 是两个独立关系值 |
| 改后断言 | ① 改用**逐字节固定夹具** `fixtures/labels_before_pursuit.py`（来源 `89d6624`，sha256 `333ad976…`，出处见 `PROVENANCE.md`）；② 新增"**夹具哈希未被改动**"断言；③ 把"当前工作区是否含 `pursuit`"**降级为漂移观察** |
| 为何不是掩盖失败 | 改动**缩小**了断言的依赖面（从随 `HEAD` 漂移的仓库状态 → 内容哈希锁定的夹具），并把可观察事实如实记录而非删除。产品行为真回退时，夹具哈希断言与枚举断言仍会分别失败 |

## 7. 深水区：错误组合、优先级、静默分支与解释器限制

**动机**：任务清单只要求边界与跨层。但我自查发现三类**未被任何人的用例覆盖**的相邻行为，
其中包含一处我**自己写错过的结论**。以下全部由 `tests/acceptance/boundary/test_error_composition.py`
（20 项）与 `probe_deep_edges.py` 固化。

### 7.1 错误组合：多错并存是否都上报

| 输入 | 实测 | 判定 |
| --- | --- | --- |
| `budget=0` + `days=366` | **两条** `LIMIT_EXCEEDED`，路径分别为 `request.budget_amount` 与 `request.available_days` | ✅ 不去重、不合并 |
| `budget=0` + `days=-1` | `INVALID_TYPE` @ days + `LIMIT_EXCEEDED` @ budget | ✅ 两类错并存 |
| `budget=0` + `currency=USD` | `LIMIT_EXCEEDED` + `UNSUPPORTED_CURRENCY` | ✅ |
| 上述三者同时 | 三个码全部上报 | ✅ |

### 7.2 优先级：类型错误与字段缺失**优先于**范围

这组是**防止范围检查过度触发**的守卫，我原本没有覆盖：

| 输入 | 实测 | 为什么重要 |
| --- | --- | --- |
| `budget_amount = 20000`（**JSON 数字**，数值越界） | **只**报 `INVALID_TYPE`，**无** `LIMIT_EXCEEDED` | `_amount` 对非字符串已返回 None，范围检查必须被跳过。若实现把范围比较写在类型判断之前，这里会同时冒出范围错——契约不允许 |
| `budget_amount = 0`（JSON 数字） | 同上，只报 `INVALID_TYPE` | 同上 |
| `budget_amount` 字段缺失 | **只**报 `MISSING_FIELD`，无范围错 | 缺字段不得被当成"0 → 越界" |
| `available_days` 字段缺失 | **只**报 `MISSING_FIELD` | 同上 |
| `days = 0.0` / `1e400`（→inf）/ `true` | 均为 `INVALID_TYPE` | 布尔与浮点不得被当作整数参与范围比较 |

### 7.3 `>1000` 码点：`_amount` 的**静默 `None` 分支**是否让越界值漏过

`validator/rules.py:96–97`：

```python
    if len(value) > 1000:
        return None          # ← 不加任何错误，静默返回
```

而范围检查写作 `if budget is not None and not (1 <= budget <= 10000)`。因此对**格式合法但超过 1000 码点**的金额，
范围检查会被**跳过**。我实测这条路径：

| 输入 | `_amount` 结果 | 报出的错误 | 消息归属 |
| --- | --- | --- | --- |
| `"1"*1000`（恰好 1000 码点） | `Decimal`（巨大） | `LIMIT_EXCEEDED` @ `request.budget_amount` | **范围规则**（"预算须在 1 至 10000 之间"） |
| `"1"*1001`（1001 码点） | **静默 `None`** | `LIMIT_EXCEEDED` @ `request.budget_amount` | **长度规则**（"字段字符串超过 1000 个 Unicode 码点"） |

**结论：不存在越界值漏过。** 原因：该输入必然同时触发 `_limits` 的 1000 码点规则（`:56–57`），
它与范围规则**同码（`LIMIT_EXCEEDED`）、同路径**。差别只在**消息**——
排查"到底是哪条规则拦下的"时，`"1"*1001` 的归属是长度规则而**不是**新加的范围规则。
我据此在用例中显式断言了消息归属，避免错误码溯源被误导。

同组的候选侧对照：候选金额为 1001 码点 → `LIMIT_EXCEEDED` @ `candidates[0].estimated_total`（长度规则），
**不会**掉进 `OVER_BUDGET` 比较；候选金额为 `'9'*999`（长度合规、数值天文）→ **只**报 `OVER_BUDGET`。

### 7.4 解释器限制：**我尝试推翻自己的结论，失败了**

我在 §5 断言"`INTERNAL_ERROR` 不能由输入触发，只能由内部故障触发"。为检验它，我构造了 5 类极端输入，
假设 CPython 3.11+ 的 **int↔str 转换上限（4300 位）**会让 `json.loads` 抛 `ValueError`；
若解析器只捕 `JSONDecodeError`，异常就会落到顶层兜底变成 `INTERNAL_ERROR`。

**实测：假设不成立，我的断言站住了。** 解析器把这个 `ValueError` 正确归为 `INVALID_JSON`：

| `available_days` 字面量位数 | 实测 |
| --- | --- |
| 4299 位 | `needs_input` + `LIMIT_EXCEEDED`（范围规则） |
| **4300 位** | `needs_input` + `LIMIT_EXCEEDED`（范围规则） |
| **4301 位** | `error` + **`INVALID_JSON`**（不是 `INTERNAL_ERROR`） |
| 5000 / 20000 位 | 同上，`INVALID_JSON` |
| 候选侧 5000 位 | `error` + `INVALID_JSON` @ `candidates_json` |

**阈值精确在 4301**，与 CPython 上限吻合。为确认它是**解释器限制而非设计规则**，我做了决定性实验：
把 `sys.set_int_max_str_digits(0)`（关闭上限）后重放**同一条** 5000 位整数请求——

```
默认上限时： status=error        codes=[['INVALID_JSON', 'request_json']]
关闭上限后： status=needs_input  codes=[['LIMIT_EXCEEDED', 'request.available_days']]
结论：假设成立 —— 阈值来自解释器，不是设计规则
```

**因此我给出两条结论，且刻意不把它写成"缺陷"**：

1. **对该输入类的拒绝是 fail-closed 的**（`all_passed=false`，绝不接受、绝不 500），**不构成安全问题**。
2. 但**同一个逻辑输入在不同解释器配置下映射到不同的契约结果**（`INVALID_JSON`+`error` vs `LIMIT_EXCEEDED`+`needs_input`），
   且**消息不准确**——"JSON 无效，可能含重复键、非标准常量或嵌套过深"对一份**语法完全合法**的 JSON 是误导性的。
   当前宿主（3.12.12）与镜像（3.12.16）都 ≥3.11，因此**现行部署内行为一致**；风险仅在换用 Python ≤3.10 时显现。

**我的用例刻意不锁定 4301 这个数字**（`test_extreme_integer_literal_never_yields_internal_error` 只断言跨版本不变量：
必须被拒绝、必须不是 `INTERNAL_ERROR`、解析失败时所有候选必须 `passed=False`）。锁定它会在换解释器时变成脆断言。

### 7.5 我在本阶段**又犯的探针缺陷**（第 3、4 次，如实记录）

| # | 缺陷 | 症状 | 修正 |
| --- | --- | --- | --- |
| 1 | 请求 JSON 模板**漏了外层 `}`** | 一整组用例全部误报 `INVALID_JSON`（连对照组也是） | 加模板自检：先用 `json.loads` 验证模板合法，不合法就**终止**而不是继续产出假结论 |
| 2 | 候选金额 `"0"` 被我用**未加引号**的字面量发出 | 变成 JSON 数字 → 误得 `INVALID_TYPE`，险些被我当成"候选 0 被拒"的缺陷上报 | 加一条"探针自身 bug 对照"用例并排展示；修正后候选 `"0"` 为 `passed` |
| 3 | "下限隔离"用例只覆盖了**候选 1**，候选 2/3 仍是 120/80 元 | `budget=0.01` 时候选 2/3 **确实**超预算，隔离失败，下界分歧被误判为"中严重度" | 增加 `all_totals` 参数覆盖全部三个候选，下界分歧随即升级为**高严重度**（§8） |

> 第 3 次尤其值得记录：**隔离不彻底会系统性地低估缺陷严重度**。若我不追这一条，
> 就会把"JS 接受非法预算"报成"两侧都拒绝、只是理由不同"，从而掩盖 4 条真实缺口。

## 8. 穷举分歧矩阵：60 例，16 例高严重度

为给前端线一份**可直接照做的修复清单**，我把 §4 的 14 例采样扩成**穷举网格**。

**方法学要点（避免伪对照）**：用例表**只在 Python 侧生成一次**，同一份 JSON 文本同时回放给
Python `validator.rules.validate` 与 JS `validate`（经 stdin 传给 `js_grid_probe.mjs`），
因此两侧输入**逐字节相同**，不会出现"两边各写一份用例"导致的假一致。脚本另对每条分歧**分类严重度**：

- **接受性分歧（高）**：一侧 `passed`、另一侧拒绝 → 用户可见的判定不一致。
- **码/状态分歧（中）**：两侧都拒绝，但码或 status 不同 → 契约层不一致，判定结论相同。

```bash
python tests/acceptance/boundary/run_js_grid_probe.py
```

```
用例总数 60：一致 35 / 码或状态分歧 9 / **接受性分歧 16**
```

### 8.1 高严重度·接受性分歧（16 条，全部为"JS 放行、Python 拒绝"）

| 类别 | 用例 | Python | JS |
| --- | --- | --- | --- |
| 预算上界 | `"10000.01"`、`"10001"`、`"99999"`、`"100000"` | `needs_input`+`LIMIT_EXCEEDED` | **`passed`** |
| 预算上界 | `"1"*1000`（1000 码点、数值巨大） | `needs_input`+`LIMIT_EXCEEDED` | **`passed`** |
| 天数上界 | `366`、`1000`、`100000` | `needs_input`+`LIMIT_EXCEEDED` | **`passed`** |
| 天数上界 | `9007199254740991`（2^53-1，**两侧都能解析**） | `needs_input`+`LIMIT_EXCEEDED` | **`passed`** |
| **下界隔离** | 预算 `"0"`／`"0.00"`／`"0.01"`／`"0.99"`，且**三个候选金额均为 `"0.00"`** | `needs_input`+`LIMIT_EXCEEDED` | **`passed`** |
| **下界隔离** | 预算 `"0.99"` + 候选全 `"0.00"` + 天数 `0` | `needs_input`+`LIMIT_EXCEEDED` | **`passed`** |
| **上界隔离** | 预算 `"10000.01"`／`"10001"`，且三个候选金额均为 `"0.00"` | `needs_input`+`LIMIT_EXCEEDED` | **`passed`** |

**"隔离"一组是本节的关键**：候选金额全部取 `"0.00"`，使"候选是否超预算"不再掩盖"预算本身非法"。
隔离后 JS **直接 `passed`** —— 证明它**完全接受了非法预算**，而不是"用别的理由拒绝"。

**对照组（必须一致，确实一致）**：预算 `"10000"` + 三个候选 `"0.00"` → 两侧均 `passed`；
预算 `"10000"` + 天数 `365` → 两侧均 `passed`。说明矩阵不是"逢 JS 必报分歧"。

### 8.2 中严重度·码/状态分歧（9 条）

| 类别 | 用例 | Python | JS | 说明 |
| --- | --- | --- | --- | --- |
| 预算下界（未隔离） | `"0"`／`"0.00"`／`"0.01"`／`"0.99"` | `needs_input`+`LIMIT_EXCEEDED` | `failed`+`OVER_BUDGET` | 两侧都拒绝，但 JS 的理由是**误导性的**——它告诉用户"候选太贵"，而真实原因是"预算非法" |
| 安全整数 | 天数 `9007199254740992`（2^53）、`10^20` | `needs_input`+`LIMIT_EXCEEDED` | `error`+`INVALID_JSON` | §4.2 的解析器安全整数规则，**独立于缺范围校验** |
| 不安全整数 | 候选 prep `9007199254740992` | `failed`+`PREPARATION_TOO_LONG` | `error`+`INVALID_JSON` | 同上 |
| 组合 | 预算 `0`+天数 `366`；预算 `0`+天数 `-1` | 两个错 | 只报候选 `OVER_BUDGET` / 只报 `INVALID_TYPE` | 缺范围校验的连带效应 |

### 8.3 给前端线的修复清单（精确到可实现）

在 `web/server/checker.mjs` 的**请求校验**处（`request(...)` 内，`currency` 比较之前）补：

1. `budget_amount` 解析为分量后：**若 `cents < 100 || cents > 1000000`** → `LIMIT_EXCEEDED` @ `request.budget_amount`，
   消息 `预算须在 1 至 10000 之间`，`status` 归为 `needs_input`（即请求级错误）。
2. `available_days`：**若 `> 365`** → `LIMIT_EXCEEDED` @ `request.available_days`，
   消息 `可用天数须在 0 至 365 天之间`。
3. **必须放在请求级、不得放进候选侧共用的金额/天数解析函数**（否则会污染候选侧——Python 侧 G-2 反向断言就是防这个）。
4. 必须**早于**候选比较生效，否则预算 `0` 会先产生误导性的 `OVER_BUDGET`（§8.2 第一行）。

> **可验证的验收方式**：修复后重跑 `python tests/acceptance/boundary/run_js_grid_probe.py`，
> **接受性分歧应从 16 降到 0**；码/状态分歧预计仍有 3 条（安全整数那三条），那属于解析器规则差异，可另行决策。

## 9. 🔴 镜像未同步：**范围校验没有进入交付件**（本轮最严重发现）

**动机**：我全部边界测试都 `import validator.rules` —— 那测的是**工作区源码**，不是**交付的镜像**。
两者若脱节，则"测试全绿"具有欺骗性。我直接问容器。

```bash
docker run -d --name gw-sync -p 18099:8000 giftwise-validator:latest
python tests/acceptance/boundary/probe_container_sync.py
```

### 9.1 字节级比对：镜像少 433 字节，且**恰好**就是那 5 行

```
本地   validator/rules.py : 14059 字节  278 行  sha256=1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500
容器内 validator/rules.py : 13626 字节  273 行  sha256=4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3
字节完全相同: False
```

统一 diff（`evidence/container-rules-diff.txt`）——**镜像缺失的内容只有这一块**：

```diff
@@ -127,6 +127,11 @@
     budget = _amount(...) if "budget_amount" in request else None
     days = _days(...) if "available_days" in request else None
+    # 请求侧范围只在调用点检查：_amount/_days 与候选侧共用，范围约束不得进入共用函数。
+    if budget is not None and not (1 <= budget <= 10000):
+        _error(errors, "LIMIT_EXCEEDED", "request.budget_amount", "预算须在 1 至 10000 之间")
+    if days is not None and days > 365:
+        _error(errors, "LIMIT_EXCEEDED", "request.available_days", "可用天数须在 0 至 365 天之间")
```

镜像内 `"预算须在"` → **不存在**；`"可用天数须在"` → **不存在**。**单一原因，无其他差异。**

### 9.2 直接问运行中的 API（候选金额一律 `"0.00"`、准备 `0` 天，排除候选侧干扰）

```
--- 运行中 API 的实际判定 ---
  预算 "10000.01"（越界，本地规则应拒）              HTTP=200 status=passed  codes=[]
  预算 "10001"（越界，本地规则应拒）                 HTTP=200 status=passed  codes=[]
  预算 "0"（越界，本地规则应拒）                     HTTP=200 status=passed  codes=[]
  天数 366（越界，本地规则应拒）                     HTTP=200 status=passed  codes=[]
  天数 9007199254740991（越界，本地规则应拒）        HTTP=200 status=passed  codes=[]
  预算 "10000" + 天数 365（双端点，须通过）          HTTP=200 status=passed  codes=[]   ← 对照组
```

**部署中的 `/validate` 对全部越界输入返回 `passed`。** 对照组通过，说明镜像本身工作正常，**只是没有这套规则**。

### 9.3 关于 `/healthz` 的 `rules_source_sha256`：**该字段可信**

`deploy/server.py:28–30` 的定义是 `sha256(validator/rules.py 的原始字节)`。我在容器内**按同一定义重算**：

```
/healthz rules_source_sha256 = 4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3
是否等于容器内文件 sha256    = True（口径自洽性）
```

即该字段**确实**是所交付文件的内容指纹，**没有说谎**——它如实报告了镜像内是旧版规则。
**它正是用来发现这类脱节的机制，而且这次真的发现了。** 建议把"镜像哈希 == 工作区哈希"做成发布门禁。

### 9.4 影响与定性

| 项 | 内容 |
| --- | --- |
| **现象** | `giftwise-validator:latest` 不含请求侧范围校验；部署的 `/validate` 放行 `budget=10000.01/10001/0`、`days=366/2^53-1` |
| **根因** | 镜像早于 2026-10-30 范围裁决构建；范围校验只落在工作区源码 |
| **严重度** | **高**。这是**唯一面向真实调用方**的入口（前端与外部调用方走的就是它），而 JS 层也缺同一检查 → 该缺口**端到端存在**，无任何一层拦得住 |
| **不属于** | 不是"分层设计"。分层设计说的是 `/validate` **不校验关系枚举**；数值范围**是**规则层职责（PM 裁决 §5/§6，且已写进源码）——镜像只是没同步 |
| **修复** | 重新构建镜像并确认 `/healthz` 的 `rules_source_sha256` 等于工作区 `1f389dad…`。**由部署线执行**，我只报告不重建（避免与其他文件线争用镜像标签） |
| **验证方式** | 修复后重跑 `probe_container_sync.py`，期望输出由"发现问题"变为"未发现问题" |

> **顺带确认**：我上一轮报的 **I-2（`Content-Length` 大于实发字节导致线程永久占用、被 HEALTHCHECK 掩盖）已被部署线修复**——
> `deploy/server.py:24–27` 引入了 `READ_TIMEOUT_SECONDS`（默认 10，且 ≤0 时启动即报错），并在 `do_POST` 中把
> `TimeoutError` 映射为明确的 `408`（源码注释即引用 `I-2/S-5`）。这是我上一轮发现的**闭环**，我确认修复存在。

## 10. 回归原始输出（全部为我自己跑出来的）

```
$ python -m unittest discover -s tests -q
----------------------------------------------------------------------
Ran 329 tests in 0.272s

OK
exit=0
```

```
$ python -m unittest discover -s tests/acceptance/stage_c -q
----------------------------------------------------------------------
Ran 39 tests in 0.100s

OK
exit=0
```

```
$ python -m unittest discover -s tests/acceptance/boundary -q
----------------------------------------------------------------------
Ran 45 tests in 0.024s

OK
exit=0
```

```
$ python tests/acceptance/contract/run_contract.py
cases=87 passed=87 failed=0
exit=0
```

```
$ python workflow/verify_local.py
local probes: 46 passed; 0 failed; model calls: 0; cloud verified: false
exit=0
```

> **重要口径澄清**：`python -m unittest discover -s tests -q` 的 **329 项全部来自 `tests/test_validator.py`**。
> `tests/acceptance/**` 下**没有任何 `__init__.py`**，因此 unittest 的 discover **不会递归进去**
> （`python -m unittest discover -s tests -v | grep -c stage_c` → **0**；`find tests -name __init__.py | wc -l` → **0**，
> 见 `evidence/discover-scope.txt`）。
> 即 **329 与 39、45、87（以及 stage_b 的 275）是互不包含的集合**，不存在"329 已含 Stage C"。
> 我**未添加任何 `__init__.py`**，以保持其他文件线依赖的 329 基线不变——代价是我的边界套件需显式指定路径运行。

## 11. 纪律记录：我修正的过时断言（含仓位与理由）

范围裁决落地后，**我上一轮的契约套件出现了 4 条失败**。我按要求先判定性质再动手：

| 用例 | 原期望 | 现期望 | 判定 |
| --- | --- | --- | --- |
| `BUD-ZERO`（`"0"`） | `ready` | `needs_input` + `LIMIT_EXCEEDED` | **过时断言** |
| `BUD-ZERO-DEC`（`"0.00"`） | `ready` | `needs_input` + `LIMIT_EXCEEDED` | **过时断言** |
| `BUD-HUGE`（`"9"×400`） | `ready` | `needs_input` + `LIMIT_EXCEEDED` | **过时断言** |
| `DL-HUGE`（`100000`） | `ready` | `needs_input` + `LIMIT_EXCEEDED` | **过时断言** |

**判定为"过时断言"而非"掩盖失败"的依据**：
1. 失败原因可独立指认——契约 §5/§6 **新增**了范围约束，被测行为按裁决**有意改变**；
2. 我**没有**删除这 4 条用例，只把期望值改为**新的正确行为**，并在源码注释与报告顶部记明取代关系；
3. 同一批输入的新行为由**独立新套件**（`tests/acceptance/boundary/`，自建夹具）另行断言，不依赖被改的旧套件；
4. 旧套件其余 83 条断言**未改动**，仍全绿。

修正后：`cases=87 passed=87 failed=0`。

## 12. 没做到的 / 未验证的（如实列出，不美化）

> 本节已按深挖结果更新：原第 3、7 条**已完成**，从"未做到"移出并给出结论（见 §4.2、§7.3）。

1. **JS 侧与镜像修复后的行为未验证**：前端线与部署线均未交付修复；`checker.mjs` 与镜像相关结论绑定到**当前**工作区版本与**当前** `latest` 标签。
   修复落地后应重跑 `run_js_grid_probe.py`（**期望接受性分歧 16 → 0**）与 `probe_container_sync.py`（期望"未发现问题"）。
2. **我的套件不在默认 discover 内**：必须显式 `-s tests/acceptance/boundary` 运行。这是为保持 329 基线不变的**有意取舍**，代价是它不会被 CI/全量命令自动执行。
3. **未验证镜像重建后的哈希是否会被正确更新**：我只能验证"当前镜像的哈希如实反映了它是旧版"（§9.3）；重建流程本身属部署线。
4. **未做真实模型链路与 Dify 节点边界信封**（`payload_json` 262144 字节）的端到端验证：需模型调用，**本轮 0 次模型调用**。
5. **未验证 `10000` / `365` 这两个端点在生产数据下的业务合理性**——那是产品决策，不是测试结论；我只验证实现与裁决一致。
6. **未复验 PM 的 329 项探针细节**：我按要求做**独立复验**（自建夹具 + 判别力证明），而非复读 PM 的探针输出；PM 探针的实现差异不在我的结论范围内。
7. **候选侧"无数值上限"的证据边界**：我已覆盖候选 `0`、`20000`、`999999`、`'9'*999`、`'1'*1001`，但**未穷举**所有量级与 `_limits` 的交互组合。
8. **§7.4 的 4301 位阈值只在本机与镜像的解释器版本上验证**（3.12.12 / 3.12.16）：我**没有**在 Python ≤3.10 上实测，因此"换解释器会改变映射"是由 `set_int_max_str_digits` 实验**推断**的，不是直接观测。
9. **JS 解析器安全整数规则的业务合理性未评估**：我只判定它"是设计规则、且两侧都拒绝、严重度较低"，未判断 `2^53-1` 这个界对 `available_days` 是否过宽。
10. **容器探针只跑了一个镜像标签**（`latest`）：`coldbuild-20261030`、`obs-check`、`prefix-check`、`slowbody-check`、`pm-baseline-20261030` 未逐一核查，其中可能也有旧版规则。

## 13. 边界与副作用

- **未修改** `validator/**`、`workflow/**`、`web/**`、`deploy/**`、`docs/intake-contract.md`、`docs/validator-contract-decisions.md`、`docs/architecture/**`、`docs/product-*.md`、`docs/competition/**`。
- 本轮新增（我的边界内）：`tests/acceptance/boundary/`（**10 个文件**：`test_boundary_ranges.py`、`test_cross_layer_gate.py`、`test_error_composition.py`、`prove_discrimination.py`、`probe_internal_error.py`、`probe_deep_edges.py`、`probe_container_sync.py`、`js_range_probe.mjs`、`js_grid_probe.mjs`、`run_js_parity_probe.py`、`run_js_grid_probe.py`）、`docs/test-reports/boundary-001/`；修改：`docs/test-plan.md`、`docs/test-reports/contract-001/acceptance-2026-10-30.md`、`docs/test-reports/stage-b/acceptance-2026-10-29.md`、`tests/acceptance/contract/run_contract.py`。
- **不是我改的但同处 `tests/**`**：`tests/test_cases.json`、`tests/test_validator.py`、`tests/acceptance/stage_b/*` 在工作区显示为已修改，属**规则线与阶段 B 的并发工作**；我从未写入这 3 处（`tests/test_cases.json` 是规则线的文件，本轮我按要求**既未修改也未复用**）。
- **容器操作的影响范围（如实说明）**：为核查镜像同步性，我启动过一个容器 `gw-sync`（端口映射 `18099→8000`），**已 `docker rm -f` 删除**，未重建/未打标签/未推送任何镜像，未执行 `docker prune`。我**没有**修改 `deploy/**`，因此该发现以报告形式提交给部署线。
- **`workflow/evidence/**` 的写入副作用（如实说明）**：运行 `python workflow/verify_local.py` 是本地探针基线的必要步骤，该脚本**按设计**会在 `workflow/evidence/local-2026-10-29/runs/` 下新建一次运行目录并更新
  `latest.json`／`runs-index.jsonl`。这些是**脚本自身的产物**，不是我手工编辑 `workflow/**`。
  同一路径下 `results.json` 与 `WF-003-*` 等改动属**工作流线的并发工作**（我在本轮开始时的边界自查中已看到它们处于已修改状态，早于我运行任何命令）。
- **未执行** `docker prune`／`system prune` 或任何破坏性清理；**未执行任何 git 分支操作**（无 checkout/switch/branch/merge/rebase/push），改动全部留在工作区。
- **文档缺陷自曝**：2026-10-30 我插入「阶段 F 独立复核」时误用 `## 指标定义` 作锚点且未补回标题，导致该章节标题丢失、表格一度成为孤儿。本轮已恢复标题并在 `docs/test-plan.md` 内留下修复记录，避免被误认为他人改动。
- 环境：Docker Desktop 29.9.2、node v24.21.0、Python 3.12.12（本机）。

## 14. 证据索引

| 文件 | 内容 |
| --- | --- |
| `evidence/run-boundary-suite.txt` | 边界 + 跨层 + 深水区套件运行原始输出（45 OK） |
| `evidence/run-full-discover.txt` | `discover -s tests` 原始输出（329 OK） |
| `evidence/run-stage-c.txt` | stage_c 原始输出（39 OK） |
| `evidence/run-verify-local.txt` | 本地探针原始输出（46 passed / 0 failed） |
| `evidence/run-contract-suite.txt` | 契约套件原始输出（87/87） |
| `evidence/boundary-suite-run.txt` | 45 项逐例名与结果（verbose） |
| `evidence/discrimination-proof.txt` | 判别力证明（6/6 判别、2/2 对照） |
| `evidence/internal-error-injection.txt` | `INTERNAL_ERROR` 两条路径注入原始输出 |
| `evidence/internal-error-injection.json` | 同上，结构化 |
| `evidence/deep-edges.txt` | **深水区探针原始输出**（错误组合、优先级、静默 `None`、解释器限制实验） |
| `evidence/deep-edges.json` | 同上，结构化（含 `int_digit_limit_experiment`） |
| `evidence/js-range-parity.txt` | JS↔Python 14 例采样对照 |
| `evidence/js-range-parity.json` | 同上，结构化 |
| `evidence/js-grid-divergence.txt` | **穷举 60 例分歧矩阵**（含严重度分类与全部明细） |
| `evidence/js-grid-divergence.json` | 同上，结构化 |
| `evidence/parity-blindspot.txt` | parity 样例集不含越界值的 grep 证据 |
| `evidence/container-sync.txt` | **容器同步性探针原始输出**（哈希比对 + 运行中 API 判定） |
| `evidence/container-sync.json` | 同上，结构化 |
| `evidence/container-rules-diff.txt` | **容器内 vs 本地 `rules.py` 统一 diff**（缺的恰是那 5 行） |
| `evidence/discover-scope.txt` | discover 作用域证据：`tests/**` 下 `__init__.py` 为 0、`-s tests` 中 stage_c 命中数为 0 |
| `evidence/regression-full.txt` | 全量回归 `discover -s tests`（329 OK） |
| `evidence/regression-stage-c.txt` | stage_c 回归（39 OK） |
