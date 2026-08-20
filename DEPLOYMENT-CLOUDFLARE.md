# Развёртывание на Cloudflare (frontend + backend)

Эта инструкция — конкретный путь деплоя через инфраструктуру Cloudflare, в дополнение к общему [DEPLOYMENT.md](DEPLOYMENT.md) (там — общий чек-лист вне зависимости от хостинга).

**Важная оговорка сразу:** Cloudflare бесплатно и нативно хостит только **статику** (frontend — через Cloudflare Pages). Backend (NestJS + PostgreSQL) — это постоянно работающий процесс с базой данных, Cloudflare Workers для такого не подходят без глубокой переделки под их рантайм. Поэтому схема такая:

```
Frontend (статика)  → Cloudflare Pages (реально хостится у Cloudflare)
Backend (Node-процесс + Postgres) → работает на своём сервере (VPS/Railway/Render/свой комп)
                                     ↓
                     Cloudflare Tunnel → даёт этому серверу HTTPS-адрес
                                          без открытия портов наружу
```

То есть Cloudflare Tunnel — это не хостинг backend'а, а **вход** к нему: безопасный HTTPS-туннель от Cloudflare до вашего процесса, работающего где угодно (в том числе на обычном домашнем компьютере).

То, что мы поднимали для быстрого теста ранее (`cloudflared tunnel --url ...`) — это временный «quick tunnel»: адрес рандомный и умирает с процессом. Ниже — как сделать то же самое, но **постоянно** (стабильный адрес, переживает перезагрузки).

---

## Предварительные требования

- Аккаунт Cloudflare (бесплатный) — https://dash.cloudflare.com/sign-up
- **Домен, подключённый к Cloudflare** (DNS этого домена должен управляться Cloudflare — либо купить домен через них, либо перенести существующий, привязав его NS-записи к Cloudflare). Без домена стабильного адреса для backend не получится — только рандомные quick-tunnel адреса.
- Сервер/машина, где будет **постоянно** крутиться `server/` (backend) и Postgres — свой VPS, Railway/Render, или тот же компьютер, если он может быть включён постоянно.
- Node.js 20+ на этой машине, `cloudflared` (см. установку ниже).

---

## Часть A. Frontend → Cloudflare Pages

### Вариант 1: через дашборд (проще всего)

1. Зайти в Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Выбрать репозиторий `tg-miniapp`.
3. Настройки сборки:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/` (корень репозитория, не `server/`)
4. **Environment variables** (в настройках Pages-проекта) → добавить:
   ```
   VITE_API_BASE_URL = https://api.ваш-домен.ru/api
   ```
   (сам адрес появится после части B — можно вписать заранее, зная какой поддомен планируете).
5. Deploy. Cloudflare даст адрес вида `https://tg-miniapp.pages.dev` — его тоже можно использовать (Cloudflare Pages не требует своего домена для базового `*.pages.dev` адреса, HTTPS уже включён), либо прикрутить свой домен через **Custom domains** в том же проекте.

### Вариант 2: вручную через CLI (`wrangler`)

```bash
npm run build
npx wrangler login          # один раз, откроет браузер для авторизации
npx wrangler pages deploy dist --project-name=tg-miniapp
```

### Важный нюанс: `base` в `vite.config.ts`

Сейчас там:
```ts
base: '/tg-miniapp/',
```
Это подогнано под GitHub Pages (сайт лежит в подпапке `/tg-miniapp/`). **Cloudflare Pages отдаёт сайт с корня домена** (`/`), поэтому для деплоя на Cloudflare Pages нужно поменять на:
```ts
base: '/',
```
Если хотите держать оба варианта деплоя (GitHub Pages и Cloudflare Pages) одновременно — держите `base: '/'` и настройте GitHub Pages на кастомный домен/корень тоже, либо делайте `base` через переменную окружения сборки. Для одного Cloudflare-деплоя — просто поменяйте на `/`.

---

## Часть B. Backend → постоянный Cloudflare Tunnel

