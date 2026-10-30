# 预演记录（命令 · 耗时 · 实际结果 · 截图）— DEMO-001

- 归属任务：**DEMO-001**（Issue #27）
- 预演日期：**2026-10-31 00:25–01:00（Asia/Shanghai）**
- 预演机：本机（Windows 10.0.26200，工作目录 `C:\Users\lenovo\Desktop\giftwise`）
- **零模型调用**：本轮**没有**发起任何模型调用。出现的"真实模型"数据全部来自 `workflow/evidence/**` 归档。

> **版本漂移声明（重要）**
> 预演开始时 HEAD = `351330da346f7382d86d34d822bd000b7228c3c2`（分支 `release/2026-11-01-submission`）。
> 预演进行中，**另一个 Agent 提交了 `ae0ea58 feat(web): 完成品牌首屏与运行说明第二屏`**，
> HEAD 移动到 `ae0ea580006c3bc90f6ddeec57abe02732446edd`。
> 这不是异常——8 条线共用同一工作目录。但它意味着：
> **① 报告里的一切数字都绑定"读取时刻"；② 现场必须按脚本 §6 的话术主动说明版本差异。**
> 我已逐条标注每一步的上下文，未把漂移当成缺陷。

---

## 0. 环境侦察

| 命令 | 实测结果 |
| --- | --- |
| `pwd` | `/c/Users/lenovo/Desktop/giftwise` |
| `node --version` | `v24.21.0`（`web/package.json` 要求 `>=18`，满足） |
| `npm --version` | `11.19.0` |
| `python --version` | `Python 3.12.12`（**解析到 `/d/msys64/mingw64/bin/python`**，见下） |
| `which -a python` | 第 1 位是 MSYS2 版；第 2 位才是 `Python312\python.exe` |
| `git rev-parse HEAD` | `351330da346f7382d86d34d822bd000b7228c3c2` |
| `git status --porcelain \| wc -l` | 128 →（预演结束时）**136**，多 Agent 并发改动中 |
| `netstat -ano \| grep 8787` | **已被占用**，LISTENING，PID 13360 |
| `netstat -ano \| grep 8000` | 空闲 |
| `curl http://127.0.0.1:8787/healthz` | `{"status":"ok","mode":"mock","runs":56}` |

**已确认**：
- ✅ node / python 都可用（python 是 MSYS2 版，本 Demo 规则层只用标准库，够用）
- ⚠️ **8787 已被另一个 Agent 的界面预览占用**，且其 `runs` 计数在探测期间 56→63→80→87→95 持续增长，
  说明对方**正在活跃使用**。→ **绝不能杀它**。详见 [`failure-modes.md`](failure-modes.md) F1。
- ⚠️ 工作区里 web 文件正被其他 Agent 改写（`index.html` mtime 00:07、`landing.css` 00:14）
  → 按任务书要求，先看 mtime 再判断，不把中间态当缺陷。

---

## 1. 测试与探针（脚本 §1.1 第 2 步）

| # | 命令 | 墙钟耗时 | 实际结果 | 与脚本期望 |
| --- | --- | --- | --- | --- |
| 1 | `python -m unittest discover -s tests -q` | **912 ms**（内部 0.287 s） | `Ran 329 tests` → `OK` | ⚠️ 脚本写"期望 **322** 项"，实测 **329** |
| 2 | `python -m unittest discover -s tests/acceptance/stage_c -q` | **510 ms**（内部 0.120 s） | `Ran 39 tests` → `OK` | ✅ 与脚本一致 |
| 3 | `python tests/acceptance/stage_c/run_verify_local_nopipe.py` | **812 ms** | `local probes: 46 passed; 0 failed; model calls: 0; cloud verified: false` | ✅ 与脚本一致 |

