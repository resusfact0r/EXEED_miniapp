#!/usr/bin/env bash
# Publishes a built frontend without a moment where the site is half-copied.
#
# Copying files over the live web root left a gap where index.html or the bundle was missing, and
# a customer opening the Mini App right then got a blank screen. Each build now goes into its own
# release folder and the web root - a symlink - is switched to it with one rename. The previous
# release's bundles are carried over, so a page opened before the switch still loads its own JS.
set -euo pipefail

SRC=${1:?"usage: deploy-frontend.sh <built dist directory>"}
ROOT=/var/www/exeedbot-frontend          # nginx root; a symlink to the current release
RELEASES=/var/www/exeedbot-releases
KEEP=5
STAMP=$(date -u +%Y%m%d%H%M%S)

mkdir -p "$RELEASES"

# First run: the web root is still a plain directory. Turn it into a release once.
if [ -d "$ROOT" ] && [ ! -L "$ROOT" ]; then
  mv "$ROOT" "$RELEASES/initial-$STAMP"
  ln -s "$RELEASES/initial-$STAMP" "$ROOT"
fi

NEW="$RELEASES/$STAMP"
cp -r "$SRC" "$NEW"
if [ -L "$ROOT" ] && [ -d "$(readlink -f "$ROOT")/assets" ]; then
  cp -n "$(readlink -f "$ROOT")"/assets/* "$NEW/assets/" 2>/dev/null || true
fi
chmod -R a+rX "$NEW"

# The switch: a new symlink renamed over the old one is atomic.
ln -sfn "$NEW" "$ROOT.next"
mv -Tf "$ROOT.next" "$ROOT"
echo "published $NEW"

ls -1dt "$RELEASES"/*/ | tail -n +$((KEEP + 1)) | xargs -r rm -rf
