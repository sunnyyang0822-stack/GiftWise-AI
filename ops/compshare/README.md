# Compshare 实际部署入口

关联 Issue #109、路径兼容缺陷 #124。部署基础为 main `15e29edcc150c3a4a8a9ba04e9f0c8a2bb614879`，QA 树 `2772f6d022a15ca98d0d8be9ec0f82033445c182`。部署时固定完整提交，不跟随浮动分支。

本目录采用 Ubuntu 22.04 + Node v24.16.0 + systemd + Nginx；不使用历史 Python Dockerfile。应用零 npm 依赖、无需前端打包。此目录脚本已做本地语法核查，**尚未在实例执行，不是公网验收证据**。

## 目标与状态

独立实例 `giftwise-prod-20261101` / `uhost-1x5rd7gtinrq`，公网 `117.50.83.57`。平台显示 P40×1、8 核、64GB、100GB 系统盘、0.38 元/小时，关机不收费，系统盘额外 0 元/小时；48 小时推算 18.24 元，不代表实际结算。资源总预算 300 元，两天试运行。公网只用 HTTP IP，不购买域名。

## 执行顺序

通过 OpenCLI 操作平台网页终端。先核对实例身份、`id`、`uname -a`、`df -h /`，再执行下面已提交脚本。不要在命令中粘贴或回显秘密，不启用 shell trace。`SHA` 必须是包含本目录的已推送完整提交。

```sh
SHA=<实际部署完整提交>
curl --fail --location --connect-timeout 15 --max-time 60 -o /tmp/giftwise-bootstrap.sh "https://raw.githubusercontent.com/sunnyyang0822-stack/GiftWise-AI/$SHA/ops/compshare/bootstrap.sh"
sudo bash /tmp/giftwise-bootstrap.sh "$SHA"
```

在可信渠道将真实环境配置写入 `/etc/giftwise/server.env`，root:root、0600。不把秘密写入公开仓库、终端命令历史、录屏、聊天、OpenCLI 调用参数或日志。模板 `env.example` 只含空值；应用不会自行加载它。启动器检查四项秘密配置完整性和 llm/domestic/选后生图开关，缺少则拒绝启动。

```sh
sudo bash "/opt/giftwise/releases/$SHA/ops/compshare/activate.sh" "$SHA"
sudo systemctl status giftwise --no-pager
curl --fail --silent http://127.0.0.1:8787/healthz
curl --fail --silent http://127.0.0.1/api/config
```

`/healthz` 200 不等于供应商已联通；必须检查有效 `mode=llm`、mock 不活跃，再单独记录实际模型、公开文字检索、选后异步 AI 图结果。不要用 `?preview=1` 验收。Nginx 900 秒只避免代理提前断开，不改变前端 120 秒/解析 60 秒超时，不构成端到端 SLA。

## 持久化与权限

单个 giftwise 用户、单个 Node 进程。systemd 将 `/var/lib/giftwise/runtime` 绑定到该 release 的真实 `.tmp` 目录，将 `/var/lib/giftwise/db` 绑定到 `.local-db`，不是符号链接。数据库为 `.local-db/giftwise.sqlite`；账本 `.tmp/llm-calls/ledger.jsonl`。运行时包含 material-cache、retrieval-audit、media-store、历史 catalog-images/style-boards。源代码由 root 保管，运行用户仅能写绑定目录。

启动时仅创建独立空库，不导入原演示商品。首次缓存不存在时导入三条经过交接验证的匿名公开文字，保留原 observed_at，不伪装实时检索；后续正常 HTTP 文字检索保持开启。素材来自交接 SHA `147e45a60f7a7fc9f2cc8c7e9d8146af3dc5f405` 的 `docs/handoff/eceef056/runtime-c/evidence/public-material-manifest.json`，SHA256 `a1298ea0f85c0ae05b3a298941ec023deb9fb1c9ed513b14bd6c51252a3c38d4`。启动日志只记录导入数量。

调用账本保留且不重置；LLM_CALL_BUDGET 为次数阈值，不是金额限额，检查与追加并非原子事务，不能声称强费用封顶。平台费用以平台结算为准。

run、analysis、selection、Cookie 签名密钥和并发状态仍在内存。重启会使旧流程失效；媒体落盘不等于旧流程可恢复，不支持多副本。发布/回滚后用户需重新开始。未知状态的付费图片不会自动重发。

## 验收和证据

从独立公网客户端检查 `/`、`/healthz`、`/api/config`，按交接 static-assets-manifest 检查 40 个静态文件的 HTTP 状态、大小和 Git 内容 SHA256。保留一个 cookie jar 走恋人/追求对象虚构输入→三方案→主动选择→先文字后图；另一个会话访问 run/task/asset 应拒绝。成功推荐必须恰好三个可选方案，推荐卡不出现网络图片槽位；体验型不出现空包装材料章。无必要不重复付费调用。

记录部署完整 SHA、Node/系统版本、服务状态、HTTP 与静态结果、模型账本增量、检索审计、选后图片状态、脱敏错误；不公开 Cookie 或供应商响应秘密。日志入口 `journalctl -u giftwise`、`/var/log/nginx/giftwise-{access,error}.log`。journal 上限配置 200M/7天，实际生效由云端检查；Nginx 日志沿用系统 logrotate。

## 备份和回滚

启动前记录当前 `/var/lib/giftwise/active-sha`。每次发布/回滚前停止服务，备份完整 db/runtime，再启动目标已审阅版本。备份包含敏感运行数据，root 0700 目录、归档 0600，不上传 GitHub。不要运行中只复制单个 SQLite 文件。

```sh
sudo systemctl stop giftwise
sudo install -d -m 0700 /var/backups/giftwise
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo sh -c 'umask 077; tar -C /var/lib/giftwise -czf "$1" db runtime active-sha' sh "/var/backups/giftwise/$STAMP.tgz"
OLD_SHA=<上一个已部署完整提交>
sudo bash "/opt/giftwise/releases/$OLD_SHA/ops/compshare/activate.sh" "$OLD_SHA"
curl --fail --silent http://127.0.0.1/healthz
```

只有兼容相同存储格式的版本才直接复用数据。若存在不兼容迁移，停止服务并从发布前快照恢复 db/runtime 后再激活旧版本；禁止覆盖运行中库。首次发布无旧运行版本时，失败回退为停服务并保留独立数据，不能虚构已有旧版可用。

试运行结束通过平台确认关机及停止计费。不要删除实例/数据替代关机。平台说明连续关机 7 天后可能回收、清空数据，重要数据需在回收前备份。
