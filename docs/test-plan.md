# 可复现测试计划

更新日期：2026-10-30（亚洲／上海）。定位以[统一说明](product-positioning.md)与 [Issue #1](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/1) 正文为准；阶段 1 冻结件为 [`docs/requirements-analysis.md`](requirements-analysis.md)（SC-1…SC-9、OPEN-1…OPEN-9）。

**当前执行状态（不把设计写成已完成）：**

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| A | 独立测试准备与案例设计 | 已执行，见[阶段 A 报告](test-reports/stage-a/preparation-2026-10-29.md) |
| B | 推荐校验器契约验收（离线公开 `validate`） | 已执行，见[阶段 B 报告](test-reports/stage-b/acceptance-2026-10-29.md) |
| C | 工作流层验收（探针／契约／校验／修订／持续失败／记录方案） | **部分执行**：Code 节点沙箱兼容已通过（真实 Dify 证据）；离线用例 39 项通过；真实模型三候选、真实一次修订、真实持续失败、调用／延迟／成本仍未执行 |
| D | 前端／接入层／集成／页面中文状态 | **接口已出现但未交付验收**：`web/` 于 2026-10-30 20:56 出现，我做了 14 项有界冒烟（mock 模式，见[阶段 C 报告](test-reports/stage-c/acceptance-2026-10-30.md) §4A），**不构成 WEB-001 验收判定**；正式验收待前端线交付 |
| E | 部署 API 与容器 | **已独立复核**：规范构建命令、规则哈希、逐字节一致、状态码契约表均通过；**发现 2 项缺陷（E-1 `.dockerignore` 漏排除、E-2 停滞连接永久占线程）**，详见下方「阶段 E 独立复核」。云端部署（K8S／UCloud、镜像仓库）仍未实施 |
| F | 契约专项（关系 ID 全量／边界值／错误码对账） | **已独立复核**：10 个关系枚举值行为一致、`pursuit` 与 `partner` 确为独立值；边界值与契约记载逐条一致（含契约自述的"金额／天数无上限"）；契约错误码表所列码**全部已实现**，spec 自述的 7 个未实现码经我独立 grep 确认零实现。**87 项用例 87 通过**。另有 1 项分层边界需 PM 定性（F-4：容器 `/validate` 不强制关系枚举），详见下方「阶段 F 独立复核」 |

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
| T02 超预算 | c1 总额 200.01；另测 200.00 | 前者 OVER_BUDGET，边界通过 |
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

已改为逐字节固定夹具 `tests/acceptance/stage_c/fixtures/labels_before_pursuit.py`（来源提交 `89d6624`，与原文逐字节一致，sha256 `333ad976…`，出处见同目录 `PROVENANCE.md`），并新增断言"夹具哈希未被改动"，同时把"当前工作区是否已加入 `pursuit`"降级为**漂移观察**而非判定条件。修复后 Stage C 39 项、全仓 322 项、本地探针 46 项全部通过；Stage C 逐例证据已重新生成到 `docs/test-reports/stage-c/20261030-224243/`。

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
| 预算超大 | **400 位数字串 `ready`**：与契约 :151 自述的"**无数值上限**（1000 位仍通过，1001 码点才 `LIMIT_EXCEEDED`）"**完全一致**，属**已声明限制**而非隐藏缺陷 |
| 期限 | `0`/`1`/`2`/`365` → `ready`；`-1` → `INVALID_TYPE`（契约 :154 同）；**`100000` → `ready`**，与契约 :155 自述的"无上限"一致 |
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

`docs/intake-contract.md:60` **已自述**"`validator/rules.py:119–157` 对 `request` 无字段白名单"，故这不是隐藏缺陷，而是**分层契约的既有事实**。但部署含义明确：**容器 `/validate` 只是规则门、不是契约门**；若调用方把它的 `passed` 当作"输入符合 intake-v1 契约"，则**未知关系值**与**伪造的服务端专属机器字段**都会通过。建议 PM 二选一定性：(a) 部署文档明确"intake 适配层必须前置"；(b) 或在规则层补关系枚举与 `recipient_relation_id` 白名单。**本 Agent 未修改相关文件。**

### F-5 本阶段用例结果

`python tests/acceptance/contract/run_contract.py` → **87 项用例，87 通过 / 0 失败**。

**方法学更正（如实记录）**：候选级错误码位于 `candidate_results[i].errors` 而**不在**顶层 `errors`；我首轮只读顶层，导致 13 项误报"没有错误码"。改为聚合顶层+候选级后全部通过——**这是我的探针缺陷，被测行为正确**。

### F-6 未核实

- `INTERNAL_ERROR` 的运行时行为（输入不可达）。
- 7 个预留码"未来是否实现"属设计决策，不在测试范围。
- Dify 节点边界信封（`payload_json` 262144 字节）与 LLM 修订链路的端到端行为（需模型调用，本轮 **0 次模型调用**）。



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
- 阶段 F：**已独立复核**（契约专项）。通过项：10 个关系枚举值行为、`pursuit`/`partner` 独立性、预算／期限／兴趣／全角 emoji／过宽字段／字节上限边界、候选侧 18 类错误码、错误码全量对账。**87 项用例 87 通过 / 0 失败**。待 PM 定性：F-4 容器 `/validate` 不强制关系枚举（intake 层才强制）。逐项证据见 [`docs/test-reports/contract-001/`](test-reports/contract-001/)。

未实测并确认前不承诺延迟和成本目标。部署后独立实测 API 可达性与容器健康，不能用本地结果替代。
