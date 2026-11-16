# Автодеплой exeedbot.ru

После push в `main` или `feat/web-visual-catalog` GitHub Actions собирает frontend и backend, проверяет поиск/фильтры, запускает production-модули интерфейса в тестовом DOM, проверяет HTTP API и сценарии установки. Только после успешных проверок создаётся prerelease `deploy-<полный SHA>` с `release.tar.gz` и SHA-256.

Сервер раз в минуту проверяет настроенную ветку и устанавливает только соответствующий проверенный артефакт. CI не требует SSH-доступа к серверу или его пароля. Механизм рассчитан на текущий публичный репозиторий и публичные release-артефакты; рабочий `.env` в них не входит.

## Один раз включить на существующем VPS

Установка выполняется под root на сервере с текущим магазином. Она использует существующие `/opt/tg-miniapp/server/.env`, пользователя `deploy`, PM2-процесс `tg-miniapp-backend` и nginx root `/var/www/exeedbot-frontend` из `DEPLOYMENT-VPS.md`.

Подставьте полный SHA коммита, содержащего этот установщик. Одинаковый SHA в обоих местах фиксирует проверенную версию установщика:

```bash
REVISION=<полный-SHA-коммита>
curl -fsSL "https://raw.githubusercontent.com/resusfact0r/EXEED_miniapp/$REVISION/server/deploy/autodeploy/install.sh" \
  | bash -s -- "$REVISION" feat/web-visual-catalog
```

Команда устанавливает `exeed-autodeploy.service` и `exeed-autodeploy.timer` и сразу запускает первую проверку ветки. Сборка первого релиза в Actions должна завершиться, прежде чем сервер начнёт установку. Наличие workflow в GitHub само по себе не устанавливает таймер на VPS.

Проверка:

```bash
systemctl status exeed-autodeploy.timer
journalctl -u exeed-autodeploy.service -n 60 --no-pager
curl -fsS https://exeedbot.ru/version.json
curl -fsS https://exeedbot.ru/api/web/catalog
```

`version.json` содержит точный SHA опубликованного frontend. HTTP API каталога начинает отвечать после установки backend из той же сборки.

## Что делает установка релиза

1. Проверяет SHA-256 архива, пути внутри него и SHA в manifest.
2. Готовит frontend и backend в `/opt/tg-miniapp/releases/<SHA>`.
3. Переносит существующий runtime `.env` в `/opt/tg-miniapp/shared/backend.env` один раз; все версии используют его через символьную ссылку.
4. Устанавливает backend-зависимости от имени `deploy`, генерирует Prisma Client, выполняет `prisma migrate deploy`, удаляет dev-зависимости. Импорт каталога или сброс БД не выполняются.
5. Переключает backend, перезапускает существующий процесс PM2 и проверяет локальные `/api/health` и `/api/web/catalog`.
6. Публикует frontend существующим атомарным `deploy-frontend.sh`, сохраняя прежние JS-бандлы. Проверяет публичные `version.json` и API каталога.
7. При ошибке переключения или проверки восстанавливает прежний frontend и backend. Автоматического отката миграций БД нет.

## Выбрать основную ветку или остановить обновления

После слияния разработки в основную ветку можно изменить `/etc/exeed-autodeploy.env`:

```text
EXEED_REPOSITORY=resusfact0r/EXEED_miniapp
EXEED_BRANCH=main
```

Следующий запуск службы прочитает новое значение. Для немедленного запуска: `systemctl start exeed-autodeploy.service`. Для отключения последующих проверок: `systemctl disable --now exeed-autodeploy.timer`.

Доступ к VPS в среде разработки не настроен. Установщик должен быть выполнен на сервере один раз владельцем или через предоставленное подключение; до этого автодеплой на VPS не активирован.