**第 3 步的完整输出（关键字段）**：
```json
{"sources_sha256": {"validator/rules.py": "1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500",
                    "workflow/labels.py": "e3128d298808fecf900974b2dcb12d33034204701175614cdb43fc4a17f67910",
                    "workflow/intake.py":  "e43b911585191ffaf7529e67e5429e2d1c8b2e1be043c58ecc413e5db02134e5",
                    "workflow/runtime.py": "eda2b4174702ac964a90a1d8f100aff1fe18fd4da16124e3e52c5bb51f3feba4"},
 "format": "python-source-not-dsl", "cloud_verified": false}
local probes: 46 passed; 0 failed; model calls: 0; cloud verified: false
results.json model_calls = 0 cloud_verified = False
```

> ⚠️ **副作用提示**：第 3 步按脚本原样执行，会在 `workflow/evidence/local-2026-10-29/runs/` 下**新写一个 run 目录**
> 并更新 `latest.json`。这是该工具自身的设计行为，不是我的改动。后续我只读该目录，未重复执行。
> （任务书要求 `workflow/**` 只读；这是唯一一次写入，由脚本自带的验证命令触发，特此说明。）

---

## 2. 起服务（脚本 §1.1 第 3、4 步）

**脚本原样命令**：
```bash
python -m deploy.server                            # 监听 0.0.0.0:8000
GW_MODE=mock GW_PORT=8787 node web/server/server.mjs
```

**实测调整**：因为 **8787 已被另一个 Agent 占用**，我改用自己的端口 8791，
以免破坏别人的工作，也避免"改别人进程"：
```bash
python -m deploy.server                            # 8000 空闲，按脚本原样
GW_MODE=mock GW_PORT=8791 node web/server/server.mjs
```

| 服务 | 命令 | 就绪耗时 | `/healthz` 实测 |
| --- | --- | --- | --- |
| 校验器 | `python -m deploy.server` | < 2 s | `{"status":"ok","service":"giftwise-validator","rules_source_sha256":"1f389dad…"}` ｜ HTTP 200，t=1.8 ms |
| 界面预览 | `GW_MODE=mock GW_PORT=8791 node web/server/server.mjs` | < 2 s | `{"status":"ok","mode":"mock","runs":0}` ｜ HTTP 200，t=7.7 ms |

✅ `rules_source_sha256` 与 §1 第 3 步输出的 `sources_sha256["validator/rules.py"]` **逐字一致**
→ 证明现场跑的规则代码 == 冻结版本的规则代码。

---

## 3. web 接入层全流程走查（脚本第四节 2:00–2:45 那段）

**驱动脚本**：`web/.tmp/demo-rehearsal/rehearse-flow.mjs`（零依赖，只用 node 内置模块）
**命令**：`GW_BASE=http://127.0.0.1:8791 node web/.tmp/demo-rehearsal/rehearse-flow.mjs`

