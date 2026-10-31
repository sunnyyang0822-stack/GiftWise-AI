# GiftWise AI 公网部署交付（2026-11-01，北京时间）

【实测】公网入口 **http://117.50.83.57/**；产品负责人在本聊天确认“可以看到首页”。部署负责人已从本机经公网完成 HTTP、静态资源、真实推荐、选后文字及真实异步生图验收。不是 mock 上线。

## 版本与跨设备入口

- 实际部署完整 SHA：`19b6819fe80787717571beb7cc0d17f89587c2d9`；树 `d6b7dca13a3779e55b58816eb0224f681663d849`。
- 分支 `codex/deploy-portable-material-root-20261101`；[部署适配 PR #125](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/125)。部署时 PR 尚未合并，本报告的后续证据提交不代表实例自动更新了代码。
- 基础 main：`15e29edcc150c3a4a8a9ba04e9f0c8a2bb614879`，与 QA `eceef056ce80399b83c61f62860a32d0ead16e3d` 共用树 `2772f6d022a15ca98d0d8be9ec0f82033445c182`。
- 固定交接：`147e45a60f7a7fc9f2cc8c7e9d8146af3dc5f405`，106 项 SHA256 核对通过；已有必要离线 51/51、受控 HTTP 1/1 由交接材料提供，本次没有把它们称为公网证据。
- 本次业务源码仅修复素材导入器 Windows 固定根，登记 [#124](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/124)。相关测试在 Windows、Linux 各 18/18；没有恢复推荐网络图片槽位，没有改关系、三方案、时间选择规则或选后流程。

远端运行与回滚入口：[ops/compshare/README.md](../../../ops/compshare/README.md)。证据均随本目录推送远端，其他设备无需读取部署电脑的路径。

## 实例、运行与费用

【实测】Compshare 独立实例 `giftwise-prod-20261101` / `uhost-1x5rd7gtinrq`，华北二A，Ubuntu 22.04.4、P40×1、8 核、64GB、100GB 系统盘。通过 OpenCLI 登录平台网页终端并执行全部云端部署操作，没有用历史 Python Dockerfile，也没有构建/运行容器。

Node v24.16.0（与 QA 版本一致），官方 SHASUMS256 校验通过；零 npm 依赖，无前端构建。Nginx 监听公网 80，转发到 Node 的 127.0.0.1:8787；仅使用公网 HTTP IP，不买域名。既有推荐防火墙允许 22/3389/80/443，未打开 8787。

systemd 单进程 `giftwise.service`，User=giftwise，enabled/active/running，检查时 PID=8301、NRestarts=0；Nginx enabled。源码由 root 保管，服务仅能写持久化目录。日志为 journal 与 Nginx 日志；journal 上限配置 200M/7天，并重启 journald 载入配置。

【推算】平台显示 0.38 元/小时，系统盘额外 0 元/小时；48 小时约 18.24 元，资源预算上限 300 元。不是已结算总费用。已在平台保存并回读定时关机 **2026-11-03 05:11（北京时间）**；届时网站停止访问，关机后该实例收费项显示“无”。可在实例列表修改/取消。未购买额外资源或域名。

## 验收结果

| 项目 | 实际结果 | 证据 |
|---|---|---|
| 公网首页、healthz、config | HTTP 200；mode=llm、mock.active=false，文本模型、domestic 文字检索及选后生图已启用 | [最终存活检查](evidence/public-health-final.json) |
| 前端/字体/图片/提示词版本 | 40 个公开静态文件状态、大小、SHA256 均与固定交接 Git blob 一致；完整 Git checkout 包含 workflow/prompts | [40/40 静态结果](evidence/public-static-assets.json) |
| 真实三方案 | 虚构追求对象、预算 100–200 元、时间 1 天；约 39.391 秒返回 passed，c1/c2/c3 均可选 | [真实推荐](evidence/recommendation.json) |
| 时间不影响选择 | 三个方案估算 2/2/5 天，在输入 1 天时仍全部可选 | 同上 |
| 网络文字素材 | 模型实际执行 2 次检索工具；本次新检索含一条站点首页摘要，最终依据为 2 条保留原观察时间的历史公开摘要，不冒充全文/实时商品 | [运行审计摘录](evidence/runtime-observations.json)、推荐 JSON |
| 推荐不抓网图 | retrieval.images=[]，候选引用 image=null；未恢复搜图槽位和轮询 | 推荐 JSON；同版前端 QA 复用 |
| 明确选择与先文后图 | 测试调用者在三方案返回后明确选择 c1；约 12.797 秒返回 completed，文字先返回，media_wait.waited=false、图片 pending | [初始指南](evidence/presentation-initial.json) |
| 真实选后 AI 图 | Seedream 供应商 HTTP 200，实际模型 doubao-seedream-4-5-251128；约 10.960 秒，1 张 2304×1728，任务 ready/succeeded | [最终媒体任务](evidence/media-task-latest.json) |
| 同源图片与目视 | 图片 HTTP 200，877634 字节，SHA256 e0c0caaa7938686c1905fedfb0ce2348e44ed59d8480938947685f60f45bda9f；实际下载并目视可显示 | [实际 AI 图](evidence/selected-ai-image.jpg) |
| 会话隔离 | 另一 cookie jar 访问 run、task、asset 均 HTTP 404；cookie 仅保存在测试进程内存，未落证据 | [请求摘要](evidence/requests-summary.json) |
| 配置秘密 | 四项由可信本机环境在内存加密，经已核验指纹的一次性 RSA 公钥传入网页终端；root 0600 写入实例，一次性私钥/密文/临时公钥随导入删除 | [运行状态](evidence/runtime-state.png)、[证据筛查](evidence/secret-screening.json) |

上述核心流程是经公网的实际 HTTP 验收，不是一次完整浏览器点击录制。OpenCLI 所控 Chrome 曾返回空 chrome-error 页面；产品负责人另行确认公网首页可见。自动浏览器整页视觉/交互走查未完成，不能将人工首页确认扩写为完整 UI 验收。

实际文本调用 5 次：recommend×2、recommend_revision×1、style_direction×1、present×1，全部 ok，总 29,513 tokens；推荐自动业务修订共 1 次。图片实际生成 1 张（供应商报告 total_tokens=15552）。没有再跑第二条付费流程。供应商金额 cost_status=not_measured，不能编造总价。`/api/config` 的 reachable_verified 是源码静态 false，不会随真实调用更新；联通结论依据实际响应与账本，不据该字段改写源码。

## 持久化、备份与回滚

【实测】systemd 挂载命名空间中 `/var/lib/giftwise/runtime` 绑定到 release/.tmp，`/var/lib/giftwise/db` 绑定到 release/.local-db，不使用被素材缓存拒绝的符号链接。独立 SQLite、材料缓存、检索审计、LLM JSONL 账本、媒体任务/图片已实际落盘，检查时 runtime 共 6 个文件、1 张资产。[挂载及状态](evidence/runtime-state.png)、[在线备份结果](evidence/online-inspection.png)。未操作原演示数据库或 8903。

【实测】在线 SQLite backup 写入 `/var/backups/giftwise/20261031T213544Z/giftwise.sqlite`，integrity_check=ok；同目录 runtime.tgz 包含运行文件与 active-sha。备份为 root 私有，未上传数据库、账本原件、Cookie 或原始用户运行数据；这里只推送白名单脱敏摘录。runtime 归档是运行中逐文件复制，不是跨文件事务快照，也没有异地备份。平台关机回收前须转移所需备份。

run/analysis/selection/Cookie 签名仍为内存状态；重启会使旧流程失效，媒体文件留存不等于旧会话恢复，不支持多副本。系统盘或实例被删除/回收时同盘备份也会丢失。

发布与回滚命令见运行入口。首次部署没有更早运行版本；失败只能停服务并保留数据，不能虚构旧版可回滚。之后回滚需固定旧 SHA、确认存储兼容性并先备份；有不兼容迁移时从发布前快照恢复。此轮没有实际做版本回滚或整机重启。

## 未完成项与影响

- 自动执行策略拒绝停服备份/重启命令，返回 `blocked by policy`、未给具体原因；该命令未执行，已改为在线备份和只读核查。**重启后持久性和恢复未实测**，没有冒称通过。
- 全浏览器点击闭环、自然语言解析真实调用、纯体验真实输出、压测和长时间稳定性未新增实测；产品相关项复用交接 QA。此轮真实样本为一条实体咖啡礼物流程，不代表所有输入均成功。
- 新的网络检索虽执行成功，本样本新增结果是站点首页摘要，最终模型引用历史公开文字；不是实时库存/价格验证。真实外观尺寸、商品存在性、价格和配送继续未知/估算。
- PR #125 尚待项目常规代码评审/集成，不影响当前固定 SHA 已运行的事实；未擅自合并 main。由用户把本交付及 Issue #109 结果转回接入 PM。

脱敏服务日志入口：实例 `/var/lib/giftwise/deployment-inspection.json`、`/var/lib/giftwise/linux-portability-tests.txt`；服务运行日志 `journalctl -u giftwise`、`/var/log/nginx/giftwise-access.log`、`giftwise-error.log`。实际部署入口、备份和回滚命令均已在远端入库。