Выполняется **на том сервере, где реально работает `server/`** (не на этой машине, если бэкенд будет жить в другом месте).

### 1. Установка `cloudflared`

```bash
# Debian/Ubuntu:
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# или без sudo, бинарником в свою папку (как делали для теста):
mkdir -p ~/.local/bin
curl -sL -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/.local/bin/cloudflared
```

### 2. Авторизация и создание именованного туннеля

```bash
cloudflared tunnel login
# откроется браузер — выбрать домен, который подключён к Cloudflare

cloudflared tunnel create tg-miniapp-backend
# создаст туннель с постоянным ID и файл учётных данных в ~/.cloudflared/<TUNNEL_ID>.json
```

### 3. Привязать поддомен к туннелю

```bash
cloudflared tunnel route dns tg-miniapp-backend api.ваш-домен.ru
```
Это само создаст нужную DNS-запись в Cloudflare — руками в DNS-панели ничего добавлять не нужно.

### 4. Конфиг туннеля

Создать `~/.cloudflared/config.yml`:
```yaml
tunnel: tg-miniapp-backend
credentials-file: /home/<user>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: api.ваш-домен.ru
    service: http://localhost:3000
  - service: http_status:404
```

### 5. Запуск как системный сервис (переживает перезагрузки и закрытие терминала)

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared   # проверить, что запущен
```

Теперь `https://api.ваш-домен.ru` — это постоянный, стабильный адрес вашего backend'а, и он не пропадёт при перезапуске терминала/сессии (в отличие от `cloudflared tunnel --url ...`, который мы использовали для быстрого теста ранее и который умер вместе с процессом).

### 6. Сам backend тоже должен быть постоянным процессом

Туннель — это только вход. Сам `node dist/main.js` тоже должен работать не в обычном терминале, а через процесс-менеджер, иначе он точно так же «сломается» при закрытии сессии:
```bash
cd server
npm ci
npx prisma migrate deploy
npm run build
npm install -g pm2
pm2 start dist/main.js --name tg-miniapp-backend
pm2 save
pm2 startup   # выведет команду для автозапуска pm2 при перезагрузке сервера — выполнить её
```

---

## Часть C. Свести всё вместе

1. `server/.env` на боевом сервере:
   ```
   CORS_ORIGIN="https://tg-miniapp.pages.dev"   # или ваш кастомный домен Pages-проекта
   ALLOW_UNSAFE_INIT_DATA=false
   CDEK_MOCKED=false
   YANDEX_MOCKED=false                            # когда появится боевой ключ Яндекс.Доставки
   ```
   Остальные переменные — как в общем чек-листе [DEPLOYMENT.md](DEPLOYMENT.md#21-переменные-окружения).

2. В Cloudflare Pages (переменная окружения проекта):
   ```
   VITE_API_BASE_URL=https://api.ваш-домен.ru/api
   ```

3. В **@BotFather** → Bot Settings → Menu Button — указать URL фронтенда:
   ```
   https://tg-miniapp.pages.dev/
   ```
   (или ваш кастомный домен Pages; со слэшем на конце, раз `base: '/'`)

4. Проверка:
   ```bash
   curl https://api.ваш-домен.ru/api/health
   # {"status":"ok"}
   ```
   Затем открыть бота в Telegram и нажать Menu Button.

---

## Если домена пока нет

Можно продолжать пользоваться быстрыми `cloudflared tunnel --url http://localhost:PORT` турами (как делали для теста) — но помните:
- адрес **меняется при каждом перезапуске** `cloudflared`;
- процесс живёт, пока открыт терминал/сессия — если её закрыть (как это уже один раз случилось), туннель и backend останавливаются;
- каждый раз придётся заново прописывать новый URL в BotFather.

Это нормально для разовой проверки, но не годится для реальной эксплуатации бота — для неё нужен домен + именованный туннель из части B, либо обычный деплой без Cloudflare (см. основной [DEPLOYMENT.md](DEPLOYMENT.md) — Railway/Render/VPS с собственным HTTPS).
