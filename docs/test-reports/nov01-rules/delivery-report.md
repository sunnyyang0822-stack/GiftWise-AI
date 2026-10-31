# REV-VAL-001 规则与适配交付记录

日期：2026-10-31（Asia/Shanghai）。分支：`line/nov01-rules`。独立 worktree：`C:/Users/lenovo/Desktop/gw-rules-nov01`。基线：`5b462ba`（`origin/release/2026-11-01-submission`）。

## 实现结果

已实现 2026-10-31 变更契约的 Python/JS 对等路径：新版 `contract_version=giftwise-20261031-v2`、`budget_mode`、必填 `budget_range.min/max`、标量从 `max` 派生、标量与区间不一致报 `BUDGET_RANGE_MISMATCH`；旧标量仍兼容。预算允许 0 和 0.99；slider/zero/other 由适配层检查，规则层检查区间结构、端点、范围、顺序及标量一致性。候选超过 max 失败，低于 min 仅产生 `BELOW_BUDGET_RANGE` warning，端点通过。六档 deadline 配置为 1/5/7/30/90/365。

`dislikes` 可为空字符串，非空原文以请求扩展数据保留，不自动变成事实或禁忌。新版呈现 `checkPresentation` 只接收风格、色调、贺卡、赠送建议、未知信息、币种和完整准备时间；拒绝 `additional_cost`、`revised_estimated_total`、旧包装材料/步骤字段，并扫描 style、palette、卡片和赠送文本的明确禁忌。旧呈现分支仍保留，不能与新版混读。

## 修改文件

| 文件 | 用途 |
|---|---|
| `validator/rules.py` | Decimal 预算区间、标量一致性、下限 warning、0 元兼容 |
| `workflow/intake.py` | Python intake v2 适配、模式/区间/不喜欢原文透传 |
| `web/server/intake.mjs` | JS intake 对等适配与服务端派生 max |
| `web/server/checker.mjs` | BigInt 金额区间、warning、新版/旧版呈现分支 |
| `web/server/config.mjs` | 新版 budget slider/modes 与六档 deadline 配置，保留旧配置 |
| `tests/test_cases.json` | 更新受契约影响的旧预算期望 |
| `tests/test_revision_budget.py` | Python 新版预算、适配和兼容回归 |
| `web/tests/revision-rules.test.mjs` | JS 新版预算、适配、呈现回归 |

未修改 `server.mjs`、`pipeline.mjs`、`mock-model`、`store`、Dify、前端页面或独立 acceptance 用例。`/api/config` 路由尚未同步新配置，属于接入线后续依赖。

## 实际命令与断言结果

Python 解释器：`C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe`，版本 Python 3.12.12；系统 Windows 11；所有命令均设置 `PYTHONIOENCODING=utf-8`。

| 命令 | 退出码 | 实际结果 |
|---|---:|---|
| `python -m unittest discover -s tests -q` | 0 | 337 项通过 |
| `python -m unittest tests.test_revision_budget -q` | 0 | 8 项通过 |
| `python -m unittest discover -s tests/acceptance/stage_b -q` | 1 | 275 项中 267 通过、8 失败 |
| `python -m unittest discover -s tests/acceptance/stage_c -q` | 1 | 39 项中 38 通过、1 失败 |
| `python -m unittest discover -s tests/acceptance/boundary -q` | 1 | 45 项中 37 通过、8 失败 |
| `node --test web/tests/revision-rules.test.mjs` | 0 | 6 项通过 |
| `node web/tests/access-layer.test.mjs` | 0 | 40 项通过 |
| `node web/tools/parity-check.mjs` | 0 | 74/74 样例一致，0 语义差异；附加 pursuit gate 通过 |
| `git diff --check` | 0 | 无空白错误 |
| `node --check`（三个 JS 实现文件及新测试） | 0 | 语法通过 |

完整日志位于本目录：`commands.txt`、各命令 `.log`、`python-version.log`、`head.log`、`status.log`。

## 旧断言失效与限制

没有修改独立 acceptance 用例来消除真实失败。stage B 的失败来自旧预算规则仍期待 0/0.0/0.00 被 `LIMIT_EXCEEDED` 拒绝、旧错误文案「1 至 10000」，以及其 pinned hash 仍指向旧实现；这些与本轮产品确认的 0 元合法和新版源码不一致。stage C 的唯一失败是生成物 manifest 仍未按本线源码重建。boundary 的 8 个失败来自同一旧零预算下限断言及其错误组合期望。

`tools/verify_all.py` 未运行：按任务要求它会写全量产物，本轮没有在临时副本重复执行。未访问 Dify、线上模型、云资源或真实商品数据；未测调用成本、真实模型修订、前端新版端到端或 `/api/config` 新字段。新版 intake/presentation 与旧 pipeline/server 的联调尚未完成，不能宣称端到端通过。当前工作区主仓库已有他人未提交证据，本线未触碰。

本轮静态敏感扫描未发现新增凭证、token、密码或网络调用；配置文件中既有服务端凭证读取代码保持原样。本报告只含虚构数据、错误码和计数，不写用户原文或密钥。

## 变更文件 SHA256

| 文件 | SHA256 |
|---|---|
| `validator/rules.py` | `f548f9554176dbcf3f4729dfba67898ccac8a4a7cd8020e20a123c5bf86a4258` |
| `workflow/intake.py` | `776fea6bf6269d554cd66b666be7115cdaa0b11b90dbd5bcf62adf6b7cacb381` |
| `web/server/intake.mjs` | `ce96daea11624f951645a4136e6ab40798025360fd5e44fd79b72c9896003839` |
| `web/server/checker.mjs` | `f5ae1a17c3eaeb048fd619494708db902360093b030235770ab6e144c2aefe1a` |
| `web/server/config.mjs` | `f2211ecf92568d95dad68ba308b2a5157d807d9facb92ed7b2ac82ba251ca41e` |
| `tests/test_cases.json` | `546e9b43ca9766885634d05f94d2729f8e827203e878c943c56aa6a93fc18669` |
| `tests/test_revision_budget.py` | `0195c439a00ceeb0f74fac2df6d18c57f242e85014399d20076ccff492fccf9c` |
| `web/tests/revision-rules.test.mjs` | `490cfaecb69e35f9187133e5534567cd7e5a56ed35aed267daabc5f3b12c264c` |

## 提交与 PR 状态

已逐文件暂存并提交：`c74a5142ff42644654e40d903362f52a64ea8565`。提交前 `HEAD^{tree}` 为 `e1405e41ab19f49badc2ab02d5c84f680d7932d4`，`origin/release/2026-11-01-submission^{tree}` 为 `047c6df80e80a23f231d7c3733689659576ffa20`，两棵树不同；已用 `git show HEAD:<文件>` 回读规则与 checker 关键新增内容。

已通过主仓库 `workflow/tools/gh-cred.py` 推送 `line/nov01-rules`，并创建 PR [#48](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/48) 到 `release/2026-11-01-submission`。实际确认 PR `state=OPEN`、`changedFiles=11`、`additions=632`、`deletions=51`。本报告更新后将再推送一笔仅文档记录提交；不合并、不 force push、不推 main/release，任务停在待 PM 审查。
