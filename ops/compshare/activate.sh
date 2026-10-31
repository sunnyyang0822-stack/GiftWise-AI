#!/usr/bin/env bash
# 仅在本任务独立实例执行；参数为已推送的完整提交 SHA。
set -euo pipefail
sha=${1:?usage: activate.sh FULL_SHA}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo INVALID_SHA >&2; exit 2; }
[[ $(id -u) == 0 ]] || { echo ROOT_REQUIRED >&2; exit 2; }
release=/opt/giftwise/releases/$sha
[[ -f "$release/ops/compshare/launch.mjs" && -f /etc/giftwise/server.env ]] || { echo RELEASE_OR_ENV_MISSING >&2; exit 2; }
[[ $(git -C "$release" rev-parse HEAD) == "$sha" ]] || exit 2
[[ -z $(git -C "$release" status --porcelain --untracked-files=no) ]] || { echo DIRTY_RELEASE >&2; exit 2; }
# 回滚先停止服务并用 sqlite backup；不复制运行中的 sqlite 文件。
systemctl stop giftwise.service 2>/dev/null || true
install -d -o giftwise -g giftwise /var/lib/giftwise/runtime /var/lib/giftwise/db
install -d -o giftwise -g giftwise "$release/.tmp" "$release/.local-db"
cat > /etc/systemd/system/giftwise.service <<EOF
[Unit]
Description=GiftWise AI Node service ($sha)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5
[Service]
Type=simple
User=giftwise
Group=giftwise
WorkingDirectory=$release
EnvironmentFile=/etc/giftwise/server.env
ExecStart=/opt/giftwise/node/bin/node $release/ops/compshare/launch.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
BindPaths=/var/lib/giftwise/runtime:$release/.tmp
BindPaths=/var/lib/giftwise/db:$release/.local-db
ReadWritePaths=$release/.tmp $release/.local-db
StandardOutput=journal
StandardError=journal
SyslogIdentifier=giftwise
[Install]
WantedBy=multi-user.target
EOF
install -m 0644 "$release/ops/compshare/nginx.conf" /etc/nginx/sites-available/giftwise
# 此实例由部署任务独占，只替换系统默认站点。
rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/giftwise /etc/nginx/sites-enabled/giftwise
nginx -t
systemctl daemon-reload
systemctl enable --now giftwise.service nginx.service
systemctl reload nginx.service
printf '%s\n' "$sha" > /var/lib/giftwise/active-sha
curl --fail --silent --max-time 10 http://127.0.0.1:8787/healthz
