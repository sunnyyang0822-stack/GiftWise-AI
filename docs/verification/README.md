# docs/verification/ —— 可复核性工程（VERIFY-GUIDE-001）

本目录属于 Issue [#29](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/29) **VERIFY-GUIDE-001** 的可写边界，内容如下：

| 文件 / 目录 | 用途 |
| --- | --- |
| [`复核指南-2026-10-31.md`](复核指南-2026-10-31.md) | **主交付物**：每条对外声明 → 一条可跑命令 → 预期输出；含已知未修缺口与不可核查项 |
| [`发现的问题.md`](发现的问题.md) | 跨线问题登记（**只登记，不代修**），供 PM 派发 |
| `runs/<时间戳>/` | 每次运行的**完整原始输出**归档（append-only，绝不覆盖历史） |

## 三条命令

```bash
python tools/verify_all.py            # 快速档（无需 Docker）
python tools/verify_all.py --full     # 完整档（含 Docker：镜像构建 / 容器内检查 / I-2 探针）
python tools/verify_all.py --list     # 列出全部检查名
python tools/verify_guide_selfcheck.py  # 核对指南 §0.4 结果表与归档是否一致（指南自身也要可验证）
#   ⚠️ 它默认取 runs/ 下**最新归档**，而指南 §0.4 是 2026-10-31 00:51:52 的**时点表** ⇒ 此后任何一次新跑
#      都会让它报"不一致"，**这属预期**（脚本自己在失败输出里也打印这条提示）。判定"指南是否被改动"请用：
python tools/verify_guide_selfcheck.py --run docs/verification/runs/20261031T005152+0800   # 实测 rc=0 ✅
```

**现场怎么跑、不要跑什么**：答辩现场请跑指南 [§0.5](复核指南-2026-10-31.md) 的两条干净命令（`node web/tools/parity-check.mjs`；`python -m deploy.server` ＋ `python docs/demo/bin/run-rules-layer-demo.py`），**不要**在现场跑 `python tools/verify_all.py`／`--full`（约 93 秒且**必然以退出码 1 收场**，唯一 FAIL 是已知残差 `js_range_parity`）。
一切 46 探针类命令**必须在带 `.git` 的 `git clone` 目录里跑**（`workflow/verify_local.py:189` 无条件执行 `git rev-parse HEAD`；zip 目录里 46 项跑完会抛 `CalledProcessError … exit status 128`）。浏览器自查（`web/tools/browser-check.mjs`／`page-probe.mjs`）**必须先自己起 Chrome CDP**，否则 rc=2／rc=1。

聚合入口是 [`tools/verify_all.py`](../../tools/verify_all.py)（零第三方依赖）。

**关于颜色**：本工具**不许把失败变绿**。**2026-10-31 00:51 时点**的全量实测为 `PASS 15 / FAIL 5 / SKIP 1`（**不是当前值**——其中 4 项缺口已于 2026-10-31 晚些时候闭合，见 [`复核指南-2026-10-31.md`](复核指南-2026-10-31.md) 顶部时点勘误）——
5 项 FAIL 都是**真实缺陷**（详见指南 §3），不是工具故障；`SKIP` 一律写明原因，且**未跑 ≠ 通过**。
