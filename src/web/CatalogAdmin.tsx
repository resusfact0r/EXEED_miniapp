import { useState, type FormEvent } from 'react';
import type { CatalogOffer } from '../../server/src/catalog/offers';
import { SHOP_WAREHOUSE } from '../../server/src/catalog/offers';
import { OfferList } from './ProductOffers';
import { api, ApiError, request } from './orders';

type Card = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  images: string[];
  originalArticles: string[];
  updatedAt: string;
  offers: CatalogOffer[];
};
type CardPage = { items: Card[]; total: number; pageSize: number };
type Warehouse = { code: string; name: string; extraMarkup: string; defaultPackQty: number; retail: boolean };
type Import = {
  id: string;
  warehouseCode: string;
  rows: number;
  createdAt: string;
  status: string;
  fileName?: string;
  error?: string;
};
type ImportResult = { rows: number; added: number; updated: number; hidden: number };
type Tab = 'cards' | 'warehouses' | 'analogues';
const labels: Record<Tab, string> = {
  cards: 'Карточки',
  warehouses: 'Склады и прайсы',
  analogues: 'Аналоговые з/ч',
};
const statusLabels: Record<string, string> = {
  APPLIED: 'Загружен',
  FAILED: 'Ошибка',
  REJECTED: 'Отклонён',
  SKIPPED: 'Пропущен',
};
const date = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
});