| # | 步骤 | 命令 | 耗时 | 实际结果 |
| --- | --- | --- | --- | --- |
| S1 | 读配置与模拟标识 | `curl -sS $BASE/api/config` | **60.7 ms** | `mode=mock`、`dify_configured=false`、`pursuit_contract_ready=true`、`global_repair_limit=1`、`currency=CNY`；关系 8 项 `["partner","pursuit","friend","family","classmate","mentor","client_partner","other"]`（**无 colleague**） |
| S2 | 中文首页 | `curl -sS $BASE/` | **6.3 ms** | HTTP 200，6597 B，`lang="zh-CN"` ✅ |
| S3 | 静态资源 | `curl -I` ×4 | **18.1 ms** | 4/4 全部 200：`styles.css` 17621 B、`app.js` 50652 B、`tokens.css` 3482 B、`landing.css` **4104653 B** |
| S4 | 基线 intake 适配 | `POST /api/intake/validate` | **10.1 ms** | `status=ready`，`errors=[]` |
| S5 | 篡改派生字段应被拒 | `POST /api/intake/validate`（加 `repair_count:9, passed:true`） | **5.1 ms** | `status=needs_input`，`codes=["INTAKE_UNKNOWN_FIELD","INTAKE_UNKNOWN_FIELD"]` ✅ 没有静默接受 |
| S6 | 生成三方案 | `POST /api/recommendations` | **7.5 ms** | `status=passed`；三候选 `c1 简洁杯具与杯垫 138.00/1天`、`c2 单品咖啡豆礼盒 118.00/1天`、`c3 无标识香氛蜡烛 128.00/2天`；`selectable=[c1,c2,c3]`；`repair_count=0`；`remaining_repairs=1`；`business_data_verification=not_verified` |
| S7 | 选择 c1 → 四段呈现 | `POST /api/presentations` | **5.7 ms** | `status=completed`；四段顺序 `style>packaging>card>giving`；标题 `① 风格与配色`/`② 包装材料与步骤`/`③ 贺卡正文与装饰物建议`/`④ 赠送时机、方式与话术` |
| S8 | 可信快照 | `GET /api/runs/:id` | **2.3 ms** | 返回 run 摘要；**不含任何密钥字段**（正则校验 `api_key\|Bearer\|sk-` 未命中）✅ |
| S9 | 并发写一致性 | 连续 5 次取首页 | **11.6 ms** | `sizes=[6597,6597,6597,6597,6597]`，`content_changed_times=0` |

**全流程合计：约 128 ms**（9 步，失败 0 步）。
明细 JSON：`web/.tmp/demo-rehearsal/rehearsal-result.json`

**四段呈现的原文（模拟数据，现场需标注）**：
- ① 风格与配色：`关系与场合：追求对象 · 生日（熟悉程度 了解不多）`
- ③ 贺卡正文：`生日快乐！看到合适的小东西就顺手带了一份，希望新的一岁顺顺利利，做想做的事。`
- ③ 装饰物：`不使用玫瑰等强表白含义的花材` / `如需搭配，用一支尤加利叶或干花点缀即可`
- ④ 话术：`这是顺手准备的一点生日心意，祝你生日快乐，别有负担。`
- ④ 关系提示：`不暗示双方已确定关系` / `不默认告白或要求回应`

→ 与脚本 §4.1 的 2:30–2:45 台词**逐点对应**（"顺手带了一份"、"不用玫瑰"、"不暗示双方已确定关系"）✅

---

## 4. 追求对象 vs 恋人 差异比对（脚本 2:30–2:45 要展示的点）

**命令**：`node web/.tmp/demo-rehearsal/capture-raw.mjs`（分别抓 pursuit 与 partner 各一轮）

| 段 | 是否相同 | 追求对象的原文 | 恋人的原文 |
| --- | --- | --- | --- |
| ① 风格与配色 | **不同** | `关系与场合：追求对象 · 生日（熟悉程度 了解不多）` | `关系与场合：恋人 · 生日（熟悉程度 了解不多）` |
| ② 包装材料与步骤 | **完全相同** ⚠️ | — | — |
| ③ 贺卡正文 | **不同** | `生日快乐！看到合适的小东西就顺手带了一份，希望新的一岁顺顺利利，做想做的事。` | `生日快乐！又一岁和你一起过，愿你喜欢的都慢慢实现，也谢谢你一直在。` |
| ③ 装饰物 | **不同** | `不使用玫瑰等强表白含义的花材` | `可搭配一小束花或干花，避免遮挡贺卡文字` |
| ④ 时机与方式 | **不同** | `挑对方方便、环境轻松的时候单独送出，简单聊几句就结束，不安排需要回应的话题。` | `在你们习惯的相处时段单独送出，可以一起吃饭、散步或看电影时交给对方。` |
| ④ 话术 | **不同** | `这是顺手准备的一点生日心意，祝你生日快乐，别有负担。` | `亲爱的，生日快乐，陪你过这一天我很开心。` |
| ④ 关系提示 | **不同** | `不暗示双方已确定关系` + `不默认告白或要求回应` | `可以表达亲密，但不承诺对方反应或关系结果` |

