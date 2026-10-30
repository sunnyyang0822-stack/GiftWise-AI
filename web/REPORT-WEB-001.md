# WEB-WF-001（WEB-001）交付报告：中文最小前端 + 最小服务端接入层

- 任务号：WEB-WF-001 / 子任务 WEB-001
- 主责角色：GiftWise｜前端开发 Agent（含最小服务端接入层）
- 交付时间：2026-10-30（Asia/Shanghai）
- 依据：Issue #3 最新正文 + PM 任务单 + `docs/pm-reviews/contract-decisions-draft-2026-10-30.md`
  + `docs/requirements-analysis.md`（阶段 1 冻结）+ `docs/intake-contract.md`（intake-v1，未改）
  + `workflow/workflow-spec.md`（选择与呈现契约、`presentation_json` 建议结构、全局一次修订）
- 运行方式与目录说明：[README.md](./README.md)
- **本报告的每一条"已核实"都附实际命令与真实输出；设计意图与未跑通的东西一律写在"未核实"与"阻塞"里。**

---

## 1. 新增文件（全部在 `web/` 下，共 19 个文件 / 5921 行）

```
web/package.json                          18   零依赖脚本入口
web/README.md                             —    运行方式、界面承诺、信任边界
web/REPORT-WEB-001.md                     —    本报告
web/public/index.html                     91   首屏 + 三步说明 + 状态挂载点
web/public/app.js                       1229   三步表单 / 三方案对比 / 呈现页 / 六种中文状态
web/public/styles.css                    843   沿用首页视觉语言（暖白底、近黑字、黑底胶囊按钮）
web/server/server.mjs                    318   HTTP 入口：静态资源 + /api/*
web/server/config.mjs                    136   唯一开关集中点
web/server/labels.mjs                    106   intake-v1 标签表（产品面 8 关系）
web/server/jsonstrict.mjs                213   严格 JSON 解析/序列化
web/server/intake.mjs                    230   确定性适配（对齐 workflow/intake.py）
web/server/checker.mjs                   518   独立规则校验（对齐 validator/rules.py）+ 呈现复核
web/server/mock-model.mjs                411   模拟候选/修订/呈现（显眼标注）
web/server/dify.mjs                       86   真实 Dify 调用（密钥只在服务端）
web/server/store.mjs                     102   服务端可信任务快照与修订计数
web/server/pipeline.mjs                  410   两阶段主流程编排
web/tests/access-layer.test.mjs          560   40 项单元检查
web/tools/gen-parity-fixtures.mjs        204   比对用固定样例生成
web/tools/parity-reference.py             80   调仓库 Python 参考实现算期望结果（只读）
web/tools/parity-check.mjs               174   JS↔Python 逐项比对
web/tools/smoke-http.mjs                 192   59 项 HTTP 冒烟检查
```

**改动边界核实**：`git status --short` 显示我的产物只有 `?? web/` 一项新增。
`docs/intake-contract.md`（mtime 10-30 20:49）、`workflow/labels.py`（20:48）、
`validator/rules.py`（10-29 18:57）、`AGENTS.md`（10-29 19:49）的时间戳都早于我会话的第一次写入，
即**我没有改过任何共享契约或既有代码**。工作区里 `deploy/`、根 `README.md`、
`workflow/evidence/WF-003*` 的近期变动属其他线并发写入，与本任务无关，我也未触碰。

**未做**：未 `git add`、未提交、未推送、未启动 Docker/云资源、未改 Dify 草稿、未读任何凭证。

---

## 2. 实际运行的命令与真实结果

以下全部在本机实际执行，输出为原样摘录（中文乱码处是控制台编码问题，非脚本失败，已在括号内注明）。

### 2.1 单元检查（40 项，全通过）

