# PM 追加两项的执行记录（2026-10-31）

> 本报告数字为 2026-10-31 时点真值；后续变更见 `docs/acceptance-criteria.md` 第 13 节。

- 执行角色：GiftWise｜测试验收 Agent（独立执行）
- 来源：PM 本轮追加的两项要求
- 本文件是这两项的**追溯记录**：说明改了什么、依据什么、如何验证、哪些没做

## 追加项 ① 复跑并归档 HTTP 冒烟 59 项

**结果：59 项全部通过，失败 0 项。**

- 完整报告：[`docs/test-reports/web-smoke-http/acceptance-2026-10-31.md`](web-smoke-http/acceptance-2026-10-31.md)
- 逐项原始输出：[`web-smoke-http/evidence/smoke-http-run1-18787.txt`](web-smoke-http/evidence/smoke-http-run1-18787.txt)（第 2 次运行与 diff 同目录）

**关键点**：

1. PM 提示"用空闲端口"——**8787 在我开始前已被其他文件线的 `node web/server/server.mjs`（PID 13360）占用**。
   我未停止、未干扰、未复用该端口，改用 `GW_PORT=18787`／`18788`（`config.mjs:132` 支持的官方配置入口）。
   另有 `node.exe`（PID 24704，同为 `web/server/server.mjs`）与 `tools/page-probe.mjs`（PID 37412）**均非我所有，一个都没动**。
2. 用**两个全新实例**各跑一次，59 项判定与顺序**逐字节一致**（排除单次碰巧通过）。
3. 该项此前被架构审计记为"未核实"，本次复跑**解除了该状态**。
4. 我同时界定了它**没有**验证什么：服务为 `mode: mock`（启动自述"模拟数据；Dify 未配置或未确认发布"），
   **0 次模型调用**，故"三候选互不相同／低压力话术／修订后落在预算内"等验证的是**接入层契约与 mock 行为，不是真实模型输出**。
5. **发现一处口径问题**：第 57 项名为「超时路径：客户端可中止并**显示中文超时状态**」，但脚本实际只断言
   `err.name === "AbortError"`（`smoke-http.mjs:172–174`），**未断言任何中文文案**。该断言**不空洞**
   （服务端 `pipeline.mjs:85` 确实 `await sleep(45000)`，客户端 3 秒中止是对真实慢响应的中止），
   但**用例名超出了断言范围**。建议收窄用例名或补上文案断言；UI 侧文案由 `browser-check.mjs:562` 覆盖，不在本冒烟范围。

## 追加项 ② 为历史报告只加时点说明（不改数字）

**范围**：`docs/test-reports/**` 与 `docs/pm-reviews/**` 下的全部 `.md`，共 **18 个**。

**格式**（PM 给定，原文采用）：

```
> 本报告数字为 <日期> 时点真值；后续变更见 docs/acceptance-criteria.md 第 13 节。
```

**位置**：紧跟 H1 标题之后（第 3 行），即「文件顶部」。这样标题仍是首行，说明在正文之前可见。
若 PM 希望**字面第 1 行**（标题之上），我可一次性调整。

**执行结果**：新增说明 **17 个** + 本就含说明 **1 个**（`web-smoke-http/acceptance-2026-10-31.md`，本次新建时已带）= **18 个全覆盖**。

日期来源（逐个人工核对，未取巧）：

| 来源 | 文件 |
| --- | --- |
| 文件名含 `YYYY-MM-DD` | 12 个（如 `acceptance-2026-10-30.md`） |
| 父目录时间戳 `YYYYMMDD-HHMMSS` | 2 个（`stage-c/20261030-205323`、`20261030-224243` `case-results.md`） |
| 父目录紧凑时间戳 | 1 个（`stage-b/20261029-190728-7b381b95/case-results.md`） |
| 同批次配套报告推定 | 1 个（`stage-a/checklist.md` 无内嵌日期，与其配套的 `preparation-2026-10-29.md` 同批，故取 **2026-10-29**） |

**"不改数字"如何保证**：改动是**纯插入**——脚本按 `[标题, 空行, 说明] + 原第 2 行起的全部内容` 构造新文本，
**原文其余部分逐行原样取用、从未被改写或删除**，因此可加性由构造本身保证。
事后我又对全部 18 个文件做了位置与格式校验（说明恰好出现 1 次、位于第 3 行、首行为 H1），**18/18 合规**。

> **澄清一处容易误读之处**：`git diff --numstat` 对 `docs/pm-reviews/web-parity-pm-verification-2026-10-30.md`
> 显示 **44 行新增**，但那**不是**我这轮加的——其中 **42 行是 PM 自己未提交的「追补（2026-10-31，PM 自查更正）」**，
> 我只加了 2 行（空行 + 说明）。同理 `docs/test-reports/stage-b/acceptance-2026-10-29.md` 的 1 处删除
> 是我**上一轮**对「零金额」claim 的取代标注，非本轮产物。numstat 是**累计**工作区差异。

### ②-附：生成物需要改生成器（否则说明会被覆盖）

我核实了哪些报告是**脚本生成物**：

| 文件 | 生成者 | 处置 |
| --- | --- | --- |
| `stage-c/*/case-results.md`（2 个） | `tests/acceptance/stage_c/run_stage_c.py:208` | 已加说明 **且** 已改生成器，使重新生成时自带说明 |
| `stage-b/*/case-results.md` | 无生成器（`run_acceptance.py` 只写 `unittest.txt`／`results.json`／`summary.json`） | 手写文件，直接加说明 |

**生成器改动**（`tests/acceptance/stage_c/run_stage_c.py`，纯新增一行 f-string，位于输出模板标题之后）：

```python
f"> 本报告数字为 {record['started_at'][:10]} 时点真值；后续变更见 `docs/acceptance-criteria.md` 第 13 节。",
```

日期由该次运行的 `started_at` 动态取值，不写死。

**该改动的验证方式（端到端，非仅语法）**：我实跑了一次生成器 →
产出 `docs/test-reports/stage-c/20261031-010037/case-results.md`，其第 3 行确为
`> 本报告数字为 2026-10-31 时点真值；…`（同时确认该次 stage C 为 `cases: 39 passed: 39 failed: 0`、`unittest: OK`）。
**验证后我删除了该副产物目录**，以免被误读为"QA 重跑了阶段 C、新增了一次运行记录"；删除前已核验绝对路径，
且该脚本 `mkdir(exist_ok=False)`、只写 `out_dir` 内 2 个文件、无索引类附带写入。
**故：生成器改动经实跑验证；但阶段 C 的历史运行记录保持原样，未新增。**

**未做**：未改动这些报告中的任何数字、结论或表格内容；未在 `docs/test-reports`、`docs/pm-reviews` 之外新增时点说明
（`docs/test-plan.md`、`docs/acceptance-criteria.md` 等未加，按 PM 给定范围执行）。

## 环境与副作用

- 未执行任何 git 分支操作（无 checkout/switch/branch/merge/rebase/push）；改动全部留在工作区。
- 我方后台作业 `bash-1246`、`bash-1268`（两个临时接入层实例）已 `job_kill`；`netstat` 确认 `18787`／`18788` 无 LISTENING。
- 未停止、未干扰任何其他文件线的进程。
- 本轮仅新增/修改：`docs/test-reports/web-smoke-http/**`（新建）、
  `tests/acceptance/stage_c/run_stage_c.py`（1 行）、上述 17 个 `.md` 的时点说明行、本文件。
