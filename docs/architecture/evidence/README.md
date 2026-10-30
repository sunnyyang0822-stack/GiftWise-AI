# 架构线证据与复跑原始输出

本目录存放**架构线（Issue #5）自己复跑得到的原始输出**，供评委与 PM 直接核对。
每个文件顶部都写了**时间、命令、判定**；不修改任何原始输出的内容。

| 文件 | 内容 | 结论 |
| --- | --- | --- |
| [`container-parity-2026-10-31.txt`](container-parity-2026-10-31.txt) | 交付镜像 `/validate` 与本机 `validator/rules.py` 逐字节比对**首轮**（探针见 [`../probes/verify_container_parity.py`](../probes/verify_container_parity.py)） | **9/9 组一致**；`rules_source_sha256` 一致 |
| [`container-parity-2026-10-31-run2.txt`](container-parity-2026-10-31-run2.txt) | **镜像 ID 漂移后对当前 tag 重跑**（见下「镜像 ID 会漂移」） | 仍 **9/9 组一致** |
| [`default-entry-vs-observable-2026-10-31.txt`](default-entry-vs-observable-2026-10-31.txt) | 默认入口 vs 可观测入口的端点矩阵、镜像内 `/app/deploy` 文件树、`/metrics` 鉴权实测 | 默认入口 `/metrics` **404**；显式启动后 **200 且未鉴权** |
| [`observability-host-39-2026-10-31.txt`](observability-host-39-2026-10-31.txt) | `python deploy/evidence/observability_check.py` | **39/39 通过**，exit 0 |
| [`observability-container-24-2026-10-31.txt`](observability-container-24-2026-10-31.txt) | `python deploy/evidence/observability_container_check.py`（独立 tag `obs-check`，不动交付镜像） | **24/24 通过** |
| [`ps1-static-rerun-2026-10-31.txt`](ps1-static-rerun-2026-10-31.txt) | `python deploy/evidence/ps1_static_check.py`（不连接主机、不产生费用） | **17/17 通过** |
| [`observability-counts-2026-10-31.md`](observability-counts-2026-10-31.md) | 竞赛图 ⑤ 层三个数字的**出处清单**与复跑记录 | 三项均可复现 |

## 两条容易被记录错的镜像事实（本目录以实测为准）

**1. 镜像 ID 会漂移，不得作为交付标识。** 同一会话内 `giftwise-validator:submission-20261101`
的 ID 已由 `c15d1afee2d2` 变为 **`d9a4a35763ee`**（`Created 2026-10-30T17:13:59Z`）。
因此本目录与 ADR-003 一律以「**tag ＋ 构建日期 ＋ `/healthz` 的 `rules_source_sha256`**」锚定版本。
（架构线早前据一个随后被替换的镜像 ID 误记过「默认入口已改」，已按 PM 裁决更正。）

**2. 可观测入口「已随镜像交付，但不是默认入口」。** 实测：
`ls -l /app/deploy` → `observable_server.py`(15,511 B)、`observability.py`(21,077 B) **均在镜像内**；
但 `Cmd=["python","-m","deploy.server"]`，故默认入口 `/metrics`、`/readyz` **均为 404**；
显式 `python -m deploy.observable_server` 启动后 `/metrics` 返回 200，且**未鉴权**
（匿名与伪造 Basic 认证均 200，并暴露 `giftwise_build_info` 的版本与规则源指纹）——
**不得直接暴露公网**。

**边界**：以上只证明"断言可在本机复现"，**不代表云端已部署、镜像已推仓库或已购买任何付费资源**（均未发生）。