```text
$ node web/tests/access-layer.test.mjs
✔ 产品面关系枚举是冻结 8 项，且不含同事
✔ 兴趣 12 项、风格 7 项、禁忌 6 类、熟悉程度 5 项、场合 6 项
✔ 追求对象不被静默映射：关系机器值原样透出，中文为「追求对象」
✔ 契约开关关闭时明确拒绝追求对象，且不改写成恋人或其他关系
✔ 只有 confirmed 兴趣进入事实；inferred 单独存放；未知不生成事实
✔ interest_confidence 只接受 confirmed/inferred；unknown 被拒
✔ 置信度多余键被拒
✔ 浏览器提交派生字段（facts / repair_count / passed）被拒绝，不进入请求
✔ 预算缺失或写成区间时不静默补默认值
✔ 天数允许 0，但拒绝浮点、布尔与缺失；不静默填 7 天
✔ 首版仅 CNY，非 CNY 被拒且不换汇
✔ 待澄清禁忌不会被静默忽略
✔ 严格 JSON：重复键、NaN、尾随内容、根节点非对象都被拒
✔ 关系或场合为 unknown 时要求澄清，不冒充已确认
✔ 同事只作为技术回归机器值存在，产品界面不出现
✔ 校验：三个不同候选全部通过；任一失败只影响该项
✔ 校验边界：等于预算通过，超一分钱失败；等于天数通过，超一天失败
✔ 校验：禁忌类别与字面词都被拦截；字面词不因同义词放过
✔ 校验：候选数量、ID、重复内容、币种、事实引用、未知标签都有独立错误码
✔ 校验：模型输出损坏 JSON 时为 error 状态，且所有候选强制不可选
✔ 校验：请求本身有问题时状态为 needs_input，不进入修订
✔ 校验：业务数据核实状态恒为 not_verified
✔ 推荐：恰好三个候选、全部可选、selected_candidate_id 为 null、修订计数 0
✔ 推荐：三个候选思路互不相同（名称与描述标准化后不重复）
✔ 推荐：预算过小时先自动修订一次，仍失败则无可选方案且不二次修订
✔ 推荐：全部候选触犯禁忌且无替代时，无可选方案，失败如实报告
✔ 推荐：模拟模型输出损坏 JSON 时不伪装为完成
✔ 推荐：部分通过时失败项不可选，系统不自动替选
✔ 推荐：输入不完整时返回 needs_input 且不生成候选
✔ 推荐：真实 Dify 未配置时明确报错，不回退成模拟并标成真实
✔ 选择：未通过项、伪造 ID、空选择都被拒绝，并给出中文原因
✔ 呈现：严格按「风格配色 → 包装 → 贺卡及装饰 → 赠送时机与话术」四段顺序
✔ 呈现：复核礼物＋包装＋贺卡＋装饰＋配送的全量费用、准备时间与禁忌
✔ 呈现：追求对象与恋人的贺卡与话术完全不同，且追求对象低压力
✔ 呈现：重复选择同一候选是幂等的，不重复消耗额度
✔ 全局修订：推荐阶段用掉额度后，呈现阶段失败不再二次修订
✔ 全局修订：推荐阶段未用额度时，呈现阶段可用一次修订并复核通过
✔ 呈现复核：不能通过下调原价腾出预算
✔ 呈现复核：材料触犯禁忌类别或字面词时失败
✔ 可信状态：修订计数只由服务端持有，浏览器无法改写
ℹ tests 40 / ℹ pass 40 / ℹ fail 0 / duration_ms 39.2283
```

注：`node --test tests/` 在本机会报 `spawn EPERM`（沙箱不允许建匿名管道，属环境限制），
因此测试文件设计成**可直接 `node <file>` 执行**，`npm test` 也走这条路径。
同理 `python workflow/verify_local.py` 在我这里跑不起来（同一 `PermissionError: WinError 5`，
卡在它自己的 `subprocess.check_output(["git", ...])`），**这不是规则线的回归**，
我也不会去改那个文件；它的既有结论仍以 `docs/requirements-analysis.md` 记录的
46 项探针 / 322 项 unittest 为准。

### 2.2 JS↔Python 语义比对（55 组样例，0 处语义差异）

```text
$ node web/tools/gen-parity-fixtures.mjs
已写出 .tmp/web-parity/fixtures.json
  intake 用例 27 条
  候选批次 24 批 + 损坏样例 4 条

$ python web/tools/parity-reference.py
已写出 .tmp/web-parity/python-out.json          （控制台中文乱码，内容正确）
  intake 参考结果 27 条；校验参考结果 28 条

$ node web/tools/parity-check.mjs
JS↔Python 语义比对：共 55 组样例（intake 27 条 / 校验批次 28 条）
参考实现：python: workflow/intake.py + validator/rules.py（Python 3.12.12）
追求对象契约开关：PURSUIT_CONTRACT_READY=true
结果：全部一致（0 处语义差异）
  其中 1 组仅错误顺序不同（Python 侧集合迭代顺序随哈希种子变化，错误码/路径/文案/请求完全一致）：
  [intake] 浏览器伪造派生字段
附加检查（把契约开关当作未落地）：错误码 PURSUIT_CONTRACT_NOT_READY；未生成请求：true
附加检查：通过（拒绝且不静默映射）
```

覆盖的边界样例含：预算区间字符串、非 CNY、浮点天数、布尔天数、0 天、重复键、`NaN`、
尾随内容、数组根节点、多余置信度键、`unknown` 置信度、待澄清禁忌、超长字符串、
21 项兴趣、伪造派生字段；校验侧含等于/超一分钱、等于/超一天、禁忌类别、字面词、
重复内容、非法 ID、候选数不足、浮点金额、前导零、负金额、空批次、损坏 JSON。

**唯一差异是错误顺序**，我实测确认它是 Python 侧的非确定性而非我的实现偏差：

```text
$ for seed in 0 1 2; do PYTHONHASHSEED=$seed python -c "...adapt_intake(...)"; done
seed=0 ['intake.facts', 'intake.repair_count', 'intake.passed']
seed=1 ['intake.passed', 'intake.repair_count', 'intake.facts']
seed=2 ['intake.facts', 'intake.passed', 'intake.repair_count']
```

来源是 `workflow/intake.py:47` 的 `data.keys() - FIELDS` 集合差运算（集合无序）。
比对器因此对**这一类**错误只做集合比对（错误码、路径、中文文案、`request_json` 逐字节仍要求全等），
并在输出里显式列出被豁免的样例，不隐藏。建议由 PM 转给工作流线决定是否改成有序遍历；我未改该文件。

