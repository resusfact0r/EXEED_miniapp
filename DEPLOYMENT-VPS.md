# Продакшн на VPS exeedbot.ru — пошаговый runbook

Это конкретная инструкция под ваш сервер (`5.35.126.169`, Ubuntu 24.04, root-доступ). Общая
хостинг-агностичная версия — в [DEPLOYMENT.md](DEPLOYMENT.md).

**Текущий статус (03.10.2026):** развёрнуто и работает полностью — сайт, API, БД, TLS,
автозапуск после ребута, бот в режиме long polling через прокси, уведомления о заказах.
Архитектура: поддомены у регистратора запрещены, поэтому backend отдаётся с того же домена по
пути `/api/` (см. §7); `www.exeedbot.ru` редиректит на основной адрес.

**История:** до октября 2026 прод жил на `138.16.224.84`. Этот сервер был скомпрометирован
(06.09 — подобран пароль пользователя `deploy`, поставлен майнер), затем переустановлен без
бэкапа. Прод развёрнут заново на `5.35.126.169` с чистой базой: каталог восстановлен из
`server/data/chery-catalog.csv`, ключи — из локального `server/.env`; заказы и пользователи
старого сервера утеряны. Поэтому теперь база каждую ночь уходит копией в Telegram — см. §11.

Каждый шаг ниже написан так, чтобы его можно было безопасно повторить — если что-то уже сделано,
команда просто не изменит систему.

---

## 0. Подключение

```bash
ssh root@5.35.126.169
```

Вход по паролю под root — сознательно оставлен (ключи на сервере не установлены). Пароль
длинный и случайный, а от перебора защищают:

- **fail2ban**, jail `sshd` (режим `aggressive`): 5 неудачных попыток за 10 мин → бан на 1 ч,
  каждый повторный бан того же IP вдвое длиннее, максимум неделя;
- **fail2ban**, jail `recidive`: 3 бана за сутки → блокировка на неделю на всех портах;
- **ufw**: входящее закрыто, кроме 22 (с лимитом — не больше 6 новых соединений за 30 сек с
  одного IP), 80 и 443;
- **sshd** (`/etc/ssh/sshd_config.d/00-hardening.conf`): 3 попытки на соединение,
  30 сек на вход, ограничение одновременных неавторизованных подключений.

Если сами ошиблись паролем 5 раз и попали в бан — подождать час или зайти через консоль в
панели adminvps и выполнить `fail2ban-client set sshd unbanip <ваш IP>`.

Пароль пользователя `deploy` заблокирован явно (`passwd -l deploy`) — на старом сервере этот
пользователь каким-то образом получил пароль и стал точкой взлома. Работать под ним только
через `su - deploy` от root.

---

## 1. Базовая подготовка сервера ✅ уже сделано

