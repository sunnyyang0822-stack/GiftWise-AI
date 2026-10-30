# GiftWise AI · web 前端与最小服务端接入层

任务号：**WEB-WF-001（WEB-001）** ｜ 主责：GiftWise｜前端开发 Agent ｜ 日期：2026-10-30
详细交付证据与限制见 [REPORT-WEB-001.md](./REPORT-WEB-001.md)。

## 这是什么

中文最小可运行前端 + 一个零依赖的服务端接入层，跑通这条闭环：

```
三步中文表单 → 服务端确定性适配 → 生成三候选 → 独立规则校验
  → 最多一次自动修订并复检 → 用户自己选一个合格方案
  → 选择后才生成四段呈现 → 呈现复核（全量费用/准备时间/禁忌）
```

**当前是模拟数据模式。** 接入层未配置真实模型凭证（DIFY_API_KEY），从未成功调用过一次，
所以候选与呈现内容来自接入层内置的固定模拟数据，页面顶部常驻黄色警示横幅说明这一点。
**不要把它读作已联通 Dify 或已有真实模型输出。**

## 目录结构

```
web/
├── package.json                 零依赖脚本入口
├── public/                      前端（原生 ES module，无框架、无构建）
│   ├── index.html               首屏（沿用 GiftWise 首页视觉语言）+ 三步说明
│   ├── app.js                   三步表单、三方案对比、呈现页、六种中文状态
│   └── styles.css               暖白底 / 近黑字 / 黑底胶囊按钮 / 细边框白卡
├── server/                      最小服务端接入层
│   ├── server.mjs               HTTP 入口：静态资源 + /api/*
│   ├── config.mjs               唯一开关集中点（PURSUIT_CONTRACT_READY、模拟标识、上限、区间）
│   ├── labels.mjs               intake-v1 标签表（产品面 8 关系，不含同事）
│   ├── jsonstrict.mjs           严格 JSON 解析/序列化（重复键、NaN、尾随内容、int/float 区分）
│   ├── intake.mjs               确定性适配（对齐 workflow/intake.py）
│   ├── checker.mjs              独立规则校验（对齐 validator/rules.py）+ 呈现阶段复核
│   ├── mock-model.mjs           模拟候选/修订/呈现（显眼标注，关系文案独立）
│   ├── dify.mjs                 真实 Dify 调用（密钥只在服务端；未配置就明确报错）
│   ├── store.mjs                服务端可信任务快照与修订计数
│   └── pipeline.mjs             两阶段主流程编排
├── tests/
│   └── access-layer.test.mjs    40 项单元检查（node:test）
└── tools/
    ├── gen-parity-fixtures.mjs  生成 JS↔Python 比对用的固定样例
    ├── parity-reference.py      调仓库 Python 参考实现算期望结果（只读，不改既有文件）
    ├── parity-check.mjs         逐项比对两侧结果
    ├── smoke-http.mjs           59 项 HTTP 冒烟检查
    ├── browser-check.mjs        真实 Chromium 自查（CDP，6 场景 / 100 项检查 + 截图）
    └── page-probe.mjs           最小页面探针：首帧是否真的渲染、有无页面异常（3 秒）
```

接入层目录选在 `web/server/` 而不是仓库根的 `server/`：它只服务前端闭环，
和 `deploy/`（另一线的 HTTP API/Docker 交付）不重叠，避免撞别人的文件。

## 运行

需要 Node.js ≥ 18（实测 v24.21.0）。不需要 `npm install`，仓库里没有第三方依赖。

```bash
# 1. 启动（默认 http://127.0.0.1:8787）
node web/server/server.mjs

# 2. 浏览器打开
#    http://127.0.0.1:8787
```

自检命令（服务端两条 + 浏览器两条 + 语义比对三步）：

```bash
node web/tests/access-layer.test.mjs   # 单元检查（40 项）
node web/tools/smoke-http.mjs          # HTTP 冒烟（59 项，需服务已启动）

# 真实浏览器自查（需先起一个带远程调试端口的 Chrome，命令见 HANDOFF 第 1 节）
GW_CDP=http://127.0.0.1:9333 node web/tools/page-probe.mjs      # 3 秒：首帧是否真的渲染
GW_CDP=http://127.0.0.1:9333 node web/tools/browser-check.mjs   # 6 场景 / 100 项检查 + 截图

# JS↔Python 语义比对（三步，产出落在 .tmp/，不提交）
node web/tools/gen-parity-fixtures.mjs
python web/tools/parity-reference.py
node web/tools/parity-check.mjs
```

