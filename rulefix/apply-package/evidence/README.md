# 本次真实执行的原始证据（2026-10-31 01:46–01:53，Asia/Shanghai +08:00）

本目录全部是**命令的原始输出**，未做任何加工（除 `git-status-*.txt` 是 `git status --porcelain` 的直接转储）。

| 文件 | 内容 |
| --- | --- |
| `pre-run-sha256.txt` | 开工前 4 个将被触及的生产文件 sha256（**由独立命令记录**，不是 apply.sh 自己算的） |
| `pre-run-git-status.txt` | 开工前全仓 `git status --porcelain`（218 行） |
| `apply-run.txt` | **第 1 次** `bash rulefix/apply-package/apply.sh --pinned-at "2026-10-31T09:12:00+08:00"` 的完整 stdout+stderr（`APPLY_RC=0`） |
| `new-cases-landed.txt` | 落地后从 `tests/test_cases.json` 直接读出的 6 条新用例原文（625 行） |
| `revert-run.txt` | **第 1 次** `bash rulefix/apply-package/revert.sh` 的完整输出（`REVERT_RC=0`） |
| `post-revert-sha256.txt` | 回滚后 4 个文件的 sha256（**独立复核**：与 `pre-run-sha256.txt` 逐字节相同，0 行差异） |
| `post-revert-git-status.txt` | 回滚后全仓 `git status --porcelain`（219 行） |
| `git-status-delta.txt` | 上面两份 git status 的 `diff` —— **只有 1 行差异**：`> ?? web/tools/server-identity.mjs` |
| `revert-run-2nd-cycle.txt` | **第 2 次** apply→revert 循环的输出（用于验证可重复性，见下） |
| `sync-references.txt` | 落地后需同步位置的原始 grep 清单（401 行） |

## 两次完整循环（可重复性）

因为 `apply.sh` 的第 0 步预检闸在"未落地"状态下会正常放行，本线在收尾时**又完整跑了一次 apply → revert**：

| 循环 | apply 后 `validator/rules.py` | apply 后 `tests/test_cases.json` | apply 后契约文档 | revert 后 4/4 与开工前 |
| --- | --- | --- | --- | --- |
| 第 1 次 | `0a57365b…3800` | `a68e3155…dded` | `38a71102…e193` | ✅ 逐字节相同 |
| 第 2 次 | `0a57365b…3800` | `a68e3155…dded` | `38a71102…e193` | ✅ 逐字节相同 |

**结论：落地是确定性的（两次同哈希），回滚是幂等且逐字节的（两次都还原干净）。**

## ⚠ 关于"全仓 git status 完全一致"的口径（如实标注）

第 1 次循环的窗口是 **01:46:57 → 01:48:09**，该窗口内全仓 `git status` 的唯一差异是并发线新增的
`?? web/tools/server-identity.mjs`（mtime 01:47:55）—— **不是本线所写**。

到 01:53 收尾时，工作区又多了**另一条线（web 线）正在写**的文件：`web/public/index.html`、
`web/public/js/landing.js`、`web/public/landing.css`、`web/public/tokens.css`、`web/public/img/`，
以及 `docs/pm-reviews/数字口径统一-2026-10-31.md`。因此：

- **能严格成立的结论**：本线触及的 **4 个生产文件**，落地前/回滚后 `git status` 条目**完全相同**
  （`M docs/validator-contract-decisions.md` / `M tests/test_cases.json` / `M validator/rules.py` /
  `?? tests/acceptance/stage_b/pinned_hashes.json`），且 sha256 逐字节相同。
- **不能成立的结论**：此刻"全仓 git status 与开工前逐字节相同"—— 因为**其他线仍在并发写**，
  这跟本线回滚是否干净无关。任何"全仓一致"的核对都必须限定时间窗口，或只看本线的文件集合。

第 2 次 `revert.sh` 自带的"全仓对照 ✅ 0 行差异"是**它自己的窗口**（第 2 次 apply 开工前快照 → 第 2 次回滚后），
在该窗口内本线与并发线都恰好没有新的写入，所以显示完全一致；这不与上面的说明矛盾。