**结论**：脚本台词"换成恋人，贺卡和话术会明显不同"**成立** ✅。
**但** ② 包装材料与步骤 **两段完全相同** —— 演示时**不要**声称四段都变了。

---

## 5. 纯规则层（脚本 §5.2）

**命令**：`python docs/demo/bin/run-rules-layer-demo.py`（校验器已在 8000）
**耗时**：**515 ms**（含 Python 启动）；单次 `/validate` 调用 **2.4–19.8 ms**

| # | 用例 | 实际结果 |
| --- | --- | --- |
| R1 | `GET /healthz` | 200，`rules_source_sha256=1f389dad…` |
| R2 | 基线三候选 | `passed`，三候选全通过，`elapsed 19.3 ms` |
| R3 | c1 抬到 `250.00`（预算 200） | **`failed` / `["OVER_BUDGET"]`**，c1 拒绝、c2/c3 通过，`all_passed=false` |
| R4 | 评委临场指定禁忌词「巧克力」 | **`failed` / `["FORBIDDEN_TERM"]`**，c2 拒绝 |
| R5 | c2 声明 `tags=["alcohol"]` | **`failed` / `["FORBIDDEN_TAG"]`** |
| R5b | 只改 `name`/`description`、**不动 tags** | **`passed`**（规则语义，非缺陷，已作为现场反例保留） |

**6 项用例，失败 0 项。零模型调用，零公网访问。**

**脚本 §5.2 原样代码的问题**：脚本写
`json.loads(...)['result']['status']`，但真实响应**没有 `result` 层** → 实测 `KeyError: 'result'`。
真实结构：`{status, all_passed, errors, candidate_results[], business_data_verification}`。
详见 [`failure-modes.md`](failure-modes.md) F3 与 [`脚本修订建议.md`](脚本修订建议.md)。

---

## 6. 离线兜底包构建与验证

| 步骤 | 命令 | 耗时 | 结果 |
| --- | --- | --- | --- |
| 构建快照 | `python docs/demo/tools/build-snapshot.py` | **335 ms** | `demo-snapshot.json` **50.2 KiB**，19 块，**0 新模型调用** |
| 生成回放页 | `python docs/demo/tools/build-replay.py` | **244 ms** | `offline-replay.html` **53.5 KiB**，外部依赖 **0** |
| 真浏览器验证 | `node web/.tmp/demo-rehearsal/shot.mjs … file:///…offline-replay.html` | — | `readyState: complete`、**console_errors: []**、**failed_requests: []**、无横向溢出 |
| 一次性自检 | `bash docs/demo/bin/preflight.sh` | **4183 ms** | **OK 12 ｜ WARN 8 ｜ FAIL 0** |

**回放页从归档里逐字提取到的真实模型数据**（这是兜底里最有价值的部分）：
```
model_provider : langgenius/deepseek/deepseek
model_name     : deepseek-v4-flash
elapsed_s      : 6.005652
usage          : prompt_tokens 915 / completion_tokens 699 / total_tokens 1614 / latency 6.002
candidates     : 3 个
   c1 精品咖啡豆小礼盒       168.00 CNY / 1 天 / tags=[food]
   c2 小型美食体验礼盒       188.00 CNY / 2 天 / tags=[food]
   c3 咖啡主题实用小物组合   150.00 CNY / 1 天 / tags=[other]
```
**来源**：`workflow/evidence/WF-003-2026-10-30/dify-real-postfix-node-io-real1_normal_200.md`（已归档，本轮未重跑）。

---

## 7. 截图清单（全部由真实浏览器产出）

