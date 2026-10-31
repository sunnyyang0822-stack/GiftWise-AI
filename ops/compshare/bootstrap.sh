#!/usr/bin/env bash
# 新建 GiftWise 独立 Ubuntu 22.04 实例；不适用于演示机/共享主机。
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo ROOT_REQUIRED >&2; exit 2; }
sha=${1:?usage: bootstrap.sh FULL_SHA}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl xz-utils git nginx
id giftwise >/dev/null 2>&1 || useradd --system --home-dir /var/lib/giftwise --shell /usr/sbin/nologin giftwise
install -d /opt/giftwise/releases /etc/giftwise /opt/giftwise/downloads
install -d -o giftwise -g giftwise /var/lib/giftwise/runtime /var/lib/giftwise/db
version=24.16.0
archive=node-v$version-linux-x64.tar.xz
cd /opt/giftwise/downloads
curl --fail --location --retry 2 --connect-timeout 15 --max-time 240 -o "$archive" "https://nodejs.org/dist/v$version/$archive"
curl --fail --location --retry 2 --connect-timeout 15 --max-time 60 -o SHASUMS256.txt "https://nodejs.org/dist/v$version/SHASUMS256.txt"
awk -v f="$archive" '$2==f{print}' SHASUMS256.txt > selected.sha256
[[ -s selected.sha256 ]] || exit 2
sha256sum --check selected.sha256
tar -xJf "$archive" -C /opt/giftwise
ln -sfn /opt/giftwise/node-v$version-linux-x64 /opt/giftwise/node
/opt/giftwise/node/bin/node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(':memory:'); db.close(); if(!globalThis.fetch||!globalThis.WebSocket) process.exit(1);console.log(process.version)"
release=/opt/giftwise/releases/$sha
if [[ ! -d "$release/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/sunnyyang0822-stack/GiftWise-AI.git "$release"
fi
git -C "$release" fetch origin "$sha"
git -C "$release" checkout --detach "$sha"
[[ $(git -C "$release" rev-parse HEAD) == "$sha" ]] || exit 2
install -d -m 0755 /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\nMaxRetentionSec=7day\n' > /etc/systemd/journald.conf.d/giftwise.conf
# 此时不启动应用，先在可信渠道配置 /etc/giftwise/server.env 并导入已核验公开素材。
printf 'BOOTSTRAP_READY %s\n' "$sha"
