# 落地后必须同步的位置清单（穷举）

> 结论先行：`validator/rules.py` 的新 sha256 `0a57365b…` 一旦落地，
> **全仓共有 292 个文件**在文本里带着旧值 `1f389dad…`（`grep -rl`，排除 `.git/` 与 `.tmp/`）。
> 其中 **12 处是"同一批次必须改"**（不改会让同一批次的验证结论当场自相矛盾或直接变红），
> 其余绝大多数是**历史运行证据**（B 类，按原始字节留存，**改了反而违规**）。
> 另有 **1 处不是改文件而是必须重建镜像**（见 §4，已显著标出）。
>
> 原始 grep 清单：`evidence/sync-references.txt`（401 行，可复现）。

复现命令（本次实测用的就是这两条）：

```bash
grep -rl "1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500" . \
  | grep -v "^\./\.git/" | grep -v "^\./\.tmp/" | sort          # 292 个文件
grep -rn "rules\.py:[0-9]" README.md docs workflow --include="*.md" --include="*.py" \
  | grep -v "docs/verification/runs"                            # 行号引用
```

---

## 1. 【必须同批次改】12 处

不改的后果栏里的"红/FAIL"都是**可复现的**，不是估计。

| # | 位置（文件:行） | 现在写的 | 落地后应为 | 不改的后果 |
| --- | --- | --- | --- | --- |
| 1 | `tests/acceptance/stage_b/pinned_hashes.json:24,26` | `files` 两条旧哈希 | `0a57365b…` / `a68e3155…` | **`test_hash_1` + `test_hash_3` 必红**，stage_b 套件 275 项直接 FAILED |
| 2 | `docs/competition/材料清单与自查.md:93` | 规则哈希 `1f389dad…` | `0a57365b…` | `tools/verify_all.py` 的 `declared_rules_hash` 探针从"一致"翻成 **FAIL**（它按正则抓该行 64-hex 与当前 rules.py 比对） |
| 3 | `docs/competition/材料清单与自查.md:219` | 自检断言 `rules_source_sha256=1f389dad…` | `0a57365b…` | 同上；且这是**给评委照着跑**的自检第 4 条，会当场对不上 |
| 4 | `workflow/generated/manifest.json:3` | `sources_sha256['validator/rules.py'] = 1f389dad…` | `0a57365b…`（跑 `python workflow/verify_local.py` 重建覆盖） | 同 `declared_rules_hash` 探针（它**也**读这个文件）→ FAIL |
| 5 | `docs/validator-contract-decisions.md` §7（18 处行号）+ §7「行号基准」注 | `:171 :182 :186 :193 :196 :200 :202 :204 :207 :210 :213 :219 :223 :227 :230 :238 :247 :276`，且注里写 278 行 | `:232 :243 :247 :254 :257 :261 :263 :265 :268 :271 :280 :286 :290 :294 :297 :305 :314 :343`，注里写 345 行 | `docs/test-reports/contract-001/tools/probe_doc_parity.py` **直接红**（它对账 §7 全量清单与实现行号，宣称"19 个码零偏差"）；完整映射表见 `contract-text.md` §4 |
| 6 | `docs/test-reports/contract-001/tools/probe_doc_parity.py:181` | 引用 `:181` | `:242` | 同上：`python docs/test-reports/contract-001/tools/run_all.py` 一条命令门禁变红 |
| 7 | `tools/verify_all.py:59-60` | `KNOWN_GAPS["declared_rules_hash"]` 文案里写「当前 `validator/rules.py` `1f389dad…`」 | 改成新值，或改写为"材料与镜像停在 2026-10-30 之前"的新措辞 | `verify_all.py` 的**备注**会说谎（该字段本身不参与判据，但 PM 的复核入口就是看它） |
| 8 | `docs/architecture/observability.md:206` | 「**现行实测** `1f389dad…`」 | `0a57365b…` | 可观测性文档的"现行实测"值失效 |
| 9 | `docs/architecture/adr/ADR-003-cloud-native-tradeoffs.md:75` | 容器内 `rules_source_sha256 = 1f389dad…` = 本机哈希，**一致** | 重建镜像后写新值；**未重建则必须改写为"镜像待重建、当前不一致"** | 该 ADR 的核心结论（"规则只有一份来源、逐字节一致"）在未重建期间**不再成立**，属对外可辩驳的失实 |
| 10 | `docs/verification/复核指南-2026-10-31.md:124,125,243,301` | 复核指南里的实测片段（`/healthz` 返回、`本地 sha256 =`、`sources_sha256[…] =`） | 新值；或显式标注"本节为 2026-10-31 01:4x 时点输出" | 这是**给别人照着跑**的指南，教人用旧哈希判断"现场是不是提交版本" |
| 11 | `README.md:82` | `/healthz` 本版本为 `1f389dad…` | `0a57365b…` | 对外入口文档的第一手指纹失效 |
| 12 | 对外测试总量口径：`README.md:44,52,118,129,176`、`docs/competition/材料清单与自查.md:125,133,175,216,262`、`docs/test-plan.md:207-225,520`、`docs/acceptance-criteria.md:45,47,213,248,263`、`docs/architecture.md:43,45`、`docs/demo-script.md:55,276`、`docs/intake-contract.md:120`、`docs/product-requirements.md:10`、`docs/requirements-analysis.md:11,149,163,165` | **329**（第一条套件）与 **688**（四条合计） | **335** 与 **694** | 数字本身不错，但**开始与实测不符**：落地后 `discover -s tests` 实测 `Ran 335 tests`。⚠ 注意：这**不是**"329 变成了 335"的返工，而是**套件项数按设计 +6**；引用时要写清是哪一条集合（四条互不包含的口径不变） |

