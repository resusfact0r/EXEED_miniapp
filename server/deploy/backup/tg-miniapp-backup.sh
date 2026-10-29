#!/usr/bin/env bash
# Nightly database backup for exeedbot.ru, sent to the owner's Telegram.
#
# The previous production server was reinstalled without a backup and every order and user was
# lost - a copy kept on the same server would have gone with it, so the copy that matters is the
# one that leaves the machine. Runs from systemd (not the Node app) so it still works when the
# backend is down. Local copies are kept too, for a quick restore without downloading.
set -euo pipefail

ENV_FILE=/opt/tg-miniapp/server/.env
DIR=/var/backups/tg-miniapp
DB=tg_miniapp_prod
KEEP=14
# Bot API document limit is 50 MB; leave headroom.
TELEGRAM_LIMIT_BYTES=$((45 * 1024 * 1024))

val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
TOKEN=$(val TELEGRAM_BOT_TOKEN)
PROXY=$(val TELEGRAM_PROXY_URL)
CHAT=$(val BACKUP_CHAT_ID)

mkdir -p "$DIR" && chmod 700 "$DIR"
STAMP=$(date -u +%Y-%m-%d_%H%M)
FILE="$DIR/tg-miniapp_${STAMP}.dump"

# Custom format is already compressed and is what pg_restore wants.
sudo -u postgres pg_dump -Fc "$DB" > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"
ls -1t "$DIR"/tg-miniapp_*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f

COUNTS=$(sudo -u postgres psql -d "$DB" -Atc \
  "select (select count(*) from \"Order\") || ' заказов, ' || (select count(*) from \"User\") || ' пользователей, ' || (select count(*) from \"Product\" where \"isActive\") || ' товаров'")
SIZE=$(du -h "$FILE" | cut -f1)
echo "дамп: $FILE ($SIZE; $COUNTS)"

if [ -z "$CHAT" ]; then
  echo "BACKUP_CHAT_ID не задан - копия сохранена только локально"
  exit 0
fi
if [ "$(stat -c %s "$FILE")" -gt "$TELEGRAM_LIMIT_BYTES" ]; then
  echo "ОШИБКА: дамп больше лимита Telegram ($SIZE) - копия только локально" >&2
  exit 1
fi

for attempt in 1 2 3; do
  if curl -sf -m 180 ${PROXY:+--proxy "$PROXY"} \
       -F chat_id="$CHAT" -F document=@"$FILE" \
       --form-string caption="Бэкап базы exeedbot.ru, ${STAMP} UTC — ${SIZE}: ${COUNTS}" \
       "https://api.telegram.org/bot${TOKEN}/sendDocument" >/dev/null; then
    echo "отправлено в Telegram"
    exit 0
  fi
  echo "попытка $attempt отправки не удалась"
  sleep $((attempt * 30))
done
echo "ОШИБКА: не удалось отправить бэкап в Telegram, локальная копия: $FILE" >&2
exit 1