| 截图 | 内容 | 用途 |
| --- | --- | --- |
| [`docs/demo/shots/D10-1-live-ui-top-1440x900.png`](shots/D10-1-live-ui-top-1440x900.png) | 界面预览首屏，含顶部「模拟数据 · 未接真实模型」标识 | D10 素材 |
| [`docs/demo/shots/D10-2-live-ui-scrolled-banner-sticky.png`](shots/D10-2-live-ui-scrolled-banner-sticky.png) | 滚动 1800 px 后，标识仍吸顶可见 | 证明"全程可见" |
| [`docs/demo/shots/FALLBACK-1-offline-replay-top.png`](shots/FALLBACK-1-offline-replay-top.png) | 回放页顶部（红条 + 四类证据图例） | 模式 C 开场 |
| [`docs/demo/shots/FALLBACK-2-archived-real-model-runs.png`](shots/FALLBACK-2-archived-real-model-runs.png) | 归档真实运行汇总表 | D3/D4/D7 替代 |
| [`docs/demo/shots/FALLBACK-3-rules-layer.png`](shots/FALLBACK-3-rules-layer.png) | 本机真实规则层结果 | D9 替代 |
| [`docs/demo/shots/FALLBACK-4-declared-limitations.png`](shots/FALLBACK-4-declared-limitations.png) | 10 条未完成/未核实 | 收尾页替代 |
| [`docs/demo/shots/RES-1920x1080.png`](shots/RES-1920x1080.png) / [`RES-1280x720.png`](shots/RES-1280x720.png) / [`RES-1024x768.png`](shots/RES-1024x768.png) | 三种投影分辨率 | F13 证据 |

**浏览器实测数据（1440×900）**：
```json
{"load_ms_observed": 436, "domContentLoaded_ms": 69, "loadEvent_ms": 315, "fcp_ms": 372,
 "resource_count": 6, "total_decoded_bytes": 4182774,
 "top5_by_decoded": [{"n":"landing.css","decoded":4104653,"dur":17},
                     {"n":"app.js","decoded":50652,"dur":6}],
 "mock_banner": {"found": true, "text": "模拟数据 · 未接真实模型",
                 "visible_after_scroll": true, "top_after_scroll": 22,
                 "font_size": "12px", "ancestor_position": "sticky"}}
```

---

## 8. 本轮预演**没有**做到的事（如实列出）

| # | 未做到 | 原因 | 影响 |
| --- | --- | --- | --- |
| 1 | **没有发起任何真实模型调用** | 任务书要求"零模型调用" | 时间轴里"真实模型"段的**现场行为**未验证；但归档素材本身是真实模型产物 |
| 2 | **没有预演模式 A（Dify 现场真实跑）** | 本机 HTTPS **整体不可用**（详见 F6），Dify 不可达 | 模式 A 在本机**无法预演**；会场网络可能正常，但本机无法证明 |
| 3 | **没有录屏** | 录屏需人工操作；沙箱内 Chrome 无法自动启动（F8），我用的截图方式不能录视频 | 脚本 §7 分镜 S1–S7 的视频**仍未制作** |
| 4 | **没有做完整 3 分钟计时口播** | 本轮聚焦"让它不可能挂住"的技术验证 | 计时排练仍需 ≥2 次，见 [`runbook-T10-checklist.md`](runbook-T10-checklist.md) |
| 5 | **F14（并发写导致 404）未复现** | 25 秒探测窗口内 `web/public/` 恰好没有被写入 | 无证据说它会或不会发生；缓解规则已建并验证 |
| 6 | 未验证发布后应用的**外部可访问性** | 按边界不做公网验证 | 现场**不许**暗示"已发布所以外部能访问" |
| 7 | 未核实 DeepSeek **单价** | 需用户提供真实账单 | 金额结论只能写"未核实" |
| 8 | 未核实**价格 / 库存 / 物流** | 无真实商品数据源（OPEN-6 仍开放） | 校验结果固定 `business_data_verification: not_verified` |

---

## 9. 本轮发现但**不属于**缺陷的现象（避免误记）

