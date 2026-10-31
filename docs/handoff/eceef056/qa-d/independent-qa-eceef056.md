# eceef056 最终组合独立 QA

Issue #122 跨设备交接。独立 Agent 验证，非另一位人类账户批准；本报告不授权合并、资源采购或部署。

受测代码完整 SHA：`eceef056ce80399b83c61f62860a32d0ead16e3d`；git tree：`2772f6d022a15ca98d0d8be9ec0f82033445c182`。证据 commit SHA **尚未产生**，见 PM 远端交付回执及固定 URL；代码 SHA 不等于证据 commit，不能用代码 SHA 构造尚不存在的证据链接。

结论：这次最终 SHA 的必要离线组合检查通过，未发现本范围内的产品阻断。7 个现有测试文件按明确名称过滤，Node 原始口径为 **51 tests / 51 pass / 0 fail / 0 skip / exit 0**；另 1 个新跨模块 HTTP 合同探针覆盖 ready、failed 两个受控场景，**1 test / 1 pass / 0 fail / 0 skip / exit 0**。它们不证明最终版真实模型、真实采集、真实出图、真实浏览器或 Linux 公网部署成功。两次探针准备失败必须与最终成功一起保留，见下表。

## 执行身份与环境

- 独立 clean detached 工作树：`E:\黑客松\.worktrees\independent-qa-eceef056-20261031`。创建命令：`git -c safe.directory=E:/黑客松/GiftWise-AI -c maintenance.auto=false -c gc.auto=0 worktree add --detach E:\黑客松\.worktrees\independent-qa-eceef056-20261031 eceef056ce80399b83c61f62860a32d0ead16e3d`，在主仓库 cwd 执行；未切换或修改主仓库/其他树。
- 每次测试前后 `git status --porcelain=v1 --untracked-files=no` 均为空，HEAD 和 tree 均按上方完整值核验。没有业务/现有测试源文件改动；QA 探针、限制脚本与证据在项目专属目录，运行夹具在该 QA 工作树 `.tmp`。
- 实测 Node **v24.16.0**，Python **3.12.10**（仅启动器/证据整理；本次未重跑 Python 规则套件）。完整版本字符串在各 execution.json。项目使用 `node:sqlite`，本次没有证明 package engines 中所有较旧 Node 版本可运行。
- 子进程从 OS 变量白名单重新构造环境；不继承模型/Dify/图片 Key、代理认证、Cookie、Token、NODE_OPTIONS 或 env-file，不读取真实 `.env`。白名单及本任务配置值保存在 execution.json；PATH 仅为已定位 Node/Python 安装目录和 Windows System32。
- `GW_MODE=mock`、style channel=rules、真实生图环境开关=0；个别受控测试显式以 `mode:llm` 进入生产解析/管线分支，模型方法与图片 transport 注入离线响应，绝不是实际 LLM/Seedream 调用。HTTP 探针显式 enableImageGeneration，仅启用注入的受控图片 transport。
- preload 拒绝外部 fetch、TCP、TLS、DNS 与其他监听；纯离线组 listen/connect/fetch/blocked 均为0。HTTP 最终组只允许 `127.0.0.1:8932`，1次自有监听、2条复用 TCP 连接、26次本地 fetch、数字回环 lookup 在进程内直接回调（不发 DNS），blocked=0。没有打开 Chrome、OpenCLI、供应商或平台页面。
- 8932 在每次 HTTP 开始前由 Python bind 成功、立即释放后才启动自有 server；退出后再次 bind 成功，证明端口已释放，精确 UTC 在 execution.json。只关闭该探针持有的 server 对象；没有查询/操作 8903、8912、PM PID35812 或其他服务。

## 命令、时间和原始结果

从 `E:\黑客松` 执行 `python -B .tmp\handoff-eceef056\qa-d\run-qa.py <mode> [label]`；启动器源码完整保留，并通过显式 env 参数启动 Node。各 execution.json 给出展开后的绝对 Node argv、Windows command、cwd、白名单、UTC、退出码和原始输出 hash，不用 PowerShell wrapper 的退出码替代 Node 退出码。