> 说明：第 12 项跨 10 个文件、约 25 行，是最容易被漏的一类 —— 因为它不含任何哈希，**grep 哈希找不到它**。

---

## 2. 【可后改，但不改会自相矛盾】——不阻塞落地

| 位置 | 为什么可以后改 |
| --- | --- |
| `docs/rulefix/规则门语义缺陷-复现与修复提案.md`（含 `1f389dad` 与 `:211` 行号引用） | 是**本线的提案文档**（提案期的时点记录）。落地后应为它补一条"已落地"批注，或另立落地记录；本线刻意**没有改**它（避免自己改自己的论证记录） |
| `docs/pm-reviews/晨间简报-2026-10-31.md`、`docs/pm-reviews/contract-decisions-draft-2026-10-30.md` | **B 类评审记录**：按仓库惯例不得改写数字，正确做法是**新立**一份评审/简报记录 |
| `docs/architecture.md:504,507,536,539,581,584` | 引的是更旧的 `4782255b…`，**本来就已经过期**；属架构线自己的刷新范围 |
| `docs/architecture/ARCH-001-report-2026-10-30.md:50,60,61,95` | 同上（2026-10-30 时点报告），且带日期，属于"历史时点"性质 |
| `docs/acceptance-criteria.md:52,264` 的容器化状态行 | 取决于是否重建镜像；重建后同批次改，未重建则保留原状并在评审里说明 |
| `docs/intake-contract.md:60,88,120,191`（`rules.py:191` → `:252`） | `:152` `:160` `:162` 等 **≤164 不受影响**；只有 `:191` 一处过期，属 intake 文件线的刷新范围。**本线一个字都没动该文件**（它在禁止名单里） |
| `docs/demo/failure-modes.md:205`（→ `:266`）、`docs/demo/**` 4 个文件、`docs/qa-prep/**` 4 个、`docs/performance/**` 2 个、`docs/bossfix/**` | 演示/备赛/性能等文件线的派生物，含历史实测值 |
| `docs/verification/发现的问题.md:19,23,70` | 是"问题发现记录"（时点性质），建议在复核指南里追记而不是回改 |
| `workflow/workflow-spec.md:96`（`:181`→`:242`、`:242`→`:309`）、`workflow/tools/create-stage-issues.py`、`workflow/evidence/WF-003-2026-10-30.md`、`workflow/tools/tmp/**`（3 个） | 工作流文件线；`probe_doc_parity.py` 已把 workflow-spec 的这两处标为"只报不判失败" |
| `docs/test-reports/contract-001/acceptance-2026-10-30.md:270` | 带日期的验收报告（历史时点） |

---

## 3. 【不要改】——历史运行证据（B 类）

