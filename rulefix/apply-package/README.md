# `rulefix/apply-package/` —— 规则门否定语义修复的「一条命令落地」包

**给 PM 的两条命令：**

```bash
bash rulefix/apply-package/apply.sh      # 落地：补丁 + 6 条用例 + 重钉基线 + 契约 §9 + 全量验证 + PASS/FAIL 汇总
bash rulefix/apply-package/revert.sh     # 回滚：从备份逐字节还原 4 个文件，并打印 sha256 与 git status 对照
```

落地单（先读这个）：[`docs/pm-reviews/规则门修复-待应用-2026-10-31.md`](../../docs/pm-reviews/规则门修复-待应用-2026-10-31.md)

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | **唯一常量来源**：4 个文件的开工前/落地后哈希、补丁与契约段的哈希、套件期望项数。任何一处对不上即中止，不做部分落地 |
| `negation-fix.diff` | 规则补丁（`validator/rules.py`，与 `rulefix/negation-fix.diff` 逐字节相同，sha256 `388e835c…`） |
| `regression-cases.json` | 6 条回归用例的**完整原文**（含 `note` 断言说明） |
| `regression-cases.diff` | 同一改动的**真实 `git diff`**（1366 行），供人工 review；已验证 `git apply --check --reverse` 通过 |
| `materialize-cases.py` | 一次性从 `T01_normal` 派生上述 6 条用例（可审计的推导过程，落地时不参与） |
| `contract-section.md` | 要插入契约文档的**字节**（§9，sha256 `e8bfe32c…`） |
| `contract-text.md` | 契约文本 + 建议插入位置 + 备选位置 + §7 行号位移映射表 |
| `repin-plan.md` | `pinned_hashes.json` 逐字段新旧值、依据，以及"`superseded_sha256` 一个字都不能动"的原因 |
| `new-regression-cases.md` | 6 条用例的落点论证、断言理由、原文 |
| `sync-after-landing.md` | **落地后必须同步的位置清单**（12 处必改 / 可后改 / 永不改 / 无需改 + 镜像特别标注） |
| `apply.sh` / `revert.sh` | 一条命令落地 / 一条命令回滚 |
| `apply_cases.py` / `repin.py` / `apply_contract.py` | 三个哈希校验型应用器（`--dry-run` 只算哈希不写盘；写盘前各自做前置校验） |
| `evidence/` | 本次**真实执行**的原始证据：`pre-run-sha256.txt`、`apply-run.txt`、`revert-run.txt`、`post-revert-sha256.txt`、`pre/post-run-git-status.txt`、`git-status-delta.txt`、`new-cases-landed.txt`、`sync-references.txt` |

## 安全设计（为什么它敢"一条命令"改生产文件）

1. **开工前哈希闸**：4 个文件与 `manifest.pre_state` 逐条比对，不符就**零写入**中止
   （已落地过、或被其他线改过，都会被拦下）。
2. **备份闸**：4 个文件完整复制到 `.tmp/rulefix-apply-backup/`（已 gitignore），
   并逐条复校副本哈希；`git status --porcelain` 快照一并留存。
3. **写盘前自检**：6 条用例在写盘**之前**用已打补丁的 `validator.validate` 逐条跑并比对 `expected`，
   任一条不符就中止。
4. **落地后哈希闸**：3 个文件按**精确字节哈希**核对；`pinned_hashes.json` 因含落地时刻，
   按 canonical 时间戳复算比对。
5. **不碰 git 分支**：全程只用 `git apply`（工作区补丁）与 `git diff`，没有 `checkout/switch/branch/stash` 等任何分支操作。
6. **失败即停**：任一步失败立刻停止并提示 `revert.sh`，绝不半落地。

## 本次真实执行记录（2026-10-31 01:46–01:48，本机 Asia/Shanghai）

| 环节 | 结果 |
| --- | --- |
| 落地 | `APPLY_RC=0`；0–10 步全 PASS；4 套件 `Ran 335 / 275 / 39 / 45`（合计 **694**，落地前 688）；parity `全部一致（0 处语义差异）`；access-layer `pass 40 / fail 0` |
| 回滚 | `REVERT_RC=0`；4/4 文件 sha256 与开工前**逐字节相同**（独立复核 0 行差异） |
| 可重复性 | 完整跑了 **2 次** apply→revert：两次落地后哈希相同（`0a57365b…` / `a68e3155…` / `38a71102…`），两次都还原干净 |
| `git status` | 4 个被触及文件的状态落地前/回滚后**完全一致**；第 1 次窗口内全仓唯一差异是并发线新增的 `?? web/tools/server-identity.mjs`（mtime 01:47:55，非本线所写）。⚠ 收尾时 web 线仍在并发写 `web/public/*`，"全仓一致"只在限定窗口内成立，详见 `evidence/README.md` |
| 落地后 `validator/rules.py` | `0a57365ba8320a441f13ca8f22e7f884b59ad2161290ad823e2bc7c683913800` |

原始输出见 `evidence/apply-run.txt` 与 `evidence/revert-run.txt`。

## 已知未做到（如实）

- **Q7 未解决**：用「陈年佳酿」等同义表达绕过字面词的路径，本轮修复**没有**覆盖，对外口径必须保留。
- **`RF04` 故意保持红**：`无酒精啤酒` 仍被判 `FORBIDDEN_TERM`（中文无词边界，词条命中更长词内部子串），
  这是**已知限制的固定夹具**，不是待修 bug。
- **镜像未重建**：`/healthz` 仍会返回旧哈希 —— 落地后必须重建，见 `sync-after-landing.md` §4。
- **`docs/validator-contract-decisions.md` §7 的 18 处行号引用未随本包更新**（属于"必须同批次"清单第 5 项）。
  本包只追加 §9；行号改写需要动既有内容，本线按"不落在生产文件上"的边界没有代劳，映射表已给全。