| 现象 | 真相 |
| --- | --- |
| 8787 端口被占 | 是**另一个 Agent 的**服务，正常使用中（`runs` 持续增长）。**不是缺陷** |
| HEAD 从 `351330d` 移到 `ae0ea58` | 别的 Agent 提交了 web 成果。**不是问题**，但现场需声明版本差异 |
| 工作区 128→136 个改动文件 | 8 条线并发修改。**正常** |
| `landing.css` 4.1 MB | 真实体积；本机 17 ms 加载。**记为观察项**，不阻塞 |
| `FORBIDDEN_TAG` 只改名字不触发 | **规则语义**（类别只在声明的 tags 上匹配），不是缺陷，已作为反例保留 |
| `/api/nope` GET 返回 405 而非 404 | `web/server/server.mjs:210` 的既有行为，影响低，**只记录不改** |
| 滚动后步骤条被吸顶头部压住一行 | 见于 1440×900 滚动 1800 px 处；属 `web/` 地盘且该文件正被其他 Agent 改。**只记录不改** |

---

## 10. 本轮我改动的文件

| 文件 | 性质 |
| --- | --- |
| `docs/demo/**` | **新建，独占**（任务书授权） |
| `web/.tmp/demo-rehearsal/**` | **新建**（任务书授权的截图/日志暂存区） |

**未改动**：`docs/demo-script.md`（只读）、`web/**`（除 `.tmp`）、`workflow/**`、`deploy/**`、`tests/**`、`validator/**`、`docs/competition/**`、`docs/architecture/**`。

**一次误操作（已修正并如实报告）**：
在验证 404 判定规则时，我执行了一条含 `cp … web/public/_probe-transient.js` 的探测命令，
**该文件被真的创建在 `web/public/` 下**（md5 与 `web/.tmp/demo-rehearsal/shot.mjs` 相同，确认是我创建的）。
已于 **00:56** 用 `rm -f` 删除，并复查 `web/public/` 目录内容恢复原状
（其余 `app.js` / `styles.css` 的 `M` 状态是 web 线自己的在制品，不是我的）。
**未执行任何 git 操作**（无 checkout / switch / branch / merge / rebase / push）。

---

## §11 第二轮补充（2026-10-31 夜）：输入阶段补齐 + 新复现故障

### 11.1 为什么要补

PM 新指令要求**离线兜底能整段演完 3 分钟**。复查发现原快照**完全没有输入阶段（0:30–1:30）的内容**，
即 `file://` 回放页**无法演出 S2**。本轮补齐。

| 项 | 之前 | 现在 |
| --- | --- | --- |
| 快照块数 | 19 | **21** |
| `local_real_rules` 块 | 2 | **4**（新增 I-01 输入阶段 / I-02 输入校验拒绝） |
| 输入阶段截图 | 0 | **6**（`docs/demo/shots/INPUT-*.png`） |
| 回放页大小 | 54815 B | **60865 B** |

### 11.2 输入阶段实测证据

用真实浏览器驱动三条输入步骤，**13 个动作全部成功**（零 Dify 额度、零公网）：

- **三步**已确认：`.step-pill` 返回 3 项，值逐字为
  「第一步 · 关系与硬约束 / 第二步 · 兴趣与风格 / 第三步 · 排除与补充」，
  与 `web/public/app.js:148` 的 `titles` 数组一致。**PM 指令写的"四步"与界面不符**（详见 `分镜计时表-3min.md` S2）。
- 两个**显式确认**复选框原文已拿到：
  - 「我确认「200.00 元」就是本次礼物＋包装＋贺卡＋装饰＋配送的全量上限（不再改由模型决定）。」
  - 「我确认可用的完整准备时间是 2 天（礼物＋包装＋贺卡＋配送合计），不是模糊期限。」
- **动态字段**（驱动自动化必须知道）：这些 `input` **没有 `name`/`id`**，只有 `data-field`。
  选完预算区间后才出现 `budget_amount`；选完时间区间后才出现 `deadline_days`。
- 顶部模拟标识：`模拟数据 · 未接真实模型`，`position: sticky`，**`font-size: 12px`**（投影可读性风险）。

