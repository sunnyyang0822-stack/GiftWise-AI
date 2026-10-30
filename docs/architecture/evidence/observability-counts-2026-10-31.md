# 可观测性三个数字的出处与架构线独立复跑（2026-10-31）

**为什么有这份文件**：竞赛架构图 ⑤ 层「可观测入口」一格的三个数字
（本机 **39/39**、容器内 **24/24**、脚本静态 **17/17**）此前在 PM 掌握的材料里查不到出处。
本文件给出**逐条出处（文件:行 + 命令）**，并由架构线**独立复跑**，原始输出与本文件同目录。

> 口径纪律：本文件只登记**能追到命令与原始输出**的数字；复跑与原文不一致的，照实写。

## 1. 出处（部署线归档文件）

三者同源于 `deploy/evidence/observability-2026-10-30.md`（阶段 14 可观测性实现与真跑证据）：

| 数字 | 该文件位置 | 内容 |
| --- | --- | --- |
| 本机 39/39 | `:14`（总述）、第 1 节表格 | 本机实现与断言 |
| 容器内 24/24 | `:26`（表格行）、`:247`（命令汇总） | `python:3.12-slim` 容器内、只读挂载 + 命令覆盖 |
| 脚本静态 17/17 | `:27`、`:142`、`:144`、`:255` | `deploy/publish-to-uhost.ps1` 的静态断言，**不连接任何主机、不产生费用** |

同文件 `deploy/evidence/README.md:25` 亦如此登记。

## 2. 架构线独立复跑（2026-10-31）

| 项 | 命令 | 我的结果 | 原始输出 |
| --- | --- | --- | --- |
| 本机 39 项 | `python deploy/evidence/observability_check.py` | ✅ **39/39 通过**，exit 0（01:19） | [`observability-host-39-2026-10-31.txt`](observability-host-39-2026-10-31.txt) |
| 容器内 24 项 | `python deploy/evidence/observability_container_check.py` | ✅ **24/24 通过**（01:22） | [`observability-container-24-2026-10-31.txt`](observability-container-24-2026-10-31.txt) |
| 脚本静态 17 项 | `python deploy/evidence/ps1_static_check.py` | ✅ **17/17 通过**（见下「复跑过程」） | [`ps1-static-rerun-2026-10-31.txt`](ps1-static-rerun-2026-10-31.txt) |

结论：**三项均可在 2026-10-31 复现通过**，与部署线证据一致。

**跨线副作用说明（为什么容器项我敢跑）**：`observability_container_check.py` 的自述
（`:4`）是用现有 `deploy/Dockerfile` 构建但打**独立 tag** `giftwise-validator:obs-check`，
**不改 Dockerfile、不动 `latest` 与交付镜像 `submission-20261101`**，因此不与部署线的交付物冲突。

## 3. 复跑过程的一个真实插曲（照实登记）

第一次复跑脚本静态项时（约 **01:17**）结果是 **15/17**，两项 FAIL：

1. `脚本为纯 ASCII 且无 UTF-8 BOM` → `{'bom': False, '非 ASCII 字节数': 150}`
2. `-DryRun 打印了将上传的 5 个文件（含 N-1 新增的可观测入口两份实现）` → 实际只列出 **4** 个：
   `validator/rules.py`、`deploy/server.py`、`deploy/Dockerfile`、`deploy/observable_server.py`
   （**未见 `deploy/observability.py`**，而 `observable_server.py` 依赖它）

**但当时 `deploy/publish-to-uhost.ps1` 与 `deploy/evidence/ps1_static_check.py` 的 mtime 分别是
01:17:50 与 01:17:26，即部署线正在同时编辑这两个文件**。3 分钟后（01:20）复跑即为 **17/17 通过**。

因此判定：**15/17 是编辑中的中间态，不是缺陷**，本文件不将其登记为缺陷。
此插曲已另行报告 PM（因为它说明"上传清单是否包含 `observability.py`"这一点值得部署线自查一次）。

## 4. 边界

- 本文件只验证**断言可复现**；不代表云端已部署、镜像已推仓库（两者均**未发生**）。
- 复跑使用本机 Docker 与本机端口；`observability_check.py` 不接触 Docker。
- 交付镜像的 `/validate` 一致性由另一支独立探针负责：
  [`probes/verify_container_parity.py`](../probes/verify_container_parity.py)（9/9 组逐字节一致）。
