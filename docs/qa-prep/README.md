# 答辩问答攻防线（Issue #30 · QA-PREP）

> **归属**：GiftWise AI 答辩问答攻防线（夜间自主工作）
> **文件边界**：本线**只写** `docs/qa-prep/**`。未改动其他任何目录。
> **取证时刻**：**2026-10-31 01:20–02:10（北京时间）**——本文件所有数字均带此时间点；数字仍在变，上台前请重跑第 4 节命令。
> 🆕 **今晚（10-30 夜 → 10-31 凌晨）有多条线改了事实面**，追平这些变更的 8 条追问「照念答案」+ 红线表 + 待发布线同步清单，集中在 **[`今晚变更-答疑补丁-2026-10-31.md`](今晚变更-答疑补丁-2026-10-31.md)**。**上台前先把那份过一遍**。

---

## 0. 为什么需要这条线

赛道 B 评分表里「**答辩现场表现（含 Demo 与问答）**」占 **15 分**，与「场景价值」「Agent 能力」「工程完成度」并列最高档。
7 分钟问答是**评委追问**环节，而我们的材料里数字与状态**正在迭代**（Dify 发布状态、镜像重建、parity 扩容、测试扩容）。
**一问就露的地方，必须提前准备好"诚实且精确"的答法。**

本线的立场只有一条：**宁可承认没做到，绝不编一个数字。**

---

## 1. 三份文件怎么用

| 文件 | 什么时候看 |
| --- | --- |
| [`今晚变更-答疑补丁-2026-10-31.md`](今晚变更-答疑补丁-2026-10-31.md) | 🆕 **最先看这份**：8 条被今晚改动推翻的旧答法，各自的「一句话版 / 30 秒版 / 可复核依据」+ 红线表 + 待发布线同步清单 |
| [`30题问答.md`](30题问答.md) | **上台前一晚通读一遍**；每题"一句话 → 30 秒 → 当场演示"三段式 |
| [`红线话术与兜底动作.md`](红线话术与兜底动作.md) | 上场前 5 分钟扫一遍红线表；被问住时用第 2 节的标准动作 |
| [`主动认错脚本.md`](主动认错脚本.md) | **主动说**，不要等评委挖出来；三条已备好口播稿 |

**答辩当天 10 分钟流程**：① 扫红线表 → ② 跑一次第 4 节的 4 条命令（确认现场数字）→ ③ 若某条命令红了，按 `主动认错脚本.md` 改成主动披露。

---

## 2. 事实基线（**我亲手复跑**的部分）

以下每一项都是**本线在 2026-10-31 01:20–01:40 亲自执行命令得到的**，不是转抄。

