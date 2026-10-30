# GiftWise AI｜14 阶段流程当前状态（2026-10-30 晚）

- 依据：Issue [#4](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/4) 的 14 阶段流程与 Gate 约定
  （**阶段 1–6 冻结后，7–8 才并行**）
- 整理人：GiftWise｜PM Agent
- 截止：**2026-11-01（周日）10:30 北京时间**；评审形式：5 分钟讲演 + 3 分钟现场 Demo + 7 分钟问答

## 总表

| 阶段 | 产出物 | 状态 | 关键证据 |
| --- | --- | --- | --- |
| **1 需求分析** | `docs/requirements-analysis.md` v1.0 | ✅ **冻结** | 用户画像、关系优先级、痛点 P-1…P-5、成功判据 SC-1…SC-9、边界；OPEN-1/2/3/4/9 已关闭 |
| **2 产品设计/PRD** | `docs/product-requirements.md`、`user-stories.md`、`product-flow.md`、`acceptance-criteria.md` | ✅ **冻结** | PRD 6 处修订；验收标准 5 处 + G-1…G-4 缺口节 |
| **3 技术方案设计** | `docs/architecture.md`、`docs/architecture/`（ADR-001…004、`observability.md`、`cost-performance-metrics.md`、图源 + 渲染 SVG） | ✅ **冻结** | ADR 记录 4 项取舍；架构图为赛道 B 必交件 |
| **4 数据模型** | `docs/intake-contract.md`、`validator-contract-decisions.md`、`workflow/labels.py`、`workflow/generated/manifest.json` | ✅ **冻结** | 10 个关系值（含 `partner`=恋人、`pursuit`=追求对象）；`colleague` 仅技术回归；生成物哈希可校验 |
| **5 API 契约** | `docs/intake-contract.md`、`deploy/README.md` 状态码矩阵 | ✅ **冻结** | `POST /validate`、`GET /healthz`、400/404/413/500 全矩阵**已实测** |
| **6 前后端任务拆分** | 子 Issue #5–#11 + #4 任务单索引 | ✅ **完成** | Gate 满足 |
| **7 开发实现** | `validator/`、`workflow/`、`web/`、`deploy/` | ✅ **基本完成** | 规则、工作流、接入层、部署包均已存在并可真实运行 |
| **8 单元测试** | `tests/` | ✅ **已完成** | **322 条通过**（`unittest discover`） |
| **9 接口/契约测试** | `web/tools/parity-*.mjs`、`workflow/verify_local.py`、`deploy` 状态码矩阵 | ✅ **已完成** | JS↔Python **55 组 / 0 差异**；本机探针 **46 条通过**；容器 5 条错误路径全符合契约 |
| **10 联调** | 前端 ↔ 真实 Dify | ⚠️ **未完成** | `web/` 目前跑 **mock** 模式；**没有**"真实模型 + 真实界面"的端到端链路 |
| **11 E2E/回归** | 组合回归 | 🟡 **局部完成** | 46 探针 + 322 测试 + 容器 9/9 + 前端冒烟 59 项全绿；但**缺真实端到端** |
| **12 预发验证** | 预发环境 | ❌ **未执行** | 无云主机、无 EIP、未采购（按边界不得自行开支）；见 `deploy/preprod-plan.md` 路线 C |
| **13 上线/Demo 冻结** | `release/2026-11-01-submission`（PR [#12](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/12)） | 🟡 **进行中** | 快照已提交并推送；PPT/讲稿/兜底/视频分镜由发布线制作中 |
| **14 监控/日志/迭代** | `deploy/observability-collection.md` | 🟡 **设计完成、实现进行中** | 采集方案为设计；部署线正在写实现代码，**尚未完成** |

## Gate 判定

**阶段 1–6 已全部冻结／完成，Gate 满足**，因此阶段 7–8 的并行开发是合规的。
阶段 7、8、9 已有可复核证据；**10、12 是真正的缺口；11 只做到局部；13、14 进行中**。

## 到截止前的关键路径

| 序 | 事项 | 负责 | 备注 |
| --- | --- | --- | --- |
| 1 | PPT（含第 8 页"明确未完成"）、3 分钟讲稿、**现场失败兜底**、视频分镜 | 发布线 | 最靠近截止；兜底是硬要求 |
| 2 | Dify 草稿最新状态读回 + 明确写"**未发布、未创建版本**" | 工作流线 | 既是 #7 验收条件，**也是现场 Demo 可运行性的前提** |
| 3 | 独立复核容器证据（无缓存重建） | QA | 进行中；若发现不一致由 PM 修正 |
| 4 | 复核 PM 对架构文档的更正 | 架构线 | PM 已提交 `d5130b5`/`dc1124a` |
| 5 | 阶段 14 采集实现 | 部署线 | 工程化/可观测性得分项 |
| 6 | **DeepSeek 单位价格**（从真实账单） | **用户** | 未提供前一律写"未核实" |
| 7 | 3 分钟 Demo 视频录制 | **用户/团队** | 发布线只出分镜与台词 |

## 诚实声明（不得在答辩中改写）

- **云部署从未发生**，`publish-to-uhost.ps1` 从未上传，未推镜像仓库，无编排/多副本/弹性伸缩/资源调度。
- **Dify 工作流未发布、未创建版本**；平台级 trace 不可用（租户未开 tracing）。
- `web/` 为 **mock 模式**，其四段呈现（风格配色→包装→贺卡→赠送）是模拟数据；Dify 侧该阶段**未实现**。
- 价格、库存**未核实**（`business_data_verification: not_verified`）；无真实商品数据源。
- 前端**未在真实浏览器中验证**界面；parity 是**样例级等价**，非全域等价。
