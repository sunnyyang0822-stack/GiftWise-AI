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
```

聚合入口是 [`tools/verify_all.py`](../../tools/verify_all.py)（零第三方依赖）。

**关于颜色**：本工具**不许把失败变绿**。**2026-10-31 00:51 时点**的全量实测为 `PASS 15 / FAIL 5 / SKIP 1`（**不是当前值**——其中 4 项缺口已于 2026-10-31 晚些时候闭合，见 [`复核指南-2026-10-31.md`](复核指南-2026-10-31.md) 顶部时点勘误）——
5 项 FAIL 都是**真实缺陷**（详见指南 §3），不是工具故障；`SKIP` 一律写明原因，且**未跑 ≠ 通过**。
