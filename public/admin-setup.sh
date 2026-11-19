#!/usr/bin/env bash
# Run on the EXEED VPS. The configured key is only printed to its local console.
set -euo pipefail

if [[ $(id -u) != 0 ]]; then
  echo 'Откройте консоль VPS от имени root.' >&2
  exit 1
fi

cd /opt/tg-miniapp/server
runuser -u deploy -- flock -w 45 /opt/tg-miniapp/shared/backend.env node <<'NODE'
const fs = require('node:fs');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { parse } = require('dotenv');

const envFile = '/opt/tg-miniapp/shared/backend.env';
const appName = 'tg-miniapp-backend';

function findApp() {
  try {
    const list = JSON.parse(execFileSync('pm2', ['jlist'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }));
    return list.find((app) => app.name === appName)?.pm2_env;
  } catch {
    throw new Error('Не удалось получить состояние приложения из PM2.');
  }
}

function status(port, key) {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1', port, path: '/api/admin/catalog/warehouses',
      headers: key ? { 'x-admin-token': key } : {},
      timeout: 2000,
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
  });
}

function printKey(key) {
  console.log('Ключ проверен. Скопируйте следующую строку в форму входа.');
  console.log(key);
}

async function setup() {
  const settings = parse(fs.readFileSync(envFile));
  const app = findApp();
  if (!app) throw new Error('В PM2 не найдено приложение ' + appName + '.');

  const pm2Key = app.ADMIN_API_TOKEN ?? app.env?.ADMIN_API_TOKEN;
  const port = Number(app.PORT ?? app.env?.PORT ?? settings.PORT ?? 3000) || 3000;
  const candidates = [...new Set([settings.ADMIN_API_TOKEN, pm2Key].filter(Boolean))];
  for (const key of candidates) {
    if (await status(port, key) === 200) return printKey(key);
  }

  let key = settings.ADMIN_API_TOKEN;
  if (!key) {
    key = randomBytes(32).toString('hex');
    fs.appendFileSync(envFile, '\nADMIN_API_TOKEN=' + key + '\n');
  }

  const env = { ...process.env };
  delete env.ADMIN_API_TOKEN;
  // An explicitly set PM2 environment variable takes priority over dotenv.
  if (pm2Key !== undefined) env.ADMIN_API_TOKEN = key;
  try {
    execFileSync('pm2', ['restart', appName, '--update-env'], { env, stdio: 'ignore' });
  } catch {
    throw new Error('PM2 не смог перезапустить приложение ' + appName + '.');
  }

  let last = 0;
  for (let attempt = 0; attempt < 15; attempt++) {
    last = await status(port, key);
    if (last === 200) return printKey(key);
    await delay(1000);
  }
  throw new Error(last ? 'Проверка ключа вернула HTTP ' + last + '.' : 'Приложение не отвечает на локальном порту ' + port + '.');
}

setup().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