### 2.3 HTTP 冒烟（59 项，全通过）

```text
$ node web/server/server.mjs &
GiftWise web 接入层已启动：http://127.0.0.1:8787
模式：mock（模拟数据；Dify 未配置或未确认发布）
追求对象契约已落地：是（工作区未提交改动）

$ curl -s http://127.0.0.1:8787/healthz
{"status":"ok","mode":"mock","runs":0}

$ node web/tools/smoke-http.mjs
PASS  GET /api/config 返回 200
...（59 项逐条，见下）
合计 59 项检查，失败 0 项；目标服务 http://127.0.0.1:8787
smoke_exit=0
```

关键几项的真实断言值：

| 检查 | 真实结果 |
| --- | --- |
| 关系 8 项、`partner` 在前、`pursuit` 第二 | `partner,pursuit,friend,family,classmate,mentor,client_partner,other` |
| 界面不出现「同事」 | 通过 |
| 兴趣 12 / 风格 7 / 禁忌 6 / 预算区间 5 / 时间区间 4 | 通过 |
| 配置接口不含密钥字段 | 通过（无 `api_key`、无 `Bearer`） |
| 派生字段篡改 | 4 个 `INTAKE_UNKNOWN_FIELD`，且不返回派生请求 |
| 正常推荐 | `status=passed`、3 候选、可选 `["c1","c2","c3"]`、`selected_candidate_id=null`、`repair_count=0`、剩余 1 |
| 事实分离 | `facts=["interest:coffee_food"]`、`preference_inferences=["design_art"]` |
| 未选择前呈现调用数 | `presentation=0`、`presentation_revision=0` |
| 伪造 ID / 空选择 / 无记录 | `INVALID_SELECTION` / `INVALID_SELECTION` / 404 `RECOMMENDATION_NOT_FOUND` |
| 四段顺序 | `style>packaging>card>giving`，标题 `①②③④` |
| 复核算术 | `138.00 + 0.00 = 138.00 ≤ 200.00`，天数 `1 ≤ 2`，禁忌 `["alcohol"]`/`["酒"]` 均参与 |
| 幂等重放 | 第二次返回 `idempotent_replay=true`，`repair_count` 仍 0 |
| 小预算（10.00） | 一次自动修订，`repair_count=1`、剩余 0，三候选都落到预算内 |
| 额度用完后呈现超支 | **409** `presentation_failed`，错误 `["OVER_BUDGET","REPAIR_LIMIT_REACHED"]`，分段数 0 |
| 额度留给呈现阶段 | 呈现修订一次后 `completed`，`revised_once=true`，`repaired_checks=["OVER_BUDGET"]`，总价回到预算内 |
| 部分通过 | `status=failed`、可选 2 项；选失败项 → `CANDIDATE_NOT_PASSED` |
| 模型输出损坏 | `status=error`、候选 0、可选 0（不伪装完成） |
| 恋人 vs 追求对象 | 贺卡正文与话术**均不同**；追求对象含"不暗示双方已确定关系/回应压力"提示 |
| 未知兴趣 | `facts=[]`、`preference_inferences=[]`，仍给三个方向 |
| 超时 | 客户端 3 秒中止命中 `AbortError`（服务端 `demo=slow` 延迟 45 秒） |
| 运行记录 | `/api/runs/:id` 返回可信状态，不含密钥 |

### 2.4 追求对象契约开关的两态实测

```text
# 默认（开）：正常提交
$ curl -X POST /api/recommendations -d @r-normal.json
status=passed | 关系 追求对象 / pursuit | 事实 ["interest:coffee_food"]

# GW_PURSUIT_CONTRACT_READY=0 起第二实例（8788）
$ curl -X POST http://127.0.0.1:8788/api/recommendations -d @r-normal.json
http=400
status=needs_input
  PURSUIT_CONTRACT_NOT_READY @intake.recipient_relation
    「追求对象」这个关系在本项目的服务端契约里还没有对应的机器值（pursuit），
    现在提交会被服务端拒绝为 INTAKE_UNKNOWN_LABEL。系统不会把它当成「恋人」或其他关系，
    也不会降低推荐等级。你可以先选其他关系，或等契约落地后再试。
$ curl http://127.0.0.1:8788/api/config
pursuit_ready=false
界面仍含追求对象? true            ← 界面不隐藏、不降级、不改写
```

### 2.5 真实模式守卫（不静默回退）

```text
$ GW_PORT=8789 GW_MODE=dify node web/server/server.mjs
模式：dify（真实 Dify；仍以服务端返回为准）
$ curl -X POST http://127.0.0.1:8789/api/recommendations -d @r-normal.json
http=503
status=error errors=["DIFY_NOT_CONFIGURED"]
notices=真实 Dify 调用未成功，未生成任何候选，也没有把模拟数据伪装成真实结果。
是否回了候选? false
```

### 2.6 前端语法检查

```text
$ node --check .tmp/app-check.mjs     （web/public/app.js 的副本）
app.js 语法检查：通过
```

---

## 3. 哪些数据是模拟的（逐项）

