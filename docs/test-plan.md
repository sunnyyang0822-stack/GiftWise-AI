# 可复现测试计划

更新日期：2026-10-30（亚洲／上海）。定位以[统一说明](product-positioning.md)与 [Issue #1](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/1) 正文为准；阶段 1 冻结件为 [`docs/requirements-analysis.md`](requirements-analysis.md)（SC-1…SC-9、OPEN-1…OPEN-9）。

**当前执行状态（不把设计写成已完成）：**

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| A | 独立测试准备与案例设计 | 已执行，见[阶段 A 报告](test-reports/stage-a/preparation-2026-10-29.md) |
| B | 推荐校验器契约验收（离线公开 `validate`） | 已执行，见[阶段 B 报告](test-reports/stage-b/acceptance-2026-10-29.md) |
| C | 工作流层验收（探针／契约／校验／修订／持续失败／记录方案） | **部分执行**：Code 节点沙箱兼容已通过（真实 Dify 证据）；离线用例 **39/39 通过**；真实模型三候选、真实一次修订、真实持续失败、调用／延迟／成本仍未执行 |
| D | 前端／接入层／集成／页面中文状态 | **接口已出现但未交付验收**：`web/` 于 2026-10-30 20:56 出现，我做了 14 项有界冒烟（mock 模式，见[阶段 C 报告](test-reports/stage-c/acceptance-2026-10-30.md) §4A），**不构成 WEB-001 验收判定**；正式验收待前端线交付 |
| E | 部署 API 与容器 | **已独立复核**：规范构建命令、规则哈希、逐字节一致、状态码契约表均通过；**发现 2 项缺陷（E-1 `.dockerignore` 漏排除、E-2 停滞连接永久占线程）**，详见下方「阶段 E 独立复核」。云端部署（K8S／UCloud、镜像仓库）仍未实施 |
| F | 契约专项（关系 ID 全量／边界值／错误码对账） | **已独立复核**：10 个关系枚举值行为一致、`pursuit` 与 `partner` 确为独立值；契约错误码表所列码**全部已实现**，spec 自述的 7 个未实现码经我独立 grep 确认零实现。**87 项用例 87 通过**。⚠️ 该阶段报告生成于 `HEAD=46d1b48`，其中"金额／天数无上限"等结论**已被请求侧范围裁决取代**，详见该报告顶部作废声明 |
| G | 请求侧数值范围独立复验 ＋ 跨层门禁 ＋ 深挖 | **已独立复核**：预算 `[1,10000]`、天数 `[0,365]`（含端点）与"格式优先于范围"逐项通过；**候选侧不受约束**的反向断言通过；判别力经"内存摘除范围校验"证明（6/6 判别用例会失败）。跨层用例确认 `/validate` 是规则门、**intake 适配层必须前置**。**45 项用例 45 通过**。深挖发现（3 项独立发现）：**🔴 交付镜像 `giftwise-validator:latest` 未同步范围校验**（273 vs 278 行，diff 恰为该 5 行；`POST /validate` 对 `budget=10000.01/10001/0`、`days=366` 全部 `passed`）；**🟠 JS 侧未同步**（穷举 60 例中 **16 例接受性分歧**）；错误组合/优先级/静默分支/解释器限制已固化。详见 [`docs/test-reports/boundary-001/`](test-reports/boundary-001/) |

阶段 C 的逐例证据见 [`docs/test-reports/stage-c/`](test-reports/stage-c/)；真实 Dify 运行证据见 [`workflow/evidence/WF-002-2026-10-30.md`](../workflow/evidence/WF-002-2026-10-30.md)（工作流线）与本套件独立复核捕获的 `dify-run-evidence.json`。**真实 Dify、真实模型、页面、部署、业务延迟或成本尚无验证结论；文档检查不等于业务测试。**

## 关系口径（2026-10-30 冻结，测试基线已按此更新）

- 产品面关系枚举为 **8 个稳定 ID**：`partner` 恋人、`pursuit` 追求对象、`friend` 朋友、`family` 家人、`classmate` 同学、`mentor` 老师/导师、`client_partner` 客户/合作伙伴、`other` 其他。
- **恋人与追求对象必须完全分开**，不得假定已恋爱或互有好感；`pursuit` 不得与 `partner` 合并，也不得落入 `other`。
- **同事已完全移出产品场景**（界面、导航、演示脚本、验收案例均不出现）。`colleague` 机器值仅为技术回归夹具（`tests/` 与 `workflow/examples/intake-colleague.json`），不作为产品验收场景，**本计划的基线与演示场景不使用同事**。
- 兴趣「未知」不是机器值：界面为互斥状态，提交为 `interests: []` + `interest_confidence: {}`；`interest_confidence` 只接受 `confirmed`/`inferred`。
- 第三优先级关系（职场上司、亲戚家人、客户、老师/导师等）本轮 MVP 不单独覆盖，登记为 P1。

## 数据与执行方式

虚构基线（阶段 C 起）：青年用户为**追求对象**送生日礼物，预算 CNY 200.00、准备两天、明确禁忌为类别 `alcohol` 与字面词「酒」；`coffee_food` 标为 `confirmed`（进入事实 `interest:coffee_food`），`design_art` 标为 `inferred`（只进入推断，不进入事实）。三个不同合格方案 c1/c2/c3，估算总费用 150/120/80、准备天数 1/2/1，合法标签和事实引用，推断和未知信息独立。

基线同时保留一个 `colleague` 变体（`workflow/examples/intake-colleague.json`），**只用于证明技术回归未破坏**，不计入产品场景验收。

不是商品报价或真实用户数据。全部为虚构数据，不记录凭证、私有地址或真实收礼人资料。

编码时在 `tests/test_cases.json` 保存规则开发自测的完整基线与变体（**测试验收 Agent 不改该文件**）；阶段 C 使用自建夹具 `tests/acceptance/stage_c/cases.json`。每例使用新深拷贝。固定修订前后快照只证明校验结果，不证明模型真实修订。集成测试保留实际模型输出及代码轨迹。

## 用例设计

### 规则与工作流层（阶段 B／C）

| 编号 | 可复现操作 | 预期结果 |
| --- | --- | --- |
| T01 正常 | 追求对象基线 | 三项通过，第一阶段修订 0 次 |
| T02 超预算 | c1 总额 200.01；另测 200.00。**请求侧预算另受范围约束 `[1,10000]`（含端点）**：`0`/`0.00`/`10000.01`/`10001` → `LIMIT_EXCEEDED`；`1`/`10000` 通过 | 前者 OVER_BUDGET，边界通过；请求侧越界为 `needs_input` + `LIMIT_EXCEEDED`，且**候选侧不受该范围约束**（候选 `0` 仍通过、候选 20000 只报 `OVER_BUDGET`） |
| T03 禁忌 | c1 标签 alcohol；另在描述写「酒」 | 分别 FORBIDDEN_TAG、FORBIDDEN_TERM |
| T04 时间 | c1 准备 3 天；另测 2 天 | 前者 PREPARATION_TOO_LONG，边界通过 |
| T05 信息不足 | 删除预算；另仅清空事实和引用 | 缺预算需补充；偏好未知可继续，不编造事实 |
| T06 无效 JSON | 截断候选 JSON | INVALID_JSON；修订后仍无效就停止 |
| T07 修订成功 | 初始 c1=250，固定修订后 180，其他不变 | 初检失败、复检通过；真实工作流另需一次真实修订轨迹 |
| T08 修订失败 | 初始 c1=250，修订后 230 | 两次失败，停止并显示未解决问题 |
| T09 币种 | 候选 USD；另测请求 USD | CURRENCY_MISMATCH／UNSUPPORTED_CURRENCY，不换汇 |
| T10 字段证据 | 删理由；另引用 f99 | MISSING_FIELD／UNKNOWN_FACT_REF |
| T11 数值类型 | 负数、NaN/Infinity、布尔天数、数字型金额 | 明确拒绝，不崩溃、不错误转换 |
| T12 批次 | 两候选、重复候选 ID、重复事实 ID | 明确批次或标识错误 |
| T13 解析限制 | 重复键、null 根、错误数组、超长、未知标签 | 对应字段失败，不静默通过 |
| T14 修订保护 | 改已通过 c2 或原始预算 | 拒绝未经授权修改，原始约束仍有效 |
| T15 基础设施 | 模型／Code 失败；API 存在后测超时 | 中文错误，不标为通过、不无限重试 |
| T16 未选择 | 获得三项后不选择 | 不触发赠送设计，不提前生成三份包装 |
| T17 选择 | 选通过 c2；另选失败项、不存在或旧版 ID | 前者进入第二阶段；后者拒绝或刷新；不自动替选 |
| T18 可信边界 | 篡改前端 passed 或候选内容 | 可信来源校验加必要的规则重检拦截，不信任前端标记；仅重检不能证明来源和已用修订次数 |
| T19 赠送完整性 | 用户选择一项后生成 | 包装步骤、配色、贺卡、赠送方式齐全且对应选定礼物 |
| T20 增量约束 | 礼物 190 加包装 20；另测新增时间超限 | 按全部费用和时间失败，不能沿用裸礼物通过结果 |
| T21 全局一次修订 | 首阶段已修订，次阶段再失败；另测首阶段未修订 | 前者如实失败；后者最多使用剩余一次并复检，不跨阶段重置 |
| T22 简体中文 | 检查导航、输入、按钮、空状态、加载、错误、报告、贺卡 | 默认简体中文；技术代码有中文解释，不直接暴露英文异常 |
| T23 人群与关系场景 | 恋人、追求对象、朋友、家人、同学、老师/导师、客户/合作伙伴、其他；青少年朋友、中年职场 | 不限制为同事生日；不把群体假设当个人事实；青少年场景不成人化；第三优先级关系本轮不单独验收 |
| T24 关系分叉 | 同一输入分别以 `pursuit`／`partner` 提交 | 中文分别为「追求对象」／「恋人」，机器值互斥；追求对象走低压力表达，不默认双向好感 |
| T25 关系机器值 | 前端提交 `recipient_relation_id`；另提交 `interest_confidence: "unknown"` | 分别 INTAKE_UNKNOWN_FIELD 与 INTAKE_CONFIDENCE_MISMATCH，不返回可用请求 |

### 阶段 C 已落地套件

`tests/acceptance/stage_c/`（**测试验收 Agent 独立编写**，不导入 `tests/test_validator.py` 与 `tests/test_cases.json`）：

| 分组 | 用例数 | 内容 |
| --- | ---: | --- |
| C1 沙箱兼容探针 | 3 | 本地标准库探针；真实 Dify Code 节点执行成功（**独立捕获**的 SSE 节点轨迹）；真实耗时与 token 记录 |
| C2 契约缺口 | 11 | `pursuit` 机器值存在性与互斥；变更前被拒的 HEAD 版本复现；`unknown` 可信度／`interests` 的 `unknown`／前端提交 `recipient_relation_id` 被拒；`colleague` 技术回归；新增字段不破坏校验；`INTERNAL_ERROR` 已入契约表 |
| C3 候选校验 | 9 | 正常三方案；超预算边界 200.00 通过／200.01 失败；禁忌标签与字面词；全角变体不被绕过；候选 JSON 损坏；币种不换汇 |
| C4 修订与保护 | 10 | 首检可修订；修订成功并占用额度；额度用尽不可再修订；持续失败不伪装通过；全部失败无可选项；已通过项被篡改拒绝；键序重排不误判；无需修订时拒绝修订；不替用户选择；禁忌项不可选 |
| C5 生成节点一致性 | 4 | 四个 Dify 入口节点真实执行；生成物与 manifest 哈希一致（无 STALE）；空输入不放行；调度器异常为中文受控失败且不重试 |
| C6 记录方案 | 2 | 离线全链路实测延迟 + `model_calls=0` + 成本记 `not_measured`；Dify 运行可追溯且 trace 缺口如实记录 |

运行：

```text
python -m unittest discover -s tests/acceptance/stage_c -v     # 只跑用例
python tests/acceptance/stage_c/run_stage_c.py                 # 生成逐例证据
python tests/acceptance/stage_c/extract_dify_evidence.py       # 规范化 Dify 浏览器实跑证据
```

**宣称完成前执行 T01–T08 的适用离线和实际工作流测试，并完成 T16–T22 选择与赠送闭环。** 涉及工作流、页面或可信状态的测试不能用纯校验器单测替代。稳定演示错误时可用明确标注的测试注入，与正常生成分离，不伪装为模型自然出错。

## 阶段 E 独立复核：容器化规则 API（CLOUD-001）

复核角色：GiftWise｜测试验收 Agent（**独立执行，不引用 `deploy/evidence/` 的汇总表**）。复核时间：2026-10-30 晚（Asia/Shanghai）。
被复核对象：`deploy/evidence/docker-2026-10-30.md` 与 `deploy/evidence/raw/docker-2026-10-30/`（PM 自执行自报告）。
本套件与证据：`tests/acceptance/cloud-001/`、`docs/test-reports/cloud-001/evidence/`。

### 环境与前置

- Docker Desktop **29.9.2**（Client 与 Server 同版本）、`desktop-linux` 上下文、`overlayfs`、CPUs 24、Mem 8179929088 —— 与 PM 记录一致。
- **`C:\Program Files\Docker\Docker\resources\bin` 不在本会话 PATH 中**：`which docker` 失败（`docker-credential-desktop` 同名坑）。显式加入后 `docker --version` 与 `docker info` 均正常。此项确为真实前置条件，PM 的提示成立。
- 规范构建：`docker build -t giftwise-validator:latest -f deploy/Dockerfile .` 成功。反例 `... -f deploy/Dockerfile deploy/` **确实失败**：`failed to calculate checksum ... "/validator": not found`，与 PM 说明一致。
- 为不破坏 PM 产物：先 `docker tag` 保全其镜像为 `giftwise-validator:pm-baseline-20261030`（`b42f408b4f07`），复核结束后已把 `latest` 还原指向该镜像。QA 自建的容器与测试镜像已全部清理。

### 已独立通过的项

| 编号 | 独立验证内容 | 我的方法 | 结果 |
| --- | --- | --- | --- |
| E-D3 | 容器 `/healthz` 的规则哈希与本机一致 | 容器 HTTP 响应 vs 本机 `sha256(validator/rules.py)` | **通过**：两侧同为 `4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3`；`Content-Length: 135` 与实际字节数相符 |
| E-D4 | `/validate` 与进程内 `validate()` 一致 | 见下方「逐字节一致的方法说明」 | **通过**：逐字节相同，且经区分力与变异测试 |
| E-D5 | 状态码与 `deploy/README.md` 契约表一致 | 对活容器逐行发真实请求 | **通过**：非法 JSON=400 `INVALID_JSON`；类型错／缺字段／非对象／null 字段=400 `INVALID_PAYLOAD`；未知路径（GET 与 POST）=404 `NOT_FOUND`；`GET /`=200；业务不通过=200；65537 字节=413；65536 字节本身不算超长；`HEAD`=501 |
| E-BUILD | 内容级可复现 | 我自己 `--no-cache` 构建后，逐文件比对 `/app` 的 sha256 | **通过**：`server.py`、`validator/__init__.py`、`validator/rules.py` 及两个 pyc，共 5 个文件哈希与 PM 基线镜像**完全相同** |
| E-START | 启动到就绪 | `docker run -d` 到首次 HTTP 200，每次探测 1 秒超时，重复 3 次 | **通过**：0.454 / 0.500 / 0.469 s（中位 **0.469 s**），与 PM 的 0.75 s 同量级 |
| E-IMG | 镜像内无密钥、无违禁路径 | `docker run --rm` 内直接查找与全文扫描 | **通过**：`.git`/`tests`/`docs`/`workflow`/`web`/`.env`/`.ssh` 均不存在；全盘无 `*.pem`/`*.key`/`id_rsa*`；`/app` 内 `api[_-]?key|secret|password|token|sk-|dify|credential` **零命中** |
| E-USER | 非 root 运行 | `docker exec ... id` | **通过**：`uid=10001(giftwise)` |
| E-RAW1 | 无 `Content-Length` 是否挂起或半开 | **原始 socket**（不补任何头） | **通过**：立即返回 `HTTP/1.0 413 REQUEST_TOO_LARGE`，0.0 s，且**对端主动关闭**（`closed_by_peer=true`）；未观察到半开或协议不同步。HTTP/1.1 keep-alive 与 `Transfer-Encoding: chunked` 两种变体行为相同（服务端始终 `HTTP/1.0` 并关闭，不协商 keep-alive） |
| E-RAW2 | 非法 `Content-Length` | 原始 socket 发 `-5` 与 `abc` | **通过**：均明确返回 413，未崩溃；`Content-Length: 0` 返回 400 |
| E-LOCAL | 是否已推送镜像／产生云资源 | 镜像仓库前缀、本地镜像清单、证据中推送命令检索 | **仅能证明本机侧**：镜像全部为本地名（无 registry 域名前缀），证据中未出现 `docker push`／`docker login`（唯一 "registry" 命中是 WSL 注册表项检查） |

### 逐字节一致的方法说明（回应「是不是同一个 JSON 序列化两次」）

这个怀疑成立与否，取决于比较方法是否有区分力。我的做法（证据 `docs/test-reports/cloud-001/evidence/api-probe.json`）：

1. 用原始 HTTP 读到服务端响应体**字节**（`len=367`）。
2. 在同一台机器的**另一个进程**里调用 `validator.rules.validate(request_json, candidates_json)`，用 `json.dumps(result, ensure_ascii=False, separators=(",", ":"))` 编码，逐字节比对 → **相等**。
3. **区分力验证**：同一结果改用 `json.dumps(result)`（默认含空格分隔符）编码 → **不相等**（长度不同）；改用 `sort_keys=True` 编码 → **不相等**。说明步骤 2 的比对确实能区分不同序列化口径，不是"同一个字符串和自己比"。
4. **解析后深比较**：`json.loads(服务端字节) == 进程内结果对象` → 相等。
5. **变异测试（排除固定/伪造响应）**：把 c1 的 `estimated_total` 改为 `999.00` 后重新请求，服务端响应随之改变（c1 `passed=false`、错误码 `OVER_BUDGET`），且仍与进程内结果逐字节一致。说明响应是**算出来的**，不是常量。
6. **多例复核**：正常／超预算／禁忌／时间／异常根 5 个夹具全部 HTTP 200 且逐字节一致。

结论：**"逐字节一致"这一结论成立**。但 PM 归档的原始证据 `d4-validate.txt` 里 `--- container ---` 是紧凑格式、`--- local ---` 是带空格格式，两行**并不同字节**，且未记录比较方法 —— 该文件本身不能自证此结论。结论对、证据形式需改（见 E-5）。

### 已发现的缺陷（报告给 PM，由 `deploy/` 线修，我不改该目录）

| 编号 | 级别 | 缺陷 | 复现步骤 | 影响 |
| --- | --- | --- | --- | --- |
| **E-1** | 中 | 两份 `.dockerignore` 中的 `__pycache__` 与 `*.pyc` **对嵌套目录无效**，镜像实际打包了编译字节码 | `docker build --no-cache -t qa:fresh -f deploy/Dockerfile .` 然后 `docker run --rm --entrypoint find qa:fresh /app -type f`，可见 `/app/validator/__pycache__/*.pyc` | 镜像含非源码产物；`.dockerignore` 的收窄承诺未达成 |
| **E-2** | 中 | 声明 `Content-Length` 大于实发字节时，`handler` 无任何超时，读操作**永久阻塞**，每个这样的连接**永久占用一个线程** | 原始 socket 发 `POST /validate HTTP/1.0` + `Content-Length: 100` + 仅 5 字节，然后停住 | 慢速/恶意客户端可无上限耗尽线程；容器 `health` 仍为 healthy，**故障会被健康检查掩盖** |
| **E-3** | 低 | D-8"二次构建可复现"的原始证据全程 `CACHED`，未证明从零可复现 | 查看 `raw/docker-2026-10-30/d8-rebuild.txt`，`#6`/`#8`/`#9` 均为 `CACHED` | 结论恰好成立（我已用 `--no-cache` 独立证明），但该证据不支撑该结论 |
| **E-4** | 低 | D-1／D-7 把 **manifest-list digest**（`b1fe2847…`）当作镜像 ID 记录 | 对比 `docker images`：实际镜像 ID 为 `b42f408b4f07` | 记录口径不一致（汇总表头部写 `b42f408b4f07`，D-1 行写 `b1fe2847…`）；且镜像 ID／config 摘要含构建时间戳，**本就不适合作可复现性判据** |
| **E-5** | 低 | D-4 的归档证据不能自证"逐字节一致"，且未记录比较方法 | 查看 `raw/docker-2026-10-30/d4-validate.txt` 的两行 | 建议改为直接归档响应体原始字节的 sha256，并写明序列化口径 |
| **E-6** | 信息 | `deploy/README.md` 称 `.dockerignore` "静态估算 10.29 MiB → 0.05 MiB，未构建验证" | 我用仓库根 `.dockerignore` 实测上下文总体积为 **196.0K** | 估算低估约 4 倍，且未识别 E-1 的漏排除 |
| **E-7** | 信息 | 两份 `.dockerignore` 规则确不一致，但**不会误排除** `validator/` 或 `deploy/server.py` | 实测上下文顶层含 `validator`、`deploy`（含 `server.py`），镜像内二者均在 | 用户怀疑的"误排除"**不成立**；实际风险方向是**漏排除**（E-1）。且规范命令下只有**仓库根** `.dockerignore` 生效，`deploy/.dockerignore` 是惰性的（该文件注释已自述） |
| **E-8** | 信息 | 镜像内 `deploy/` 只有 `server.py`，无 `__init__.py` | `docker run --rm --entrypoint ls <img> -la /app/deploy` | `python -m deploy.server` 依赖 PEP 420 命名空间包，实测可用但较脆弱，建议显式 `COPY deploy/__init__.py` |
| **E-9** | 信息 | `deploy/README.md` 称逐字节一致的响应体为 **367 字节**，与我实测不符 | 用 `tests/test_cases.json#T01_normal` 请求容器：`server_body_bytes=271`、进程内同值 271 | 271 ≠ 367。该数字可能取自其它用例但未注明来源；建议改为标注"取自哪个夹具"，或直接以夹具 + 字节数成对记录 |

**E-1 根因（已用最小实验确证）**：`.dockerignore` 模式锚定在**上下文根**，`__pycache__` 只匹配顶层 `__pycache__`，`*.pyc` 只匹配顶层 `*.pyc`，二者都不匹配 `validator/__pycache__/rules.cpython-312.pyc`。最小实验（`docs/test-reports/cloud-001/evidence/raw/qa4-dockerignore-experiment.txt`）：

- `.dockerignore` 写 `__pycache__` + `*.pyc` → `/ctx/top.pyc` 被排除，但 `/ctx/sub/__pycache__/mod.cpython-312.pyc` **仍在**。
- 改成 `**/__pycache__` + `**/*.pyc` → 嵌套目录也被正确排除。

**E-1 的决定性证据**：镜像内 pyc 的 sha256（`90e7e233…`、`2360bda0…`）与本机 `validator/__pycache__/` 中同名文件**完全相同**，且镜像已设 `PYTHONDONTWRITEBYTECODE=1`（容器内 `sys.dont_write_bytecode=True`，文件时间戳为构建日）→ 这些 pyc 只能来自构建上下文 COPY，不可能是运行时生成。**PM 自己的 `raw/docker-2026-10-30/d6-image-files.txt` 已列出这 2 个 pyc（9 行清单中的第 3、7 行），但未作为问题标出。**

**E-2 量化（`docs/test-reports/cloud-001/evidence/stall-probe.json`）**：单个停滞连接 **45 秒无任何响应、未被对端关闭**；再打开 8 条同类连接后容器内 `PID 1` 线程数 **+9 且 10 秒后仍不回收**，同时 `/healthz` 仍返回 200。`deploy/server.py` 中 `settimeout`／`timeout`／`protocol_version` **全部未出现**（仅 `Content-Length` 取值与 `rfile.read(size)`）。客户端关闭后线程可回收，因此是"连接存活期间无限占用"，不是永久泄漏；但 Docker `HEALTHCHECK` 只探回环 `/healthz`，**无法发现该状态**。

### 我自己的方法学更正（如实记录）

1. 首轮 `D5-01` 报"契约不符"，经查是**我手写的 `Content-Length` 与实际字节数不符**（如声明 41、实际 42），服务端严格按声明长度读取后截断成非法 JSON。改为由 `len(body)` 计算后 **D5-01 通过**。服务端行为本身正确。
2. 首轮我把启动耗时测成 **21.8 s**，经查是**我的无超时 `curl` 在 Docker Desktop 端口尚未转发时被静默阻塞**所致。改用带 1 秒超时的探测后为 **0.469 s（中位）**，与 PM 的 0.75 s 一致。**PM 的启动耗时声明成立，我先前的高值是测量缺陷。**

### 已核实／未核实／与开发方声明不一致

**已核实（我自己执行）**
1. Docker 环境可用；`PATH` 前置条件是真实的；规范构建命令成功，`context=deploy/` 确会失败。
2. 容器 `/healthz` 的 `rules_source_sha256` 等于本机 `validator/rules.py` 的 sha256。
3. `/validate` 响应与进程内 `validate()` 逐字节一致（含区分力、深比较、变异、多例四重验证）。
4. `deploy/README.md` 状态码契约表逐行成立（含 65536/65537 边界与 `HEAD`=501）。
5. 无 `Content-Length` 时立即 413 且连接被对端关闭，**无挂起、无半开**。
6. 镜像内无密钥、无 `.git/tests/docs/workflow/web`；非 root；内容级可复现（5 文件 sha256 全同）。
7. 启动到就绪约 0.47 s。

**未核实／无法独立验证**
1. "未上传任何 registry、未产生云资源费用"：我只能证明**本机**无推送痕迹（无 registry 前缀、证据中无 `docker push`）；远端 registry 与云账单侧无凭据可查，**不能独立确认**。
2. PM 的精确启动值 0.75 s：我测得 0.47 s，同量级但**无法复现其精确数值**（方法不同）。
3. D-0…D-10 的完整命令序列：`raw/` 只归档了输出，未归档命令本身，**无法逐步重放**。
4. 镜像体积口径（`178MB` / `177582258` / `169.4MB`）未深究差异来源（多平台 manifest 与 attestation 会致口径不同）。

**与开发方声明不一致**
1. `deploy/README.md` "`.dockerignore` 静态估算 → 0.05 MiB"：实测上下文 **196.0K**（且含漏排除的 pyc）。
2. `deploy/README.md` 引用的逐字节一致响应体 **367 字节**：实测同夹具为 **271 字节**（见 E-9）。
2. D-6 隐含的"排除规则有效"：`validator/__pycache__` 与 `deploy/__pycache__` 均未被排除（D-6 的字面断言——无密钥、无违禁路径——**成立**）。
3. D-8 "二次构建可复现"：其证据全程 `CACHED`，不足以支撑该结论（结论本身经我独立验证成立）。
4. D-1／D-7 镜像 ID 口径与汇总表头部不一致（manifest-list digest vs 镜像 ID）。
5. D-5 "错误路径全部符合契约"：**覆盖不完整**，未覆盖"声明 `Content-Length` 大于实发字节"，该场景实为缺陷（E-2）。

### 边界与副作用

- **未修改** `deploy/**`、`docs/architecture/**`、`workflow/**`、`web/**`。本轮所有发现均以报告形式提交，由对应文件线修。
- 本轮新增：`tests/acceptance/cloud-001/`（`probe_deploy_api.py`、`stall_probe.py`、`startup_probe.py`）、`docs/test-reports/cloud-001/`（本证据）。
- 构建 Dockerfile 与"整仓库上下文体积测量"均通过 **stdin（`-f -`）** 完成，未在仓库内新增或改动任何构建文件。
- 未执行构建缓存清理（`builder prune`／`system prune`）：未测出问题，且属破坏性操作，**未获授权故未执行**。

运行：

```text
python tests/acceptance/cloud-001/probe_deploy_api.py http://127.0.0.1:18000   # 接口复核（需先起容器）
python tests/acceptance/cloud-001/stall_probe.py  http://127.0.0.1:18000 gw-qa  # 停滞连接实验
python tests/acceptance/cloud-001/startup_probe.py giftwise-validator:latest    # 启动耗时
```

### 本轮顺带修复的测试自身缺陷（我方问题，如实记录）

复核期间发现**我自己的 Stage C 用例 C2-03 是脆弱的**：它用 `git show HEAD:workflow/labels.py` 取"变更前版本"来复现 `INTAKE_UNKNOWN_LABEL`。工作流线随后把 `pursuit` 提交进 `HEAD`（`959aa6a`），该用例便取到"变更后版本"，由通过转为失败。**历史基线不能挂在会移动的引用上。**

已改为逐字节固定夹具 `tests/acceptance/stage_c/fixtures/labels_before_pursuit.py`（来源提交 `89d6624`，与原文逐字节一致，sha256 `333ad976…`，出处见同目录 `PROVENANCE.md`），并新增断言"夹具哈希未被改动"，同时把"当前工作区是否已加入 `pursuit`"降级为**漂移观察**而非判定条件。**这是"修过时断言"，不是"为了让测试过而改测试"**——改动内容、原断言、失效依据与改后断言见下方 §「C2-03 用例修订说明」。修复后 **Stage C 39/39 通过**、`python -m unittest discover -s tests -q` **329 项通过**、本地探针 46 项通过；Stage C 逐例证据已重新生成到 `docs/test-reports/stage-c/20261030-224243/`。

> **数字口径澄清（2026-10-31）**：`python -m unittest discover -s tests -q` 的 **329 项**全部来自 `tests/test_validator.py`。
> `tests/acceptance/**` 下**没有 `__init__.py`**，因此 unittest 的 discover **不会递归进去**；
> Stage C（39 项）与阶段 G（25 项）等验收套件必须**显式指定路径**运行，例如
> `python -m unittest discover -s tests/acceptance/stage_c -q`。此前文稿中"全仓 322 项"的写法易被读成
> "329 已包含 Stage C"，现更正：**329 与 39 是两个互不包含的集合**。
> 我未添加任何 `__init__.py`，以保持其他文件线依赖的 329 基线不变。

> **补充口径（2026-10-31 01:20，#8 测试验收线实测）**：验收套件不是"两条"而是**四条互不包含的独立集合**，
> 合计 **688 项**。除第一条外，任何一条都**不被** `python -m unittest discover -s tests` 覆盖：
>
> | 套件 | 项数 | 运行命令 | `discover -s tests` 是否覆盖 |
> | --- | --- | --- | --- |
> | `tests/test_validator.py` | 329 | `python -m unittest discover -s tests -q` | ✅（329 项全部来自此文件） |
> | `tests/acceptance/stage_b` | 275 | `python -m unittest discover -s tests/acceptance/stage_b -q` | ❌ 不覆盖 |
> | `tests/acceptance/stage_c` | 39 | `python -m unittest discover -s tests/acceptance/stage_c -q` | ❌ 不覆盖 |
> | `tests/acceptance/boundary` | 45 | `python -m unittest discover -s tests/acceptance/boundary -q` | ❌ 不覆盖 |
>
> `stage-a`、`contract`、`cloud-001` 是**探针目录而非 unittest 套件**（`discover` 命中 0 项，无钉住哈希）。
> **因此"329 项通过"不等于"全仓通过"**：四条集合之间没有包含关系，对外引用时必须写明是哪一条。
>
> 本条口径的由来：2026-10-31 夜间发现 `stage_b` 的 **3 项失败长期隐形**——该套件 275 项因目录无
> `__init__.py` 而从未进入常规回归，是被验证指南 `tools/verify_all.py` 抓出来的。根因与重钉依据见
> [`test-reports/stage-b/`](test-reports/stage-b/) 的《Stage B 基线重钉报告》。
> **建议（非本线文件范围，供 #29 验证指南线采纳）**：把聚合入口 `tools/verify_all.py` 扩展到
> **逐条运行 stage_b / stage_c / boundary 三个套件**——它目前是唯一能防止"隐形失败"再次发生的机制。

### 仓库状态观察（与容器化结论相关，供 PM 决策）

- 复核期间 `HEAD` 已前移到 `46d1b48`，含 `959aa6a`（2026-11-01 现场提交冻结版本）、`d5130b5`（容器化 D-0…D-10）、`dc1124a`、`46d1b48`（PM 状态盘点）。
- `git rev-list --count origin/main..HEAD` = **7**，即本地领先远端 7 个提交，**仍未推送**（原 OPEN-8 由 3 个增至 7 个，且其中已含"现场提交冻结版本"这类发布性提交）。
- 本报告的全部容器化结论绑定到 `46d1b48` 与上述镜像摘要；若随后有人改动 `deploy/`，E-1／E-2 需重测。
- **复核期间 `deploy/observability.py` 新出现**（部署线并发工作，非本 Agent 所加）。因此 E-1／E-2 的重测**必须**在部署线停止改动 `deploy/` 之后进行；在此之前上述结论只对该时刻的 `deploy/` 内容成立。

## 阶段 F 独立复核：契约专项（关系 ID 全量 + 边界值 + 错误码对账）

复核对象：`workflow/intake.py`、`validator/rules.py`、`workflow/runtime.py`。套件：`tests/acceptance/contract/run_contract.py`（可重跑）。证据与报告：[`docs/test-reports/contract-001/`](test-reports/contract-001/)。结论绑定 `HEAD = 46d1b48`。

### F-1 关系 ID 全量（10 个枚举值）

`workflow/labels.py` 的 `RELATIONS` 实际声明 9 项：`classmate, client_partner, colleague, family, friend, mentor, other, partner, pursuit`（外加 UI 未确认态 `unknown`）。

- 8 个产品值（`partner`／`pursuit`／`friend`／`family`／`classmate`／`mentor`／`client_partner`／`other`）逐个实测 → `ready`，且输出 `recipient_relation`（冻结中文）与 `recipient_relation_id`（机器值）**一一对应、无错配**。
- `pursuit` 与 `partner` **确为两个独立枚举值**：以 `pursuit` 输入时输出 `recipient_relation_id="pursuit"`，**未被提升为 `partner`**，代码中无"追求 ⇒ 双向好感"的推导。
- `colleague` 机器枚举保留、可回归（`ready`），**未出现在产品文案路径**；`unknown`（界面未确认态）→ `needs_input` + `INTAKE_CLARIFICATION_REQUIRED`。
- 反向用例全部按契约拒绝：缺字段／`null`／未声明值 `"boss"`／误传显示文本 `"追求对象"`／大小写 `"PURSUIT"` → `INTAKE_CLARIFICATION_REQUIRED` 或 `INTAKE_UNKNOWN_LABEL`。
- 顶层伪造 `recipient_relation_id` → `INTAKE_UNKNOWN_FIELD`（**前端不得提交该字段，适配层确实拦住**）。

### F-2 边界值（逐条实测，均与 `docs/intake-contract.md` 记载一致）

| 维度 | 实测要点 |
| --- | --- |
| 预算 | `"0"`/`"0.00"`/`"200.00"`/`"200.01"` → `ready`；`"-1"`/`"-0"`/`"1e3"`/`"２００"`/`"1,000.00"`/空白/`".5"`/`"1."`/`"0.001"`/空串/JSON 数字 → `INVALID_AMOUNT`（数字类型另见 `INVALID_TYPE`） |
| 预算超大 | **400 位数字串 `ready`**：与当时契约 :151 自述的"无数值上限"一致 ⚠️ **已被取代**：请求侧现已限 `[1,10000]`，400 位数字串远超上限 → `LIMIT_EXCEEDED`；**候选侧仍无数值上限**（阶段 G 已复验） |
| 期限 | `0`/`1`/`2`/`365` → `ready`；`-1` → `INVALID_TYPE`（契约 :154 同）⚠️ **部分已被取代**：`100000` 原为 `ready`，现请求侧限 `[0,365]` → `100000`/`10^20` 均为 `LIMIT_EXCEEDED`；**`0` 仍保留**（阶段 G 已复验） |
| 空偏好 | `interests: []` + `interest_confidence: {}` → **`ready`**（偏好未知不等于输入无效） |
| 可信度 | 值 `unknown`／键不在已选兴趣内 → `INTAKE_CONFIDENCE_MISMATCH`；非对象 → `INVALID_TYPE` |
| 全角／emoji | `additional_context` 含 emoji、ZWJ 家庭序列、全角字母、零宽空格 → `ready` 且原样保留；`closeness: "İstanbul"`（土耳其 I 混淆）→ `INTAKE_UNKNOWN_LABEL` |
| 过宽字段 | 备注 1001 码点、禁忌 `terms` 单项 1001 码点、禁忌 `tags` 21 项 → `LIMIT_EXCEEDED`；禁忌 `terms` 含空白字符串 → `INVALID_TYPE`；禁忌 `unresolved` 非空 → `INTAKE_CLARIFICATION_REQUIRED` |
| 字节上限 | **恰好 32768 字节**通过解析（未报 `INTAKE_INVALID_JSON`），**32769 字节 → `INTAKE_INVALID_JSON`**，边界精确、与契约"等于上限允许"一致 |
| 严格解析 | 重复键／`NaN` 字面量／非 JSON／根为数组 → `INTAKE_INVALID_JSON` 或 `INVALID_TYPE` |
| 候选侧边界 | 金额恰好等于预算上限 → `passed`（边界含）；`200.01` → `OVER_BUDGET`；准备 9 天 → `PREPARATION_TOO_LONG`；2 个候选 → `INVALID_CANDIDATE_COUNT`；18 类候选错误码逐项触达 |

### F-3 错误码全量对账

对账口径：代码实现点（逐文件 grep）× 契约错误码表 × `workflow/workflow-spec.md` 预留 × 我本轮实际触发。

- **契约错误码表中列出的每一个码都已实现**：`documented_in_contract` 与实现集的**差集为空**。不存在"文档承诺、代码缺失"的码。
- **本轮实际触达 23 个码**，覆盖全部 8 类输入错误（`INTAKE_*`）× 全部请求侧与候选侧规则码。
- **`workflow-spec.md:166` 明示"代码中不存在的 7 个码"**（`INVALID_SELECTION`／`STALE_RECOMMENDATION`／`UNTRUSTED_RECOMMENDATION`／`CANDIDATE_NOT_PASSED`／`PRESENTATION_INVALID`／`TOTAL_MISMATCH`／`REPAIR_LIMIT_REACHED`）并自称"已逐项 grep 核实"。**我的独立逐文件 grep 结论完全相同：该 7 码零命中。** 文档的自我披露准确，**不存在把设计预留冒充已实现**。
- **`INTERNAL_ERROR` 是唯一"已实现但输入不可达"的码**：它是 `validate()` 顶层 `except Exception` 与 intake 的 `status=="error"` 兜底；我构造极端输入后仍先落入 `INVALID_JSON` 分支，**未能进入该分支**。记为"实现存在、输入不可达"，**不主张已验证其运行时行为**。
- 包装层 `REPAIR_NOT_ALLOWED`／`PASSED_CANDIDATE_CHANGED`／`WORKFLOW_INPUT_ERROR` 由阶段 C 套件触达，本阶段不重复主张。
- 对账口径更正：`validator/rules.py` 中的字符串 `"NFKC"` 是规范化标记而非错误码，已从计数中剔除，避免虚增。

### F-4 需 PM 定性的分层边界（**不是我的结论性缺陷判定**）

同一个未声明关系值，两层行为不同（原始输出 `evidence/raw-layer-boundary.txt`）：

| 层 | 输入 | 结果 |
| --- | --- | --- |
| intake 层 `adapt_intake` | `recipient_relation="boss"` | `needs_input` + `INTAKE_UNKNOWN_LABEL` |
| 规则层 `validate`（**容器 `/validate` 暴露的就是它**） | `recipient_relation="boss-未声明关系"` | **`passed: true`** |
| 规则层 `validate` | 额外原样加入 `recipient_relation_id="pursuit"` | **`passed: true`** |

`docs/intake-contract.md:60` **已自述**"`validator/rules.py:119–157` 对 `request` 无字段白名单"，故这不是隐藏缺陷，而是**分层契约的既有事实**。

**PM 已定性（2026-10-30，采纳方案 (a)）：R-1 属分层设计，不是缺口。** `/validate` 只是一道**规则门**，它根本不消费关系枚举；关系白名单在 **intake 层**（未知关系 → `INTAKE_UNKNOWN_LABEL`）。落档口径为：

> **intake 适配层必须前置。不得把 `/validate` 的 `passed` 当作"输入符合 intake-v1 契约"。**

跨层实测：intake 层对"未知关系 + 伪造 `recipient_relation_id`"报 `INTAKE_UNKNOWN_LABEL` + `INTAKE_UNKNOWN_FIELD` 且不释放 `request_json`；同一语义送规则层则 `passed`。两层**行为不同且都正确**；适配层对合法输入的产物送进规则层仍然 `passed`（闭环成立，说明分层不是靠放宽任何一侧实现的）。可复跑用例：`tests/acceptance/boundary/test_cross_layer_gate.py`。**本 Agent 未修改 `validator/**`、`workflow/**`、`deploy/**`。**

### F-5 本阶段用例结果

`python tests/acceptance/contract/run_contract.py` → **87 项用例，87 通过 / 0 失败**。

**方法学更正（如实记录）**：候选级错误码位于 `candidate_results[i].errors` 而**不在**顶层 `errors`；我首轮只读顶层，导致 13 项误报"没有错误码"。改为聚合顶层+候选级后全部通过——**这是我的探针缺陷，被测行为正确**。

### F-6 未核实

- ~~`INTERNAL_ERROR` 的运行时行为（输入不可达）。~~ **已移出未核实（2026-10-31）**：用受控故障注入实际触达两条路径——规则层 `path="$"`（`status=error`、不泄露堆栈、`business_data_verification=not_verified`）与适配层 `path="intake"`（`status=needs_input`、不释放 `request_json`）。复现：`python tests/acceptance/boundary/probe_internal_error.py`，输出见 `docs/test-reports/boundary-001/evidence/internal-error-injection.txt`。仍成立的说明是：它**不能由任何输入触发**，只能由内部故障触发（设计意图）。
- 7 个预留码"未来是否实现"属设计决策，不在测试范围。
- Dify 节点边界信封（`payload_json` 262144 字节）与 LLM 修订链路的端到端行为（需模型调用，本轮 **0 次模型调用**）。

> **文档修复记录（2026-10-31）**：2026-10-30 插入「阶段 F 独立复核」时，我误用 `## 指标定义` 作为替换锚点
> 且未在末尾补回该标题，导致**「指标定义」章节标题丢失、其表格一度成为孤儿**。
> 现已在表格前恢复 `## 指标定义` 标题。这是**我引入的文档缺陷**，如实记录以免被误认为他人改动。

## 阶段 G 独立复核：请求侧数值范围与跨层门禁

依据：`docs/validator-contract-decisions.md` §5（2026-10-30 修订，请求预算 `[1,10000]` 含端点）、§6（可用天数 `[0,365]` 含端点，保留 `0`）；超限复用 `LIMIT_EXCEEDED`、请求侧 `needs_input`。**候选侧不受约束。**

套件（自建夹具，**不复用规则线的 `tests/test_cases.json`**）：`tests/acceptance/boundary/`。报告与证据：[`docs/test-reports/boundary-001/`](test-reports/boundary-001/)。

### G-1 范围与端点（断言三要素：错误码 + 字段路径 + status）

| 维度 | 实测 |
| --- | --- |
| 预算下限 | `0`／`0.0`／`0.00` → `LIMIT_EXCEEDED` @ `request.budget_amount`，`needs_input` |
| 预算端点（含） | `1`／`1.00`／`10000`／`10000.00` → 不报范围码 |
| 预算上限以上 | `10000.01`／`10001` → `LIMIT_EXCEEDED` @ `request.budget_amount`，`needs_input` |
| 天数 | `-1`／`true`／`1.0`／`"3"`／`null` → `INVALID_TYPE` @ `request.available_days`；`0`／`1`／`365` 通过；`366`／`10^20` → `LIMIT_EXCEEDED` |
| **格式优先于范围** | `-1`／`-0`／`1e5`／`10000.001`／`00`／`01.00`／`" 200"`／`"1,000"` → **统一 `INVALID_AMOUNT`**，且**任何位置都不得出现 `LIMIT_EXCEEDED`**。其中 `01.00`（=1）、`1,000`（=1000）数值上**落在范围内**，是精心挑选的判别器：只有"先格式、后范围"才会统一得到 `INVALID_AMOUNT` |
| 边界业务语义 | `budget=1` 配候选 `1.01` → `OVER_BUDGET`；候选恰好 `1` → 通过（比较用 `>`，非 `>=`）；`days=0` 配准备 1 天 → `PREPARATION_TOO_LONG`；配 0 天 → 通过；`days=365` 配 366 → `PREPARATION_TOO_LONG` |
| 请求错误优先 | 请求越界 + 候选越界同时存在 → `needs_input`（§1 优先级），`all_passed=false` |

### G-2 反向断言：范围**没有下沉**到与候选侧共用的 `_amount`／`_days`

本阶段最重要的一组。若把 `1 <= x <= 10000` 写进 `_amount`、把 `x <= 365` 写进 `_days`，会误伤候选侧：

| 用例 | 期望 | 实测 |
| --- | --- | --- |
| 候选 `estimated_total="0"` | 仍全部通过 | `passed`，无 `LIMIT_EXCEEDED`、无 `OVER_BUDGET` |
| 候选 `estimated_preparation_days=0` | 仍全部通过 | `passed`，无 `LIMIT_EXCEEDED`、无 `PREPARATION_TOO_LONG` |
| 候选估算 `20000`／`999999`／`10000.01` | **只**出现 `OVER_BUDGET` | `failed` + `OVER_BUDGET`，**任何位置无 `LIMIT_EXCEEDED`** |
| 候选准备 5000 天 | **只**出现 `PREPARATION_TOO_LONG` | `failed` + `PREPARATION_TOO_LONG`，无 `LIMIT_EXCEEDED` |
| 候选格式（全角／`01.00`／`-1`） | 仍 `INVALID_AMOUNT` | 一致（格式规则两侧同一套） |

### G-3 判别力证明（**通过不等于有牙**）

把范围校验视为被测功能，用**受控变异**验证断言真能发现它缺失：在内存中整块摘除 `validator/rules.py` 的请求侧范围校验那 4 行后重跑同一批输入。

| 类别 | 结果 |
| --- | --- |
| 判别用例（越界值，须拒） | **6/6 有判别力**：摘除后 `budget=0` → `failed/OVER_BUDGET`（不再 `LIMIT_EXCEEDED`）；`10000.01`／`10001`／`366`／`10^20` → 全部 `passed` |
| 对照用例（范围内端点，须通过） | **2/2 两侧一致**（本就该通过，不承担判别职责） |

命令：`python tests/acceptance/boundary/prove_discrimination.py`。**不修改 `validator/rules.py`**（只读源码 + 内存 `exec`）。

### G-4 跨层门禁（R-1 已定性为分层设计）

同一条"未知关系值 + 伪造 `recipient_relation_id`"，两层行为如下，且**两层都正确**：

| 层 | 实测 |
| --- | --- |
| intake 适配层 `adapt_intake` | `needs_input` + `INTAKE_UNKNOWN_LABEL`（未知关系）+ `INTAKE_UNKNOWN_FIELD`（伪造的服务端专属字段），**不释放 `request_json`** |
| 规则层 `validate`（容器 `/validate` 暴露的就是它） | **`passed`** —— 规则门不消费关系枚举，也不做字段白名单 |

**落档口径：intake 适配层必须前置；不得把 `/validate` 的 `passed` 当作"输入符合 intake-v1 契约"。**
闭环佐证：适配层对**合法**输入的产物送进规则层仍然 `passed`（分层不是靠放宽任何一侧实现的）。
用例：`tests/acceptance/boundary/test_cross_layer_gate.py`（6 项，含枚举成员集冻结断言：8 产品值 + `colleague` + `unknown`，`partner` 与 `pursuit` 显示文本不同）。

### G-5 独立发现 ①：JS 侧 `web/server/checker.mjs` **尚未同步**范围校验（穷举矩阵）

**现象**：Python 已落地的请求侧范围在 JS 接入层缺失。为给出**可照做的修复清单**，我把采样扩成**穷举网格**：
用例表**只在 Python 侧生成一次**，同一份 JSON 文本同时回放给两侧（经 stdin 传给 `js_grid_probe.mjs`），
因此两侧输入**逐字节相同**，不会出现"两边各写一份用例"的假一致。

命令：`python tests/acceptance/boundary/run_js_grid_probe.py`（node v24.21.0）

```
用例总数 60：一致 35 / 码或状态分歧 9 / **接受性分歧 16**
```

**高严重度·接受性分歧 16 条**（全部为"JS 放行、Python 拒绝"）：预算 `"10000.01"`／`"10001"`／`"99999"`／`"100000"`／`"1"×1000`；
天数 `366`／`1000`／`100000`／`9007199254740991`；以及**隔离用例**（三个候选金额均为 `"0.00"`）：
预算 `"0"`／`"0.00"`／`"0.01"`／`"0.99"` 与 `"10000.01"`／`"10001"`——隔离后 JS **直接 `passed`**，
证明它**完全接受了非法预算**，而非"用别的理由拒绝"。

**对照组**：预算 `"10000"` + 候选全 `"0.00"` 与 预算 `"10000"` + 天数 `365` 两侧一致（矩阵不是"逢 JS 必报分歧"）。

**修复清单**：在 `web/server/checker.mjs` 的**请求校验**处（`currency` 比较之前）补
① `budget` 分量 `< 100 || > 1000000` → `LIMIT_EXCEEDED` @ `request.budget_amount`；② `available_days > 365` → `LIMIT_EXCEEDED` @ `request.available_days`；
③ **必须放在请求级、不得放进候选侧共用的金额/天数解析函数**（否则污染候选侧，正是 G-2 反向断言在防的）；
④ 必须**早于**候选比较生效，否则预算 `0` 会先产生误导性的 `OVER_BUDGET`。
**验收方式**：修复后重跑，**接受性分歧应从 16 降到 0**。

**次生分歧（严重度较低，勿与上条混为一谈）**：JS 解析器 `jsonstrict.mjs:168` 有 `Number.isSafeInteger` 规则
（我此前猜测"是我的探针序列化问题"，**该猜测已被推翻**）。故天数 `2^53`／`10^20` 在 JS 为 `INVALID_JSON`、
在 Python 为 `LIMIT_EXCEEDED`——**两侧都拒绝**，仅码不同。

> **不要把 `web/tools/parity-check.mjs` 的绿灯当作 JS 侧已同步的证据。** 我独立核查了样例生成器
> `web/tools/gen-parity-fixtures.mjs`：其中**零个**请求侧越界值（无 `10000`／`10001`／`10000.01`／`deadline_days: 366`）；
> 其 intake 样例只覆盖缺预算、`"100-200"` 这类**格式**错误、非 CNY、未知关系／标签、重复兴趣、超长补充说明、超限数组。
> 该样例集**结构性看不见**数值范围变更，parity 绿是盲区，而非同步证据。

### G-6 独立发现 ②：✅ **交付镜像已同步**（**2026-10-31 01:13:59 已重建并复核**；标题保留历史写法，勿再读作「未同步」）

**动机**：G-1～G-4 全部是 `import validator.rules`——测的是**工作区源码**，**不是交付的镜像**。
两者若脱节，"测试全绿"就具有欺骗性。我直接问容器。

命令：`docker run -d --name gw-sync -p 18099:8000 giftwise-validator:latest` 后运行
`python tests/acceptance/boundary/probe_container_sync.py`（只读；容器已删除，未重建/未打标签/未推送）

```
本地   validator/rules.py : 14059 字节  278 行  sha256=1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500
容器内 validator/rules.py : 13626 字节  273 行  sha256=4782255bb9c9ab48494382ca712d6b92ade248bf64143406161418b6ae744ca3
字节完全相同: False
```

**统一 diff 显示镜像缺失的内容恰好只有那 5 行范围校验**（无其他差异）；镜像内 `"预算须在"` 与 `"可用天数须在"` 均**不存在**。

**直接问运行中的 API**（候选金额一律 `"0.00"`、准备 `0` 天，排除候选侧干扰）：

| 请求 | HTTP | status |
| --- | --- | --- |
| `budget="10000.01"` | 200 | **`passed`** |
| `budget="10001"` | 200 | **`passed`** |
| `budget="0"` | 200 | **`passed`** |
| `days=366` | 200 | **`passed`** |
| `days=9007199254740991` | 200 | **`passed`** |
| `budget="10000"` + `days=365`（对照组） | 200 | `passed` |

即**部署中的 `/validate` 放行全部越界输入**；对照组通过说明镜像本身工作正常，**只是没有这套规则**。

**关于 `/healthz` 的 `rules_source_sha256`：该字段可信。** `deploy/server.py:28–30` 定义为
`sha256(validator/rules.py 原始字节)`；我在容器内按同一定义重算，结果与 `/healthz` 报告值**完全一致**
（`4782255b…`）。它**如实报告了镜像内是旧版规则**——该机制正是用来发现这类脱节的，这次真的发现了。
**建议把"镜像哈希 == 工作区哈希"做成发布门禁。**

**严重度：高。** 这是**唯一面向真实调用方**的入口，而 JS 层（G-5）也缺同一检查 → 该缺口**端到端存在，无任何一层拦得住**。
**修复由部署线执行**（重建镜像并确认 `/healthz` 哈希等于工作区 `1f389dad…`）；我不重建，避免与其他文件线争用镜像标签。

> **顺带确认**：我上一轮报的 **I-2**（`Content-Length` 大于实发字节导致线程永久占用、被 HEALTHCHECK 掩盖）**已被部署线修复**：
> `deploy/server.py:24–27` 引入 `READ_TIMEOUT_SECONDS`（默认 10，≤0 时启动即报错），并在 `do_POST` 中把 `TimeoutError` 映射为明确的 `408`（源码注释即引用 `I-2/S-5`）。此为上一轮发现的**闭环**。

### G-7 深水区：错误组合、优先级、静默分支与解释器限制

20 项固化于 `tests/acceptance/boundary/test_error_composition.py`，探针为 `probe_deep_edges.py`。要点：

- **错误组合**：`budget=0` + `days=366` → **两条** `LIMIT_EXCEEDED`（各自路径）；范围+类型、范围+币种、三错并存**全部上报**，不去重。
- **优先级（防范围过度触发）**：JSON 数字型金额 `20000`／`0` → **只**报 `INVALID_TYPE`，**无** `LIMIT_EXCEEDED`；
  字段缺失 → **只**报 `MISSING_FIELD`；`days=0.0`／`1e400`／`true` → 均 `INVALID_TYPE`。
- **`_amount` 静默 `None` 分支**（`rules.py:96–97`，`len > 1000` 时不报错即返回 None）会使范围检查被**跳过**：
  实测 `"1"×1000` 由**范围规则**拒绝、`"1"×1001` 由**长度规则**拒绝——**同码同路径，故无越界值漏过**，
  但**消息归属不同**，错误码溯源时勿被误导。
- **解释器限制（我尝试推翻自己的结论，失败了）**：我假设 CPython 的 4300 位整数上限会让 `json.loads` 抛 `ValueError`
  并被兜底成 `INTERNAL_ERROR`。实测**不成立**：4299/4300 位 → `LIMIT_EXCEEDED`；**4301 位起 → `INVALID_JSON`**（不是 `INTERNAL_ERROR`）。
  决定性实验：`sys.set_int_max_str_digits(0)` 关闭上限后，**同一条** 5000 位整数请求变为
  `needs_input`+`LIMIT_EXCEEDED` → **证明该阈值来自解释器，不是设计规则**。
  故：拒绝是 **fail-closed** 的（不构成安全问题），但**同一逻辑输入在不同解释器配置下映射到不同契约结果**，
  且消息"JSON 无效…"对一份**语法合法**的 JSON 是误导性的；现行宿主（3.12.12）与镜像（3.12.16）均 ≥3.11，故**现行部署内一致**。
  用例刻意**不锁定 4301**，只断言跨版本不变量（必须被拒绝、必须不是 `INTERNAL_ERROR`、解析失败时候选全部 `passed=False`）。

### G-8 我在此阶段犯的探针缺陷（自曝，避免后来者重踩）

| # | 缺陷 | 症状 | 修正 |
| --- | --- | --- | --- |
| 1 | 请求模板**漏外层 `}`** | 整组用例全部误报 `INVALID_JSON`（连对照组也是） | 加**模板自检**：先用 `json.loads` 验证，不合法即**终止**而非继续产出假结论 |
| 2 | 候选金额 `"0"` 用**未加引号**字面量发出 | 变成 JSON 数字 → 误得 `INVALID_TYPE`，险些当成"候选 0 被拒"上报 | 加"探针自身 bug 对照"用例并排展示；修正后候选 `"0"` 为 `passed` |
| 3 | "下限隔离"只覆盖**候选 1**，候选 2/3 仍 120/80 元 | 隔离失败，下界分歧被**系统性低估**为"中严重度" | 增加 `all_totals` 覆盖三个候选，下界分歧随即升级为**高严重度**（16 条里的 5 条） |

> 第 3 条最值得记住：**隔离不彻底会系统性地低估缺陷严重度**。不追这一步，就会把"JS 接受非法预算"报成
> "两侧都拒绝、只是理由不同"，从而掩盖 4 条真实缺口。

### G-9 未核实

- **JS 与镜像修复后的行为**：**镜像侧已于 2026-10-31 01:13:59 重建并复核**（`submission-20261101`，`/healthz` 规则哈希 `1f389dad…` 与本机一致，半开正文 10.05 s 返 408）；**JS 侧接受性分歧仍待重跑**。修复后应重跑 `run_js_grid_probe.py`（期望接受性分歧 16 → 0）与 `probe_container_sync.py`（期望"未发现问题"）。
- **镜像重建流程是否会正确更新哈希**：我只能验证"当前镜像的哈希如实反映它是旧版"。
- **只核查了一个镜像标签**（`latest`）：`coldbuild-20261030`／`obs-check`／`prefix-check`／`slowbody-check`／`pm-baseline-20261030` 未逐一核查，其中可能也有旧版规则。
- **`4301` 阈值只在本机与镜像的解释器版本上实测**（3.12.12 / 3.12.16）；"换 Python ≤3.10 会改变映射"是由 `set_int_max_str_digits` 实验**推断**的，不是直接观测。
- **JS 解析器安全整数规则的业务合理性未评估**（我只判定它"是设计规则、两侧都拒绝、严重度较低"）。
- **Dify 节点边界信封**（`payload_json` 262144 字节）与真实模型链路：需模型调用，本轮 **0 次模型调用**。




## 指标定义

| 指标 | 方法与分母 |
| --- | --- |
| 硬性约束满足率 | 有效请求且完成运行中，最终候选满足全部适用规则数／全部最终候选数；失败项计入，错误和无输出另报。第二阶段另检查礼物加包装的总费用、时间及禁忌。 |
| 禁忌拦截率 | 正确拦截的已知禁忌候选／全部刻意构造的禁忌候选；标签和字面词分开，正常项误拦截另报。不能代表所有语义禁忌。 |
| 修订成功率 | 跨两阶段使用一次实际自动修订后通过的任务／进入修订的有效请求任务，包含超时和持续失败。固定快照不混入真实模型指标。 |
| 响应延迟 | 提交到候选报告、确认选择到赠送指南分别用单调时钟测量；不计用户思考时间。报告原始值、样本数、中位数及范围；足量后说明 p95 方法。**探针耗时不得当作业务延迟。** |
| 模型调用次数 | 实际生成、修订、赠送设计与失败调用逐项记录。完整任务通常两次基础生成，最多再加一次修订；未选择只有第一阶段调用。MVP 不自动重试模型。 |
| 调用成本 | 各类实际计费用量乘当时对应费率求和，记录模型、日期、币种、缓存处理及账单依据。**缺数据记 `not_measured`（未知），不填零**；云费用另计。 |

验收：承诺的测试实际结果符合预期；未校验内容不标通过；选择后才生成赠送设计；跨阶段最多一次修订；错误中文如实反馈。未实测并确认前不承诺延迟和成本目标。

## 结果记录

每次保存案例编号、测试层次（离线／Dify／部署 API／页面）、虚构数据版本、Git SHA、模型设置、Dify 版本与托管类型、时间、预期与实际、通过与否、错误代码、请求和候选版本、选定 ID、阶段、全局修订次数、调用数、耗时、用量、费率依据、脱敏轨迹和局限。

- 阶段 B：推荐校验器离线全量已执行，逐例证据见 [`docs/test-reports/stage-b/`](test-reports/stage-b/)。
- 阶段 C：离线用例与真实 Dify Code 节点探针已执行，逐例证据见 [`docs/test-reports/stage-c/`](test-reports/stage-c/)；**真实模型三候选、真实一次修订、持续失败、业务延迟／token／成本仍未执行**。
- 阶段 E：**已独立复核**（容器化规则 API）。通过项：规范构建、规则哈希一致、逐字节一致、状态码契约表、无密钥／违禁路径、非 root、内容级可复现、启动约 0.47 s。发现缺陷：E-1 `.dockerignore` 漏排除嵌套 `__pycache__`、E-2 停滞连接永久占用线程。逐项证据见 [`docs/test-reports/cloud-001/`](test-reports/cloud-001/)。**云端部署（K8S／UCloud、镜像仓库推送、多副本伸缩）仍未实施，无验证结论。**
- 阶段 D：**未执行**（前端接口已出现但未交付验收）。
- 阶段 F：**已独立复核**（契约专项）。通过项：10 个关系枚举值行为、`pursuit`/`partner` 独立性、预算／期限／兴趣／全角 emoji／过宽字段／字节上限边界、候选侧 18 类错误码、错误码全量对账。**87 项用例 87 通过 / 0 失败**。⚠️ 该报告生成于 `HEAD=46d1b48`，其中"金额／天数无上限"等结论**已被请求侧范围裁决取代**（报告顶部有作废范围声明）；R-1 已由 PM 定性为分层设计。逐项证据见 [`docs/test-reports/contract-001/`](test-reports/contract-001/)。
- 阶段 G：**已独立复核**（请求侧数值范围 ＋ 跨层门禁 ＋ 深挖）。通过项：预算 `[1,10000]`／天数 `[0,365]` 端点与越界、**格式优先于范围**（8 个判别用例统一 `INVALID_AMOUNT`、无 `LIMIT_EXCEEDED`）、**候选侧不受范围约束**（候选 `0` 通过；候选 20000 与 `'9'*999` 只报 `OVER_BUDGET`）、边界业务语义（`>` 比较）、跨层门禁（intake 拒／`/validate` 放行）、错误组合与优先级（JSON 数字型越界金额只报 `INVALID_TYPE`，字段缺失只报 `MISSING_FIELD`）。**45 项用例 45 通过 / 0 失败**；判别力经"内存摘除范围校验"证明（6/6 判别用例会失败）。**深挖发现 3 项**：① 🔴 **交付镜像 `giftwise-validator:latest` 未同步**（`rules.py` 273 vs 278 行、diff 恰为那 5 行范围校验；运行中 `POST /validate` 对 `budget=10000.01`／`10001`／`0`、`days=366`／`2^53-1` **全部 `passed`**）——缺口端到端存在；② 🟠 **JS 侧未同步**（穷举 60 例中 **16 例接受性分歧**；parity 样例集不含越界值，其绿灯不构成同步证据）；③ 解释器整数位数上限使超长整数字面量映射到 `INVALID_JSON` 而非 `LIMIT_EXCEEDED`（我用 `set_int_max_str_digits` 实验证明其来源，并尝试推翻"`INTERNAL_ERROR` 输入不可达"的结论而失败——该结论被加强）。逐项证据见 [`docs/test-reports/boundary-001/`](test-reports/boundary-001/)。


## C2-03 用例修订说明（**过时断言，不是为了让测试通过而改测试**）

**纪律声明**：改测试前必须先判断"这是在修过时断言，还是在掩盖失败"。此例属**前者**，理由与证据如下。

| 项 | 内容 |
| --- | --- |
| 改了哪条 | `tests/acceptance/stage_c/test_stage_c_workflow.py` 的 `test_c2_03`（现名 `test_c2_03_pursuit_was_rejected_before_the_change`） |
| **原断言** | 通过 `git show HEAD:workflow/labels.py` 读出"变更前版本"，断言其中**不含** `pursuit` 键 |
| **为什么失效** | 该断言把**历史基线挂在 `HEAD` 这个会移动的引用上**。DEC-1 已把 `pursuit` 加入关系枚举（自提交 `959aa6a`「2026-11-01 现场提交冻结版本」起），工作流线随后提交，`HEAD` 前移 → `git show HEAD:workflow/labels.py` 返回的是**新版本**（含 `pursuit`），断言自然失败。**失败原因是"基线取错"，不是"产品行为回退"** |
| 依据裁决 | DEC-1：`partner`（恋人）与 `pursuit`（追求对象）必须是两个独立关系值（`workflow/workflow-spec.md:9`、`docs/intake-contract.md` 关系表） |
| 改后断言 | ① 使用**逐字节固定夹具** `tests/acceptance/stage_c/fixtures/labels_before_pursuit.py`（来源提交 `89d6624`，即加入 `pursuit` 前的最后一个版本，与原文逐字节一致，sha256 `333ad9761d9278c7421c0cdd1c8d43ebbef7b6a6c164dfc54896ec653520d916`，出处见同目录 `PROVENANCE.md`）；② 新增断言"**夹具哈希未被改动**"，防止夹具被静默篡改；③ 把"当前工作区是否已加入 `pursuit`"**降级为漂移观察**，不作为判定条件 |
| 为什么这不是掩盖失败 | 改动**缩小**了断言的依赖面（从"随 `HEAD` 漂移的仓库状态"改为"内容哈希锁定的固定夹具"），并把可观察事实（当前工作区是否含 `pursuit`）**如实记录**而非删除。若产品行为真的回退（`pursuit` 被移除），夹具哈希断言与关系枚举断言仍会分别失败 |
| 佐证 | 该用例修复后 Stage C **39/39 通过**；同一修复前后 `tests/test_validator.py` 的 329 项始终通过，不涉及规则线用例 |



未实测并确认前不承诺延迟和成本目标。部署后独立实测 API 可达性与容器健康，不能用本地结果替代。
