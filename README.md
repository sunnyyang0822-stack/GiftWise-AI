# GiftWise AI

帮助青年用户从"不知道送什么"走到"知道为什么选、怎么送"的 **AI 礼赠决策助手**。

面向初入社会的青年，**关系场景优先级：恋人、追求对象（最高）→ 朋友 → 其他**。
恋人与追求对象是**两个独立关系值**（`partner` / `pursuit`），独立提示与独立文案；**追求关系不假定已恋爱、不假定双向好感**。
**同事已完全移出产品场景**（不出现在界面、导航、演示脚本与验收案例中），仅作为技术回归夹具保留 `colleague` 机器值。

网站与文档默认**简体中文**；机器字段、错误代码、库名与技术标识符保留原标识。

## ⚠️ 评委复现前必读：克隆**必须带 `-b`**

```bash
git clone -b release/2026-11-01-submission https://github.com/sunnyyang0822-stack/GiftWise-AI.git
cd GiftWise-AI
```

- **评委应使用的确切 ref 是 `release/2026-11-01-submission`**：本文档和 [`docs/verification/复核指南-2026-10-31.md`](docs/verification/复核指南-2026-10-31.md) 里的 `python tools/verify_all.py`、`node web/tools/*.mjs`、`docs/verification/**` 命令**都以它为准**。
- **⚠️ 默认分支可能不含 `tools/verify_all.py` 与 `docs/verification/**`，请务必带上 `-b`。** 不带 `-b` 会克隆到默认分支，照本文敲 `python tools/verify_all.py` 会直接报「找不到文件」。
- 该分支由 PM 在收口时推送为**含全部工具链**的状态：届时仓库约 **1820** 个文件，`tools/` 与 `docs/verification/` 均非空。本节**不声称**该分支是默认分支，也**不引用任何 tag**。
- （兜底）若克隆后 `tools/verify_all.py` 仍不存在，说明收口推送尚未完成：可改用 `-b snapshot/night-2026-10-31-v2`（快照，含全部工具链，但文档是该时间点的旧版），或直接向产品负责人索取含工具链的提交。