| 内容 | 状态 | 说明 |
| --- | --- | --- |
| 三个候选方案（名称、描述、理由、推断、未知项） | **模拟** | `web/server/mock-model.mjs` 的固定候选池 + 确定性挑选，不是模型输出 |
| 候选费用 `estimated_total` | **模拟估算** | 池内固定金额（88/96/108/118/128/138/188 元），无真实商品价源 |
| 候选准备天数 | **模拟估算** | 池内固定值，非物流或商家承诺 |
| 自动修订后的候选 | **模拟** | 只按错误码改小规格/改现货速购/换安全类别，明确写入 `notices` |
| 呈现四段（配色、材料、步骤、贺卡、话术、装饰物） | **模拟** | 按关系分支的固定模板；`partner` 与 `pursuit` 文案完全不同 |
| 呈现新增费用 `additional_cost` | **模拟** | 默认 `0.00`，模板假定基础包装已含在原估算内（**不是普遍免费**） |
| 独立规则校验结果 | **真实计算** | 由 `checker.mjs` 对候选实际求值，不是写死的"通过"；与 Python 参考实现比对一致 |
| 确定性适配、错误码、修订计数、可选列表、幂等 | **真实实现** | 服务端逻辑，非模拟 |
| `business_data_verification` | 恒为 `not_verified` | 价格、库存、送达一律未核实 |

界面上的模拟标识：顶部常驻黄色横幅（`MOCK_MODE_NOTICE`，含"Dify 未发布、不是模型真实输出、没有联通"）、
徽章条"模拟数据模式"、推荐页与呈现页各自的模拟说明、页脚"待测目标/未核实"声明。

---

## 4. `pursuit`（追求对象）契约的处理方式

**开关位置**：`web/server/config.mjs` → `PURSUIT_CONTRACT_READY`（默认值 + `GW_PURSUIT_CONTRACT_READY` 环境变量），
一行可切；文案也在同文件（`PURSUIT_NOT_READY_MESSAGE` / `PURSUIT_READY_MESSAGE`）。

**任务单假设与实测差异**（这是我要报给 PM 的第一件事）：
任务单写"今天刚决定的 `pursuit`，`workflow/labels.py` 与 `docs/intake-contract.md` 还没有它，提交会被拒"。
我在开工时实测**本地工作区已经落地**（应是工作流线在 20:48–21:21 之间完成）：

```text
$ python -c "sha256(labels.py) 与 manifest 声明对比"
labels.py 实际 sha256 : e3128d298808fecf900974b2dcb12d33034204701175614cdb43fc4a17f67910
manifest 声明         : e3128d298808fecf900974b2dcb12d33034204701175614cdb43fc4a17f67910
一致                  : True
pursuit in labels.py  : True
生成物含 pursuit      : {code_node: True, intake_node: True, check_node: True, recheck_node: True, report_node: True}
cloud_verified        : False
HEAD                  : 89d6624
labels.py 是否已提交  : False        ← 仍是未提交的工作区改动
$ python -c "adapt_intake(recipient_relation='pursuit')"
STATUS: ready   request.recipient_relation_id: "pursuit"
```

因此我把默认值定为 **`true`**，并在 UI 与报告里如实标注它的限制（未提交、Dify 未重新发布）。
**若 PM 以已提交版本（HEAD）为准**，只需把 `config.mjs` 的 `PURSUIT_CONTRACT_READY_DEFAULT` 改回 `false`
（或启动时 `GW_PURSUIT_CONTRACT_READY=0`），行为立刻变成 2.4 节实测的那条中文拒绝路径——两条路我都已实现并测过。

无论开关是哪一态，都满足任务单的硬要求：

1. 界面**正常展示并允许选择**「追求对象」，不隐藏、不置灰、不降级为「其他」；
2. 关状态时提交**明确中文拒绝**，错误码 `PURSUIT_CONTRACT_NOT_READY`，不生成请求；
3. **绝对没有静默映射**：关系机器值原样透出为 `pursuit`，中文为「追求对象」，
   单测 `追求对象不被静默映射` 与 `契约开关关闭时…不改写成恋人或其他关系` 直接断言这一点；
4. 恋人与追求对象是两条独立分支：提示文案、候选理由口径、贺卡正文、赠送话术、
   关系风险提示全部不同（单测 + 冒烟各一条断言）；追求对象默认低压力，
   不暗示关系已确定、不默认告白、不制造回应压力。

---

## 5. 已核实（有命令、有输出、可复现）

- 三步表单的字段与交互契约：关系 8 项无同事、恋人/追求对象独立、熟悉程度 5、场合 6、
  预算区间+明确上限+勾选确认、时间区间+最终天数+勾选确认（0 天允许）、仅 CNY。
- 兴趣 12 项逐项 `confirmed`/`inferred`（默认猜测）；"暂时不知道"互斥，提交 `interests: []` + `interest_confidence: {}`；
  只有 `confirmed` 进事实，`inferred` 单独存为推断，未知不编造。
