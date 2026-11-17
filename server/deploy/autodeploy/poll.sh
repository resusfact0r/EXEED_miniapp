#!/usr/bin/env bash
# Pulls only an artifact published AFTER all checks passed for the configured branch.
# Public GitHub repository/releases: no SSH listener or GitHub token is needed on the VPS.
set -euo pipefail

REPOSITORY=${EXEED_REPOSITORY:-resusfact0r/EXEED_miniapp}
BRANCH=${EXEED_BRANCH:-feat/web-visual-catalog}
STATE=${EXEED_DEPLOY_STATE_DIR:-/var/lib/exeed-autodeploy}
APPLY=${EXEED_APPLY_SCRIPT:-/usr/local/lib/exeed-autodeploy/apply-release.sh}
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid repository'; exit 1; }
[[ "$BRANCH" =~ ^[A-Za-z0-9_./-]+$ ]] || { echo 'Invalid branch'; exit 1; }
mkdir -p "$STATE"
exec 9>"$STATE/poll.lock"
flock -n 9 || exit 0

SHA=$(git ls-remote "https://github.com/$REPOSITORY.git" "refs/heads/$BRANCH" | awk 'NR==1 {print $1}')
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Could not resolve the deployment branch'; exit 1; }
if [[ -f "$STATE/current" && "$(cat "$STATE/current")" == "$SHA" ]]; then exit 0; fi

TMP=$(mktemp -d "$STATE/download.XXXXXX")
trap 'rm -rf -- "$TMP"' EXIT
BASE="https://github.com/$REPOSITORY/releases/download/deploy-$SHA"
STATUS=$(curl --silent --show-error --location --connect-timeout 15 --max-time 60 \
  --output "$TMP/checksum" --write-out '%{http_code}' "$BASE/release.tar.gz.sha256")
if [[ "$STATUS" == 404 ]]; then echo "Waiting for a verified CI release of $SHA"; exit 0; fi
[[ "$STATUS" == 200 ]] || { echo "Release lookup failed: HTTP $STATUS"; exit 1; }
EXPECTED=$(awk 'NR==1 {print $1}' "$TMP/checksum")
[[ "$EXPECTED" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid release checksum'; exit 1; }
curl --fail --silent --show-error --location --retry 2 --connect-timeout 15 --max-time 300 \
  "$BASE/release.tar.gz" --output "$TMP/release.tar.gz"
ACTUAL=$(sha256sum "$TMP/release.tar.gz" | awk '{print $1}')
[[ "$ACTUAL" == "$EXPECTED" ]] || { echo 'Release checksum does not match'; exit 1; }

bash "$APPLY" "$TMP/release.tar.gz" "$SHA"
printf '%s\n' "$SHA" > "$STATE/current.next"
mv "$STATE/current.next" "$STATE/current"
echo "Deployed $BRANCH at $SHA"