> 单测与 HTTP 冒烟都是**服务端视角**；前端首帧是否真的可交互只能靠真实浏览器验证
> ——2026-10-30 深夜的浏览器自查救回了一个致命 bug（`bootstrap()` 在配置未就位时渲染表单，
> 抛 `TypeError` 导致首屏完全点不动）。交接状态与未完成清单见
> [HANDOFF-2026-10-30.md](./HANDOFF-2026-10-30.md)。

### 可用的环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `GW_PORT` / `GW_HOST` | `8787` / `127.0.0.1` | 监听地址 |
| `GW_MODE` | 自动（有 Dify 配置才 `dify`） | 强制 `mock` 或 `dify` |
| `GW_PURSUIT_CONTRACT_READY` | `1`（见报告核实依据） | `0` 时提交「追求对象」被中文拒绝，界面仍可选 |
| `DIFY_API_BASE`、`DIFY_API_KEY` | 未配置 | 只在服务端读；不进前端、不进仓库、不进日志 |
| `DIFY_PUBLISHED_VERIFIED` | `0` | 未确认发布前拒绝把结果标成真实调用 |

例：想看「契约未落地」的表现：

```bash
GW_PORT=8788 GW_PURSUIT_CONTRACT_READY=0 node web/server/server.mjs
```

### 演示开关（只为验证失败与超时路径）

页面底部「演示开关」折叠面板，或地址栏参数：

| 参数 | 效果 |
| --- | --- |
| `?demo=model_error` | 模拟模型两次都输出损坏 JSON → 错误态、零可选 |
| `?demo=partial_fail` | 一个候选引用不存在的事实 → 部分通过、失败项不可选 |
| `?demo=presentation_over_budget` | 呈现首次复核超预算一分钱 → 走全局唯一一次修订 |
| `?demo=stress` | 超长中文 + emoji + 不可断行长串 → 前端破版自查用（结构不变，校验仍通过） |
| `?demo=slow` | 服务端延迟 45 秒 → 前端 20 秒超时状态 |

## 界面承诺（都已实现）

- 关系单选 **8 项**：恋人 `partner`、追求对象 `pursuit`、朋友、家人、同学、老师/导师、客户/合作伙伴、其他。
  **不出现「同事」**；恋人与追求对象各有独立提示与输出文案。
- 预算与准备天数：**先选区间 → 再填明确上限/天数 → 再勾选确认**，三步缺一不可；不静默补默认值；0 天允许；首版仅 CNY。
- 兴趣 12 项逐项「明确知道 / 只是猜测」，默认猜测；「暂时不知道」是**互斥界面状态**，提交 `interests: []` + `interest_confidence: {}`。
- 风格 7 项 + 「不确定」互斥；风格视为送礼者偏好，不当作收礼人事实。
- 禁忌分三层：类别（`tags`）、用户确认的字面词（`terms`）、无法表达的待澄清项（`unresolved`，提交时要求澄清，不静默忽略）。
- 中文状态：加载中、空状态、错误、超时、无可选方案、未选择。
- 窄屏可操作：44px 以上触控目标、粘性底部动作条、无横向滚动、`prefers-reduced-motion` 降级。
- 不要求注册、不要求真实姓名。

## 信任边界

- 浏览器只提交 intake 契约字段。提交 `facts` / `available_days` / `passed` / `repair_count`
  会得到 `INTAKE_UNKNOWN_FIELD`，服务端不生成请求。
- `selectable_candidate_ids`、`selected_candidate_id`、`repair_count` 全部由服务端 `store.mjs` 持有。
- 推荐阶段 `selected_candidate_id` 恒为 `null`；失败项不可选；系统不自动替选。
- 全局自动业务修订合计最多 1 次，跨推荐与呈现两阶段；额度用完后如实报失败，不开第二次。
- 重复选择同一候选是幂等的，并在响应里带 `idempotent_replay: true`，让调用方看得见重放。

## 我不碰的范围

只写 `web/`（与本目录下的工具、测试）。没改 `validator/`、`workflow/`、`tests/`、`docs/` 下任何既有文件，
也没改 `AGENTS.md` 与共享契约 `docs/intake-contract.md`。未提交、未推送、未部署、未触碰 Dify 草稿
（2026-10-30 23:04 的 Dify 发布是工作流线自己的动作，我只读过他们的证据文件，未发起任何真实模型调用）。
交接状态与未完成清单见 [HANDOFF-2026-10-30.md](./HANDOFF-2026-10-30.md)。