- 风格 7 项 + "不确定"互斥；风格视为送礼者偏好。
- 禁忌三层：类别 / 字面词 / 待澄清（`unresolved` 非空被要求澄清，不静默忽略）。
- 不按性别、年龄、职业或关系推断兴趣：适配层无任何此类分支（代码事实 + 单测断言事实来源只有 confirmed 兴趣）。
- 三方案对比页：恰好三个不同思路，逐项展示理由、事实引用、推断、未知、全量估算费用（CNY）、准备时间、
  **独立规则校验结果**（错误码 + 中文）。
- 选择门槛：`selectable_candidate_ids` 决定可选；失败项不可选；伪造 ID / 空选择 / 选失败项全部被拒；
  系统不自动替选；推荐阶段 `selected_candidate_id` 恒为 `null`。
- 选择后才生成呈现，四段顺序固定为 风格配色 → 包装材料与步骤 → 贺卡正文与装饰物 → 赠送时机方式与话术；
  未选择时呈现阶段零调用。
- 呈现复核覆盖礼物+包装+贺卡+装饰+配送的全量费用、准备时间与禁忌；
  `revised_estimated_total` 必须等于原价+新增，**不能靠下调原价腾预算**（有专门单测）。
- 全局最多一次自动业务修订，跨两阶段合计；计数只在服务端 `store.mjs`；
  浏览器提交 `repair_count` 被 `INTAKE_UNKNOWN_FIELD` 拒绝；额度耗尽后如实 409 报失败，不二次修订；
  重复选择幂等且重放对调用方可观察。
- 六种中文状态全部可达并已实现：加载中、空状态（无记录/记录过期/零候选）、错误、超时、无可选方案、未选择。
- 窄屏基础可操作：触控目标 ≥44px、底部粘性动作条、无固定宽度、`viewport-fit=cover`、reduced-motion 降级。
  （**注意：这一条我只做了 CSS 与结构层面的实现与静态审查，没有真机/浏览器渲染验证，见第 6 节。**）
- 服务端接入层目录自定并写入报告：`web/server/`；密钥只从服务端环境变量读，
  `/api/config` 与 `/api/runs/:id` 的输出实测不含 `api_key`/`Bearer`。
- 未配置/未发布时不静默回退：`GW_MODE=dify` 起实例后请求返回 503 `DIFY_NOT_CONFIGURED` 且零候选。
- 改动边界：只新增 `web/`，未改共享契约与既有代码；未提交、未推送、未部署、未动 Dify 草稿。
- 视觉语言沿用首页：暖白底 `#fafaf9`、近黑 `#111112`、极粗紧字距大标题、黑底白字胶囊按钮、
  细边框白卡、大留白；彩色仅用于状态语义（模拟警示/通过/失败）。

## 6. 未核实（不得读作已完成）

- **浏览器实际渲染**：我没有可用的浏览器自动化，`node --check` 只证明 `app.js` 语法成立。
  首屏排版、窄屏断点、点击流、键盘可达性、`details` 折叠面板、横幅换行——**都未经真实渲染验证**。
  走查链接已给出，需人眼过一遍。
- **真实 Dify 联通**：`web/server/dify.mjs` 按 Dify 官方 `/workflows/run`（blocking）约定编写，
  **从未成功调用过一次**（无凭证、工作流未发布、`DIFY_PUBLISHED_VERIFIED=0`）。
  它的真实请求/响应形状、变量名映射、超时行为都未验证。
- **真实模型输出**：三候选与呈现内容全部是模拟模板；模型是否真能给出三个不同思路、
  事实/推断/未知分离是否成立，均未验证。
- **价格、库存、物流、送达**：无数据源，全为估算，`business_data_verification` 恒 `not_verified`。
- **"约 60 秒完成输入"**：待测目标，**没有做任何真实用户测量**，页面与报告都未宣称达成。
- **规则线回归**：`python workflow/verify_local.py` 与 `python -m unittest discover -s tests -q`
  在我的沙箱里因 `spawn EPERM` / `WinError 5` 跑不起来（环境限制，非代码问题），
  我**没有**亲自复现 46 项探针与 322 项 unittest 的通过结论。
- **多币种、账号、数据库、支付、库存、持久化快照**：未实现（本轮明确后置）。
  任务快照是**进程内存**实现，重启即失效——这是已知限制，不是遗漏。
- **`presentation_json` 契约**：我按 `workflow/workflow-spec.md:138` 的建议结构实现，并新增了两个字段
  （`decorative_advice`、`packaging.material_tags`）来承载"装饰物建议"和"材料参与禁忌复核"。
  这两个字段**尚未进入共享契约**，需 PM 协调后由工作流/数据契约线确认。
- **选择/呈现错误码**：`INVALID_SELECTION`、`CANDIDATE_NOT_PASSED`、`RECOMMENDATION_NOT_FOUND`、
  `PRESENTATION_INVALID`、`TOTAL_MISMATCH`、`REPAIR_LIMIT_REACHED` 在 `workflow-spec.md:166` 被标为
  "代码中不存在（设计预留）"。我在**本接入层新实现**了它们（有真实实现点与测试），
  但这不等于 `validator/rules.py` 已具备这些能力，报告与代码注释都按这个口径写。

---

## 7. 当前进度 / 未完成清单 / 阻塞

