# GiftWise AI

帮助青年用户从"不知道送什么"走到"知道为什么选、怎么送"的 **AI 礼赠决策助手**。

面向初入社会的青年，**关系场景优先级：恋人、追求对象（最高）→ 朋友 → 其他**。
恋人与追求对象是**两个独立关系值**（`partner` / `pursuit`），独立提示与独立文案；**追求关系不假定已恋爱、不假定双向好感**。
**同事已完全移出产品场景**（不出现在界面、导航、演示脚本与验收案例中），仅作为技术回归夹具保留 `colleague` 机器值。

网站与文档默认**简体中文**；机器字段、错误代码、库名与技术标识符保留原标识。

> **项目状态：开发中，核心业务闭环尚未完成。**
> 当前**真实可运行**的是：确定性规则校验器（Python）、本地测试套件、`.env.example` 之外的零第三方依赖服务、以及一个**模拟数据模式**的中文接入层页面。
> **完整业务工作流、真实模型调用、真实商品数据、前端正式验收与云部署都尚未完成**——见[真实能力](#真实能力已核实)与[未完成清单](#未完成清单)。

## 版本与快照

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/sunnyyang0822-stack/GiftWise-AI |
| 本文对应的本地 HEAD | `89d662483febbb90ab7fd579e05052b309700b91`（`89d6624`，2026-10-30 20:07:58 +0800） |
| 分支状态 | 本地 `main` 领先 `origin/main` **3 个提交**（`8e8bc27`、`b2ea08a`、`89d6624`），**未推送** |
| 工作区状态 | **存在未提交改动**（截至 2026-10-30 21:20 有 38 项 `M`/`??`），含 `workflow/labels.py` 的 `pursuit` 落地 |

**提交材料时必须同时给出对应的代码快照或版本号**（评分规则 1.4）；现场若使用与提交版本不同的代码、模型或配置，必须主动说明。
上表只能说明"撰写本文时的本地状态"，**不代表已提交、已推送或已被验收**。

## 快速开始

### 环境要求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Python | **3.12**（实测 3.12.12） | 校验器、工作流适配、部署服务、全部测试 |
| Node.js | **≥ 18**（实测 v24.21.0） | 仅前端接入层与页面需要 |
| 操作系统 | Windows / Linux / macOS | 本地实测于 Windows |
| 第三方依赖 | **无** | `validator/`、`workflow/`、`deploy/` 只用 Python 标准库；`web/` 只用 Node 内置模块（`web/package.json` 的 `dependencies` 为空） |

无需 `pip install`、无需 `npm install`；仓库内**不含**任何密钥。

### 运行 1：本地测试（真实、离线、不调用模型）

```bash
python -m unittest discover -s tests -q                        # 322 项
python -m unittest discover -s tests/acceptance/stage_c -q      # 39 项（阶段 C 独立套件）
python tests/acceptance/stage_c/run_verify_local_nopipe.py      # 46 项离线探针
```

已实测结果（2026-10-30）：

```text
Ran 322 tests in 0.163s        OK
Ran 39 tests in 0.126s         OK
local probes: 46 passed; 0 failed; model calls: 0; cloud verified: false
```

`workflow/verify_local.py` 是同一组 46 项探针的原始入口；它会**重写**自己的证据文件 `workflow/evidence/local-2026-10-29/results.json`（既定行为）。在禁止匿名管道的受限环境中它会因采集 `platform`/`git` 信息而在探针跑完后抛 `PermissionError`（已知缺陷 D-4），此时改用上面的 `run_verify_local_nopipe.py`。

### 运行 2：确定性规则校验 API（真实可用）

```bash
# 正确启动方式（在仓库根目录执行）
python -m deploy.server          # 默认监听 0.0.0.0:8000
# 可用环境变量调整：GIFTWISE_BIND=127.0.0.1 GIFTWISE_PORT=8001

curl -sS http://127.0.0.1:8000/healthz
curl -sS http://127.0.0.1:8000/          # 端点清单
```

> **注意**：`deploy/README.md` 里写的 `python deploy/server.py` 在当前仓库状态下**会失败**（`ModuleNotFoundError: No module named 'validator'`，因为脚本以文件方式运行时 `sys.path[0]` 是 `deploy/`）。
> 请使用 **`python -m deploy.server`**，或 `PYTHONPATH=. python deploy/server.py`。`deploy/Dockerfile` 的 `CMD` 已是正确形式（`python -m deploy.server`）。该文档缺陷已登记，待 PM 指派修复。

`POST /validate` 接收两个 JSON **字符串**：

```json
{"request_json": "{...intake-v1 请求...}", "candidates_json": "{...候选批次...}"}
```

实测（真实运行）：合规候选 → `all_passed: true`；把首项金额改成 `250.00`（预算上限 200.00）→ `OVER_BUDGET`、`all_passed: false`；非法 JSON → `400 INVALID_JSON`（不回显输入、不泄露堆栈）；未知路径 → `404`。
`/healthz` 返回 `rules_source_sha256`（本版本为 `4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3`），可用于确认现场运行的就是提交版本。

### 运行 3：中文接入层页面（**模拟数据模式**）

```bash
GW_MODE=mock GW_PORT=8787 node web/server/server.mjs
# 浏览器打开 http://127.0.0.1:8787
```

- 页面顶部与响应中**常驻模拟标识**：候选方案与呈现内容都是接入层内置的**固定模拟数据**，**不是模型输出**，也**没有联通 Dify**。
- 该层自带开发自测（**属开发自测，不是独立验收**）：
  ```bash
  cd web && node tests/access-layer.test.mjs   # 40 项通过 / 0 失败
  cd web && node tools/parity-check.mjs        # JS↔Python 语义比对 55 组样例，0 处差异
  ```
- **该层尚未交付独立验收**（`web/` 属在飞工作），见[未完成清单](#未完成清单)。

### 运行 4：Docker（**未验证**）

`deploy/Dockerfile` 已存在（`python:3.12-slim`、非 root 用户、`HEALTHCHECK`、`CMD ["python","-m","deploy.server"]`），但**本轮未构建、未运行任何容器**，也未做云部署。因此：

```bash
# 仅作参考，未经实测
docker build -t giftwise-validator -f deploy/Dockerfile .
docker run --rm -p 8000:8000 giftwise-validator
```

## 复现命令总表

| 目标 | 命令 | 实测结果（2026-10-30） |
| --- | --- | --- |
| 推荐阶段单元测试 | `python -m unittest discover -s tests -q` | `Ran 322 tests` / `OK` |
| 阶段 C 独立套件 | `python -m unittest discover -s tests/acceptance/stage_c -q` | `Ran 39 tests` / `OK` |
| 46 项离线探针 | `python tests/acceptance/stage_c/run_verify_local_nopipe.py` | `46 passed; 0 failed; model calls: 0; cloud verified: false` |
| 阶段 B 契约套件 | `python tests/acceptance/stage_b/run_acceptance.py` | 生成新证据目录（历史：260 项） |
| 规则 API | `python -m deploy.server` | `/healthz` 200 |
| 前端接入层自测 | `cd web && node tests/access-layer.test.mjs` | `pass 40 / fail 0` |
| JS↔Python 语义比对 | `cd web && node tools/parity-check.mjs` | 55 组样例，0 处语义差异 |
| 真实 Dify 复核（需浏览器会话，**不会发布草稿**） | `node tests/acceptance/stage_c/dify-qa-runner.cjs tests/acceptance/stage_c/qa-steps-run2.json` | 见 `workflow/evidence/WF-002-2026-10-30.md`、`docs/test-reports/stage-c/` |

以上命令**只证明本地规则、固定快照与接入层模拟链路**；**不能**证明完整 Dify 工作流、真实模型调用、成本延迟或云部署。

## 目录结构

```text
giftwise/
├── validator/            # 确定性规则校验器（纯标准库，不含模型）
│   └── rules.py          #   validate(request_json, candidates_json)
├── workflow/             # Dify 侧适配、节点生成与证据
│   ├── intake.py         #   表单 → intake-v1 请求的确定性适配
│   ├── labels.py         #   关系/熟悉度/场合/兴趣等标签表（含 pursuit/partner）
│   ├── runtime.py        #   check / recheck / report / main 编排
│   ├── build_code_node.py#   由同一份规则生成 Dify Code 节点源码
│   ├── generated/        #   生成的 5 个节点源码 + manifest.json（哈希清单）
│   ├── prompts/          #   generate.md / repair.md
│   ├── examples/         #   示例 intake 与候选（含同事技术回归样例）
│   └── evidence/         #   真实运行证据（WF-001/002/003 等）
├── deploy/               # 最小确定性校验 API（本地可运行；云部署未开始）
│   ├── server.py         #   仅暴露 /healthz 与 /validate
│   ├── Dockerfile        #   未经构建验证
│   └── publish-to-uhost.ps1  # UCloud 发布脚本（未执行）
├── web/                  # 中文接入层（mock 为默认模式；未交付验收）
│   ├── public/           #   index.html / styles.css / app.js
│   ├── server/           #   server.mjs + config/labels/intake/pipeline/store/checker/mock-model
│   ├── tests/            #   接入层开发自测
│   └── tools/            #   JS↔Python 语义比对与夹具生成
├── tests/                # 单元测试与分阶段验收套件
│   ├── test_validator.py #   规则开发自测
│   ├── test_cases.json
│   └── acceptance/       #   stage-a / stage_b / stage_c
├── docs/                 # 需求、定位、架构、流程、测试报告与竞赛材料
│   ├── competition/      #   赛道 B 材料（评分规则、PPT 骨架、架构图、材料清单）
│   ├── test-reports/     #   分阶段真实测试报告与证据
│   └── pm-reviews/       #   PM 验收与契约决定
├── AGENTS.md             # 协作规范（开工前必读）
├── .env.example          # 仅示意变量名；无程序读取，不会启动任何服务
└── Giftwise.ifpkg        # 原始 Dify 导出（本地保留，已被 .gitignore 排除）
```

`workflow/tools/` 存放本地浏览器自动化脚本与被 `.gitignore` 排除的产物（含 Dify 专用浏览器配置目录，**不进入 git**）。

## 真实能力（已核实）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 推荐阶段确定性规则校验（预算、币种、禁忌、必要字段、准备时间） | **已实现并通过离线验收** | 46 项探针、322 项单测 `OK` |
| 关系枚举与 `pursuit`（追求对象）独立机器值，与 `partner`（恋人）互斥 | **已落地（工作区未提交改动）** | `workflow/labels.py`；`parity-check` 55 组一致 |
| 全局最多一次业务修订与"已通过项不可改"保护 | **已实现（离线/模拟层）** | 阶段 C 套件 39 项；`web/` 自测 40 项 |
| 失败不伪装为完成（失败项不可选、无可选项） | **已实现（离线/模拟层）** | 超预算与损坏 JSON 实测为失败态 |
| 前端中文交互链路（三方案→选择→四段呈现） | **可在 mock 模式运行** | 实测三候选 × 2 轮均 `completed`、四段齐全；**模拟数据** |
| 追求对象与恋人文案差异（贺卡、装饰、话术、关系提示） | **在 mock 层实测不同** | 追求对象：不用玫瑰、"别有负担"、"不暗示双方已确定关系"；恋人：可表达亲密、允许花材 |
| 真实 Dify Cloud 沙箱 Code 节点执行 | **已成功（0 Tokens）** | `workflow/evidence/WF-002-2026-10-30.md`、`docs/test-reports/stage-c/` |
| 规则 API 本地运行 | **可运行** | `python -m deploy.server` → `/healthz` 200 |
| 证据哈希可追溯 | **已实现** | `workflow/generated/manifest.json` 的 5 个 `artifacts_sha256` 与实际文件逐一匹配 |

## 未完成清单

**核心业务闭环**

- [ ] **完整 Dify 业务工作流端到端运行**：草稿当前只有 `开始 → 代码执行` 2 节点 1 边、**无结束节点**，N1–N7 未接线。
- [ ] **Dify 草稿发布**：`tool_published: false`，页面持续显示「未发布」。**未上线、未部署。**
- [ ] **真实模型调用**：至今 **0 次调用、0 Tokens**（供应商未授权，OPEN-5）；无真实三候选、无真实一次修订轨迹、无真实持续失败路径。
- [ ] **真实商品数据**：价格、库存、物流**完全没有**；现有金额与准备时间**只是估算**。
- [ ] **成本、延迟与用量基线**：**无实测**。探针耗时（0.079s–0.462s）是**无模型探针**的抖动值，**不可当作业务延迟**。
- [ ] **约 60 秒完成输入**的目标：**无真实用户测量**。

**前端与部署**

- [ ] **前端正式验收（WEB-001）**：`web/` 属在飞工作，只有开发自测与一次有界预备冒烟（14/14），**未交付独立验收**；页面数据为模拟。
- [ ] **E2E 与页面中文状态清单**（加载、空状态、错误、超时、无可选方案、未选择）未逐项验收。
- [ ] **云部署**：`CLOUD-001` 未开始；`deploy/` **无归属任务单、无验收记录**；Docker 镜像未构建；UCloud 未开通、未付费、未部署。
- [ ] **可导入的 Dify DSL**：`workflow/generated/*.py` 是 Python 源码（`format: python-source-not-dsl`），**不是 DSL**，未导入。

**可观测性与工程化**

- [ ] **平台级调用轨迹**：Dify 租户**未启用 trace 采集**（`status: not_collected`），无法提供平台级节点追踪。
- [ ] 可观测性验收项（运行 ID、候选版本、校验输出、修订计数、错误、调用记录）尚未收编进验收标准（缺口 G-2）。
- [ ] 独立成文的「异常处理说明」（工具失败、模型输出异常、超时、重试、状态恢复、人工介入）尚未成文（缺口 G-3）。

**已知缺陷（已登记，本轮未修）**

| 编号 | 缺陷 | 影响 | 归属 |
| --- | --- | --- | --- |
| D-1（原） | `docs/demo-script.md` 首场景原为"同事" | **已由本轮 DEMO-001 修复**：改为追求对象/恋人 | 发布线（已处理） |
| D-2 | `deploy/` 无任务单、无验收，却含可执行发布脚本 | 无人负责的可执行产物 | PM（阶段 6） |
| D-4 | `workflow/verify_local.py` 受限环境下崩溃且不打印汇总 | 复核者可能误判为探针失败 | 工作流线 |
| **新增 D-7** | `deploy/README.md` 的 `python deploy/server.py` 实际报 `ModuleNotFoundError` | 现场按文档启动会失败 | 部署/PM（阶段 6） |
| **新增 D-8** | `web/` 在飞编辑期间，`/api/presentations` 曾于 21:19 对三个候选全部返回 `500 INTERNAL_ERROR`，21:20 复测恢复正常（`pipeline.mjs` 于 21:19:31 被改动） | 现场依赖该路径存在**瞬时不稳**风险，须在冻结版本上重新验证 | 前端线 |

## 技术栈与选型

| 技术 | 用途 | 实际状态 | 选型理由 |
| --- | --- | --- | --- |
| Python 3.12（标准库） | 确定性规则校验 | **已实现并验收** | 规则必须独立于模型；零依赖便于复现与二次复验 |
| Dify（Cloud 1.18.0） | 模型编排与 Code 节点 | **草稿未发布**；仅 Code 探针真实执行过 | 平台承担编排与节点调度，减少自建工作流框架的工程量 |
| Node.js（内置模块） | 中文页面与薄接入层 | mock 模式可运行；**未验收** | 零依赖、进程内即可演示；密钥只在服务端 |
| 薄服务端接入层 | 保管凭证、维护可信任务状态 | 已实现（mock） | 不把 API Key 放浏览器；不信任浏览器传来的 `passed` |
| Docker | 可复现打包 | **未构建** | 只在赛题强制或确有需要时采用 |
| UCloud | 托管校验 API | **未开通、未部署** | 资源与费用未确认，不虚构要求 |

**为什么是这个架构**：把"模型生成"和"硬约束校验"分开——模型可以产出有依据的建议，但预算、币种、禁忌、字段、准备时间由**独立代码**判定；校验失败项不可选，且跨两阶段合计最多一次自动修订。状态留在服务端，浏览器只提交输入与选择，避免篡改。

**当前架构的边界**：这是**单机、无数据库、无账号**的最小实现；未做弹性伸缩、分布式状态或故障恢复演练。"云原生"部分目前**只有 Dockerfile 与设计**，没有实测证据。

## 限制声明

1. 本项目**未部署**，没有在线体验地址；Dify 草稿**未发布**。
2. **没有真实模型调用与真实商品数据**；所有价格、准备时间、库存、物流均为**估算或固定模拟数据**，未经核实。
3. **不承诺对方一定喜欢**；关系适配只是降低风险的建议。
4. 追求对象场景**默认低压力**，不假定双向好感、不暗示关系已确定、不制造回应压力。
5. 前端页面当前使用**标记清楚的模拟数据**，**不能**当作模型闭环或规则闭环的证明。
6. 本地探针与单元测试**只证明本地规则与固定快照路径**，不证明云端、模型或部署。
7. 评分规则中"是否强制容器/Kubernetes、是否允许托管 Dify 与外部模型、UCloud 额度、准确截止时间"等要求**仍待向主办方核实**；本仓库不编造要求。
8. **同事案例仅作技术回归**，不代表产品场景。

## 安全与隐私

- 不提交密钥、Token、密码或未经授权的敏感数据；`.gitignore` 已排除 `.env*`、`*.pem`、`*.key`、`credentials*.json`、`*.ifpkg`。
- API Key 只放在**可信服务端**或平台配置中；**不放前端、不进提示词、不进日志、不进截图**。
- 公开材料只使用**虚构人物与已脱敏数据**。
- `deploy/server.py` 不保存请求内容、不写请求体到日志；错误响应不回显输入、不泄露堆栈。

## 文档导航

| 文件 | 用途 |
| --- | --- |
| [产品定位 Issue #1](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/1) | **定位唯一权威来源** |
| [协作规范](AGENTS.md) | 开工前必读 |
| [产品需求](docs/product-requirements.md) / [用户故事](docs/user-stories.md) / [产品流程](docs/product-flow.md) | 范围与体验 |
| [需求分析（阶段 1 冻结）](docs/requirements-analysis.md) | 成功标准 SC-1…SC-9、未决项 OPEN-1…OPEN-9 |
| [验收标准](docs/acceptance-criteria.md) | P0 与场景验收项 |
| [技术架构](docs/architecture.md) | 最小架构、信任边界与条件性云部署 |
| [工作流规范](workflow/workflow-spec.md) | 节点与数据契约 |
| [开发流程](docs/development-process.md) | 四线并行、文件归属与任务状态 |
| [测试计划](docs/test-plan.md) | 用例、指标与真实结果记录方式 |
| [阶段 C 独立复核报告](docs/test-reports/stage-c/acceptance-2026-10-30.md) | Dify Code 节点与契约缺口的真实证据 |
| [WF-002 真实 Dify 验证记录](workflow/evidence/WF-002-2026-10-30.md) | 沙箱执行、0 Tokens、自动保存风险 |
| [现场 Demo 脚本](docs/demo-script.md) | 3 分钟现场演示与备用录屏计划 |
| [竞赛材料](docs/competition/) | 评分规则原文、PPT 骨架、架构图、材料清单与自查 |

## 协作与提交约束

开发自测后报告**实际命令、真实输出、修改文件、限制与阻塞**；测试验收独立复核，**不以开发声明代替证据**。
不伪造功能、测试、价格、库存、物流、模型或部署状态；**不自行提交、推送、发布 Dify 草稿或采购云资源**。
提交截止：**2026-11-01（周日）10:30（北京时间）**；现场：汇报 5 分钟、Demo 3 分钟、问答 7 分钟。
