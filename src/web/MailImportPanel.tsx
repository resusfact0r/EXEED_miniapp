import { useState, type FormEvent } from 'react';
import { request } from './orders';

type Warehouse = { code: string; name: string };
type PriceMail = {
  enabled: boolean;
  lastCheckOkAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  supplierMail: { subject: string; lastAt: string; matched: boolean }[];
  feeds: { warehouseCode: string; subjects: string[]; attachment?: string; enabled: boolean }[];
};
type Settings = {
  warehouseCode: string;
  subjects: string[];
  attachment?: string;
  sheet?: string;
  columns?: Record<string, string>;
};
type Preview = {
  subject: string;
  receivedAt: string;
  fileName: string;
  previewId: string;
  sheets: { sheet: string; columns: string[]; brands: { brand: string; rows: number }[] }[];
  parsed?: {
    sheet: string;
    columns: Record<string, string>;
    articles: number;
    invalidPrices: number;
    available: number;
  };
  parseError?: string;
};
const date = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
});
const fields = [
  ['code', 'Артикул'],
  ['price', 'Цена'],
  ['stock', 'Остаток'],
  ['pack', 'Мин. партия'],
  ['brand', 'Бренд'],
];

export function MailImportPanel({
  token,
  warehouses,
  onImported,
}: {
  token: string;
  warehouses: Warehouse[];
  onImported: () => Promise<void>;
}) {
  const [status, setStatus] = useState<PriceMail>();
  const [preview, setPreview] = useState<{ data: Preview; settings: Settings }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const headers = { 'x-admin-token': token };
  async function refresh() {
    setStatus(await request<PriceMail>('/admin/catalog/mail', { headers }));
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setResult('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? '').trim();
    setPreview(undefined);
    const settings: Settings = {
      warehouseCode: value('warehouse'),
      subjects: value('subjects')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      attachment: value('attachment') || undefined,
      sheet: value('sheet') || undefined,
      columns: Object.fromEntries(fields.map(([key]) => [key, value(key)]).filter(([, text]) => text)),
    };
    void run(async () => {
      const data = await request<Preview>('/admin/catalog/mail/preview', {
        method: 'POST',
        body: JSON.stringify(settings),
        headers,
        signal: AbortSignal.timeout(90000),
      });
      setPreview({ data, settings });
    });
  }
  function connect() {
    if (!preview) return;
    void run(async () => {
      const loaded = await request<{ fileName: string; rows: number }>('/admin/catalog/mail/connect', {
        method: 'POST',
        body: JSON.stringify({ ...preview.settings, previewId: preview.data.previewId }),
        headers,
        signal: AbortSignal.timeout(135000),
      });
      setPreview(undefined);
      setResult(`${loaded.fileName} загружен. Позиций ${loaded.rows}. Автоимпорт включён.`);
      await Promise.all([refresh(), onImported()]);
    });
  }
  return (
    <details
      className="admin-mail"
      onToggle={(event) => {
        if (event.currentTarget.open && !status && !busy) void run(refresh);
      }}
    >
      <summary>Прайсы из почты</summary>
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
      {status && (
        <>
          <p>
            {!status.enabled
              ? 'Автоимпорт выключен.'
              : status.consecutiveFailures
                ? 'Последняя проверка почты завершилась ошибкой.'
                : status.lastCheckOkAt
                  ? `Почта проверена ${date.format(new Date(status.lastCheckOkAt))}.`
                  : 'Первая проверка ещё выполняется.'}
          </p>
          <ul className="admin-log">
            {status.feeds.map((feed) => (
              <li key={feed.warehouseCode}>
                <strong>
                  {warehouses.find((w) => w.code === feed.warehouseCode)?.name ?? feed.warehouseCode}
                </strong>
                <small>
                  {feed.enabled ? 'Подключён' : 'Выключен'} ·{' '}
                  {feed.subjects.filter(Boolean).join(', ') || 'Все темы отправителя'}
                </small>
              </li>
            ))}
          </ul>
          <details>
            <summary>Последние темы поставщика</summary>
            <ul className="admin-log">
              {status.supplierMail.map((mail) => (
                <li key={mail.subject}>
                  <strong>{mail.subject}</strong>
                  <small>
                    {mail.matched ? 'Подходит по правилу' : 'Нет активного правила'} ·{' '}
                    {date.format(new Date(mail.lastAt))}
                  </small>
                </li>
              ))}
            </ul>
            {status.supplierMail.length === 0 && <p>Темы ещё не получены.</p>}
          </details>
        </>
      )}
      <form className="checkout-form" onSubmit={inspect} onChange={() => setPreview(undefined)}>
        <label>
          Склад
          <select name="warehouse" defaultValue="msk-opt-2" required>
            {warehouses.map((warehouse) => (
              <option key={warehouse.code} value={warehouse.code}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Постоянные части темы, по одной на строку
          <textarea
            name="subjects"
            rows={2}
            required
            maxLength={1000}
            placeholder="Автолига-Лион МСК наличие"
          />
        </label>
        <label>
          Часть имени вложения
          <input name="attachment" maxLength={180} />
        </label>
        <details>
          <summary>Лист и колонки</summary>
          <label>
            Название листа
            <input name="sheet" maxLength={140} />
          </label>
          {fields.map(([key, label]) => (
            <label key={key}>
              Колонка «{label}»<input name={key} maxLength={140} />
            </label>
          ))}
        </details>
        <button className="button button-secondary" disabled={busy}>
          {busy ? 'Проверяем…' : 'Проверить последнее письмо'}
        </button>
      </form>
      {preview && (
        <div className="admin-mail-preview">
          <p>
            <strong>{preview.data.fileName}</strong> · {date.format(new Date(preview.data.receivedAt))}
          </p>
          <p>{preview.data.subject}</p>
          {preview.data.sheets.map((sheet) => (
            <p key={sheet.sheet}>
              <strong>{sheet.sheet}</strong> · {sheet.columns.filter(Boolean).join(', ')}
            </p>
          ))}
          {preview.data.parsed && (
            <p>
              Позиций {preview.data.parsed.articles}. В наличии {preview.data.parsed.available}.
            </p>
          )}
          {preview.data.parseError ? (
            <p role="alert">{preview.data.parseError}</p>
          ) : (
            <button className="button" type="button" disabled={busy || !status?.enabled} onClick={connect}>
              Загрузить и включить автоимпорт
            </button>
          )}
        </div>
      )}
    </details>
  );
}
