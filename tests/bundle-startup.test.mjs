import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const dist = new URL('../dist/', import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail(message);
}

test('the shipped module graph starts, loads the export, selects a part and updates the basket', { timeout: 20000 }, async () => {
  const html = await readFile(new URL('index.html', dist), 'utf8');
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  console.on('error', (...args) => errors.push(args.map(String).join(' ')));
  const dom = new JSDOM(html, { url: 'https://catalog.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  try {
    const { window } = dom;
    const context = dom.getInternalVMContext();
    Object.assign(context, { TextEncoder, TextDecoder, Response, Request, Headers, AbortController, AbortSignal });
    window.HTMLElement.prototype.scrollIntoView = function () {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    context.fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
      if (url.pathname.startsWith('/api/')) return new Response('{"message":"Not Found"}', { status: 404 });
      if (url.origin !== window.location.origin) throw new Error('The startup test must not use a live service');
      try { return new Response(await readFile(new URL(url.pathname.slice(1), dist))); }
      catch { return new Response('Not found', { status: 404 }); }
    };
    // jsdom does not fetch stylesheets. Simulate their completion; JS itself runs unchanged.
    const append = window.document.head.appendChild.bind(window.document.head);
    window.document.head.appendChild = (element) => {
      const result = append(element);
      if (element.tagName === 'LINK') setTimeout(() => element.dispatchEvent(new window.Event('load')), 0);
      return result;
    };
    const modules = new Map();
    const evaluations = new Map();
    async function getModule(url) {
      if (modules.has(url.href)) return modules.get(url.href);
      const source = await readFile(url, 'utf8');
      const module = new SourceTextModule(source, {
        identifier: url.href, context,
        initializeImportMeta(meta) { meta.url = url.href; },
        async importModuleDynamically(specifier, parent) {
          const imported = await getModule(new URL(specifier, parent.identifier));
          if (imported.status === 'unlinked') await imported.link(linker);
          if (!evaluations.has(imported.identifier)) evaluations.set(imported.identifier, imported.evaluate());
          await evaluations.get(imported.identifier);
          return imported;
        },
      });
      modules.set(url.href, module);
      return module;
    }
    async function linker(specifier, parent) { return getModule(new URL(specifier, parent.identifier)); }
    const entry = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    assert.ok(entry, 'built HTML must point to a module');
    const module = await getModule(new URL(entry.replace(/^\//, ''), dist));
    await module.link(linker);
    await Promise.race([
      module.evaluate(),
      delay(3000).then(() => { throw new Error('Entry module did not finish: possible top-level-await import cycle'); }),
    ]);
    await until(() => window.document.querySelector('.page-intro h1'), `Storefront did not render. ${errors.join('; ')}`);
    await until(() => window.document.querySelector('.product-grid .product-card .product-name'), 'Catalog products did not load');
    assert.match(window.document.querySelector('h1').textContent, /Каталог запчастей/);
    assert.match(window.document.querySelector('.snapshot-notice').textContent, /Каталог из выгрузки/);
    const engine = window.document.querySelector('[aria-label="Показать раздел: Двигатель"]');
    engine.click();
    await until(() => window.document.querySelector('.assembly-map'), 'Clicking an assembly did not open the part map');
    const oilFilter = [...window.document.querySelectorAll('.assembly-parts button')].find((element) => element.textContent.includes('Масляный фильтр'));
    oilFilter.click();
    await until(() => window.document.querySelector('.products-toolbar h2')?.textContent.includes('фильтр масляный'), 'The part map did not select the search');
    await until(() => window.document.querySelector('.product-card .add-button:not([disabled])'), 'No sellable filter was found');
    window.document.querySelector('.product-card .add-button:not([disabled])').click();
    await until(() => Number(window.document.querySelector('.basket-button b')?.textContent) > 0, 'Adding a real product did not update the basket');
    window.document.querySelector('.basket-button').click();
    await until(() => window.document.querySelector('dialog[open] .bag-line'), 'Saved basket did not open');
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.ok(fileURLToPath(dist).includes('/dist/'));
  } finally { dom.window.close(); }
});
