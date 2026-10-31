# 历史独立复核索引

以下均为历史独立 Agent 复核，非另一位人类账户批准。适用各自完整SHA；本次未重跑历史测试、浏览器、供应商。后续更改优先，不能将旧报告的当时状态当作当前冻结服务状态。

| PR | 受审完整SHA | 原正式复核 | 范围/局限 |
| --- | --- | --- | --- |
| #115 | `dd51324a67832991c11cb76d3d039d35656a3128` | [COMMENT](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/115#pullrequestreview-5724681740) | 实际指南章节；当时仅复用10/10，开发输出工作树HEAD为008，相关源码匹配。 |
| #117 | `cacfe958aa8dbf6fcdda51c6bc8754d503291067` | [COMMENT](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/117#pullrequestreview-5724692556) | 可选包装与内容决定章节；35/35含旧25+新10。旧启动/过滤失败仍保留。 |
| #120 | `6d162dfd41ea6c08f1110112d8869a2fd9bbe879` | [COMMENT](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/120#pullrequestreview-5724742176) | 推荐文字无图，选后AI仍接线；非阻断diff-check EOF空白差异保留。 |
| #121 | `db5e74df236983c979093b0e40c279686f0aa055` | [COMMENT](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/121#pullrequestreview-5724780375) | 文字素材/缓存/有界HTTP/取消推荐补图；28.393s仅早于最终增量的一次暖素材模块样本。 |
| #83 | `26df1432218a15f49f3de1a796dc19d3d63da287` | [COMMENT](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/83#pullrequestreview-5724187752) | 选后异步后端；旧一次真实Seedream图和受控文字，不是最终ecee真图或真实文字闭环。 |
| #84 | `e2899a1c0789fa929b39de3a26ede77458f52c36` | [COMMENT](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/84#pullrequestreview-5724195494) | 选后前端只读poll/失效；旧Chrome回放复用83原图，非新增真实供应商。 |
| #95 | `1447b4233773e28bfbdd50636eb6af148166536f` | [COMMENT](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/95#pullrequestreview-5724463591) | 本地字体扩展；不证明所有字形或最终Linux字体环境。 |
| #102 | `1db4949bf7edee0d6c617a6b71958747ea325587` | [COMMENT](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/102#pullrequestreview-5724463329) | 选后版式/骨架；原浏览器与素材回放的时点和旧失败均保留，空章后续已由115改变。 |

旧全量仅索引：受测 `42a1accc7159cae6ee4c6e11e7e170ad02eb1a81`，363 tests / 349 pass / 12 fail / 2 skip / exit1。它不是ecee结果；本次51+1不覆盖全部旧失败。

原始根：`E:\黑客松\.worktrees\integration-qa-42a1accc-20261031\.tmp`。不大量复制旧全量输出；hash索引如下：

- `integration-qa-report.md` SHA256 `d58afcdf4b53ec555b2ee18ebb2f5858a441b3aca6579ec3c5a3a26f52fb3ff5`
- `qa-run-environment.json` SHA256 `7e7e28bb04571ca9d500f620f37f568d0c18120fb16b07d0bb96440874eb5341`
- `qa-run-result.json` SHA256 `cae5db14fe9fcba6c607406cc6ef697a42272529be763f1dd3297c460270bb3a`
- `qa-failures.json` SHA256 `3e3b1b58545c40c70527771e388c282047fec3b9e7e287cb8d9c291fc2a5c3f0`
- `web-full-raw.txt` SHA256 `7d5d3d9976dd2842d93de31f32ae18771304368606f01c45f943e1411ff3b09d`
- `web-full-stderr.txt` SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `qa-final-state-manifest.json` SHA256 `8d9e9c4f2e8d2af467a2987a12d4f29bef8ba581c1d6fd41b665040907530bad`