export function CatalogAdmin() {
  const [token, setToken] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [tab, setTab] = useState<Tab>('cards');
  const [cards, setCards] = useState<CardPage>();
  const [selected, setSelected] = useState<Card | null>();
  const [formKey, setFormKey] = useState(0);
  const [q, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [imports, setImports] = useState<Import[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const headers = { 'x-admin-token': token };
  function admin<T>(path: string, init?: RequestInit) {
    return request<T>('/admin/catalog' + path, { ...init, headers });
  }
  function select(card?: Card | null) {
    setSelected(card);
    setFormKey((key) => key + 1);
  }
  function logout() {
    setToken('');
    setAuthorized(false);
    setTab('cards');
    setCards(undefined);
    select(undefined);
    setImports([]);
    setWarehouses([]);
    setMessage('');
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) logout();
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadCards(term: string, currentPage: number) {
    const data = await admin<CardPage>(
      '/cards?' + new URLSearchParams({ q: term, page: String(currentPage) }),
    );
    setCards(data);
    setPage(currentPage);
  }

  async function loadWarehouses() {
    const [stock, history] = await Promise.all([
      admin<Warehouse[]>('/warehouses'),
      admin<Import[]>('/imports'),
    ]);
    setWarehouses(stock);
    setImports(history);
  }

  function openTab(next: Tab) {
    void run(async () => {
      if (next === 'cards') await loadCards(q, page);
      if (next === 'warehouses') await loadWarehouses();
      setTab(next);
    });
  }

  function saveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const price = String(fields.get('price') ?? '').trim();
    const stock = String(fields.get('stock') ?? '').trim();
    const dto = {
      name: String(fields.get('name') ?? ''),
      description: String(fields.get('description') ?? ''),
      images: fields
        .getAll('photo')
        .map((url) => String(url).trim())
        .filter(Boolean),
      originalArticles: String(fields.get('originals') ?? '')
        .split(/\r?\n/)
        .map((code) => code.trim())
        .filter(Boolean),
      ...(selected ? { version: selected.updatedAt } : { code: fields.get('code') }),
      ...(price ? { storeOffer: { price: Number(price), stockQty: Number(stock) } } : {}),
    };
    void run(async () => {
      if (Boolean(price) !== Boolean(stock))
        throw new Error('Укажите и цену, и количество для склада магазина.');
      const saved = await admin<Card>(selected ? '/cards/' + encodeURIComponent(selected.id) : '/cards', {
        method: selected ? 'PUT' : 'POST',
        body: JSON.stringify(dto),
      });
      select(saved);
      setMessage('Карточка сохранена.');
      await loadCards(q, page);
    });
  }

  function addWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void run(async () => {
      const stock = await admin<Warehouse>('/warehouses', {
        method: 'POST',
        body: JSON.stringify({
          code: String(fields.get('code') ?? '').trim(),
          name: fields.get('name'),
          extraMarkup: Number(fields.get('markup')),
          defaultPackQty: Number(fields.get('pack')),
          brandFilter: String(fields.get('brand') ?? '').trim() || undefined,
        }),
      });
      setWarehouses((all) => [...all, stock]);
      form.reset();
      setMessage('Склад добавлен.');
    });
  }

  function upload(event: FormEvent<HTMLFormElement>, kind: 'stock' | 'analogues') {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const body = new FormData();
    const file = fields.get('file');
    if (!(file instanceof File) || !file.size) {
      setError('Выберите файл.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Размер файла должен быть до 8 МБ.');
      return;
    }
    body.append('file', file);
    if (kind === 'stock' && fields.has('snapshot')) body.append('snapshot', 'true');
    const path =
      kind === 'stock'
        ? '/warehouses/' + encodeURIComponent(String(fields.get('warehouse'))) + '/import'
        : '/analogues/import';
    void run(async () => {
      const result = await admin<ImportResult>(path, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(135_000),
      });
      setMessage(
        kind === 'stock'
          ? `Загружено позиций: ${result.rows}. Добавлено: ${result.added}. Изменились цены: ${result.updated}. Скрыто: ${result.hidden}.`
          : `Строк в файле: ${result.rows}. Добавлено связей: ${result.added}.`,
      );
      form.reset();
      if (kind === 'stock') setImports(await admin<Import[]>('/imports'));
    });
  }

  function downloadAnalogs() {
    void run(async () => {
      const response = await fetch(api + '/admin/catalog/analogues.xlsx', {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(35000),
      });
      if (!response.ok) throw new ApiError(response.status, 'Не удалось выгрузить связи.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'analogues.xlsx';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
    });
  }

  return (
    <main className="web-store">
      <div className="container catalog-admin">
        <header className="admin-header">
          <h1>Управление каталогом</h1>
          <div>
            <a className="text-link" href="?warehouse=1">
              Заказы
            </a>
            <a className="text-link" href={location.pathname}>
              Витрина
            </a>
          </div>
        </header>
        {error && (
          <p className="admin-message" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="admin-message" role="status">
            {message}
          </p>
        )}
        {!authorized ? (
          <form
            className="checkout-form admin-login"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await loadCards('', 1);
                setQuery('');
                setAuthorized(true);
              });
            }}
          >
            <label>
              Ключ администратора
              <input
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <button className="button" disabled={busy}>
              Войти
            </button>
          </form>
        ) : (
          <>
            <nav className="admin-tabs" aria-label="Управление каталогом">
              {(Object.keys(labels) as Tab[]).map((item) => (
                <button
                  key={item}
                  className="button button-secondary"
                  aria-current={item === tab ? 'page' : undefined}
                  disabled={busy}
                  onClick={() => openTab(item)}
                >
                  {labels[item]}
                </button>
              ))}
              <button className="text-link" disabled={busy} onClick={logout}>
                Выйти
              </button>
            </nav>

            {tab === 'cards' && (
              <div className="admin-columns">
                <section aria-label="Поиск карточек">
                  <form
                    className="checkout-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(() => loadCards(q, 1));
                    }}
                  >
                    <label>
                      Артикул или название
                      <input value={q} maxLength={100} onChange={(event) => setQuery(event.target.value)} />
                    </label>
                    <div className="admin-actions">
                      <button className="button" disabled={busy}>
                        Найти
                      </button>
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => select(null)}
                      >
                        Создать карточку
                      </button>
                    </div>
                  </form>
                  {cards?.items.length === 0 && <p>Карточки не найдены.</p>}
                  <ul className="admin-card-list">
                    {cards?.items.map((card) => (
                      <li key={card.id}>
                        <button
                          type="button"
                          aria-pressed={selected?.id === card.id}
                          disabled={busy}
                          onClick={() => select(card)}
                        >
                          <strong>{card.name}</strong>
                          <small>{card.code}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {cards && cards.total > cards.pageSize && (
                    <nav className="pagination" aria-label="Страницы карточек">
                      <button
                        disabled={busy || page <= 1}
                        onClick={() => run(() => loadCards(q, page - 1))}
                        aria-label="Предыдущая страница"
                      >
                        ‹
                      </button>
                      <span>
                        {page} из {Math.ceil(cards.total / cards.pageSize)}
                      </span>
                      <button
                        disabled={busy || page * cards.pageSize >= cards.total}
                        onClick={() => run(() => loadCards(q, page + 1))}
                        aria-label="Следующая страница"
                      >
                        ›
                      </button>
                    </nav>
                  )}
                </section>
                {selected !== undefined && (
                  <CardEditor key={formKey} card={selected} busy={busy} onSave={saveCard} />
                )}
              </div>
            )}

            {tab === 'warehouses' && (
              <div className="admin-columns">
                <section>
                  <h2>Загрузить прайс</h2>
                  <form className="checkout-form" onSubmit={(event) => upload(event, 'stock')}>
                    <label>
                      Склад
                      <select name="warehouse" required defaultValue="">
                        <option disabled value="">
                          Выберите склад
                        </option>
                        {warehouses.map((w) => (
                          <option key={w.code} value={w.code}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Прайс XLS, XLSX или CSV
                      <input name="file" type="file" accept=".xls,.xlsx,.csv" required />
                    </label>
                    <label className="checkout-check">
                      <input name="snapshot" type="checkbox" />
                      Полный снимок склада. Скрыть позиции, которых нет в файле.
                    </label>
                    <button className="button" disabled={busy}>
                      Загрузить
                    </button>
                  </form>
                  <h2>История загрузок</h2>
                  {imports.length === 0 && <p>Загрузок пока нет.</p>}
                  <ul className="admin-log">
                    {imports.map((item) => (
                      <li key={item.id}>
                        <strong>
                          {statusLabels[item.status] ?? item.status} ·{' '}
                          {warehouses.find((w) => w.code === item.warehouseCode)?.name ?? item.warehouseCode}
                        </strong>
                        <small>
                          {date.format(new Date(item.createdAt))} · {item.fileName ?? 'Прайс'} · {item.rows}{' '}
                          поз.
                        </small>
                        {item.error && <small>{item.error}</small>}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h2>Добавить склад</h2>
                  <form className="checkout-form" onSubmit={addWarehouse}>
                    <label>
                      Название
                      <input name="name" required maxLength={100} />
                    </label>
                    <label>
                      Код склада
                      <input
                        name="code"
                        required
                        maxLength={40}
                        pattern="[a-z0-9][a-z0-9\u002d]{0,39}"
                        placeholder="supplier-3"
                      />
                    </label>
                    <label>
                      Доплата к базовой наценке, п. п.
                      <input
                        name="markup"
                        type="number"
                        step="0.01"
                        min={0}
                        max={300}
                        defaultValue={0}
                        required
                      />
                    </label>
                    <label>
                      Партия, если её нет в файле
                      <input
                        name="pack"
                        type="number"
                        step={1}
                        min={1}
                        max={2147483647}
                        defaultValue={1}
                        required
                      />
                    </label>
                    <label>
                      Бренд в прайсе, если нужен отбор
                      <input name="brand" maxLength={100} />
                    </label>
                    <button className="button" disabled={busy}>
                      Добавить склад
                    </button>
                  </form>
                </section>
              </div>
            )}

            {tab === 'analogues' && (
              <section className="admin-login">
                <h2>Связи по оригинальному артикулу</h2>
                <p>
                  Загрузите файл с колонками «Артикул оригинала» и «Артикул аналога». Для нескольких
                  оригиналов повторите артикул аналога в отдельных строках.
                </p>
                <form className="checkout-form" onSubmit={(event) => upload(event, 'analogues')}>
                  <label>
                    Файл связей XLS, XLSX или CSV
                    <input name="file" type="file" accept=".xls,.xlsx,.csv" required />
                  </label>
                  <div className="admin-actions">
                    <button className="button" disabled={busy}>
                      Загрузить связи
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy}
                      onClick={downloadAnalogs}
                    >
                      Выгрузить XLSX
                    </button>
                  </div>
                </form>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function CardEditor({
  card,
  busy,
  onSave,
}: {
  card: Card | null;
  busy: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const offer = card?.offers.find((row) => row.warehouse === SHOP_WAREHOUSE);
  return (
    <section>
      <h2>{card ? 'Редактировать карточку' : 'Новая карточка'}</h2>
      <form className="checkout-form" onSubmit={onSave}>
        <label>
          Артикул
          <input required name="code" maxLength={100} readOnly={Boolean(card)} defaultValue={card?.code} />
        </label>
        <label>
          Название
          <input required name="name" maxLength={2000} defaultValue={card?.name} />
        </label>
        <label>
          Описание
          <textarea name="description" maxLength={5000} rows={4} defaultValue={card?.description ?? ''} />
        </label>
        <label>
          Артикулы оригиналов, по одному на строку
          <textarea
            name="originals"
            maxLength={5050}
            rows={2}
            defaultValue={card?.originalArticles.join('\n')}
          />
        </label>
        <fieldset className="admin-fieldset">
          <legend>Склад магазина</legend>
          <label>
            Цена за штуку, ₽
            <input
              name="price"
              type="number"
              min={0.01}
              max={99999999.99}
              step={0.01}
              defaultValue={offer?.price}
              required={!card || Boolean(offer)}
            />
          </label>
          <label>
            В наличии, шт.
            <input
              name="stock"
              type="number"
              min={0}
              max={2147483647}
              step={1}
              defaultValue={offer?.stockQty}
              required={!card || Boolean(offer)}
            />
          </label>
        </fieldset>
        <fieldset className="admin-fieldset">
          <legend>Фотографии</legend>
          {[0, 1, 2, 3].map((index) => (
            <label key={index}>
              Ссылка на фото {index + 1}
              <input
                name="photo"
                inputMode="url"
                maxLength={2000}
                defaultValue={card?.images[index]}
                placeholder="https://…"
              />
            </label>
          ))}
        </fieldset>
        <button className="button" disabled={busy}>
          Сохранить карточку
        </button>
      </form>
      {Boolean(card?.offers.length) && <OfferList offers={card!.offers} />}
    </section>
  );
}
