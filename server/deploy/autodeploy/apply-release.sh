#!/usr/bin/env bash
# Uses the existing exeedbot.ru layout and keeps runtime credentials outside release folders.
set -Eeuo pipefail
ARCHIVE=${1:?release archive is required}
SHA=${2:?commit SHA is required}
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA'; exit 1; }
[[ $(id -u) == 0 ]] || { echo 'Run this installer as root on the VPS'; exit 1; }

ROOT=/opt/tg-miniapp
RELEASES="$ROOT/releases"
RELEASE="$RELEASES/$SHA"
LIVE="$ROOT/server"
ENV_FILE="$ROOT/shared/backend.env"
WEB_ROOT=/var/www/exeedbot-frontend
APP=tg-miniapp-backend
ORIGIN=${EXEED_PUBLIC_ORIGIN:-https://exeedbot.ru}
PREVIOUS_BACKEND=''
PREVIOUS_FRONTEND=''
if [[ -L "$WEB_ROOT" ]]; then PREVIOUS_FRONTEND=$(readlink -f "$WEB_ROOT"); fi
SWITCHED=0

as_deploy() { runuser -u deploy -- "$@"; }
check_local() {
  curl --fail --silent --show-error --max-time 15 http://127.0.0.1:3000/api/health >/dev/null &&
  curl --fail --silent --show-error --max-time 30 http://127.0.0.1:3000/api/web/catalog >/dev/null
}
rollback() {
  local code=$?
  trap - ERR
  echo "Release $SHA failed; restoring the previous application" >&2
  if [[ "$SWITCHED" == 1 && -n "$PREVIOUS_BACKEND" && -d "$PREVIOUS_BACKEND" ]]; then
    ln -sfn "$PREVIOUS_BACKEND" "$LIVE.next"
    mv -Tf "$LIVE.next" "$LIVE"
    as_deploy pm2 restart "$APP" --update-env || true
  fi
  if [[ -n "$PREVIOUS_FRONTEND" && -d "$PREVIOUS_FRONTEND" && ( -L "$WEB_ROOT" || ! -e "$WEB_ROOT" ) ]]; then
    ln -sfn "$PREVIOUS_FRONTEND" "$WEB_ROOT.next"
    mv -Tf "$WEB_ROOT.next" "$WEB_ROOT"
  fi
  exit "$code"
}
trap rollback ERR

id deploy >/dev/null
mkdir -p "$RELEASES" "$ROOT/shared"
if [[ ! -f "$ENV_FILE" ]]; then
  [[ -f "$LIVE/.env" ]] || { echo "Existing runtime configuration is missing: $LIVE/.env"; exit 1; }
  install -m 600 -o deploy -g deploy "$LIVE/.env" "$ENV_FILE"
fi

# Recover cleanly if installation finished but the polling state was not written yet.
if [[ "$(readlink -f "$LIVE" || true)" == "$RELEASE/backend" && -f "$WEB_ROOT/version.json" ]] &&
  node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1])).commit === process.argv[2] ? 0 : 1)' "$WEB_ROOT/version.json" "$SHA"; then
  check_local
  exit 0
fi

mkdir -p "$RELEASE"
# Validate all archive paths before extracting a CI artifact with root privileges.
python3 - "$ARCHIVE" "$RELEASE" <<'PY'
import sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1]) as archive:
    for item in archive.getmembers():
        path = PurePosixPath(item.name)
        if path.is_absolute() or '..' in path.parts or item.issym() or item.islnk():
            raise SystemExit('Unsafe release member')
    archive.extractall(sys.argv[2], filter='data')
PY
node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]));if(m.commit!==process.argv[2])process.exit(1)' "$RELEASE/manifest.json" "$SHA"
test -f "$RELEASE/frontend/index.html"
test -f "$RELEASE/backend/dist/main.js"
ln -sfn "$ENV_FILE" "$RELEASE/backend/.env"
chown -R deploy:deploy "$RELEASE"
as_deploy bash -c '
  set -e
  cd "$1"
  npm ci --include=dev --no-audit --no-fund
  npx --no-install prisma generate
  npx --no-install prisma migrate deploy
  npm prune --omit=dev --no-audit --no-fund
' bash "$RELEASE/backend"

# Convert the original plain directory once; subsequent releases use an atomic symlink switch.
if [[ -d "$LIVE" && ! -L "$LIVE" ]]; then
  LEGACY="$RELEASES/legacy-$(date -u +%Y%m%d%H%M%S)"
  mkdir -p "$LEGACY"
  mv "$LIVE" "$LEGACY/backend"
  PREVIOUS_BACKEND="$LEGACY/backend"
  SWITCHED=1
  ln -s "$LEGACY/backend" "$LIVE"
fi
PREVIOUS_BACKEND=$(readlink -f "$LIVE")
ln -sfn "$RELEASE/backend" "$LIVE.next"
mv -Tf "$LIVE.next" "$LIVE"
SWITCHED=1
if as_deploy pm2 describe "$APP" >/dev/null 2>&1; then
  as_deploy pm2 restart "$APP" --update-env
else
  as_deploy pm2 start "$LIVE/dist/main.js" --name "$APP" --cwd "$LIVE"
fi
READY=0
for attempt in {1..15}; do
  if check_local; then READY=1; break; fi
  sleep 2
done
[[ "$READY" == 1 ]] || { echo 'Backend health checks did not pass'; false; }
if [[ -d "$WEB_ROOT" && ! -L "$WEB_ROOT" ]]; then
  PREVIOUS_FRONTEND="/var/www/exeedbot-releases/legacy-$SHA"
  mkdir -p /var/www/exeedbot-releases
  mv "$WEB_ROOT" "$PREVIOUS_FRONTEND"
  ln -s "$PREVIOUS_FRONTEND" "$WEB_ROOT"
fi
bash "$RELEASE/deploy-frontend.sh" "$RELEASE/frontend"
curl --fail --silent --show-error --max-time 30 "$ORIGIN/version.json" | \
  node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{if(JSON.parse(s).commit!==process.argv[1])process.exit(1)})' "$SHA"
curl --fail --silent --show-error --max-time 30 "$ORIGIN/api/web/catalog" >/dev/null
as_deploy pm2 save
echo "Application and frontend are healthy at $SHA"
