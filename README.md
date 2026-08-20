# tg-miniapp — заказ автозапчастей через Telegram Mini App

Telegram Mini App для поиска и заказа автозапчастей по артикулу: корзина, самовывоз/доставка (СДЭК, Яндекс.Доставка), оплата по QR-ссылке или безналично для юрлиц. Существующий Telegram-бот (регистрация/авторизация по телефону) — отдельный проект, не входит в этот репозиторий; здесь реализована сама торговая логика внутри miniapp и backend, который её обслуживает.

## Стек и структура репозитория

Репозиторий состоит из двух частей:

```
.
├── src/            # Telegram Mini App — React 18 + TypeScript + Vite
│                    # (@telegram-apps/sdk-react, @telegram-apps/telegram-ui)
├── server/         # Backend — NestJS + PostgreSQL + Prisma
└── docker-compose.yml   # Postgres для локальной разработки
```

Frontend — статический SPA, деплоится отдельно (сейчас на GitHub Pages) и обращается к backend по HTTP через `VITE_API_BASE_URL`. Backend — отдельный деплоящийся Node-процесс со своей базой данных.

## Функциональность

- **Авторизация**: Mini App проверяет пользователя через Telegram `initData` (HMAC-подпись) и запрашивает номер телефона нативным Telegram API (`requestContact`), без участия бота.
- **Каталог**: поиск товаров по артикулу/названию с постраничной подгрузкой («Показать ещё» — фронт не ограничен первой страницей результатов). Наполняется через admin API (`POST /api/admin/products`) или CSV-импорт (`npm run import:catalog`); сейчас в базе — реальный прайс-лист CHERY (~22 тыс. позиций), импортированный из выгрузки поставщика.
- **Живая цена от поставщика (Avtoliga Parts)**: каталожная цена в БД — индикативная (обновляется при импорте/после заказов). Перед фактическим оформлением заказа backend всегда переспрашивает актуальную цену и остаток у [avtoliga-parts.ru](https://avtoliga-parts.ru) по каждому товару в корзине, берёт минимальную цену среди складов, накидывает наценку (`AVTOLIGA_MARKUP_PERCENT`, сейчас 14%) и только эту цену фиксирует в заказе. Если поставщик недоступен — заказ **не оформляется** (503), чтобы не продать ниже себестоимости на устаревших данных. См. `server/src/avtoliga`.
- **Корзина**: хранится на сервере (переживает закрытие приложения), лимит 10 шт. на одну позицию.
- **Оформление заказа**:
  - способ получения — самовывоз (2 фиксированных адреса в Москве) или доставка (СДЭК / Яндекс.Доставка — выбор ПВЗ через прокси-эндпоинты backend, весогабариты не считаются);
  - способ оплаты — QR-ссылка (генерируется вручную оператором) или безналичная оплата для юрлиц (свободный текст реквизитов организации);
  - обязательное согласие с политикой невозврата.
- **Заказы**: после оформления заказ виден в истории пользователя и в admin API (`GET /api/admin/orders`); опционально уходит вебхуком во внешнюю систему обработки (`EXTERNAL_ORDER_WEBHOOK_URL`).

Подробное описание API, схемы БД и архитектурных решений — в `server/src` (модули `auth`, `catalog`, `cart`, `delivery`, `orders`, `avtoliga`).

## Быстрый старт (локальная разработка)

### 1. Backend

```bash
cd server
npm install
cp .env.example .env        # заполнить при необходимости (по умолчанию подходит для локальной разработки)
docker compose -f ../docker-compose.yml up -d   # поднимает Postgres на порту 5433
npx prisma migrate dev      # применить миграции
npx prisma db seed          # наполнить тестовыми товарами
npm run start:dev           # backend на http://localhost:3000/api
```

В `server/.env` для локальной разработки без реального Telegram-клиента важны два флага:
- `ALLOW_UNSAFE_INIT_DATA=true` — позволяет авторизоваться с замоканной initData из `src/mockEnv.ts`, минуя проверку подписи бота.
- `CDEK_MOCKED=true` / `YANDEX_MOCKED=true` — раздельные флаги на каждого перевозчика (фиктивный список ПВЗ вместо реального API, удобно без боевых кредов). Сейчас в проекте СДЭК уже переведён на боевой API (`CDEK_MOCKED=false`), Яндекс — пока на моках, ждёт ключа.

**Оба флага обязательно выключить (`false`) перед продакшн-деплоем** — см. [DEPLOYMENT.md](DEPLOYMENT.md).

Отдельно: `AVTOLIGA_API_TOKEN` и `AVTOLIGA_ADDRESS_ID` — без них `POST /api/orders` всегда будет падать с `503` (живая проверка цены — обязательный шаг оформления, заглушки/мок-режима для неё нет). Токен выдаётся в личном кабинете avtoliga-parts.ru, `AddressId` — через `POST /get/addresses/` с этим токеном.

### 2. Frontend

```bash
npm install
echo "VITE_API_BASE_URL=http://localhost:3000/api" > .env.local
npm run dev          # http://localhost:5173/tg-miniapp/
```

Как и в оригинальном шаблоне, `src/mockEnv.ts` подменяет Telegram-окружение при разработке вне Telegram-клиента — приложение можно открыть в обычном браузере.

## Скрипты

**Корень репозитория (frontend):**
- `npm run dev` / `npm run dev:https` — режим разработки
- `npm run build` — сборка (`tsc --noEmit && vite build`)
- `npm run lint` — ESLint (примечание: в исходном шаблоне не настроена типизация для `recommendedTypeChecked` в `eslint.config.js` — известная проблема конфигурации, не связанная с бизнес-логикой)
- `npm run deploy` — ручной деплой на GitHub Pages

**`server/` (backend):**
- `npm run start:dev` — режим разработки с watch
- `npm run build` / `npm run start:prod` — прод-сборка и запуск
- `npm run prisma:migrate` / `npm run prisma:seed` — миграции и тестовые данные
- `npm run import:catalog -- <path.csv>` — импорт каталога товаров из CSV (upsert по артикулу)
- `npm run test` — юнит-тесты (Jest)

## Деплой в продакшн

Пошаговая инструкция (переменные окружения, миграции, чек-лист безопасности, настройка бота через BotFather, смоук-тест) — в [DEPLOYMENT.md](DEPLOYMENT.md). Конкретно про деплой на Cloudflare (Pages для frontend + постоянный Tunnel для backend) — в [DEPLOYMENT-CLOUDFLARE.md](DEPLOYMENT-CLOUDFLARE.md).

## TON Connect

В шаблоне остался нетронутым интеграционный код TON Connect (`@tonconnect/ui-react`, страница `/ton-connect`, `public/tonconnect-manifest.json`) — он не относится к функциональности заказа запчастей и не используется бизнес-логикой. Можно удалить, если не планируется использовать TON-кошельки, либо оставить как есть.

## Полезные ссылки

- [Документация платформы Telegram Mini Apps](https://docs.telegram-mini-apps.com/)
- [@telegram-apps/sdk-react](https://docs.telegram-mini-apps.com/packages/telegram-apps-sdk-react)
- [NestJS](https://docs.nestjs.com/) / [Prisma](https://www.prisma.io/docs)