| 项 | 实测值 | 命令 |
| --- | --- | --- |
| 交付镜像 | `giftwise-validator:submission-20261101` **=** `latest` **=** `d9a4a35763ee`，Created **2026-10-31 01:13:59 +08:00**，**177,918,474 B ＝ 169.676 MiB**（原记 `169.36 MiB` 是**重建前**值） | `docker inspect giftwise-validator:submission-20261101 --format '{{.Id}} {{.Created}} {{.Size}}'` |
| 冷构建 | **两个合法值**：10-30 基线 **1.720 s**、01:13:59 重建版 **3,662 ms**。⚠️ 两次**是否同口径未确认**，故**不得**宣称"变慢了" | `deploy/evidence/raw/d9-coldbuild.txt`、`deploy/evidence/raw/image-rebuild-n1n4/build-timing.txt` |
| `/healthz` 规则哈希 | `1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500`，**与本机 `validator/rules.py` 一致** | `verify_delivery_claims.py` |
| 半开正文（I-2） | **10.02 s** → `HTTP/1.0 408 Request Timeout`，**服务端主动关闭** | 同上 |
| `/metrics` | **HTTP 404**（默认不暴露） | 同上 |
| 容器用户 | **uid 10001**（非 root） | 同上 |
| 并发 40 请求后日志 | 44 行、**粘连 0 行**（N-4 已修） | 同上 |
| 单元测试 | `Ran 329 tests` / **OK** | `python -m unittest discover -s tests -q` |
| `tests/acceptance/stage_b` | `Ran 275 tests` / **OK** | `discover -s tests/acceptance/stage_b` |
| `tests/acceptance/stage_c` | `Ran 39 tests` / **OK** | `discover -s tests/acceptance/stage_c` |
| `tests/acceptance/boundary` | `Ran 45 tests` / **OK** | `discover -s tests/acceptance/boundary` |
| **四集合是否互不包含** | **是**——`discover -s tests -v` 的输出里 `acceptance` / `stage_b` / `stage_c` 各出现 **0** 次 | `discover -s tests -v \| grep -c`（⚠️ **别用 `boundary` 当判据**：会命中一条用例方法名 `test_decimal_boundary_ignores_context_rounding`，不是目录） |
| parity（JS↔Python） | **74 组样例 / 0 处语义差异**（intake 27 + 候选批次 26 + **请求侧越界与格式 17** + 损坏样例 4） | `node web/tools/parity-check.mjs` |
| HTTP 冒烟 | **59 项检查 / 失败 0 项** | `node web/tools/smoke-http.mjs` |
| **真实浏览器自查**（🆕 前端集成后） | **100 项检查 / 失败 0 项**（退出码 0，68.06 s）；服务一致性自检 `/landing.css=24981B /=20724B` | `docs/verification/runs/20261031T015908+0800/browser_check.out` |
| **首屏字节数**（🆕） | desktop 1280 = **486,540 B**（10 请求，原 **4,190,755 B**，**−88.4%**）；390/320 = **367,274 B**（9 请求，原 4,190,755 B）——**2026-10-31 02:02:51 CSS 加固后 +449 B；486,091 / 366,825 是 02:02 冻结口径** | 同上（`note` 行「首屏请求 N 条，累计 N 字节」） |
| **渲染阻塞 CSS / 内联图**（🆕） | `landing.css` **24,981 B**（原 4,104,653 B）；内联 `data:image` **0 处**（原 2 处）；3 张外置 WebP 共 **348,480 B** | `ls -l web/public/img/`；`grep -c "data:image" web/public/index.html` |
| 测试总量（🆕 口径提醒） | **329 + 275 + 39 + 45 ＝ 688**，四条**互不包含**；`discover -s tests` **只覆盖第一条** | 四个套件分别 `discover` |
| 交付镜像内的 Python | `Server: GiftWiseValidator/0.1 **Python/3.12.16**`（N-3 版本泄露**仍存在**） | 同上探针 |
| **规则门否定语义缺陷**（🆕，未修） | `validator/rules.py:212` 纯字面子串匹配：`不含酒精 / 无酒 / 不含酒类` **被拒**；`陈年佳酿` **通过**；`无酒精啤酒` **仍被拒**（残留假阳性） | `python docs/qa-prep/tools/probe_negation.py`（本线探针，7/7 命中预期） |

**引用归档、我未亲自复跑的部分**（答问时须说明来路）：

| 项 | 值 | 来源 |
| --- | --- | --- |
| 本机离线探针 | `passed 46 / failed 0 / model_calls 0` | `workflow/evidence/local-2026-10-29/latest.json`（归档指针） |
| 接入层单测 | 40 项 | `web/tests/access-layer.test.mjs`（**注意路径在 `web/` 下**，不是 `tests/`） |
| 模型调用 | 主批次 10 次 / 34,127 tokens；累计 13 次 / 38,326 tokens | Dify 控制台「上次运行」+ 工作流线归档（**非本线实测**） |
| 规则层错误码 | 19 个 | `validator/rules.py`（**非本线逐一清点**） |
| I-2 线程数 1→10→1 | 部署线实测 | `deploy/evidence/**`（**本线只验了 408 + 关闭，未验线程计数**） |

---

## 3. 当前**红项**（上台前必须知道，答问时不要被突袭）

截至 **2026-10-31 02:00**，`docs/verification/runs/20261031T015908+0800/results.json` 的对外声明审计是 **15 PASS / 1 FAIL / 1 SKIP**：

| # | 红项 | 事实 | 性质与归属 |
| --- | --- | --- | --- |
| 1 | `js_range_parity`（**唯一 FAIL**） | 验证指南的**独立 14 条网格**：**1/14 分歧**，唯一一条是 **`days=10**20`** —— Python = `needs_input ['LIMIT_EXCEEDED']`，JS = `error ['INVALID_JSON']` | **两侧都拒绝**，只是错误码与层级不同。真正缺陷只剩这 1 条极端值分歧。⚠️ 该值**不在** parity 74 组网格内（网格天数只到 366），**不要说成"74 组里有 1 项分歧"** |
| — | ~~`declared_rules_hash`~~ | **已于 01:5x 闭合 → PASS**：`docs/competition/材料清单与自查.md:93` 与 `docs/acceptance-criteria.md:264` 现均声明 `1f389dad…`，与本机一致 | 发布线已修，本条**不再是红项** |
| — | ~~`browser_check`~~ | **已闭合 → PASS**：`browser-check` **100 项 / 0 失败**（自有端口，退出码 0，耗时 68.06 s） | 前端集成完成，本条**不再是红项** |
| SKIP | `dify_publish_state` | 该检查被跳过（不消耗 Dify 额度） | 不是失败，但**也不能当作"已验证"** |