### 当前进度（P0 七项逐条）

| # | 任务单要求 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 三步输入表单（关系 8 项/熟悉度/场合/预算/时间；兴趣 12+未知；风格 7+不确定；禁忌三层；进度/返回/可跳过；无需注册） | **已完成** | 2.1 前 22 项单测 + 2.3 冒烟前 17 项 |
| 2 | 三方案对比页（三个不同思路 + 理由/事实/推断/未知/全量费用/准备时间/独立校验结果） | **已完成** | 2.3「推荐返回 200…」至「报告带模拟标识」 |
| 3 | 只允许选通过校验的方案；`selected_candidate_id` 推荐阶段保持 `null` | **已完成** | 2.3 选择门槛 3 项 + 2.1 选择拒绝项 |
| 4 | 选择后才生成四段呈现，顺序固定；复核礼物+包装+贺卡+装饰+配送的费用/时间/禁忌 | **已完成** | 2.3 四段顺序与复核 8 项 |
| 5 | 全局最多一次自动业务修订，跨两阶段合计；计数由服务端可信状态持有 | **已完成** | 2.3 修订额度两种走向 + 2.1 篡改拒绝 |
| 6 | 中文状态页：加载、空、错误、超时、无可选、未选择 | **已完成（代码与接口层）** | 状态机在 `app.js`；超时/空/无可选/错误均有接口级断言。**浏览器渲染未核实** |
| 7 | 最小服务端接入层：安全调用 Dify、持有可信快照与修订计数 | **已完成（mock 路径实测；dify 路径未实测）** | `web/server/`，2.3 密钥检查 + 2.5 真实模式守卫 |
| — | 窄屏基础可操作 | **已实现，未渲染验证** | CSS 层面；见第 6 节第一条 |
| — | 显眼模拟标识 | **已完成** | 2.3「模拟模式标识可见」「报告带模拟标识」 |

**结论：P0 的服务端闭环与接口契约已全部可运行、可复现；缺口集中在"真实渲染验证"与"真实 Dify 联调"两块，
后者受外部条件阻塞，不是我能单方面完成的。**

### 未完成清单（按优先级）

1. **浏览器走查（最优先，成本最低）**：用第 8 节的链接过一遍首屏、三步表单、窄屏（375px）、
   键盘 Tab 顺序、`details` 演示面板、六种状态的视觉效果。我无浏览器工具，这一步必须由人做。
2. **`presentation_json` 两个新增字段交 PM 定契约**：`decorative_advice`、`packaging.material_tags`。
   定稿后工作流线的 P2/P3 节点需同步，否则真实联调时会出现字段分叉。
3. **`workflow/intake.py:47` 错误顺序非确定性**：建议改成有序遍历（`[k for k in data if k not in FIELDS]`）。
   我未改，需工作流线动，PM 协调。
4. **`docs/intake-contract.md` 需要补的两处**（我未改，交 PM）：
   - 未写"追求对象提交在契约未落地时的界面行为"（本层用 `PURSUIT_CONTRACT_NOT_READY` 承载）；
   - 未写 `pursuit` 的**低压力语义边界**（哪些措辞算制造回应压力），目前只有我层的模板判断。
5. **真实 Dify 联调**：等工作流线发布含模型与结束节点的完整工作流 + 产品负责人授权模型与额度
   （`OPEN-5` 仍未关闭）。届时只需配 `DIFY_API_BASE`/`DIFY_API_KEY`/`DIFY_PUBLISHED_VERIFIED=1`，
   前端与接入层不需要改结构。
6. **可信快照持久化**：现在是进程内存，重启丢失（空状态已如实处理）。是否需要落盘/DB 属架构与部署线决定，
   本轮按"避免不必要数据库"的要求刻意不做。
7. **60 秒输入实测**：需要真实试用方法与记录，本轮无用户研究，未做也不宣称。
8. P1 项全部未做（视觉精修、动效、更细可信度、多币种、动态追问）——按任务单后置。

### 阻塞

- **GitHub 不可达**：`web_fetch` 报 `github.com/api.github.com resolves to a non-public IP`，
  `gh` 未认证（我不读任何凭证，也不用 `gh-cred.py`），`git ls-remote` 被沙箱拒绝
  （`cannot create standard input pipe for remote-https: Permission denied`），`curl` 直连 `http=000`。
  我只能读 PM 缓存在 `.tmp/gh/issue{1,3,4}.json` 的正文（抓取时间 10-30 20:24）。
  **Issue #3 的 `updated_at` 是 2026-10-29T11:50:11Z、评论 1 条但正文不含评论**，
  所以我没能读到 PM 说的"正文更正"原文与评论记录。
  处理方式：以**任务单 + `docs/pm-reviews/contract-decisions-draft-2026-10-30.md` +
  `docs/requirements-analysis.md` 第 9 节的决定表**为权威（三者口径一致），
  缓存正文里与 2026-10-30 决定冲突的部分（关系含同事、`partner`=伴侣、兴趣 `unknown` 机器值）一律不采纳。
  **风险**：若 PM 的正文更正里还有这三份文档没记录的新要求，我会漏看。请 PM 直接确认这一点。
