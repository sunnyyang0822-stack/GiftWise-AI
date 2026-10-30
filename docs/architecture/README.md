# 架构文档目录（ARCH-001 归属）

本目录由 **GiftWise｜架构 Agent** 在 **ARCH-001（阶段 3 技术方案设计）** 下创建与维护。所有文件均为架构线新建，**不修改** `workflow/`、`validator/`、`tests/`、`web/`、`deploy/` 及任何产品文档。

## 文件清单与用途

| 文件 | 用途 | 对应评分规则（赛道 B） |
| --- | --- | --- |
| [`../architecture.md`](../architecture.md) | **主文档**：为什么采用该架构、组件与依赖方向、云原生取舍、异常处理独立成节 | 系统架构设计文档（1.2 重点交付物）+ 异常处理说明 |
| [`observability.md`](observability.md) | 可观测性字段、语义、落点与替代路径（与 CLOUD-001 对齐） | 可观测性证据 |
| [`cost-performance-metrics.md`](cost-performance-metrics.md) | 成本与性能指标：测什么、怎么测、当前未知项 | 成本、性能与工程化分析 |
| [`diagrams/system-architecture.mmd`](diagrams/system-architecture.mmd) | 主架构图源（组件／边界／数据流，颜色即证据等级） | 架构图（赛道 B 必交） |
| [`diagrams/failure-recovery.mmd`](diagrams/failure-recovery.mmd) | 异常处理与状态恢复流程 | 异常处理说明 |
| [`diagrams/observability-flow.mmd`](diagrams/observability-flow.mmd) | 可观测性数据流与落点分级 | 可观测性证据 |
| [`rendered/`](rendered/) | 三张图的**渲染产物（SVG）**，可直接放入 PPT | 架构图 |
| [`adr/`](adr/) | 4 份架构决策记录（取舍与被否决方案） | 技术选型及设计理由 |

## 架构决策记录（ADR）

| 编号 | 决策 | 核心实测依据 |
| --- | --- | --- |
| [ADR-001](adr/ADR-001-rules-inline-not-microservice.md) | 确定性规则**内联执行**，不拆微服务 | 纯函数 p50 0.166 ms vs HTTP 往返 p50 12.545 ms；Code 节点 28.9 KB 实测可执行 |
| [ADR-002](adr/ADR-002-two-phase-and-trusted-state.md) | **两阶段工作流 + 服务端可信快照** | Dify 不适合停下等待交互；前端派生字段已被实测拒绝 |
| [ADR-003](adr/ADR-003-cloud-native-tradeoffs.md) | Docker 计划、**K8S 不采用**、微服务不采用 | 无并发数据；计算快而传输贵；未做任何压力测试 |
| [ADR-004](adr/ADR-004-observability-without-platform-trace.md) | 无平台追踪下的**三级替代路径 + 版本哈希锚定** | 本租户 `trace-runs` 返回 `not_collected`（实测） |

## 图的渲染与校验

三张图均已用**本机 Chrome（headless）+ mermaid 11 真实渲染通过**，产物在 `rendered/`：

```bash
# 重新渲染 + 语法校验（辅助脚本不属于交付物；见主文档 §10.4）
python .tmp/render_mermaid.py
```

若需在别处渲染（如在线编辑器或 `mmdc`）：

```bash
mmdc -i diagrams/system-architecture.mmd -o rendered/system-architecture.svg
```

**同步约定**：`.mmd` 文件是单一事实源；`../architecture.md` 与 `observability.md` 中内嵌的 Mermaid 块**必须与对应 `.mmd` 逐行一致**（忽略 `%%` 注释行）。修改图时改 `.mmd` → 重新渲染 → 同步内嵌块。

## 证据等级约定（全文统一）

| 等级 | 含义 |
| --- | --- |
| **E1 已实测** | 有命令与输出、服务端实读回执或哈希 |
| **E2 已实现未实测** | 代码存在，该路径从未真实跑通 |
| **P 占位实现** | 接线在跑，但不产生真实结果 |
| **E3 计划／未实现** | 只有设计，无实现 |
| **U 未知** | 无数据，记 `unknown`／`not_measured`，**不填默认值** |

## 命名协调（避免与 CLOUD-001 冲突）

- 架构线产物**全部收在本目录**（`docs/architecture/`）与 `docs/architecture.md`。
- CLOUD-001（部署 Agent）的采集实现落在 `deploy/**` 与其自选文件名；**字段名以 [`observability.md`](observability.md) §3 为准**，不另起同义字段。
- 当前**无文件名冲突**；若部署线需要同名文件，由 PM 裁决。

## 相关外部证据（非本目录，只读引用）

| 文件 | 内容 |
| --- | --- |
| [`../../workflow/evidence/WF-002-2026-10-30.md`](../../workflow/evidence/WF-002-2026-10-30.md) | Dify Cloud Code 节点沙箱探针（真实执行、0 Tokens） |
| [`../../workflow/evidence/WF-003-2026-10-30.md`](../../workflow/evidence/WF-003-2026-10-30.md) | N1–N7 接线、五类用例真实运行、DeepSeek 可用性核查 |
| [`../test-reports/stage-c/acceptance-2026-10-30.md`](../test-reports/stage-c/acceptance-2026-10-30.md) | 测试验收 Agent 独立复核（含缺陷清单与三段清单） |
| [`../requirements-analysis.md`](../requirements-analysis.md) | 阶段 1 冻结件（SC-1…SC-9、OPEN-1…OPEN-9） |