```bash
apt-get update && apt-get upgrade -y

apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

Своп (сервер на 1 vCPU / 2 GB RAM — своп нужен как страховка от OOM при пиках):

```bash
swapoff /swapfile 2>/dev/null; rm -f /swapfile
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 2. Установка Node/PostgreSQL/nginx/certbot/pm2 ✅ уже сделано

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs postgresql postgresql-contrib nginx python3-certbot-nginx
npm install -g pm2
```

Отдельный непривилегированный пользователь для приложения (не гоняем Node под root):

```bash
useradd -m -s /bin/bash deploy
mkdir -p /opt/tg-miniapp/server /opt/tg-miniapp/frontend
chown -R deploy:deploy /opt/tg-miniapp
mkdir -p /var/www/exeedbot-frontend
chown deploy:deploy /var/www/exeedbot-frontend
```

Проверка: `node --version` (v20.x), `psql --version` (16.x), `nginx -v`, `pm2 --version`.

---

## 3. PostgreSQL: боевая база ✅ уже сделано

```bash
sudo -u postgres psql -c "CREATE ROLE tg_miniapp_app WITH LOGIN PASSWORD 'СГЕНЕРИРОВАННЫЙ_ПАРОЛЬ';"
sudo -u postgres psql -c "CREATE DATABASE tg_miniapp_prod OWNER tg_miniapp_app;"
```

Пароль сгенерирован случайно (`openssl rand -hex 24`) и уже прописан в `/opt/tg-miniapp/server/.env`
на сервере — если нужно посмотреть, зайдите на сервер и откройте файл. Postgres слушает только
`127.0.0.1:5432` (проверка: `ss -tlnp | grep 5432` — снаружи порт не должен быть виден).

---

## 4. Сборка кода — на самом VPS, из git

Изначально план был собирать локально и заливать артефакты через rsync, но хостинг блокирует
входящие соединения с части иностранных IP, поэтому надёжнее оказалось клонировать репозиторий
прямо на сервер и собирать там. 2 ГБ свопа (см. §1) закрывают вопрос нехватки памяти при `tsc`
на 1 vCPU / 2 ГБ RAM.

Репозиторий приватный (`github.com/resusfact0r/EXEED_miniapp`). Deploy-key старого сервера
пропал вместе с ним, поэтому сейчас код заливается архивом с машины разработчика:

```bash
# локально, в корне репозитория
git archive --format=tar.gz -o /tmp/code.tgz HEAD
scp /tmp/code.tgz root@5.35.126.169:/root/
# на сервере
rm -rf /opt/tg-miniapp/build/repo && mkdir -p /opt/tg-miniapp/build/repo
tar xzf /root/code.tgz -C /opt/tg-miniapp/build/repo && rm /root/code.tgz
```

Чтобы сервер снова сам делал `git pull`, нужен новый read-only deploy-key: сгенерировать на
сервере, добавить его публичную часть в Settings → Deploy keys репозитория, а старый ключ
оттуда удалить — его приватная часть утеряна, и он только висит.

`vite.config.ts` уже переключён на `base: '/'` (было `/tg-miniapp/` под GitHub Pages), и есть
`.env.production` с `VITE_API_BASE_URL=https://exeedbot.ru/api` (без поддомена — см. §7) — эти
файлы уже в репозитории, пересобирать конфиг не нужно.

---

## 5. Деплой backend на VPS ✅ уже сделано

Заливка (с локальной машины, `rsync` или `scp`):

```bash
rsync -az --delete server/dist server/package.json server/package-lock.json server/prisma server/data \
  root@5.35.126.169:/opt/tg-miniapp/server/
```

На сервере — установка прод-зависимостей (без dev, без пересборки), генерация Prisma-клиента,
применение миграций:

```bash
cd /opt/tg-miniapp/server
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy    # НЕ migrate dev — идемпотентно, безопасно перезапускать
```

`server/.env` на сервере уже создан вручную (см. таблицу в [DEPLOYMENT.md §2.1](DEPLOYMENT.md)) —
файл в `.gitignore`, через git/rsync не передаётся. Ключевые отличия от dev-`.env`:

| Переменная | Прод-значение |
|---|---|
| `DATABASE_URL` | `postgresql://tg_miniapp_app:ПАРОЛЬ@localhost:5432/tg_miniapp_prod?schema=public` |
| `CORS_ORIGIN` | `https://exeedbot.ru` |
| `ALLOW_UNSAFE_INIT_DATA` | `false` |
| `ADMIN_API_TOKEN` | новый случайный секрет (уже сгенерирован, не `devtoken`) |
| `CDEK_MOCKED` | `false` |
| `MINIAPP_URL` | `https://exeedbot.ru` |
| `TELEGRAM_WEBHOOK_SECRET` | новый случайный секрет (`openssl rand -hex 32`) — тот же указывается в `setWebhook` (см. §10) |
| остальное (`TELEGRAM_BOT_TOKEN`, `CDEK_*`, `AVTOLIGA_*`) | те же боевые значения, что и в dev `server/.env` |

Наполнение каталога (боевой источник — `chery-catalog.csv`, уже залит вместе с `dist/`):

```bash
node dist/scripts/import-catalog.js ./data/chery-catalog.csv
```

(Скрипт запускается через `node` на скомпилированный `dist/`, а не через `npm run import:catalog`
— тот использует `ts-node`, которого нет среди prod-зависимостей.)

Запуск и автозапуск при перезагрузке:

```bash
pm2 start dist/main.js --name tg-miniapp-backend
pm2 save
# отдельно, от root (не от deploy — нужны права на systemd):
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u deploy --hp /home/deploy
```

Проверка: `curl localhost:3000/api/health` → `{"status":"ok"}`.

---

## 6. Деплой frontend ✅ уже сделано

Фронтенд собирается прямо на сервере из склонированного репозитория (`/opt/tg-miniapp/build/repo`)
и копируется в вебрут:

```bash
cd /opt/tg-miniapp/build/repo
npm ci && npm run build
rm -rf /var/www/exeedbot-frontend/*
cp -r dist/* /var/www/exeedbot-frontend/
```

Проверка, что отдаётся свежая сборка: хэш в `curl -s https://exeedbot.ru/ | grep -o 'assets/index-[^"]*\.js'`
должен совпадать с хэшем из вывода `npm run build`.

---

## 7. nginx — единый домен без поддоменов ✅ уже сделано

Панель регистратора не позволяет создать поддомен `api.exeedbot.ru`, поэтому backend отдаём с
того же домена по пути `/api/` — благо NestJS и так вешает префикс `/api` на все роуты
(`app.setGlobalPrefix('api')` в `server/src/main.ts`), значит прокси ничего не переписывает,
просто пробрасывает путь как есть. Плюс это заодно убирает необходимость в CORS вообще
(frontend и API теперь на одном origin).

Один конфиг вместо двух, `/etc/nginx/sites-available/exeedbot.ru`:

```nginx
server {
    listen 80;
    server_name exeedbot.ru;

    root /var/www/exeedbot-frontend;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
rm -f /etc/nginx/sites-enabled/api.exeedbot.ru /etc/nginx/sites-available/api.exeedbot.ru
ln -sf /etc/nginx/sites-available/exeedbot.ru /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Проверка (по IP, ещё без DNS):
```bash
curl -H "Host: exeedbot.ru" http://5.35.126.169/api/health
```

---

## 8. DNS ✅ уже сделано

Теперь нужна **только одна** A-запись (поддомен `api.` больше не нужен) — в панели adminvps.ru,
на `5.35.126.169`:
- `exeedbot.ru` (он же `@`)

Проверка распространения (может занять от 5 минут до нескольких часов):

```bash
curl -s "https://dns.google/resolve?name=exeedbot.ru&type=A"
```

В ответе должен появиться `"Answer": [{"data": "5.35.126.169", ...}]` вместо `"Status": 3`.

---

## 9. TLS-сертификат ✅ уже сделано

```bash
certbot --nginx -d exeedbot.ru
```

Certbot сам допишет HTTPS-редирект в конфиг nginx и настроит автопродление (systemd-таймер
`certbot.timer` уже установлен вместе с пакетом).

Проверка:
```bash
curl -I https://exeedbot.ru
curl https://exeedbot.ru/api/health
```

---

## 10. Бот: Menu Button + `/start` через polling ✅ уже сделано + смоук-тест

1. Menu Button ✅ уже сделано — выставлен напрямую через Bot API (`setChatMenuButton`), указывает
   на `https://exeedbot.ru`, без захода в BotFather.