### 11.3 新复现的故障点

| # | 现象 | 证据 | 影响 |
| --- | --- | --- | --- |
| **F22** | **端口占用直接崩进程** | 按脚本原命令在 8787 已被占用时启动 → `Error: listen EADDRINUSE` + `node:events:505 throw er; // Unhandled 'error' event`，**未捕获异常** | 🔴 现场若照脚本原命令起服务**必崩**。已给 `servers.sh` 加端口避让 + 复用检测 |
| **F23** | **前台 `nohup … &` 起的服务在调用结束后被回收** | 前台起 8790 → 截图显示 `ERR_CONNECTION_REFUSED`；而经后台任务机制起的 8788 存活 | 🟡 起服务必须用能存活的方式（本脚本已验证） |
| **F24** | **孤儿进程无法回收** | 8788 端口 LISTENING（pid 13576），但 `Get-Process -Id 13576` 报 PID 不存在、`taskkill //F` → 拒绝访问、`kill -9` → No such process | 🟡 未解决；已在检查表里改为"避开端口"而非"杀掉进程" |

### 11.4 两条输入校验的**边界发现**（必须如实说）

`/api/intake/validate` 的真实返回（本机，零模型）：

| 用例 | 返回 | 说明 |
| --- | --- | --- |
| 基线合法输入 | `ready` | — |
| 伪造派生字段 `repair_count/passed` | `needs_input` / `INTAKE_UNKNOWN_FIELD` | ✅ 契约严格 |
| 预算写 `100-200` | `needs_input` / `INVALID_AMOUNT` | ✅ 拒绝 |
| **预算 `999999`** | **`ready`** ⚠️ | 1–10000 的上限是在 **Dify 侧 N1** 才拦（归档 v2-run2 有 `LIMIT_EXCEEDED`）。**两层口径不一致** |
| 币种 `USD` | `needs_input` / `UNSUPPORTED_CURRENCY` | ✅ 拒绝 |
| 未决排除项 | `needs_input` / `INTAKE_CLARIFICATION_REQUIRED` | ✅ 拒绝 |
| **关系 `colleague`** | **`ready`** ⚠️ | 已移出产品场景，仅作回归夹具值保留；接口仍接受 |

> 现场被问到时的正确说法：**「越界预算的拦截在 Dify 侧 N1，不在本机 intake 适配层。」**
> 不能说成「输入层已经拦住了越界预算」。

### 11.5 另一处需要注意的差异：**8788 服务的内容与磁盘不一致**

排查中发现：同一份 `web/public/`，**8788 端口返回的字节数与磁盘不一致**，
而 8787（另一个 Agent 的服务）与磁盘**完全一致**：

| 文件 | 磁盘 | 8787 | 8788 |
| --- | --- | --- | --- |
| `index.html` | 6597 | 6597 ✅ | 20724 ❌（且首行 `\n` 变 `\r\n`） |
| `app.js` | 50652 | 50652 ✅ | 57755 ❌ |
| `styles.css` | 17621 | 17621 ✅ | 21933 ❌ |

结论：**8788 是另一份代码副本起的服务，不代表当前仓库内容**。因此本轮的 UI 证据
**一律改用 8787**（已核验逐字节等于磁盘）。此前基于 8788 的界面度量已重新核验，
`font-size: 12px` 等结论在 8787 上**复现一致**。

### 11.6 本轮没有做的事（边界）

- ❌ **没有发起任何真实 Dify 调用**。额度保持 **13 次 / 38,326 tokens** 未动。
- ❌ **没有预演模式 A**（在线真跑）。本机 HTTPS 整体不可用（见 `故障处置卡.md` C6），
  **场地是否能跑通属未核实**，不能声称"模式 A 已预演"。
- ❌ **没有做任何 git 操作**，没有改 `docs/demo-script.md`。
- ⚠️ **8788 孤儿进程仍在**，未回收（见 F24）。