- **`pursuit` 落地状态与任务单不一致**：见第 4 节，已按实测处理并保留一行开关，等 PM 裁定以哪一版为准。
- **沙箱限制导致两条既有验证命令跑不了**：`workflow/verify_local.py`、`node --test`（`spawn EPERM`）。
  我已绕开（测试改成直接执行、比对改成三段脚本），但这意味着**我没能亲自复现规则线的 46/322 结论**。
- **模型与额度未授权（`OPEN-5`）**：真实推荐接口在本轮客观上不存在，只能用模拟数据开发，已显眼标注。
  ⚠️ 但发布前提已在 23:04 由工作流线达成，且我发现**出参约定不一致**与**修订额度可能双重消耗**
  两个流程风险，详见本节末「🔴 联调前的流程风险」与 [HANDOFF-2026-10-30.md](./HANDOFF-2026-10-30.md) 第 6 节。
- **~~无浏览器自动化工具~~（本节第 9 节已推翻）**：前端渲染与窄屏可操作**已在真实 Chromium 中自查**，
  并因此发现一个既有致命 bug；详见第 9 节与 [HANDOFF-2026-10-30.md](./HANDOFF-2026-10-30.md)。

### 🔴 联调前的流程风险（23:05 后读到他人证据，未花任何调用额度）

工作流线已于 2026-10-30 23:04:23 **发布** Dify 工作流（`appId 5abdb13c-a633-4a9c-96c3-dabd44072511`、
11 节点、`nodeTypes start,code,llm,code,if-else,llm,code,code,code,end,end`、`hasPublishedLabel=True`）。
我只读了他们的证据文件，**没有**发起真实调用，也没读任何凭证。

但**出参约定与我的接入层不一致**，照现状联调必然失败：Dify 的 End 出参是
`report_json` / `report_text`（未修订）与 `revised_report_json` / `revised_report_text`（已修订），
而 `web/server/dify.mjs` 读的是 `candidates_json` / `presentation_json`。
更需要 PM 拍板的是：**Dify 内部已有 `if-else` + revised 分支，即修订可能发生在工作流内部，
而接入层也持有"全局最多 1 次自动业务修订"的可信计数——两边各自修订一次就会合计 2 次，违反契约。**
额度的唯一持有者必须是单边。三点详细分析见 [HANDOFF-2026-10-30.md](./HANDOFF-2026-10-30.md) 第 6 节。


---

## 8. 走查入口

- 服务已用当前代码启动在 **http://127.0.0.1:8787**（后台运行中；停止请说一声）。
- 建议顺序：首屏 → 填三步（选「追求对象」看独立文案）→ 三方案对比 → 选一个 → 看四段呈现与复核。
- 想看异常路径，用页面底部「演示开关」或地址栏：
  `?demo=partial_fail`（部分通过、失败项不可选）、`?demo=model_error`（错误态零可选）、
  `?demo=presentation_over_budget`（呈现阶段用掉唯一修订）、`?demo=slow`（超时状态）。
- 想看「契约未落地」那一态：`GW_PORT=8788 GW_PURSUIT_CONTRACT_READY=0 node web/server/server.mjs`。

---

## 9. 当前进度 / 未完成清单 / 阻塞（2026-10-30 深夜收尾，前端工作转交）

> 最后一次更新。浏览器自查的**剩余修复工作转交其他子 Agent**，此处如实记录交接点。
> 逐条细节（含建议改法与脚本误报清单）见 [HANDOFF-2026-10-30.md](./HANDOFF-2026-10-30.md)。

### 进度变化

- 第 6 节"未核实"里的**「浏览器实际渲染」已补上**：用真实 `Chrome/156.0.8078.79` 经 CDP 驱动
  （`web/tools/browser-check.mjs`，零依赖，Node 24 内置 WebSocket），6 场景 / 100 项检查 / 13 类截图，
  三种视口 1280×900、390×844、320×640。
- 因此发现并**修复一个既有致命 bug**：`bootstrap()` 在 `state.config` 仍为 `null` 时就 `render()`，
  `renderStep1()` 解引用 `config.labels` 抛 `TypeError`，导致事件绑定与 `/api/config` 请求全部不执行，
  **首屏完全点不动**。真实栈：

  ```text
  TypeError: Cannot read properties of null (reading 'labels')
      at renderStep1 (app.js:218)  at render (app.js:1163)  at bootstrap (app.js:1218)
  readyState: complete / #badges 子节点: 0 / #view 子节点: 0 / #mode-flag hidden: true
  ```

  修复：`render()` 在配置未就位时渲染中文等待态 `renderWaiting()`；`bootstrap()` 改为
  先绑事件 → 再渲染 → 再取配置。修复后实测 `#view` 5 个子节点、`#mode-flag` 可见、页面异常 0 条。
- **这条自我修正很重要**：第 2.1 节"40 项单测全通过"与 2.3 节"59 项冒烟全通过"并没有覆盖这一层。
  单测与 HTTP 冒烟都是服务端视角，前端首帧崩溃只有真实浏览器能抓到。
  此前那张首屏截图步骤条下方是空白，我误判成"landing 主动隐藏了表单"，其实是崩溃。