> 注：parity 主夹具已是 **74 组 / 0 差异**（含请求侧越界网格 17 组），说明越界同步**基本完成**；
> 剩下的 `days=10**20` 是**分类口径**分歧，不是"放行"。答问时务必说清这个区别。

> ⚠️ **本表是 02:00 的时点值**。其他线仍在并发写仓，上台前请重跑 `python tools/verify_all.py` 复核。

---

## 4. 可当场演示的命令（评委说"你跑一下"时用这三条）

```bash
# ① 一键对外声明审计（会告诉你哪里红了、红在哪一行、原始输出在哪个文件）
python tools/verify_all.py

# ② 交付镜像四条头条声明，一条命令自证（我写的，零第三方依赖）
"C:\Users\lenovo\AppData\Local\Programs\Python\Python312\python.exe" docs/qa-prep/tools/verify_delivery_claims.py

# ③ JS↔Python 规则一致性（含请求侧越界网格）
node web/tools/parity-check.mjs
```

**② 的预期输出**（我在 01:35 跑出来的原样）：

```
[1] /healthz   HTTP 200  rules_source_sha256=1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500  一致=True
[2] 半开正文   10.02s  状态=408  服务端关闭=True  通过=True
[4] /metrics HTTP 404（期望 404）  容器 uid=10001  非 root=True  通过=True
[3] 并发 40 请求  响应码={'400': 40}  日志 44 行  粘连 0 行  通过=True
```

**若 ② 在现场变红**：不要慌，改口径——"这一条现在红，说明我们这套自证工具是真判据，不是装饰；
它红在哪一项我念给您听"。这比掩盖强得多。

---

## 5. 本线发现、需要其他线处理的隐患（已登记，未越界修改）

| # | 隐患 | 影响 | 建议归属 |
| --- | --- | --- | --- |
| H-1 | **材料清单声明哈希过期**（见第 3 节 #1） | 评委用 `/healthz` 一测即穿；且与已重建镜像彼此矛盾 | 发布线 / PM：把 `:92/:93` 与 `:216` 重钉为 `1f389dad…` |
| H-2 | **`COPY deploy /app/deploy` 把内部文档与脚本打进了交付镜像** | 实测 `/app/deploy/` 里有 `security-review.md`、`preprod-plan.md`、`observability-collection.md`、`publish-to-uhost.ps1`、`Dockerfile`、`.dockerignore`。**这不是密钥泄露**，但评委会问"你的镜像里为什么有部署脚本和内部安全评审？"，且 `security-review.md` 可能自曝弱点 | 部署线：`.dockerignore` 排除 `deploy/*.md`、`deploy/*.ps1`，或改为逐个 `COPY` 需要的 `.py` |
| H-3 | **N-3 版本泄露仍在**：新镜像 `Server: GiftWiseValidator/0.1 Python/3.12.16` | 信息泄露（低危）；且与文档写的 `3.12.12` 不一致 | 部署线：要么改写 `Server` 头，要么把文档改成 3.12.16 |
| H-4 | **服务器讲 `HTTP/1.0`**（`BaseHTTPRequestHandler` 默认 `protocol_version`） | 意味着**每个响应后关闭连接、无 keep-alive**。评委若问"你这服务能扛多少并发"，这是必须先说清的前提 | 规则/部署线：知情即可；若要改需评估（`HTTP/1.1` 会引入 keep-alive 与半开连接的新语义） |
| H-5 | `stage_b` 在 **01:20 时还是红**（`Ran 275 tests / FAILED (failures=3)`），**01:28 已变绿** | 变绿方式是**新增 `val-001-rereview` 记录并用 `superseded_sha256` 保留旧哈希**（不是删断言）——这是正确做法，且 `cases.json` +313 行是**加**用例 | 测试线（已修，无需动作；但答辩可主动讲，见认错脚本三） |

---

## 6. 一条纪律

本线**没有**改动 `docs/competition/**`、`web/**`、`validator/**`、`deploy/**`、`tests/**`、`workflow/**`。
第 5 节的隐患**只登记不代修**——归谁的文件由谁改，避免多人同改一文件。
