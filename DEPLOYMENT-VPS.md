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
и публикуется скриптом `server/deploy/frontend/deploy-frontend.sh`:

```bash
cd /opt/tg-miniapp/build/repo
npm ci && npm run build
install -m 755 server/deploy/frontend/deploy-frontend.sh /usr/local/bin/tg-miniapp-deploy-frontend
tg-miniapp-deploy-frontend dist
```

`/var/www/exeedbot-frontend` — это символьная ссылка на текущую версию в `/var/www/exeedbot-releases/`.
Каждая сборка кладётся в свою папку, и ссылка переключается на неё одним переименованием. Поэтому
нет момента, когда сайт скопирован наполовину и показывает белый экран. Файлы предыдущей версии
переносятся в новую, чтобы уже открытая страница могла загрузить свои старые скрипты. Хранятся 5
последних версий. Откат: `ln -sfn /var/www/exeedbot-releases/<папка> /var/www/exeedbot-frontend`.

Пока перезапускается бэкенд (около 10 секунд) или сервер недоступен, приложение показывает заглушку
«Обновляем магазин». Сервер проверяется каждые 3 секунды, и заглушка исчезает сама. Если сбой пришёлся
на запуск, страница перезагрузится. Если человек был внутри, введённые данные сохранятся.

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

    # The entry page must be revalidated on every open (cheap: ETag -> 304). Without this,
    # Telegram's WebView kept a stale index.html and loaded the previous bundle after deploys.
    location = /index.html {
        add_header Cache-Control "no-cache" always;
    }

    # Bundles are content-hashed: a new build means new file names, so cache them for good.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Кэширование.** Без `Cache-Control` у `index.html` Telegram WebView держал старую страницу,
и после деплоя клиенты продолжали видеть прошлую версию (так было до 31.10.2026). Проверка:
`curl -sI https://exeedbot.ru/ | grep -i cache-control` → `no-cache`; у файла из `/assets/` —
`max-age=31536000, immutable`.

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

**Шифрование.** Копия в Telegram зашифрована: `tg-miniapp_<дата>.dump.enc`, AES-256, ключ получается
из пароля через PBKDF2 (200 000 итераций). Пароль лежит на сервере в `/root/.tg-miniapp-backup.key`
(доступ только root), владелец хранит его копию отдельно — в письме «Ключ бэкапов exeedbot.ru».
Без этого пароля копию из Telegram не восстановить, а если сервера не станет, копия на нём пропадёт
вместе с ним. Если ключа на сервере нет, бэкап в Telegram не отправляется, а юнит завершается
с ошибкой, и сторож об этом сообщает. Локальные копии в `/var/backups/tg-miniapp/` не шифруются.

Расшифровать скачанную из Telegram копию:
```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/.tg-miniapp-backup.key \
  -in tg-miniapp_<дата>.dump.enc -out tg-miniapp_<дата>.dump
# на новом сервере вместо file:… — pass:'<пароль из письма>'
```

**Восстановление** (из расшифрованного или локального файла):

```bash
su - deploy -c 'pm2 stop tg-miniapp-backend'
# файл передаётся через stdin: дамп принадлежит root с правами 600, и сам postgres его не прочитает
sudo -u postgres pg_restore --clean --if-exists --no-owner -d tg_miniapp_prod < /путь/к/tg-miniapp_<дата>.dump
su - deploy -c 'pm2 start tg-miniapp-backend'
```

На новом сервере: сначала шаги 1–3 (пакеты, роль и база), затем `pg_restore` в пустую базу
вместо импорта каталога. Проверено 29.10.2026: восстановление в пробную базу дало совпадение с
боевой по числу товаров, заказов, пользователей, миграций и trgm-индексов.

**Отправка в Telegram идёт через тот же прокси, что и бот** (`TELEGRAM_PROXY_URL`). Если прокси
не работает, копия остаётся только локально, а юнит падает: `systemctl status tg-miniapp-backup`.

## 12. Автообновление прайса из почты ✅ включено 29.10.2026

На проде: ящик `artemakinshin1@gmail.com`, отправитель `opt@avtoliga.nnov.ru` («Оптовые продажи»
Автолига-Лион), тема «Прайс Chery ЦС от Автолига-Лион от <дата>», файл `Central price CHERY.xls`.
В рассылке только наличие центрального склада: в первом прайсе было 12,5 тыс. позиций против
22 тыс. в июльской выгрузке. Поэтому после первого импорта 14 434 позиции скрыты — так решено:
каталог показывает только то, что есть в прайсе. Дамп до первого импорта:
`/var/backups/tg-miniapp/pre-first-price.dump`.

Поставщик несколько раз в день присылает прайс Excel-файлом. Backend раз в 10 минут проверяет
почту по IMAP. Новое письмо от `PRICE_MAIL_FROM` с вложением `.xls`/`.xlsx` применяется к каталогу
одной транзакцией:

- цена = цена поставщика × (1 + `AVTOLIGA_MARKUP_PERCENT`/100), остаток — из файла;
- новых артикулов — добавляются; отсутствующие в файле — скрываются (`isActive=false`);
- скрытые артикулы, снова появившиеся в файле, возвращаются в продажу;
- названия существующих товаров не трогаются.

Если за проход пришло несколько писем, применяется только самое свежее.

**Где ищутся письма.** Во «Всей почте» Gmail (входящие, архив и все ярлыки) и в «Спаме». Папки
определяются по IMAP-флагам `\All` и `\Junk`, задать свои можно через `PRICE_MAIL_FOLDERS`.
Поэтому прайсы можно убрать из «Входящих», и обновления продолжат приходить:
- фильтр Gmail «от `opt@avtoliga.nnov.ru` → Пропускать входящие» (рекомендуется);
- или заблокировать отправителя, тогда письма уходят в «Спам». Gmail удаляет спам через 30 дней,
  а синхронизации нужны только письма за последние 3 дня, так что это не мешает.

Одно и то же письмо в нескольких папках обрабатывается один раз (по Message-ID).

**Ящик открывается только на чтение** (IMAP EXAMINE): письма не помечаются прочитанными, не
перемещаются и не удаляются. Какие письма уже обработаны, хранится в таблице `PriceImport` по
Message-ID. Там же история: сколько цен изменилось, добавлено, скрыто.

**Предохранитель.** Файл не применяется, если в нём:
- меньше половины активного каталога;
- больше 5% строк без цены;
- не найдены колонки артикула и цены.

Каталог в этом случае остаётся как был, а в Telegram приходит предупреждение.

**Отчёт** уходит в `PRICE_REPORT_CHAT_ID` (по умолчанию `BACKUP_CHAT_ID`):
- успешное обновление — без звука;
- отказ, ошибка, недоступная почта — со звуком. Об ошибке входа в почту сообщается один раз,
  и ещё раз — когда доступ восстановится.

Настройка в `/opt/tg-miniapp/server/.env`:

```bash
PRICE_SYNC_ENABLED=true
PRICE_IMAP_USER=ящик@gmail.com
PRICE_IMAP_PASSWORD=пароль приложения   # не основной пароль от почты
PRICE_MAIL_FROM=адрес отправителя прайса
# PRICE_MAIL_SUBJECT=часть темы, если от того же адреса приходят и другие письма
```

Сервер IMAP определяется по домену ящика (Gmail, Яндекс, Mail.ru). Для другой почты задайте
`PRICE_IMAP_HOST`. Пароль приложения:
- Gmail: нужна двухэтапная аутентификация, затем myaccount.google.com/apppasswords;
- Яндекс: id.yandex.ru → Безопасность → Пароли приложений.

После правки — `pm2 restart tg-miniapp-backend --update-env`. Первая проверка почты идёт через
минуту после старта, в логе — `Price sync enabled` и `Price list …: APPLIED`.

**Ручная загрузка** того же файла (тот же код, те же проверки; `--force` отключает предохранитель):

```bash
cd /opt/tg-miniapp/server && sudo -u deploy node dist/scripts/import-price.js "/путь/к/прайс.xls"
```

История импортов:
```bash
sudo -u postgres psql tg_miniapp_prod -c 'select "createdAt", "fileName", status, rows, updated, added, hidden, restored, error from "PriceImport" order by "createdAt" desc limit 10'
```

Колонки находятся по заголовкам (Артикул, Номенклатура поставщика, Цена, Количество остаток,
Бренд) в первых 30 строках листа. Если поставщик переименует колонку, а автоопределение её не
узнает, задайте `PRICE_COL_CODE`/`PRICE_COL_NAME`/`PRICE_COL_PRICE`/`PRICE_COL_STOCK` — точный текст заголовка.

---

## 13. Мониторинг: сторож

Все серьёзные сбои до сих пор были тихими. Бот лежал 25 дней, потому что умер прокси. Прайс 5 дней
не обновлялся (с 30.10 по 04.11 не было рассылки «Прайс Chery ЦС»), и никто этого не заметил. Сторож
(`server/deploy/watchdog/`) — systemd-таймер раз в 5 минут. Он работает отдельно от Node-приложения,
поэтому срабатывает и тогда, когда бэкенд упал.

| Проверка | Тревога |
|---|---|
| Приложение (`/api/health`) | 2 проверки подряд без ответа |
| Telegram через прокси (`getMe`) | 2 проверки подряд |
| Бот получает обновления | нет ответа от Telegram 10 минут |
| Почта с прайсом проверяется | ни одной удачной проверки за час |
| Прайс свежий | дольше 80 рабочих часов (пн–пт) без применённого прайса: «Chery ЦС» приходит раз в несколько дней, самый долгий перерыв пока 72 часа; в тревоге — какие письма поставщика пришли мимо фильтра |
| Поставщик (API Автолиги) | 30 минут нет ответа по реальным позициям, с 8 до 23 по Москве; без него заказы не оформляются |
| Ночной бэкап | файлу больше 26 часов или юнит упал |
| Диск | занят больше 85% |
| TLS-сертификат | истекает меньше чем через 14 дней |