> **项目状态：开发中，核心业务闭环尚未完成。**
> 当前**真实可运行**的是：确定性规则校验器（Python）、本地测试套件、`.env.example` 之外的零第三方依赖服务、以及一个**模拟数据模式**的中文接入层页面。
> **仍未完成**：真实商品数据、前端正式验收、包装／配色／贺卡呈现阶段、云部署（**从未发生**）——见[真实能力](#真实能力已核实)与[未完成清单](#未完成清单)。
> 已完成并可复核：**真实 Dify 工作流（已发布并创建版本）**、**累计 13 次真实模型调用 / 38,326 tokens**、**本机容器实测 14 项通过**。

## 版本与快照

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/sunnyyang0822-stack/GiftWise-AI |
| 本文对应的本地 HEAD | `ae0ea580006c3bc90f6ddeec57abe02732446edd`（`ae0ea58`，当前工作分支 `release/2026-11-01-submission`） |
| 主分支状态 | `origin/main == main == 37493f9`，**领先 0 个提交**（原 OPEN-8 残留已消解）；origin 上另有 **8 条 `line/*` 快照分支** |
| 工作区状态 | **存在未提交改动**（多线并行写入；更新本文时 `git status --porcelain` 为 129 项） |
| 复核工具链（`tools/`、`docs/verification/`）在哪个 ref | **2026-10-31 02:2x 实测**：`origin/main` 268 个文件、`origin/release/2026-11-01-submission` 281 个文件，**两者的 `tools/` 与 `docs/verification/` 都还是空的**；只有 `origin/snapshot/night-2026-10-31-v2`（1698 个文件）含全部工具链。评审请以**收口推送后**的 `release/2026-11-01-submission`（届时约 1820 个文件）为准，见文首「评委复现前必读」一节 |

**提交材料时必须同时给出对应的代码快照或版本号**（评分规则 1.4）；现场若使用与提交版本不同的代码、模型或配置，必须主动说明。
上表说明**撰写本文时的本地状态**：`main` 已与 `origin/main` 同步并推送；`release/2026-11-01-submission` 分支亦已推送（本机另有未推送提交）。**工作区的未提交改动不等于已验收**。

## 快速开始

### 环境要求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Python | **3.12**（实测 3.12.12） | 校验器、工作流适配、部署服务、全部测试 |
| Node.js | **≥ 18**（实测 v24.21.0） | 仅前端接入层与页面需要 |
| 操作系统 | Windows / Linux / macOS | 本地实测于 Windows |
| 第三方依赖 | **无** | `validator/`、`workflow/`、`deploy/` 只用 Python 标准库；`web/` 只用 Node 内置模块（`web/package.json` 的 `dependencies` 为空） |

**评委复核路径**无需 `pip install`、无需 `npm install`（`validator/`、`workflow/`、`deploy/` 只用 Python 标准库；`web/` 只用 Node 内置模块，`web/package.json` 的 `dependencies` 为空）；仓库内**不含**任何密钥。

> 唯一的例外是**「仅内部复现」**的 Dify 浏览器脚本（见下文"仅内部复现"小节）：它硬依赖本地 `workflow/tools/node_modules/playwright-core`，而 `workflow/tools/**` **被 `.gitignore` 整体排除**，所以**干净克隆里必然报 `Error: Cannot find module`**。该路径**不属于**评委复核路径，不需要、也不应该为它执行 `npm install`。

### 运行 1：本地测试（真实、离线、不调用模型）

```bash
python -m unittest discover -s tests -q                        # 329 项
python -m unittest discover -s tests/acceptance/stage_c -q      # 39 项（阶段 C 独立套件）
python tests/acceptance/stage_c/run_verify_local_nopipe.py      # 46 项离线探针
```

> ⚠️ **上面三条都必须在带 `.git` 的 `git clone` 目录里跑**（不要用 zip／网页下载解压的目录）：第 3 条跑完 46 项后，`workflow/verify_local.py:189` 会**无条件**采集 `git rev-parse HEAD`；在没有 `.git` 的导出目录里会抛 `subprocess.CalledProcessError: … returned non-zero exit status 128`（2026-10-31 实测复现；这不是探针失败，但当场会以异常收场）。

已实测结果（**2026-10-31 02:0x 复跑**）：

```text
Ran 329 tests in ~0.2s         OK      # 2026-10-31 复跑多次，实测时长约 0.2–0.3 s；原 322 为 10-30 时点值
Ran 39 tests in 0.118s         OK
local probes: 46 passed; 0 failed; model calls: 0; cloud verified: false
```

> **时点说明**：`322` 是 2026-10-30 的真实值（当时尚未新增请求侧范围校验）；**当前真值为 329**。历史证据文件不改写。

`workflow/verify_local.py` 是同一组 46 项探针的原始入口；它会**重写**自己的证据文件 `workflow/evidence/local-2026-10-29/results.json`（既定行为）。在禁止匿名管道的受限环境中它会因采集 `platform`/`git` 信息而在探针跑完后抛 `PermissionError`（已知缺陷 D-4），此时改用上面的 `run_verify_local_nopipe.py`。

### 运行 2：确定性规则校验 API（真实可用）

```bash
# 正确启动方式（在仓库根目录执行）
python -m deploy.server          # 默认监听 0.0.0.0:8000
# 可用环境变量调整：GIFTWISE_BIND=127.0.0.1 GIFTWISE_PORT=8001

curl -sS http://127.0.0.1:8000/healthz
curl -sS http://127.0.0.1:8000/          # 端点清单
```

> **注意**：以**文件方式**运行 `python deploy/server.py` 会失败（实测 rc=1，`ModuleNotFoundError: No module named 'validator'`，因为此时 `sys.path[0]` 是 `deploy/`）。
> 请使用 **`python -m deploy.server`**，或 `PYTHONPATH=. python deploy/server.py`。`deploy/Dockerfile` 的 `CMD` 与 `deploy/README.md` 的启动命令**都已是**正确形式（2026-10-31 逐条核对）：该文档缺陷 **D-7 已闭合**，原文的「待 PM 指派修复」不再成立。

`POST /validate` 接收两个 JSON **字符串**：

```json
{"request_json": "{...intake-v1 请求...}", "candidates_json": "{...候选批次...}"}
```

实测（真实运行）：合规候选 → `all_passed: true`；把首项金额改成 `250.00`（预算上限 200.00）→ `OVER_BUDGET`、`all_passed: false`；非法 JSON → `400 INVALID_JSON`（不回显输入、不泄露堆栈）；未知路径 → `404`。
`/healthz` 返回 `rules_source_sha256`（本版本为 `1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500`），可用于确认现场运行的就是提交版本。

### 运行 3：中文接入层页面（**模拟数据模式**）

```bash
GW_MODE=mock GW_PORT=8787 node web/server/server.mjs
# 浏览器打开 http://127.0.0.1:8787
```

- 页面顶部与响应中**常驻模拟标识**：候选方案与呈现内容都是接入层内置的**固定模拟数据**，**不是模型输出**，也**没有联通 Dify**。
- 该层自带开发自测（**属开发自测，不是独立验收**）：
  ```bash
  cd web && node tests/access-layer.test.mjs   # 40 项通过 / 0 失败
  cd web && node tools/parity-check.mjs        # JS↔Python 语义比对 74 组样例，0 处语义差异（**样例级**，见下）
  ```
- **浏览器自查**（`node web/tools/browser-check.mjs` / `node web/tools/page-probe.mjs`）**必须先自己起一个带远程调试端口的 Chrome 并设 `GW_CDP`**：不设 CDP 时 `browser-check` 会以 `TypeError: fetch failed`（**rc=2**）收场、`page-probe` 会 `connect ECONNREFUSED`（**rc=1**）——这两个脚本**不会**替你起浏览器。完整命令（自己起服务 + 私有端口 + `GW_BASE`/`GW_CDP`）见[复核指南 §0.0](docs/verification/复核指南-2026-10-31.md)。
- **parity 的边界**：**74 组**样例（intake 27 / 候选批次 26 / **请求侧越界与格式 17** / 损坏样例 4），越界网格 15 组**已覆盖且一致**；**唯一剩余分歧 1 项**：`days=10**20` → Python `needs_input/LIMIT_EXCEEDED` vs JS `error/INVALID_JSON`（**两侧都拒绝**，只是错误码与层级口径不同，属 IEEE754 双精度保真度差异，**不是放行问题**）。所以这是**样例级等价，不是全域等价**。
- **该层尚未交付独立验收**（`web/` 属在飞工作），见[未完成清单](#未完成清单)。

### 运行 4：Docker（**本机已实测；未上云**）

`deploy/Dockerfile`（`python:3.12-slim`、非 root 用户 uid 10001、`HEALTHCHECK`、`CMD ["python","-m","deploy.server"]`）已在**本机 Docker 29.9.2 真实构建并验证**：

```bash
docker build -t giftwise-validator -f deploy/Dockerfile .
docker run -d --name gw-val -p 127.0.0.1:8000:8000 giftwise-validator
curl -sS http://127.0.0.1:8000/healthz
```

本机实测：体积 **178 MB**（= `169.36 MiB`，十进制／二进制双口径）、**冷构建 1.720 s**（热构建 0.6 s）、启动到 `/healthz` 200 **0.750–0.939 s**、运行内存 **14.45–17.08 MiB**、**14 项检查通过**；容器内 `/validate` 与本机 `validator.rules.validate` **逐字节一致**；镜像内**无密钥**。

> ⚠ **边界**：这是**单机基线，不是生产容量结论**；**从未推送任何镜像仓库**；交付镜像已重建并复核通过（`giftwise-validator:submission-20261101` = `latest`，`/healthz` 规则哈希与本机一致）。⚠️ 体积数字正随镜像优化重建变动，**本条暂缓刷新**。镜像标识请用 **tag + 日期 + `rules_source_sha256`**，**不要**引用 "manifest digest"（从未推 registry，`RepoDigests` 只是本地 config digest，与镜像 ID 同值，且**会随重建漂移**）。

## 复现命令总表

| 目标 | 命令 | 实测结果（2026-10-30） |
| --- | --- | --- |
| 推荐阶段单元测试 | `python -m unittest discover -s tests -q` | `Ran 329 tests` / `OK`（2026-10-31 复跑，约 0.2–0.3 s） |
| 阶段 C 独立套件 | `python -m unittest discover -s tests/acceptance/stage_c -q` | `Ran 39 tests` / `OK`（**`discover -s tests` 不覆盖**） |
| 阶段 B 独立套件 | `python -m unittest discover -s tests/acceptance/stage_b -q` | `Ran 275 tests` / `OK`（**`discover -s tests` 不覆盖**） |
| 边界独立套件 | `python -m unittest discover -s tests/acceptance/boundary -q` | `Ran 45 tests` / `OK`（**`discover -s tests` 不覆盖**） |
| 46 项离线探针 | `python tests/acceptance/stage_c/run_verify_local_nopipe.py` | `46 passed; 0 failed; model calls: 0; cloud verified: false`（**必须在带 `.git` 的 clone 目录里跑**，否则跑完抛 `exit status 128`） |
| 阶段 B 契约套件 | `python tests/acceptance/stage_b/run_acceptance.py` | 生成新证据目录（历史：260 项） |
| 规则 API | `python -m deploy.server` | `/healthz` 200 |
| 前端接入层自测 | `cd web && node tests/access-layer.test.mjs` | `pass 40 / fail 0` |
| JS↔Python 语义比对 | `cd web && node tools/parity-check.mjs` | **74 组**样例，0 处语义差异（**样例级**；越界网格已覆盖，剩余 1 项为错误码口径差异、两侧都拒绝） |
> ⚠️ **本表只列评委可现场复跑的命令。** 需要本地第三方包或已登录外部会话的命令**不在本表**，见下面「仅内部复现」小节。

### 仅内部复现（评委现场**无法**复核，故不列入上表）

| 目标 | 命令 | 为什么现场跑不了 |
| --- | --- | --- |
| 真实 Dify 复核（需浏览器会话；工作流**已发布 v1/v2**） | `node tests/acceptance/stage_c/dify-qa-runner.cjs tests/acceptance/stage_c/qa-steps-run2.json` | 该脚本第 9 行硬 `require` **`workflow/tools/node_modules/playwright-core`**，而 `workflow/tools/**` **被 `.gitignore` 整体排除**：干净克隆里必然 `Error: Cannot find module '…\workflow\tools\node_modules\playwright-core'`。要跑通需本地装好 `playwright-core` **且**有一个已登录的 Dify 控制台会话（会消耗真实模型调用额度）。 |

结果请看**归档证据**（不是现场命令）：`workflow/evidence/WF-002-2026-10-30.md`（Code 节点探针，**0 Tokens**）、`workflow/evidence/WF-003-2026-10-30.md`（真实模型 10 次 / 34,127 tokens）。

> **测试总量口径**：全仓共**四条互不包含**的独立套件 —— **329**（`discover -s tests`）＋**275**（`stage_b`）＋**39**（`stage_c`）＋**45**（`boundary`）＝ **688** 项。`tests/acceptance/**` 没有 `__init__.py`，`discover -s tests` **只覆盖第一条**，所以**「329 项通过」≠「全仓通过」**。口径出处 `docs/test-plan.md:214` 起。

上表命令能证明**本地规则、固定快照、接入层模拟链路**与**本机容器**；**真实 Dify 模型链路（10 次 / 34,127，累计 13 次 / 38,326）**由**归档证据**给出（`workflow/evidence/WF-003-*.md`），**不是**现场可复跑的命令。以上命令**不能**证明云部署、真实商品数据、前端验收或生产容量。

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
├── deploy/               # 最小确定性校验 API（本地可运行 + 本机容器实测；云部署未开始）
│   ├── server.py         #   仅暴露 /healthz 与 /validate
│   ├── Dockerfile        #   本机已实测（14 项通过）；未上云
│   └── publish-to-uhost.ps1  # UCloud 发布脚本（从未上传任何主机）
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

`workflow/tools/` 存放本地浏览器自动化脚本与被 `.gitignore` 排除的产物（含 Dify 专用浏览器配置目录与 `node_modules/`，**不进入 git**）。⇒ **干净克隆里没有这个目录**：`tests/acceptance/stage_c/dify-qa-runner.cjs` 硬 require 其中的 `node_modules/playwright-core`，在干净克隆里**必然**报 `Cannot find module`，属**仅内部复现**。

## 真实能力（已核实）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 推荐阶段确定性规则校验（预算、币种、禁忌、必要字段、准备时间） | **已实现并通过离线验收** | 46 项探针、**329** 项单测 `OK` |
| 关系枚举与 `pursuit`（追求对象）独立机器值，与 `partner`（恋人）互斥 | **已落地** | `workflow/labels.py`；`parity-check` **74 组**一致（**样例级**） |
| 全局最多一次业务修订与"已通过项不可改"保护 | **已实现（离线/模拟层）** | 阶段 C 套件 39 项；`web/` 自测 40 项 |
| 失败不伪装为完成（失败项不可选、无可选项） | **已实现（离线/模拟层）** | 超预算与损坏 JSON 实测为失败态 |
| 前端中文交互链路（三方案→选择→四段呈现） | **可在 mock 模式运行** | 实测三候选 × 2 轮均 `completed`、四段齐全；**模拟数据** |
| 追求对象与恋人文案差异（贺卡、装饰、话术、关系提示） | **在 mock 层实测不同** | 追求对象：不用玫瑰、"别有负担"、"不暗示双方已确定关系"；恋人：可表达亲密、允许花材 |
| 真实 Dify 工作流（已发布并创建版本 v1/v2） | **已真实运行** | `workflow/evidence/WF-003-2026-10-30.md`：主批次 **10 次 / 34,127 tokens**、N2 约 6.0 s；**累计 13 次 / 38,326** |
| Docker 本机构建与验证 | **本机实测 14 项通过** | `deploy/evidence/docker-2026-10-30.md`（178 MB / 169.36 MiB；冷构建 1.720 s；启动 0.750–0.939 s） |
| 规则 API 本地运行 | **可运行** | `python -m deploy.server` → `/healthz` 200 |
| 证据哈希可追溯 | **已实现** | `workflow/generated/manifest.json` 的 5 个 `artifacts_sha256` 与实际文件逐一匹配 |

## 未完成清单

**核心业务闭环**

- [x] **完整 Dify 业务工作流端到端运行**：**11 节点 11 边已接线**，5 类用例真实跑通（含双 End 分支）。
- [x] **Dify 工作流发布**：**已发布并创建版本**（v1 于 2026-10-30 23:04 +08:00；当前 v2）。⚠️ `toolPublished: false` / `version: "draft"` **不是发布状态判据**（前者只表示"是否作为工具供其他应用调用"）。**但仍未上云、未部署到任何主机。**
- [x] **真实模型调用**：**主批次 10 次 / 34,127 tokens；累计 13 次 / 38,326 tokens**（DeepSeek，产品负责人自备额度）。
- [ ] **真实商品数据**：价格、库存、物流**完全没有**；现有金额与准备时间**只是估算**（`business_data_verification: not_verified`）。
- [ ] **供应商费率与单任务成本**：**未核实**（须来自真实账单；**不得用估算值冒充**）。
- [ ] **Dify 侧包装／配色／贺卡／赠送呈现阶段**：**未实现**（只在 `web/` 的 mock 中呈现）。
- [ ] **N4 的 ELSE 分支**从未被触发；**无自然 `OVER_BUDGET` 与 `FORBIDDEN_TAG` 触发证据**；提示词修复**之后**的修订→再校验路径**无运行时证据**。
- [ ] **约 60 秒完成输入**的目标：**无真实用户测量**。

**前端与部署**

- [ ] **前端正式验收（WEB-001）**：`web/` 属在飞工作，只有开发自测与一次有界预备冒烟（14/14），**未交付独立验收**；页面数据为模拟。
- [ ] **E2E 与页面中文状态清单**（加载、空状态、错误、超时、无可选方案、未选择）未逐项验收。
- [ ] **云部署**：`CLOUD-001` 未执行；**云部署从未发生**（无云主机、无 EIP、UCloud 未采购）；**未推送任何镜像仓库**；无编排平台（无 K8S/k3s）、无多副本、无弹性伸缩、无资源调度、无分布式状态。
- [x] **Docker 本机构建与验证**：**已完成（14 项通过）**——但仅为**单机基线**，不等于生产容量。
- [ ] **可导入的 Dify DSL**：`workflow/generated/*.py` 是 Python 源码（`format: python-source-not-dsl`），**不是 DSL**，未导入。

**可观测性与工程化**

- [ ] **平台级调用轨迹**：Dify 租户**未启用 trace 采集**（`status: not_collected`），无平台侧调用链；节点级输出只能取自界面「上次运行」。
- [ ] **阶段 14 采集**：代码**已实现**（`deploy/observability.py` 等），但**未进默认镜像、未实测**——完成前不得写成「已实测」。
- [ ] 可观测性验收项（运行 ID、候选版本、校验输出、修订计数、错误、调用记录）尚未收编进验收标准（缺口 G-2）。
- [ ] 独立成文的「异常处理说明」（工具失败、模型输出异常、超时、重试、状态恢复、人工介入）尚未成文（缺口 G-3）。

**已知缺陷（已登记，本轮未修）**

| 编号 | 缺陷 | 影响 | 归属 |
| --- | --- | --- | --- |
| D-1（原） | `docs/demo-script.md` 首场景原为"同事" | **已由本轮 DEMO-001 修复**：改为追求对象/恋人 | 发布线（已处理） |
| D-2 | `deploy/` 无任务单、无验收，却含可执行发布脚本 | 无人负责的可执行产物 | PM（阶段 6） |
| D-4 | `workflow/verify_local.py` 受限环境下崩溃且不打印汇总 | 复核者可能误判为探针失败 | 工作流线 |
| **D-7（已闭合）** | `deploy/README.md` 的 `python deploy/server.py` 实际报 `ModuleNotFoundError` | 现场按文档启动会失败 | 部署/PM —— **已修**：`deploy/README.md` 的启动命令现为 `python -m deploy.server`（并保留"文件方式会失败"的告警，实测 rc=1）；本 README 的对应说明与「运行 2」已同步更正（2026-10-31 核对） |
| D-8 | `web/` 在飞编辑期间，`/api/presentations` 曾于 21:19 对三个候选全部返回 `500 INTERNAL_ERROR`，21:20 复测恢复正常（`pipeline.mjs` 于 21:19:31 被改动） | 现场依赖该路径存在**瞬时不稳**风险，须在冻结版本上重新验证 | 前端线 |

## 技术栈与选型

| 技术 | 用途 | 实际状态 | 选型理由 |
| --- | --- | --- | --- |
| Python 3.12（标准库） | 确定性规则校验 | **已实现并验收** | 规则必须独立于模型；零依赖便于复现与二次复验 |
| Dify（Cloud 1.18.0） | 模型编排与 Code 节点 | **已发布并创建版本（v1/v2）**；真实模型链路已跑通（累计 13 次 / 38,326 tokens） | 平台承担编排与节点调度，减少自建工作流框架的工程量 |
| Node.js（内置模块） | 中文页面与薄接入层 | mock 模式可运行；**未验收** | 零依赖、进程内即可演示；密钥只在服务端 |
| 薄服务端接入层 | 保管凭证、维护可信任务状态 | 已实现（mock） | 不把 API Key 放浏览器；不信任浏览器传来的 `passed` |
| Docker | 可复现打包 | **本机已实测 14 项通过**；未推 registry、未上云 | 只在赛题强制或确有需要时采用 |
| UCloud | 托管校验 API | **未开通、未部署** | 资源与费用未确认，不虚构要求 |

**为什么是这个架构**：把"模型生成"和"硬约束校验"分开——模型可以产出有依据的建议，但预算、币种、禁忌、字段、准备时间由**独立代码**判定；校验失败项不可选，且跨两阶段合计最多一次自动修订。状态留在服务端，浏览器只提交输入与选择，避免篡改。

**当前架构的边界**：这是**单机、无数据库、无账号**的最小实现；未做弹性伸缩、分布式状态或故障恢复演练。"云原生"部分目前**只有本机容器实测（14 项）与设计**；**云部署从未发生**，本机容器数据是**单机基线，不是生产容量结论**。

## 限制声明

1. 本项目**未部署**，没有在线体验地址（**云部署从未发生**）；Dify 工作流**已发布并创建版本**，但未部署到任何自有机房或云主机。
2. **有真实模型调用**（累计 13 次 / 38,326 tokens），但**没有真实商品数据**；所有价格、准备时间、库存、物流均为**估算或固定模拟数据**，**未核实**；供应商费率同样**未核实**。
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
| [WF-002 真实 Dify 验证记录](workflow/evidence/WF-002-2026-10-30.md) | Code 节点沙箱探针（该时点 **0 Tokens**；真实模型调用见 WF-003） |
| [现场 Demo 脚本](docs/demo-script.md) | 3 分钟现场演示与备用录屏计划 |
| [竞赛材料](docs/competition/) | 评分规则原文、PPT 骨架、架构图、材料清单与自查 |

## 协作与提交约束

开发自测后报告**实际命令、真实输出、修改文件、限制与阻塞**；测试验收独立复核，**不以开发声明代替证据**。
不伪造功能、测试、价格、库存、物流、模型或部署状态；**不自行提交、推送、发布 Dify 草稿或采购云资源**。
提交截止：**2026-11-01（周日）10:30（北京时间）**；现场：汇报 5 分钟、Demo 3 分钟、问答 7 分钟。