- 新增能力：吸顶常驻模拟标识 `#mode-flag`、首屏数据来源说明 `#hero-flag`（三种视口均实测可见）；
  服务端新增 `?demo=stress` 压力演示（超长中文 + emoji + 不可断行长 URL），已验证不污染业务校验路径。
  动机：上一版模拟数据横幅位于 hero/how **之后**，首屏看不见，评委容易误判为已联通真实模型。

### 未完成清单（交接给下一个 Agent）

浏览器自查 100 项检查中 **32 项 FAIL**，分类与状态：

| # | 问题 | 状态 |
| --- | --- | --- |
| 1 | 首屏 `TypeError` 致页面不可交互 | **已修并已验证** |
| 2 | 真实逐字输入丢焦点、丢字符（`value=1 focused=false`） | 改动已落盘（`captureFocus`/`restoreFocus` + 五字段 `data-field`），**未重跑验证** |
| 3 | 320px 头部挤爆，连带 `.actions` 拉到 414px | 改动已落盘（`flex-wrap: wrap`、`.brand{min-height:44px}`），**未重跑验证** |
| 4 | 不可断行长串撑破 `.kv dd` / `.list li`（390 视口被撑到 790px） | **未修**，根因已定位，建议 `overflow-wrap: anywhere` |
| 5 | 触控目标 <44px（`.site-nav a` 23px、头部 `.btn--sm` 42px） | **未修** |
| 6 | 超时状态断言未通过 | **未定位**；很可能是断言文案写错而非页面缺陷 |
| 7 | 性能基线只有首屏 4 请求 / ~71KB / 零外部依赖 | 接口延迟分布、服务端内存、FCP/LCP **全部空白** |
| 8 | 截图的人眼视觉效果 | 脚本只能量化溢出与尺寸，**需要人看** |

另有 4 条**自查脚本自身已知误报**（`a.skip-link` 的 `-9999px` 无障碍定位被判溢出、呈现页
`not_verified` 字面断言写错、`maxTouchPoints` 不能为 0、复用调试端口需关 HTTP 缓存），
已写进交接文件第 3 节，避免接手者去修页面里本来没坏的东西。

**结论：P0 的服务端闭环仍然成立（40 项单测 0 失败、59 项冒烟 0 失败）；
前端首次达到"真的可交互"，但窄屏与长文本破版、输入焦点、性能基线四项未完成，已交接。**

### 阻塞（未变，且不由我单方面解除）

- **真实模型调用上限 10 次已用满（总上限 16）**：未获 PM 明确授权前不触发任何真实调用。
  本轮**没有**发起过真实调用，`web/server/dify.mjs` 至今从未成功调用过一次。
  就绪清单：环境变量 `DIFY_API_BASE` / `DIFY_API_KEY`（只在服务端）/ `DIFY_PUBLISHED_VERIFIED=1` /
  `GW_MODE=dify` / `GW_PURSUIT_CONTRACT_READY`。
  ⚠️ **本节早前写的"Dify 侧需补模型与结束节点并发布"已过时**：工作流线在 23:04:23 已发布
  （11 节点、2 个 LLM、2 个 End、`hasPublishedLabel=True`，我只读了他们的证据文件，未发起调用）。
  现在的阻塞不再是"未发布"，而是**两个需要 PM 拍板的契约分歧**：
  ① 出参名不一致（Dify 用 `report_json` / `revised_report_json`，我的 `dify.mjs` 读 `candidates_json` / `presentation_json`）；
  ② **全局修订额度可能双重消耗**（Dify 内部已有 `if-else` + revised 分支，接入层也持有 1 次额度）。
  详细分析见第 7 节末「🔴 联调前的流程风险」与 [HANDOFF-2026-10-30.md](./HANDOFF-2026-10-30.md) 第 6 节。
  `cloud_verified` 此前为 `false`、`OPEN-5` 未关闭。额度获批后接入层**不需要改结构**，预计 30 分钟内跑通第一轮。
- **GitHub 仍不可达**：Issue #3 的"正文更正"原文与其 1 条评论始终没读到，
  以任务单 + `docs/pm-reviews/contract-decisions-draft-2026-10-30.md` + `docs/requirements-analysis.md` 为权威。
- `pursuit` 落地状态与任务单假设不一致（实测已落地但**未提交**，HEAD=89d6624），待 PM 裁定；两态都已实现并测过。
- 沙箱限制：`node --test` 与 `python workflow/verify_local.py` 因 `spawn EPERM` 跑不起来，
  未亲自复现规则线 46 项探针 / 322 项 unittest 的结论。

### 边界与 git 状态

**未执行任何 git 分支操作**（无 checkout / switch / branch / merge / rebase / push），**也未提交**——
按用户指示，提交与 PR 统一由 PM 处理，改动全部留在工作区。
只新增/修改 `web/` 下文件；`docs/`、`workflow/`、`validator/`、`tests/`、`deploy/`、`AGENTS.md`
与共享契约 `docs/intake-contract.md` 均未触碰。工作区其他目录的近期变动属其他线并发写入。