这些文件里的 `1f389dad…` 是**当时的真实输出**，按原始字节留存；改了就是**伪造证据**。
正确处理方式是**新增**一份本次批次的证据目录/文件，而不是回改旧值。

| 目录 | 带旧哈希的文件数 |
| --- | --- |
| `deploy/evidence/**`（含 `raw/`） | 140 |
| `docs/verification/runs/**` | 94 |
| `workflow/evidence/**` | 23 |
| `docs/test-reports/**` | 12 |
| `web/.tmp/**` | 8（本就是本地产物，gitignore） |
| `docs/pm-reviews/val-001-rereview-2026-10-29.md` | 1 —— **B 类 + 被 stage_b 断言逐条引用**（`superseded_sha256` 必须与它相等，见 `repin-plan.md` §2） |

---

## 4. ★ 镜像：不改文件，但**不重建就等于没落地**（显著标出）

`deploy/server.py:43` 在**运行时**从容器里的 `validator/rules.py` 现算哈希并挂在 `/healthz` 的
`rules_source_sha256` 上 —— 也就是说：

> **`deploy/` 目录下一个字都不用改；但如果不重建 `giftwise-validator` 镜像，
> `/healthz` 会继续返回旧哈希 `1f389dad…`，而本机已经是 `0a57365b…`。**

后果（都是已入库的判据，不是推测）：

- `tools/verify_all.py` 的 `i2_local` / `i2_image` / `docker_build` 三项以
  `本地 rules.py sha256 == 容器 /healthz 哈希`为判据 → **镜像不重建则必 FAIL**；
- `docs/competition/材料清单与自查.md` 的 A4「容器 `POST /validate` 与本机逐字节一致；
  `/healthz` 规则哈希与本机一致」→ **不再成立**；
- `docs/architecture/adr/ADR-003-cloud-native-tradeoffs.md:75` 的核心结论（规则只有一份来源）→ **同上**。

**同批次动作**：落地后立刻重建镜像（`deploy/Dockerfile` 无需改动），
再把新镜像 tag + 日期 + 新 `rules_source_sha256` 记进材料清单 A3/A4、ADR-003 与复核指南。
**若本轮不重建**：必须在上述位置显式写「镜像待重建，当前 `/healthz` 返回旧哈希」，
不得保留"逐字节一致"的结论 —— 否则就是对外口径失实。

---

## 5. 已确认**无需**同步的位置

- **`web/**`：无哈希常量、无派生物。**
  全仓 `grep -rn "1f389dad\|4782255b\|rules_source_sha256" web/` 的结果**全部落在 `web/.tmp/**`**
  （本地产物，gitignore），`web/server/**`、`web/public/**`、`web/tools/**`、`web/tests/**` 一处都没有。
  JS 侧与 Python 侧的关系是**语义比对**（`web/tools/parity-check.mjs`：74 组样例逐项比错误码/路径/文案），
  不是哈希比对 —— 本次真实运行结论仍是「**结果：全部一致（0 处语义差异）**」，
  所以 **web 线一个文件都不用动**。
- `deploy/Dockerfile`：`HEALTHCHECK` 只探 `/healthz`，不内嵌哈希 → 无需改。
- `tests/acceptance/stage_b/cases.json`（275 项独立夹具）：由 `build_cases.py` 独立生成，**不读** `tests/test_cases.json`，本次 +6 条用例**不影响**它 → 无需重建，实测仍 `Ran 275 tests … OK`。
- `tests/**` 其他文件：6 条用例通过 `tests/test_validator.py:138` 的自动生成机制生效，**无需改任何生产测试文件**。

---

## 6. 一张表：同批次 vs 可后改 vs 永不改

| 类别 | 数量级 | 处理 |
| --- | --- | --- |
| **必须同批次** | 12 处（跨 ~20 个文件行位） | apply.sh 完成 1；其余 11 处由 PM 在素材/文档批次里一次改完 |
| **可后改（不改会自相矛盾）** | ~20 个文件（含 12 个历史时点报告） | 下一次文档刷新批次；建议在评审记录里追记，不回改带日期的报告 |
| **永不改（历史证据）** | 278 个文件 | 保持原样；新证据另立目录 |
| **无需改** | `web/**`、`deploy/Dockerfile`、`stage_b/cases.json` | 但**镜像必须重建**（§4） |
