# GiftWise AI｜现场 Demo 脚本（3 分钟）

- 更新日期：2026-10-30（北京时间，Asia/Shanghai）
- 归属任务：DEMO-001（阶段 13）
- 产品定位依据：[Issue #1](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/1) 正文
- **首场景已按冻结决定改为「追求对象 / 恋人」**；同事**已完全移出产品场景**，本脚本的产品演示部分不出现同事（仅技术回归夹具保留 `colleague` 机器值，现场不展示）。
- 提交截止：**2026-11-01（周日）10:30（北京时间）**；现场环节：项目汇报 5 分钟、**Demo 3 分钟**、评委提问 7 分钟。

> **本脚本的诚实性基线**：现场**以真实运行为主**，录屏**仅作备用/佐证**，不得以录屏代替所有可现场验证的核心功能（评分规则 1.2 / 第四节）。
> 当前**不存在**完整业务闭环：Dify 草稿仍未发布、未接线、无模型调用、无真实商品数据、无云部署、无前端正式验收。
> 因此 3 分钟里**能真实跑的是**：① 确定性规则校验 API（真实代码 + 真实规则）；② 接入层 mock 模式的中文交互链路（**模拟数据，必须当场声明**）；③ 真实 Dify Cloud 沙箱 Code 节点的历史执行证据（0 Tokens，建议以录屏/截图佐证）。
> **凡是未实现的，现场一律口播为"未完成/计划"，不得演示为已完成。**

## 一、演示前的冻结与自检（建议 T-20 分钟执行）

```bash
# 1) 冻结版本：记录现场实际使用的 commit（与材料提交版本不一致时必须主动说明，评分规则 1.4）
git rev-parse HEAD
git status --short

# 2) 重跑真实证据（只读；会写自己的证据文件）
python -m unittest discover -s tests -q                 # 期望 Ran 322 tests / OK
python -m unittest discover -s tests/acceptance/stage_c -q   # 期望 Ran 39 tests / OK
python tests/acceptance/stage_c/run_verify_local_nopipe.py   # 期望 local probes: 46 passed; 0 failed

# 3) 启动确定性校验 API（注意：不是 README 旧写法 python deploy/server.py）
python -m deploy.server        # 监听 0.0.0.0:8000，可用 GIFTWISE_BIND/GIFTWISE_PORT 改
curl -sS http://127.0.0.1:8000/healthz

# 4) 启动演示用前端接入层（mock，非默认端口避免与他人工位冲突）
GW_MODE=mock GW_PORT=8787 node web/server/server.mjs
# 打开 http://127.0.0.1:8787
```

**现场必须确认的三件事**

| 检查 | 期望 | 不满足时 |
| --- | --- | --- |
| `deploy/server.py` 的 `/healthz` | 200，且 `rules_source_sha256` 与冻结版本一致 | 改用 `PYTHONPATH=. python deploy/server.py`；仍失败则口头说明并切录屏 |
| 页面顶部模拟标识 | 显示「⚠ 模拟数据模式…」 | 立即口头澄清"以下候选为模拟数据"，不得让评委误认为模型输出 |
| 网络与 Dify 会话 | 可访问 Dify Cloud 且草稿仍为「未发布」 | 不点发布；Dify 部分改播录屏并声明为历史证据 |

**现场固定使用的虚构基线（追求对象，全部为虚构数据）**

| 字段 | 取值 |
| --- | --- |
| 关系 | **追求对象**（`pursuit`，与恋人 `partner` 互斥、独立文案） |
| 熟悉程度 / 场合 | 了解不多 / 生日 |
| 预算上限 / 币种 | 200.00 / CNY |
| 可用天数 | 2 天 |
| 已知兴趣 | 咖啡与美食（**已确认**）、设计与艺术（**推断**） |
| 风格 | 实用型、精致但不张扬 |
| 明确禁忌 | 酒类（类别 `alcohol` + 字面词"酒"） |

## 二、3 分钟分步脚本（0:00–3:00）

| 时间 | 讲述要点（可直接照读） | 承办操作 | 屏幕上应出现什么 | 该证据的性质 |
| --- | --- | --- | --- | --- |
| 0:00–0:20 | "给追求对象送礼最难的不是买东西，是分寸：既不想冷淡，也不能假定对方已经接受你。GiftWise 从你**已知**的信息出发，先给三个方向，再由你自己选。" | 展示首页（中文） | 中文表单与顶部模拟标识 | 产品说明（定位假设，非市场验证） |
| 0:20–0:50 | "我如实填：追求对象、了解不多、生日、预算两百、两天时间；已知咖啡与美食，设计只是我的推断；禁忌是酒。" | 填表并提交 | 三步中文输入；未知项留空不编造 | **真实交互**（接入层 mock 模式） |
| 0:50–1:25 | "它给了三个不同方向，并列清哪些是你的事实、哪些是它的推断、哪些仍然未知。注意三条都写了'不保证对方喜欢'。" | 打开三方案 | 三个候选：简洁杯具与杯垫 138.00／单品咖啡豆礼盒 118.00／无标识香氛蜡烛 128.00；事实/推断/未知分离 | **模拟数据**（接入层固定样例，**非模型输出**） |
| 1:25–1:55 | "接下来是真正独立于模型的一部分：规则校验。这条候选被改成 250 元，超过你两百的上限——它被判定失败，并且**失败项不可选**。" | 终端跑真实校验（见下方命令） | `OVER_BUDGET`、`all_passed=false`、可选项为空 | **真实运行**（真实 Python 代码 + 真实规则） |
| 1:55–2:25 | "我选第二项——**系统不会替我选**。选完才生成怎么送：配色、包装步骤、贺卡，以及赠送时机和话术。" | 选择一项并提交 | 四段中文呈现：①风格与配色 ②包装材料与步骤 ③贺卡与装饰 ④赠送时机方式与话术 | **模拟数据**（同上，须声明） |
| 2:25–2:45 | "因为这是追求对象，贺卡写的是'顺手带了一份，别有负担'，装饰明确**不用玫瑰**，关系提示写的是**不暗示双方已确定关系、不默认告白或要求回应**。换成恋人，同样的礼物，贺卡和话术会明显不同。" | 口播（可切一张对比页） | 追求对象 vs 恋人文案对比 | **实测差异**（在 mock 层实测；非模型输出） |
| 2:45–3:00 | "最后说清楚边界：Dify 草稿仍未发布、完整工作流没接线、没有真实模型调用、没有真实价格库存和物流、前端仅模拟数据、云端没有部署。已通过的是本地 46 项探针、322 项单测、39 项阶段 C，以及真实 Dify 沙箱 Code 节点执行成功且 0 Tokens。" | 展示证据页 | 已核实/未核实两段清单 | **真实记录**（详见第四节） |

### 1:25 环节的真实命令（可现场敲）

```bash
# 终端 A：python -m deploy.server
# 终端 B：把"超预算"候选送进真实校验器
python - <<'PY'
import json, copy, urllib.request
from workflow.intake import adapt_intake, dump
intake = json.load(open('workflow/examples/intake.json', encoding='utf-8'))
adapted = adapt_intake(dump(intake))
batch = copy.deepcopy(json.load(open('workflow/examples/candidates.json', encoding='utf-8')))
batch['candidates'][0]['estimated_total'] = '250.00'      # 故意超预算
body = json.dumps({"request_json": adapted["request_json"], "candidates_json": dump(batch)}).encode()
req = urllib.request.Request('http://127.0.0.1:8000/validate', data=body,
                             headers={'Content-Type': 'application/json'}, method='POST')
print(json.load(urllib.request.urlopen(req, timeout=10)).get('status'))
PY
```

**实测结果（2026-10-30 21:20 复查）**：`OVER_BUDGET`；`all_passed=false`；失败候选不出现在可选项。
同一命令把金额改回 200 以内的合规候选时，`all_passed=true`、无可修订项。

## 三、备用录屏计划

**录制清单（建议 11 月 1 日 09:00 前完成，逐段单独录，便于失败时点播对应片段）**

| 片段 | 内容 | 时长 | 必须叠加的字幕/角标 |
| --- | --- | --- | --- |
| R1 | 追求对象：填表 → 三方案 → 选择 → 四段呈现（完整一遍成功路径） | 约 75 秒 | **「预录演示·接入层模拟数据，非模型输出」** |
| R2 | 真实确定性校验：合规通过 + 超预算失败 + 失败项不可选 | 约 30 秒 | 「真实本地运行：validator + deploy/server.py」 |
| R3 | 真实 Dify Cloud 沙箱 Code 节点执行成功（0 Tokens、未发布草稿） | 约 25 秒 | 「真实云端执行·仅 Code 节点探针；完整业务工作流未接线、未发布」 |
| R4 | 追求对象 vs 恋人文案差异对比页 | 约 15 秒 | 「接入层模拟数据」 |
| R5 | 未完成清单与证据来源页 | 约 20 秒 | 「未完成项：详见 README 未完成清单」 |

**播放纪律**

- 录屏**只用于**：网络/平台故障、Dify 站点不可用、需要呈现难以现场复现的过程（评分规则第四节）。**不得用录屏代替可现场验证的规则校验与中文交互链路。**
- 每段录屏播放前**口头声明**其为预录、以及其中的模拟数据性质；画面角标常驻，不能只在开头闪一次。
- 录屏中出现的关系、姓名、预算、聊天内容**全部为虚构**；不得出现真实个人信息、密钥、Token、Cookie、供应商配置、私有地址或控制台账号。

**现场故障切换决策树**

1. 校验 API 起不来 → 改 `PYTHONPATH=. python deploy/server.py`；仍失败 → 播 **R2** 并声明"现场服务未起，以下为本地真实运行的预录"。
2. 页面打不开/前端报错 → 重启 `web/server/server.mjs`；仍失败 → 播 **R1/R4**，明确说明"该部分是模拟数据的预录"。
3. Dify 无法访问 → **不点发布、不改草稿**，播 **R3** 并声明为历史真实执行记录。
4. 全部环境不可用 → 只做口头讲解 + 展示证据页与两段清单，**明确说明无法现场运行**；**不伪造**任何输出。

## 四、现场可引用的真实证据（只能说这些）

**已核实（有真实记录，可现场引用）**

1. `python -m unittest discover -s tests -q` → `Ran 322 tests` / `OK`（2026-10-30 复跑）。
2. `python -m unittest discover -s tests/acceptance/stage_c -q` → `Ran 39 tests` / `OK`。
3. `python tests/acceptance/stage_c/run_verify_local_nopipe.py` → `local probes: 46 passed; 0 failed; model calls: 0; cloud verified: false`。
4. 真实 Dify Cloud 沙箱 Code 节点执行成功：`compatible: true`，`json/re_ascii/unicodedata_nfkc/decimal` 四项可用，**0 Tokens**；草稿 `tool_published: false`（**未发布**），2 节点 1 边、无结束节点。
5. `deploy/server.py` 本地可运行（**须用 `python -m deploy.server` 启动**）；`/healthz` 返回与提交版本一致的规则源码哈希。
6. 追求对象与恋人在接入层产出**不同**贺卡、装饰与关系提示（mock 层实测）。
7. 失败路径不伪装成功：超预算/损坏 JSON 均为失败态，可选项为空。

**未核实／未完成（现场必须说"没有"）**

1. 完整业务工作流端到端运行（Dify 草稿仅 2 节点 1 边、无结束节点、未接线）。
2. **真实模型调用**：至今 **0 次**模型调用、0 Tokens（无供应商授权，OPEN-5）。
3. 真实三候选生成、真实一次修订轨迹、真实持续失败路径（均为固定快照/模拟数据）。
4. 业务延迟、Token 用量与调用成本：**无实测**（探针耗时不可当业务延迟）。
5. 真实商品价格、库存、物流：**完全没有**。
6. 前端正式验收：`web/` 属在飞工作、**未交付验收**；仅 mock 模式可用。
7. 云部署：**未部署**（`CLOUD-001` 未开始）；`deploy/` 只做过本地验证。
8. 约 60 秒完成输入的目标：**无真实用户测量**。

## 五、口径与安全红线

- **同事不出现在本脚本的产品演示部分**；`colleague` 只作为技术回归夹具，现场不展示、不作为案例。
- 追求关系**不假定双向好感**：贺卡与话术不提"表白成功""在一起"等承诺或结果暗示。
- 不承诺"对方一定喜欢"；价格与准备时间**只是估算**，不宣称实时价格/库存/送达已验证。
- 不展示密钥、Token、Cookie、供应商配置、私有地址、真实个人信息与未经脱敏截图。
- 若现场使用的代码、模型或配置与提交版本**不同**，开场主动说明（评分规则 1.4）。
- 页面默认简体中文；技术字段与错误代码保留原标识符。

## 六、排练记录

| 日期 | 内容 | 结果 |
| --- | --- | --- |
| 2026-10-30 | 重跑 46/322/39 项；实测 mock 链路与两类失败路径；实测 `deploy/server.py` 启动方式 | 见第四节；未排练完整 3 分钟口播 |
| 待办（11-01 前） | 完整 3 分钟计时排练 ≥2 次；录制 R1–R5；确认现场网络与 Dify 会话 | **未完成** |

---

## 附：当前进度 / 未完成清单 / 阻塞（2026-10-30 21:30 收尾）

### 进度：本脚本已完成

- **首场景已按要求改为「追求对象 / 恋人」**；同事**不再出现在本脚本的产品演示部分**（仅技术回归夹具保留，现场不展示）。
- 3 分钟分步脚本（0:00–3:00 六段）、1:25 环节的真实命令、备用录屏 R1–R5 清单、故障切换决策树、证据两段清单、安全红线均已写入。

### 本脚本依赖的真实命令与结果（实测）

```bash
python -m unittest discover -s tests -q                       # Ran 322 tests / OK
python -m unittest discover -s tests/acceptance/stage_c -q     # Ran 39 tests / OK
python tests/acceptance/stage_c/run_verify_local_nopipe.py     # 46 passed; 0 failed; model calls: 0
python -m deploy.server                                        # /healthz 200（正确启动方式）
# POST /validate：合规 → all_passed=true；250.00 超预算 → OVER_BUDGET / all_passed=false
# GW_MODE=mock GW_PORT=8787 node web/server/server.mjs          # 三候选 × 2 轮：200 / completed / 四段齐全
```

**与脚本相关的两个真实发现（必须知道）**

1. **`python deploy/server.py` 会失败**（`ModuleNotFoundError: No module named 'validator'`）——`deploy/README.md` 的写法是错的，现场必须用 `python -m deploy.server` 或 `PYTHONPATH=. python deploy/server.py`。该文件不在本 Agent 允许修改范围，已登记为缺陷 **D-7**，待 PM 指派修复。
2. **`web/` 存在瞬时不稳（D-8）**：21:19 观测窗口内 `/api/presentations` 对三个候选**全部返回 500 INTERNAL_ERROR**，21:20 复测恢复正常（`web/server/pipeline.mjs` 于 21:19:31 被改动，属在飞编辑的瞬时状态）。因此**现场前 30 分钟必须重跑一次主路径**，且不要把具体状态串写死在讲稿里。

### 未完成清单（本脚本相关）

1. **R1–R5 录屏未录制**（脚本已就绪，需人工录屏与角标字幕）。
2. **3 分钟完整计时排练未做**（目标 ≥2 次）。
3. **现场环境未预检**：Dify 会话、网络可用性、端口占用均未在真实会场环境验证。
4. **`web/` 未交付验收**：本脚本中标注为「模拟数据」的环节，在现场仍是模拟数据，**不得**讲成模型输出。

### 阻塞

| 阻塞 | 对 Demo 的影响 | 需要的动作 |
| --- | --- | --- |
| 模型未授权（OPEN-5） | 无法演示真实三候选与真实修订；只能演示 mock 与规则校验 | 产品负责人/PM 完成授权 |
| Dify 草稿未发布、N1–N7 未接线 | 无法演示真实 Agent 链路 | 工作流线接线 + PM 决定是否发布（本 Agent **未发布**） |
| `web/` 在飞未验收 + D-8 | 主路径现场可能失败，需备用录屏兜底 | 前端线冻结交付；现场前重跑 |
| 录屏需人工完成 | 无备用材料 | 11-01 09:00 前完成录制 |

> 本 Agent 未提交、未推送、未发布 Dify 草稿、未采购云资源；本脚本中所有"未完成"项均如实标注。
