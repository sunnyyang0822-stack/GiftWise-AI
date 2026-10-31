# GiftWise AI · Demo 预演与兜底包（DEMO-001）

> 归属任务：**DEMO-001**（[Issue #27](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/27)）
> 冻结版本：预演开始时 `351330da346f7382d86d34d822bd000b7228c3c2`
> （预演进行中 HEAD 被另一个 Agent 推进到 `ae0ea58`，见 [`demo-rehearsal-record.md`](demo-rehearsal-record.md) 顶部的版本漂移声明）
> 预演日期：2026-10-31 00:25–01:00（Asia/Shanghai）

## 这个包是干什么的

任务书的原话：

> 你的任务不是让 Demo 更漂亮，而是**让它不可能挂住**。

所以这里没有美化工作，全部是**"挂住也不会崩"**的准备：
真跑一遍 → 找出所有会翻车的点 → **逐个把兜底做出来并验证** → 现场检查清单 → 3 分钟时间轴。

**一句话**：主路径可以失败，但这个包保证**任何一环失败时，主持人知道该按哪个键、该说什么话，而且那一步已经被验证过。**

---

## 5 分钟上手

```bash
cd <仓库根>

# 0) 出问题先看这个：约 9 秒跑完（2026-10-31 复测 9,013 ms），退出码 0 = 没有 FAIL
bash docs/demo/bin/preflight.sh

# 1) 起服务（端口自动避让，不需要 timeout）
bash docs/demo/bin/servers.sh start        # 会打印"演示入口： http://127.0.0.1:<端口>"

# 2) 最不可能挂的一段：纯规则层，零模型、零公网
python -m deploy.server                    # 另开一个终端
python docs/demo/bin/run-rules-layer-demo.py

# 3) 最后的兜底：双击就能开，不需要任何服务
#    docs/demo/replay/offline-replay.html

# 4) 收工
bash docs/demo/bin/servers.sh stop
```

---

## 文件导航

### 🔴 先看这四份（PM 指定交付物，2026-10-31 夜新增）

| 文件 | 是什么 | 什么时候看 |
| --- | --- | --- |
| [`分镜计时表-3min.md`](分镜计时表-3min.md) | **3 分钟分镜与计时表**，按 PM 指定的四段切分（0:00–0:30 / 0:30–1:30 / 1:30–2:20 / 2:20–3:00），每段给出**讲什么 / 屏幕应出现什么 / 时间上限**，并标出**哪几段真的烧额度** | 开演前背熟 |
| [`故障处置卡.md`](故障处置卡.md) | **故障处置卡**：10 张卡，每张 = 症状 + 一句话话术 + 备用演示路径。覆盖 Dify 打不开 / 额度耗尽 / 网络断 / 页面白屏 + 6 个本轮实测故障点 | 打印放手边 |
| [`预演检查表.md`](预演检查表.md) | **预演检查表**：前一晚 T-10 组 + 当天早上 T-01 组，覆盖端口 / mock 标识 / 额度余量 / 浏览器缓存 | 前一晚 + 当天早上各跑一遍 |
| [`replay/offline-replay.html`](replay/offline-replay.html) | **离线回放兜底**：自包含单文件（零外部依赖），断网/断额度/白屏都能**整段演完 3 分钟**（本轮已补齐输入阶段，快照 19 → 21 块） | 双击打开，全程常驻 |

### 给现场用（按开演时间顺序）

| 文件 | 什么时候看 |
| --- | --- |
| [`runbook-T10-checklist.md`](runbook-T10-checklist.md) | **T-10 分钟起**，逐项打勾。具体到"确认 8000 端口未被占"。⚠️ 这是**更细的旧版**；PM 指定的新版是 [`预演检查表.md`](预演检查表.md) |
| [`timeline-3min.md`](timeline-3min.md) | **15 秒粒度**细表。已按"已发布·版本 2"口径重写；四段骨架以 [`分镜计时表-3min.md`](分镜计时表-3min.md) 为准 |
| [`fallback-verification.md`](fallback-verification.md) | 兜底**怎么验证的**（每一条都有原始命令和输出） |
| [`replay/offline-replay.html`](replay/offline-replay.html) | **双击打开，全程常驻**。故障时一次 `Alt+Tab` 切过去 |

### 给 PM / 复盘用

| 文件 | 内容 |
| --- | --- |
| [`demo-rehearsal-record.md`](demo-rehearsal-record.md) | 本轮真跑的实际命令、耗时、结果、截图；以及**没做到的事** |
| [`failure-modes.md`](failure-modes.md) | **21 条翻车点**，标注"已复现/未复现"，每条带证据与兜底 |
| [`脚本修订建议.md`](脚本修订建议.md) | 交给发布线 #9 的修订清单（**我没有改 `docs/demo-script.md`**） |

### 可执行工具

| 工具 | 用途 | 实测 |
| --- | --- | --- |
| `bin/preflight.sh` | T-10 一键自检 | **9,013 ms**（2026-10-31 复测；旧稿 `4183 ms` 已过期），退出码 0 |
| `bin/servers.sh` | 起/停服务，端口自动避让 + 精确回收 | ✅ 避让 8787→8788；停服务无连带损伤 |
| `bin/run-rules-layer-demo.py` | 纯规则层现场跑（零模型零公网） | ✅ **6/6 通过**，515 ms |
| `bin/retry-on-404.mjs` | 判断 404 是"别人正在写"还是真问题 | ✅ 三分支全部正确分类 |
| `tools/build-snapshot.py` | 从归档提取证据，生成离线快照 | ✅ **21 块**（输入阶段 I-01/I-02 已补），**0 新模型调用**，335 ms |
| `tools/build-replay.py` | 生成自包含回放页 | ✅ 53.5 KiB，**0 外部依赖**，244 ms |
| `shots/*.png` | 真实浏览器截图 **15 张**（另有 `docs/demo/pack/shots/` **24 张**） | ✅ 0 控制台错误 |

---

## 诚实边界（这是本包的核心纪律）

任务书原话："**违反即返工**"。所以这里把边界写死在**数据结构**里，而不是靠人记得。

### 四类证据，颜色强制区分

回放页的角标**由 `evidence_kind` 字段决定，不允许人工改写文案**：

| 角标 | `evidence_kind` | 含义 | 能不能说成"真实模型输出" |
| --- | --- | --- | --- |
| 🟩 **已归档·真实模型输出** | `archived_real_model` | 归档里**真的**由 `deepseek-v4-flash` 生成的原文 | ✅ 可以，但必须说明"**这是归档，本次没有发起新调用**" |
| 🟦 **本机·真实规则代码** | `local_real_rules` | 本机校验器的真实结果 | ⚠️ 是真实的，但**不是模型**——不能说成"模型判断的" |
| 🟧 **模拟数据·界面预览** | `mock_ui` | `web/` 接入层内置的固定模拟数据 | ❌ **绝对不行** |
| 🟥 **未完成/未核实·如实声明** | `declared_limitation` | 明确没做的事 | ❌ 不行，且必须主动说出来 |

每个证据块强制携带四个字段：`evidence_kind` / `source` / `model_calls` / `verified`。

### 三条红线

1. **`case1–case5` 不是模型跑出来的。**
   它们的节点名逐字写着「**占位·未接模型**」，端到端仅 ~1.1 s，`model_called: false`。
   它们是**确定性夹具跑**（工作流真跑了、代码节点真跑了），**但不能**说成"真实运行记录"。

2. **本轮零模型调用。**
   所有"真实模型"数据都来自 `workflow/evidence/**` 的归档。
   快照里 `new_model_calls_made_by_this_snapshot: 0`。

3. **没验证过的，不许暗示已验证。**
   价格、库存、物流 → **未核实**；DeepSeek 单价 → **未从真实账单核实**；
   发布后的**外部可访问性** → **未核实**（本包完全没做公网验证）。

### 本轮预演**没有**做到的事

| 没做到 | 原因 |
| --- | --- |
| 发起任何真实模型调用 | 任务书要求零模型调用 |
| 预演模式 A（Dify 现场真实跑） | **本机 HTTPS 整体不可用**（见下），Dify 不可达 |
| 录屏 | 录屏需人工；沙箱内 Chrome 无法自动启动 |
| 完整 3 分钟计时口播 | 本轮聚焦技术验证；计时排练仍需 ≥2 次 |
| 复现"并发写导致 404" | 25 秒探测窗口内 `web/public/` 恰好没被写入（**0 次 404/5xx**） |

---

## 一个关键的环境发现

**本机 HTTPS 整体不可用**，与是否断网无关：

```
$ curl -sS -m 8 -o /dev/null -w '%{http_code}' https://cloud.dify.ai/
000
$ python urllib → CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate
$ nslookup cloud.dify.ai → 198.18.0.94     # 198.18.0.0/15 = 保留段，不是公网真实地址
$ curl -sS -o /dev/null -w '%{http_code}' http://www.baidu.com/
200                                          # 明文 HTTP 是通的 → 不是断网，是 TLS 链不受信
```

**后果**：**本机无法预演模式 A**。所以时间轴把模式 C 做成了主力，而不是"实在不行才用"。
**边界**：这**不能推断会场网络也一样**——会场可能是正常网络。

> ⚠️ 顺带提醒：`curl -w '%{http_code}'` 在连接失败时**仍然打印 `000` 且退出码非 0**。
> 我第一版自检写成 `$(curl … || echo 000)`，结果把 `000` 拼成 `000000`，
> 于是 `!= "000"` 恒真、**把断网误报成"可达"**。已修（见 `bin/preflight.sh` §5 的注释）。

---

## 演示主路径可以怎么降级

```
第 1 级  模式 A：Dify 现场真实跑
   └ 失败 →
第 2 级  模式 C-1：离线回放页（内联真实模型归档）  ✅ 已验证
   └ 需要：一个能打开的浏览器
第 3 级  模式 C-2：纯规则层现场跑                  ✅ 已验证（6/6）
   └ 需要：本机 python + deploy/server.py
第 4 级  模式 C-3：静态截图（shots/*.png，9 张）    ✅ 已产出
   └ 只需要一个能显示图片的程序
```

---

## 我改了什么（文件边界）

| 路径 | 情况 |
| --- | --- |
| `docs/demo/**` | **新建**（任务书授权为独占） |
| `web/.tmp/demo-rehearsal/**` | **新建**（任务书授权的截图/日志暂存区） |

**没动**：`docs/demo-script.md`（只读）、`web/**`（除 `.tmp`）、`workflow/**`、`deploy/**`、
`tests/**`、`validator/**`、`docs/competition/**`、`docs/architecture/**`。

**没做任何 git 操作**（无 checkout / switch / branch / merge / rebase / push）。

**一次误操作（已修正）**：验证 404 判定规则时，一条探测命令里的
`cp … web/public/_probe-transient.js` **真的在 `web/public/` 下建了文件**。
已于 00:56 删除并复查目录恢复原状。详见 [`demo-rehearsal-record.md`](demo-rehearsal-record.md) §10。

> ⚠️ **2026-10-31 注**：`shots/D10-1-live-ui-top-1440x900.png` 与 `shots/INPUT-20-input-step1.png` **字节完全相同**（均 421,249 B，sha256 `06e7a6af2bb72b5d…`）——是**同一张图挂了两个 ID**，**不要当成两条独立证据**计数。


## 2026-10-31 新版联调期间的材料入口

本 README 上文的运行、截图和模式记录是旧版历史；不能作为新版真实模型端到端或最终三分钟 Demo 的完成证据。当前文案以 [主脚本](../demo-script.md) 和 [新版分镜计划](分镜计时表-3min.md) 为 PM 审查入口；旧脚本修订建议、预演清单、故障卡和离线回放仍属旧版参考，不自动升级。最终数字、步骤条/按钮、服务入口、等待阈值、截图和录屏均等 QA 锁版再核对。见 [待核实清单](../competition/文案修订与待核实清单-2026-10-31.md)。


## 2026-10-31 统一入口与模式续注

后续以 [赛道 B 技术交付总文档](../competition/赛道B技术交付总文档.md) §五、活动主脚本和分镜的同一时间表执行。与当前 PPT 第 10 页保持 A 在线/B 归档/C 离线定义；人工示意只供内部审稿。本轮不调用模型、不改旧截图包，新图等 PM 审核 QA 报告后采集。所选礼物预算不计包装等，不等于包装免费。