| 目录 / 启动器参数 | UTC 开始 → 结束 | Node 原始口径 | 结论 |
| --- | --- | --- | --- |
| `offline` / `offline` | 20:38:43.300410 → 20:38:46.781890，2026-10-31 | 51 / 51通过 / 0失败 / 0跳过，exit0 | 7文件明确过滤；过滤未选中的用例不算已执行或 skip。TAP 有42个顶层、另9个嵌套负例，合计51。 |
| `http` / `http` | 20:39:45.507481 → 20:39:46.621625 | 1 / 0通过 / 1失败 / 0跳过，exit1 | QA 限制脚本误拦 Node listen 对数字回环的 lookup，`QA_NETWORK_BLOCKED_DNS`。无产品判断；未发生外部 DNS。 |
| `http-attempt-2` / `http http-attempt-2` | 20:40:01.152533 → 20:40:02.263182 | 1 / 0通过 / 1失败 / 0跳过，exit1 | QA 新探针误把 cache.put 的返回断言写为 saved，生产契约实际为 stored。只修断言，不改生产。 |
| `http-attempt-3` / `http http-attempt-3` | 20:40:14.536937 → 20:40:16.513493 | 1 / 1通过 / 0失败 / 0跳过，exit0 | 修正上述两个 QA 准备问题，跨模块全部断言执行至末尾。 |

每组均保存独立 stdout.tap、stderr.txt、execution.json；stderr 均为空。原始失败未删除、拼接成绿或被后一次结果覆盖。离线组使用的 guard v1、各失败探针版本和最终版本也随发布副本保留，不重复测试其他已通过范围。

## 断言覆盖与适用范围

1. **真实素材结构与模型协议（离线 unit/受控 provider）**：实际 provider 读到注入的摘要/来源/时间后再输出；一批素材可支撑三种创意，不强求词匹配或逐卡绑定。伪 refid、假域/商店域/非HTTPS、缺时间/标题、纯图无摘要均被拒；无素材有限 continuation 后诚实 NO_MATERIAL，无根据的内容不假称 grounded。无关缓存不锁定主题，允许选择新查询。这里“真实”指校验生产来源结构和引用身份，样本为明确离线夹具，不冒充本次访问了来源网站。
2. **推荐零网图及业务修订（pipeline）**：即便 referenceImagesEnabled=true，成功修订或修订失败也不启动补图模型/任务。新 HTTP 探针把生产 MaterialCache→LlmProvider.requestCandidates→推荐校验→LlmProvider.requestCandidateRevision→最终选择串起来：初始 c1 超300预算，唯一修订降至100；c2/c3字节语义保持，最终三个通过且可选，repair=1、revision调用计数1，deadline null，没有图查询/job。推荐生成入口是直接调用生产管线，**不是**通过 POST /api/recommendations；边界如实保留。
3. **纯体验与实体/混合（pipeline + DOM，非真实浏览器）**：六种模型响应进入生产 runPresentation/sections/image plan，纯体验无包装章，实体材料/步骤、实体 description-only、混合邀请函保留。同名方案不同模型内容决定实际章节，不按演唱会关键词路由。DOM 测试验证实际非空 sections、空白条目、timeline/贺卡/摘要、ready仅替换图片区及错响应拒绝。前后端单测分别执行；HTTP 探针另核验实际生成 sections 的纯体验和实体说明两种形态，不把单测假 DOM 当 Chrome。
4. **推荐文字三卡与选后 AI（DOM/VM + HTTP）**：ready/pending/缺失/错绑推荐图片数据均不生成推荐 img、空框或定时 GET，三个选择沿用服务端可选集合。选后依然调用原呈现 POST；pending 文字立即进入状态，ready 原位补图，failed 保留文字与只读刷新，重复点击无并发，错任务/候选、离开后旧响应失效。
5. **实际 HTTP 选择/GET/资产与持久化（本地受控）**：探针在第24行直接导入完整生产 `web/server/server.mjs` 导出的 server，使用它创建的监听器；没有自建 HTTP 包装 handler、替换路由或替换 ownerScope。实际请求经生产 `ownerScope(req,res)` 的签名 Cookie 签发/校验中间件，再走生产 `/api/config`、POST `/api/presentations`、GET `/api/media/tasks/:id`、GET `/api/media/assets/:id`。通过 `/api/config` 得到两个真实本地测试会话，仅在内存读取 owner 为直接调用推荐 pipeline 的 run 绑定归属；Cookie/owner 值不输出或发布。第二个会话访问第一个会话的呈现 POST、任务及资产实际返回404。此为生产路由和会话隔离的本地受控实测；**本次没有单独测试篡改签名 Cookie**，也没有测试公网代理/HTTPS Cookie属性或跨设备会话恢复，不能将跨owner404外推为这些场景均已通过。

   文字 completed+pending 在图片 Promise 未完成时返回。两次任务 GET 不改变任务文件，重复 POST 不增加呈现/图片 transport 次数；未知64hex任务=404、pending资产=404。ready返回真实受控 PNG字节、failed保留最终文字且没有图，重复 POST不重生。每场景图片 fixture调用1次、文字fixture调用1次，真实外部调用0。模型方法与媒体 transport 的注入不替代生产 Cookie/HTTP handler；推荐阶段仍是直接调用 runRecommendation，未经过 POST /api/recommendations。另既有离线 owner/run/candidate 错绑定和重启中断只读派生失败测试通过。

