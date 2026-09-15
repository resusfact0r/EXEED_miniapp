# Инструкция по выпуску в продакшн

Проект состоит из двух независимо деплоящихся частей:

- **`server/`** — backend (NestJS + PostgreSQL + Prisma). Требует отдельный хостинг с HTTPS.
- **корень репозитория** — Telegram Mini App (Vite/React), статический billed, сейчас деплоится на GitHub Pages через `.github/workflows/github-pages-deploy.yml`.

Ниже — по порядку, что нужно сделать, чтобы перевести оба компонента из dev-режима (мок-данные, `ALLOW_UNSAFE_INIT_DATA=true`, локальный Postgres) в боевой режим.

Этот файл — хостинг-агностичная версия (Railway/Render/VPS и т.п.). Если конкретно хотите деплоить через Cloudflare (Pages + Tunnel) — см. [DEPLOYMENT-CLOUDFLARE.md](DEPLOYMENT-CLOUDFLARE.md).

---

## 1. Предварительные требования

- **Домен + HTTPS для backend** (например `api.your-domain.ru`). Telegram Mini Apps и валидация initData не требуют HTTPS сами по себе, но practically любой нормальный хостинг (Railway, Render, VPS + Caddy/nginx, Yandex Cloud, VK Cloud) даёт HTTPS из коробки — используйте его.
- **Домен + HTTPS для miniapp**, если не остаётесь на GitHub Pages (GitHub Pages HTTPS уже есть).
- **Реальный Telegram-бот**: токен от [@BotFather](https://t.me/BotFather). Он нужен backend'у для валидации `initData` (см. `TELEGRAM_BOT_TOKEN` ниже) — это тот же токен, что использует ваш существующий бот.
- **Продакшн-доступы к СДЭК API** (client_id/client_secret, боевой контур, не `api.edu.cdek.ru`) — оформляются в личном кабинете СДЭК.
- **Продакшн-доступ к Яндекс.Доставке** (API-ключ) — оформляется через партнёрский кабинет Яндекса.
- **Токен Avtoliga Parts** (`avtoliga-parts.ru`, личный кабинет → API) и его `AddressId`. Это не опционально: оформление заказа (`POST /api/orders`) всегда переспрашивает у Avtoliga актуальную цену перед фиксацией заказа и без валидного токена **всегда** отвечает `503` — checkout физически не заработает без этого токена.
- **PostgreSQL 14+** в проде (managed-сервис или свой инстанс). Не переиспользуйте dev-контейнер из `docker-compose.yml` — он для локальной разработки.
- Определённость по **внешней системе обработки заказов**: URL, на который слать вебхук (`EXTERNAL_ORDER_WEBHOOK_URL`), либо решение, что заказы будут забираться через `GET /api/admin/orders` (поллингом).

---

## 2. Backend (`server/`)

### 2.1 Переменные окружения

Скопируйте `server/.env.example` в `server/.env` (или в переменные окружения вашей платформы деплоя) и заполните боевыми значениями:

| Переменная | Продакшн-значение |
|---|---|
| `DATABASE_URL` | Строка подключения к боевому PostgreSQL |
| `PORT` | Порт, на котором слушает процесс (обычно берётся платформой автоматически) |
| `NODE_ENV` | **`production`** — от него зависит не только режим Node, но и выдача `/api/delivery/carriers`: перевозчик, оставшийся в мок-режиме, в проде не предлагается вообще, чтобы клиент не выбрал несуществующий ПВЗ |
| `CORS_ORIGIN` | Точный origin продакшн miniapp, например `https://your-username.github.io` — **не `*`** |
| `TELEGRAM_BOT_TOKEN` | Боевой токен бота из BotFather |
| `MINIAPP_URL` | Боевой HTTPS-URL miniapp — используется в кнопке «Открыть каталог» в ответе на `/start` |
| `TELEGRAM_WEBHOOK_SECRET` | Случайный секрет для `POST /api/bot/webhook` (сверяется с `secret_token` в апдейтах от Telegram, см. §4) — без него эндпоинт примет апдейт от кого угодно |
| `ALLOW_UNSAFE_INIT_DATA` | **`false`** — обязательно. В деве это `true`, чтобы обходить проверку подписи для замоканной initData; в проде это дыра в авторизации |
| `ADMIN_API_TOKEN` | Новый случайный секрет (не `devtoken`!), например `openssl rand -hex 32` |
| `CDEK_API_BASE_URL` | `https://api.cdek.ru` (боевой, не `api.edu.cdek.ru`) |
| `CDEK_CLIENT_ID` / `CDEK_CLIENT_SECRET` | Боевые креды СДЭК |
| `YANDEX_DELIVERY_API_BASE_URL` / `YANDEX_DELIVERY_API_KEY` | Боевые креды Яндекс.Доставки |
| `CDEK_MOCKED` | **`false`** — иначе в проде будут отдаваться фиктивные ПВЗ СДЭК |
| `YANDEX_MOCKED` | **`false`**, когда появятся боевые креды Яндекс.Доставки — до тех пор остаётся `true` |
| `EXTERNAL_ORDER_WEBHOOK_URL` | URL внешней системы обработки заказов (если есть на момент запуска; можно оставить пустым и забирать заказы через `/api/admin/orders`) |
| `AVTOLIGA_API_TOKEN` | Боевой токен из личного кабинета avtoliga-parts.ru — **обязателен**, без него любой заказ падает с `503` |
| `AVTOLIGA_ADDRESS_ID` | `Id` из ответа `POST /get/addresses/` (тот же токен) — адрес доставки/самовывоза в системе поставщика |
| `AVTOLIGA_VENDOR_FILTER` | Бренд, по которому фильтруются совпадения артикула (по умолчанию `CHERY`) — раз тот же артикул может относиться к другому бренду у поставщика |
| `AVTOLIGA_MARKUP_PERCENT` | Наценка сверх цены поставщика в процентах (сейчас `14`) — бизнес-решение, не техническая настройка |

Обязательно проверьте перед запуском: `ALLOW_UNSAFE_INIT_DATA=false` и `CDEK_MOCKED=false` — это флаги, специально сделанные "дырявыми" для локальной разработки. `YANDEX_MOCKED` остаётся `true`, пока нет боевого ключа Яндекс.Доставки.

### 2.2 Сборка и миграции

```bash
cd server
npm ci
npx prisma migrate deploy   # НЕ migrate dev — это команда для прод-миграций без интерактивных вопросов
npm run build               # tsc через nest build -> dist/
npm run start:prod          # node dist/main.js
```

`npx prisma migrate deploy` применяет уже созданные миграции из `server/prisma/migrations/` — она идемпотентна и безопасна для CI/CD, в отличие от `migrate dev`.

### 2.3 Процесс-менеджер / контейнер

Backend — обычный Node-процесс (`node dist/main.js`), слушающий `PORT` и отвечающий на `/api/health`. Заверните его в то, что использует ваша инфраструктура:
- systemd unit / pm2, если разворачиваете на своём VPS;
- Dockerfile (в репозитории его пока нет — создать по образцу `server/package.json`: `FROM node:20-alpine`, `npm ci --omit=dev`, `npm run build`, `CMD ["node", "dist/main.js"]`, не забыть `npx prisma generate` на этапе сборки образа);
- либо PaaS (Railway/Render/Fly.io) — они сами дают HTTPS и умеют запускать `npm run build && npm run start:prod` по Procfile/настройкам.

Настройте health-check платформы на `GET /api/health` (уже реализован, возвращает `{"status":"ok"}`).

### 2.4 База данных

- Используйте managed Postgres (Yandex Managed PostgreSQL, RDS, Supabase и т.д.) с бэкапами — это боевые заказы клиентов, терять их нельзя.
- После первого `prisma migrate deploy` **не запускайте `prisma db seed`** — сид-скрипт (`server/prisma/seed.ts`) содержит тестовые товары для разработки, не боевой каталог.
- Наполните боевой каталог реальными товарами через:
  - `POST /api/admin/products` (по одному, с заголовком `X-Admin-Token`), или
  - `npm run import:catalog -- ./data/products.csv` с реальным CSV (колонки: `code,name,price,stockQty,description,imageUrl`) — скрипт делает upsert по `code`, безопасно перезапускать.

---

## 3. Frontend (Telegram Mini App)

### 3.1 Указать боевой backend

Vite подхватывает `.env.production` при сборке в режиме `production` (`vite build` по умолчанию использует этот режим). Создайте в корне репозитория `.env.production`:

```
VITE_API_BASE_URL=https://api.your-domain.ru/api
```

Это публичный URL, секретов не содержит — можно коммитить в репозиторий.

### 3.2 Сборка и деплой

Если остаётесь на GitHub Pages (текущий `.github/workflows/github-pages-deploy.yml` уже это делает при пуше в `master`):

```bash
npm ci
npm run build   # tsc --noEmit && vite build -> dist/
```

`dist/` публикуется автоматически GitHub Actions. Проверьте `vite.config.ts` — `base: '/tg-miniapp/'` должен совпадать с реальным путём на GitHub Pages (репозиторий/URL); если miniapp переезжает на свой домен, поменяйте `base` на `/`.

Если хостите не на GitHub Pages — соберите `npm run build` и залейте содержимое `dist/` на любой статический хостинг с HTTPS (Netlify, Vercel, Cloudflare Pages, свой nginx).

### 3.3 TON Connect манифест

`public/tonconnect-manifest.json` сейчас содержит плейсхолдер-данные шаблона. Если TON Connect не используется в проекте — можно оставить как есть либо убрать; если используется — обновить под реальный домен по [документации TON Connect](https://docs.ton.org/develop/dapps/ton-connect/manifest).

---

## 4. Настройка бота (BotFather + webhook)

1. В [@BotFather](https://t.me/BotFather) → `/mybots` → выбрать бота → **Bot Settings → Menu Button** — указать боевой HTTPS-URL miniapp. (Это можно сделать и без захода в BotFather — через Bot API `setChatMenuButton`, см. историю чата/скрипты этого проекта.)
2. Токен этого же бота — то значение, которое должно быть в `TELEGRAM_BOT_TOKEN` на backend (иначе валидация `initData` не пройдёт ни при каких обстоятельствах, так как HMAC считается по секрету бота).
3. Зарегистрировать webhook, чтобы `/start` отвечал сообщением с кнопкой запуска miniapp (обработчик уже есть в этом репозитории, `server/src/bot`) — одноразовый вызов после того, как backend задеплоен и доступен по HTTPS:

   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://<ваш-домен>/api/bot/webhook" \
     -d "secret_token=<то же значение, что в TELEGRAM_WEBHOOK_SECRET>"
   ```

   Проверить регистрацию: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`.

---

## 5. Чек-лист безопасности перед запуском

- [ ] `ALLOW_UNSAFE_INIT_DATA=false` на проде
- [ ] `CDEK_MOCKED=false` на проде (и `YANDEX_MOCKED=false`, когда появятся боевые креды Яндекса)
- [ ] `ADMIN_API_TOKEN` — новый случайный секрет, не `devtoken`, хранится вне репозитория (секрет-менеджер платформы)
- [ ] `CORS_ORIGIN` — точный origin miniapp, не `*`
- [ ] `server/.env` и корневой `.env.local`/`.env.production` не закоммичены с секретами (в `.gitignore` уже есть `server/.env` и `*.local`; `.env.production` содержит только публичный URL, коммитить можно)
- [ ] Postgres доступен только backend'у (не открыт наружу), есть бэкапы
- [ ] Токен бота (`TELEGRAM_BOT_TOKEN`) хранится как секрет платформы деплоя, не в git
- [ ] `TELEGRAM_WEBHOOK_SECRET` установлен (не пусто) — иначе `POST /api/bot/webhook` примет апдейт от кого угодно, не только от Telegram
- [ ] `AVTOLIGA_API_TOKEN` действителен и не пустой — иначе оформление заказа сломано полностью (не деградация, а полный отказ checkout)
- [ ] `AVTOLIGA_MARKUP_PERCENT` выставлен осознанно (не забыт со значением по умолчанию) — это напрямую бьёт по марже

---

## 6. Смоук-тест после деплоя

Повторить вручную (или скриптом, аналогично тому, как тестировалось в разработке):

1. Открыть miniapp внутри Telegram (из бота) на реальном устройстве —начальная страница `/catalog` должна показать боевой каталог.
2. Найти товар по артикулу, добавить в корзину, убедиться что при попытке добавить >10 шт. срабатывает ограничение.
3. Закрыть и переоткрыть Mini App — корзина должна сохраниться (проверяет, что она серверная, а не localStorage).
4. Пройти оформление: самовывоз (Адрес 1/2) и отдельно доставка (СДЭК и Яндекс — с реальными, не мок ПВЗ).
5. Пройти оплату: QR-ссылка и отдельно юрлицо (текстовое поле реквизитов обязательно).
6. Подтвердить, что чекбокс политики невозврата блокирует отправку без отметки.
7. Проверить, что заказ появился в `GET /api/admin/orders` (с `X-Admin-Token`) и/или пришёл вебхук во внешнюю систему.
8. Проверить, что запрос телефона (`PhoneGate`) реально показывает системный диалог Telegram "поделиться номером" на живом клиенте (это единственное, что нельзя было протестировать в dev-моке — там нет настоящего Telegram-клиента).
9. Убедиться, что цена в оформленном заказе (`unitPrice` в `GET /api/admin/orders`) отличается от каталожной цены на актуальную наценку — это подтверждает, что заказ действительно берёт живую цену у Avtoliga, а не кэш. Отдельно проверить сценарий отказа: временно испортить `AVTOLIGA_API_TOKEN` и убедиться, что `POST /api/orders` возвращает `503`, а не создаёт заказ по устаревшей цене.

---

## 7. Что осознанно не автоматизировано (см. план реализации)

- Сам Telegram-бот — не часть этого репозитория, дорабатывается отдельно.
- Генерация ссылок на оплату (QR) и счетов для юрлиц — вручную оператором через `PATCH /api/admin/orders/:id` (поле `paymentLink`).
- Админ-панель для каталога — только API + CLI-импорт, без веб-интерфейса.
- Весогабаритные расчёты у СДЭК/Яндекса — не реализованы, только выбор ПВЗ.