Владелец получает сообщение, только когда проверка меняет состояние: 🔴 сломалось → 🟢 снова в
порядке. Пока проблема не устранена, сторож повторяет тревогу раз в сутки. Если Telegram
недоступен, тревога уходит письмом через SMTP Gmail. Используются тот же ящик и тот же пароль
приложения, что и для прайса (`WATCHDOG_EMAIL`, по умолчанию `PRICE_IMAP_USER`).

Ещё сторож:
- в 09:00 по Москве присылает владельцу тихую сводку: прайс, бэкап, заказы;
- напоминает операторам о заказе, который ждёт ссылку на оплату дольше 2 часов. Напоминание
  уходит один раз на заказ и только с 9 до 21.

Данные о боте, почте, прайсе и заказах сторож берёт из `GET /api/health/details`. Этот адрес
отвечает только запросам с самого сервера: запрос через nginx получает 403.

Установка:

```bash
cd /opt/tg-miniapp/build/repo/server/deploy/watchdog
install -m 755 tg-miniapp-watchdog.py /usr/local/bin/tg-miniapp-watchdog
install -m 644 tg-miniapp-watchdog.service tg-miniapp-watchdog.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now tg-miniapp-watchdog.timer
```

Проверка и отладка:
- `WATCHDOG_DRY_RUN=1 tg-miniapp-watchdog` — печатает, что бы отправил, ничего не отправляя;
- `journalctl -u tg-miniapp-watchdog -n 20` — итог каждого запуска;
- `/var/lib/tg-miniapp-watchdog/state.json` — текущее состояние проверок.

Если задать `WATCHDOG_PING_URL` (например, адрес проверки на healthchecks.io), сторож будет
отмечаться там при каждом запуске. Если отметки прекратятся, значит, лежит весь сервер, и внешний
сервис пришлёт письмо. Пока не настроено: нужен аккаунт владельца.

---

## 14. Реквизиты продавца и документы

Реквизиты задаются в `/opt/tg-miniapp/server/.env`:

```bash
SELLER_NAME="ООО «Название»"     # или ИП Фамилия Имя Отчество
SELLER_OGRN=                     # ОГРН или ОГРНИП
SELLER_INN=
SELLER_ADDRESS=""
SELLER_EMAIL=                    # необязательно; без неё запросы направляются в чат с ботом
SELLER_BANK=""                   # банковские реквизиты для условий продажи, одной строкой
SELLER_PHONE=                    # необязательно
```

После правки — `su - deploy -c 'pm2 restart tg-miniapp-backend --update-env'`. Новая сборка не нужна.

Пока заполнены не все обязательные поля, всё это выключено: документы отдают 404, галочки согласия
и блока «О продавце» нет. Когда поля заполнены, включаются:
- документы `https://exeedbot.ru/api/legal/privacy`, `/consent`, `/terms`. Тексты лежат в
  `server/src/legal/documents.ts`, это черновики, их должен проверить юрист;
- блок «О продавце» в профиле и команда бота `/about`;
- галочка согласия на обработку данных перед передачей телефона и на шаге оформления заказа. Время
  согласия хранится в `User.pdConsentAt`. Без согласия заказ не создаётся, поэтому клиенты, которые
  оставили телефон раньше, дадут согласие при следующем заказе.

Часы работы самовывоза — поле `schedule` в `server/src/delivery/pickup-addresses.ts`. Пока оно
пустое, клиентам часы не показываются.

---

## 15. Бот в группах: вопросы по артикулу

`/part <артикул>` работает в любой группе сразу. Чтобы бот отвечал на простой тег
(`@e_PartsBot 501014147AA`), он должен видеть сообщения группы. В режиме приватности,
который включён по умолчанию, обычные упоминания боту не приходят. Есть два способа:
- @BotFather → `/setprivacy` → бот → **Disable**, затем удалить бота из каждой группы и добавить
  заново: изменение действует только после повторного добавления;
- или сделать бота администратором группы: администраторы получают все сообщения.

Проверка: `getMe` возвращает `can_read_all_group_messages: true`, если режим приватности выключен.
Ответ на сообщение бота и артикул в личном чате работают без этих настроек.

Кнопки Mini App в группах Telegram не разрешает. Поэтому в группе под карточкой кнопка
«Заказать»: она открывает личный чат с ботом (`/start p_<id товара>`), где уже есть кнопка
«Открыть в каталоге».

---

## Полезные команды на сервере

```bash
pm2 status                    # статус backend-процесса
pm2 logs tg-miniapp-backend   # логи
pm2 restart tg-miniapp-backend
systemctl status nginx postgresql
nginx -t                      # проверка конфига перед reload
```