## 历史证据与未核实

`history/index.md` 及8份历史独立报告仅索引其各自 SHA、来源和局限，不能顶替本次同版 QA。旧全量针对 `42a1accc7159cae6ee4c6e11e7e170ad02eb1a81`，363=349通过/12失败/2跳过/exit1，未重跑、未转绿。本次选定范围通过不证明那12项全部消失。旧 PR83 的一次真图、PR84/102 浏览器回放、PR121 的暖素材28.393s，也都不是最终 ecee 的新端到端/性能结果。

尚未验证：最终 ecee 的真实解析→素材检索→推荐→呈现→真实AI图片→Chrome全链路、跨设备会话/缓存迁移、冷启动/均值/P95、物理junction全部平台行为、Compshare资源/公网/Linux安装运行与访问控制。没有 build/run 镜像、SSH/SCP、云API、资源采购或外部供应商请求；health200不能作为上线结论。

静态可移植性限制：`web/server/retrieval/material-bundle.mjs:8` 的 PROJECT_ROOT 明确 `resolve('E:/黑客松')`。Linux 下该字符串不是实际 `/app` 项目根，常规 Linux 目标目录的素材导入会与此硬编码路径边界冲突；这是源码推断，未在Linux执行。`task-paths.mjs` 使用由 import.meta.url 推导的当前 REPO_ROOT，并有目标树路径限制，导入包也不能直接依赖旧 Windows C工作树。跨设备按现冻结源码直接部署需解决/验证该限制，不能顺手修改已冻结代码；runtime-data 与部署负责人负责后续配置和裁定。

## 发布材料与隐私

可发布文件位于 `publish/`，包括本报告、精确命令/环境记录、原始 TAP/stderr、两个失败准备版本、最终探针和 guard、历史报告副本及索引。只选择必要文本，不复制数据库、media task/session记录、Cookie、浏览器配置、ledger或整个.tmp。所有发布副本经过限定敏感值扫描及人工内容检查；如有脱敏用 `[REDACTED:类别]`，`publication-manifest.json` 逐文件记录本地原始SHA256、发布SHA256及脱敏类别数量，保留本地原文。hash清单不包含自身（避免自引用），清单自身hash另在交付回执给PM。当前证据未push/commit，固定链接等待PM真实回执。
