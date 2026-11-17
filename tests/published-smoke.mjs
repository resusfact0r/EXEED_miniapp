import { createInterface } from 'node:readline';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

// Supply {origin, token} through hidden stdin only. Never put the owner token in an argument,
// environment variable, screenshot, repository file or report. It is attached ONLY to this origin.
const reader = createInterface({ input: process.stdin, terminal: false });
console.log('Ready for private Site QA JSON on hidden stdin.');
const payload = JSON.parse(await new Promise((done) => reader.once('line', done)));
reader.close(); process.stdin.pause();
const target = new URL(payload.origin);
if (target.protocol !== 'https:') throw new Error('Published QA requires HTTPS');
const output = resolve('work/qa'); await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, '.published-browser-'));
let executablePath;
for (const path of [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)) {
  if (await access(path).then(() => true, () => false)) { executablePath = path; break; }
}
let browser;
try {
  browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile, args: ['--disable-dev-shm-usage'], env: { ...process.env, XDG_CONFIG_HOME: resolve(output, '.config'), XDG_CACHE_HOME: resolve(output, '.cache') } });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === target.origin) return request.continue({ headers: { ...request.headers(), 'OAI-Sites-Authorization': `Bearer ${payload.token}` } });
    if (url.origin === 'https://exeedbot.ru' && url.pathname.startsWith('/api/web/') && request.method() === 'GET') return request.continue();
    return request.abort();
  });
  const response = await page.goto(target.href, { waitUntil: 'networkidle0', timeout: 45000 });
  assert.equal(response.status(), 200);
  await page.waitForSelector('.product-card .product-name', { timeout: 30000 });
  assert.equal(await page.$eval('h1', (element) => element.textContent), 'Каталог запчастей');
  assert.equal(await page.$eval('.vehicle', (element) => element.complete && element.naturalWidth > 0), true);
  await page.click('.map-pin[aria-label="Показать раздел: Двигатель"]');
  await page.waitForSelector('.assembly-map');
  await page.waitForSelector('.product-card .add-button:not([disabled])');
  await page.click('.product-card .add-button:not([disabled])');
  await page.waitForFunction(() => Number(document.querySelector('.basket-button b').textContent) > 0);
  await page.click('.basket-button'); await page.waitForSelector('dialog[open] .bag-line'); await page.keyboard.press('Escape');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, 'published-desktop.png'), fullPage: true });
  const report = { origin: target.origin, status: 'passed', browser: await browser.version(), source: await page.$('.snapshot-notice') ? 'snapshot' : 'live', checks: ['HTTPS page 200', 'Application started', 'Catalog rendered', 'Car illustration loaded', 'Map selected an assembly', 'Guest cart add/open/close'], uncaughtErrors: errors };
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'published-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (browser) await browser.close();
  await rm(profile, { recursive: true, force: true });
}
