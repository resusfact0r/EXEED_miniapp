#!/usr/bin/env bash
# One-time installation on the existing Ubuntu 24.04 VPS; no new network listener is opened.
set -euo pipefail
REVISION=${1:?Pass the full commit SHA used to download this installer}
BRANCH=${2:-feat/web-visual-catalog}
[[ "$REVISION" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected a full commit SHA'; exit 1; }
[[ "$BRANCH" =~ ^[A-Za-z0-9_./-]+$ ]] || { echo 'Invalid deployment branch'; exit 1; }
[[ $(id -u) == 0 ]] || { echo 'Run this command as root on exeedbot.ru'; exit 1; }
for command in curl git node npm runuser flock tar sha256sum python3; do command -v "$command" >/dev/null; done
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
id deploy >/dev/null
[[ -f /opt/tg-miniapp/server/.env || -f /opt/tg-miniapp/shared/backend.env ]] || { echo 'Existing backend .env was not found'; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
BASE="https://raw.githubusercontent.com/resusfact0r/EXEED_miniapp/$REVISION/server/deploy/autodeploy"
install -d -m 755 /usr/local/lib/exeed-autodeploy
for script in poll.sh apply-release.sh; do
  curl --fail --silent --show-error --location "$BASE/$script" --output "$TMP/$script"
  bash -n "$TMP/$script"
  install -m 755 "$TMP/$script" "/usr/local/lib/exeed-autodeploy/$script"
done
install -d -m 700 /var/lib/exeed-autodeploy
cat > /etc/exeed-autodeploy.env <<EOF
EXEED_REPOSITORY=resusfact0r/EXEED_miniapp
EXEED_BRANCH=$BRANCH
EOF
chmod 600 /etc/exeed-autodeploy.env
cat > /etc/systemd/system/exeed-autodeploy.service <<'EOF'
[Unit]
Description=Install a verified EXEED branch release
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/exeed-autodeploy.env
ExecStart=/usr/bin/bash /usr/local/lib/exeed-autodeploy/poll.sh
TimeoutStartSec=1200
UMask=0077
EOF
cat > /etc/systemd/system/exeed-autodeploy.timer <<'EOF'
[Unit]
Description=Check the EXEED deployment branch once a minute

[Timer]
OnBootSec=30s
OnUnitInactiveSec=60s
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now exeed-autodeploy.timer
systemctl start --no-block exeed-autodeploy.service
echo "Autodeploy activated for $BRANCH. Logs: journalctl -u exeed-autodeploy.service -f"