2. **`/start` через long polling + прокси.** Webhook на этом хостинге не работает по двум
   независимым причинам (проверено 15.09.2026):
   - с сервера недоступен `api.telegram.org` — таймаут и по IPv4 (`149.154.166.110`), и по
     IPv6, при том что `api.cdek.ru` отдаёт 200, а `google.com` — 301. Адресная блокировка
     Telegram у провайдера;
   - Telegram не может зарезолвить `exeedbot.ru` — `setWebhook` падает с
     `Failed to resolve host`, хотя на контрольном домене та же команда проходит, а Google DNS
     / Cloudflare / локальный резолвер отдают корректный `138.16.224.84`.

   Поэтому бот работает в режиме **getUpdates (long polling)** — нужен только исходящий доступ,
   входящие соединения и резолвинг домена не требуются. Исходящий доступ к Telegram даёт
   HTTP(S)-прокси вне РФ:

   ```bash
   # в /opt/tg-miniapp/server/.env (боевые значения уже прописаны, прокси арендован отдельно)
   TELEGRAM_PROXY_URL=http://user:pass@proxy-host:port
   TELEGRAM_BOT_POLLING=true
   ```

   Прокси обязан держать длинные соединения: long poll висит 30 секунд на запрос, и прокси,
   рвущий такие сессии, даст бесконечные `getUpdates request failed`. Текущий проверен — за
   полный цикл ни одной ошибки.

   ```bash
   su - deploy -c 'pm2 restart tg-miniapp-backend --update-env'
   su - deploy -c 'pm2 logs tg-miniapp-backend --lines 20 --nostream' | grep -E 'Bot polling|proxy|getUpdates'
   ```

   Признак, что всё поднялось: в логах `Bot polling enabled` + `Telegram API calls go through
   proxy <host>` и **отсутствие** повторяющихся `getUpdates request failed`. Без прокси
   `TELEGRAM_BOT_POLLING` надо держать в `false` — иначе бэкенд будет ретраить в пустоту раз в
   5 секунд.

   Webhook-эндпоинт (`POST /api/bot/webhook`, защищён `TELEGRAM_WEBHOOK_SECRET`) остаётся в коде
   на случай переезда на хостинг, откуда Telegram видит домен — тогда достаточно
   `setWebhook` и `TELEGRAM_BOT_POLLING=false`.

3. Пройти чек-лист из [DEPLOYMENT.md §6](DEPLOYMENT.md#6-смоук-тест-после-деплоя) на реальном
   Telegram-клиенте: `/start` отвечает сообщением с кнопкой → открывает miniapp; новый пользователь
   видит стартовую страницу → делится номером → попадает в каталог; поиск товара, корзина (клэмп
   на 10, персистентность, открытие карточки товара из корзины и возврат обратно), самовывоз/СДЭК
   с выбором города и реальными ПВЗ (автопереход после выбора), оба способа оплаты, чекбокс
   политики кликается в любой точке строки, заказ виден в `GET https://exeedbot.ru/api/admin/orders`
   (заголовок `X-Admin-Token`), цена в заказе отличается от каталожной на актуальную наценку Avtoliga,
   настройки в профиле сохраняются и подставляются в следующий чекаут.

---

## 11. Бэкапы базы

Каждую ночь в 00:00 UTC (03:00 МСК) systemd-таймер делает `pg_dump -Fc` базы `tg_miniapp_prod`
и отправляет файл ботом в чат `BACKUP_CHAT_ID` (владелец) с подписью: размер и сколько в базе
заказов, пользователей и товаров. Локально хранятся последние 14 копий в
`/var/backups/tg-miniapp/`. Копия в Telegram — главная: локальная пропадёт вместе с сервером,
как это уже случилось со старым.

Файлы — в репозитории, `server/deploy/backup/`. Установка:

```bash
cd /opt/tg-miniapp/build/repo/server/deploy/backup
install -m 755 tg-miniapp-backup.sh /usr/local/bin/
install -m 644 tg-miniapp-backup.service tg-miniapp-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now tg-miniapp-backup.timer
```

Проверка: `systemctl list-timers tg-miniapp-backup.timer` — время следующего запуска;
`systemctl start tg-miniapp-backup` — внеплановый бэкап; `journalctl -u tg-miniapp-backup` — лог.

**Восстановление** (из скачанного из Telegram или локального файла):

```bash
su - deploy -c 'pm2 stop tg-miniapp-backend'
sudo -u postgres pg_restore --clean --if-exists -d tg_miniapp_prod /путь/к/tg-miniapp_<дата>.dump
su - deploy -c 'pm2 start tg-miniapp-backend'
```

На новом сервере: сначала шаги 1–3 (пакеты, роль и база), затем `pg_restore` в пустую базу
вместо импорта каталога.

---

## Полезные команды на сервере

```bash
pm2 status                    # статус backend-процесса
pm2 logs tg-miniapp-backend   # логи
pm2 restart tg-miniapp-backend
systemctl status nginx postgresql
nginx -t                      # проверка конфига перед reload
```
