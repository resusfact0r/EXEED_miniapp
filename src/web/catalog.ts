import { filterWebProducts, type NavigationProduct, type WebFilters, type webMetadata } from '../../server/src/catalog/web-taxonomy';

export type { NavigationProduct, WebFilters };
export type CatalogMetadata = ReturnType<typeof webMetadata>;
type Snapshot = { sourceDate: string | null; metadata: CatalogMetadata; products: NavigationProduct[] };
const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');
let snapshotPromise: Promise<Snapshot> | undefined;
let mode: 'live' | 'snapshot' = 'live';

async function snapshot() {
  snapshotPromise ??= fetch(`${import.meta.env.BASE_URL}web-catalog.json`).then(async (response) => {
    if (!response.ok) throw new Error('Не удалось загрузить каталог. Попробуйте обновить страницу.');
    return response.json() as Promise<Snapshot>;
  }).catch((error) => { snapshotPromise = undefined; throw error; });
  return snapshotPromise;
}

async function live<T>(path: string): Promise<T> {
  const response = await fetch(`${base}/web/${path}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
  return response.json();
}

export async function loadCatalog() {
  try {
    const metadata = await live<CatalogMetadata>('catalog');
    if (!Array.isArray(metadata.brands) || !Array.isArray(metadata.categories) || typeof metadata.total !== 'number') throw new Error('Invalid catalog metadata');
    mode = 'live';
    return { metadata, source: 'live' as const, sourceDate: null };
  }
  catch { mode = 'snapshot'; const data = await snapshot(); return { metadata: data.metadata, source: 'snapshot' as const, sourceDate: data.sourceDate }; }
}

export async function findProducts(filters: WebFilters) {
  if (mode === 'live') {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
    // A live outage must be visible, rather than silently showing old stock as live.
    return live<ReturnType<typeof filterWebProducts>>(`products?${params}`);
  }
  return filterWebProducts((await snapshot()).products, filters);
}

export async function findProduct(code: string) {
  if (mode === 'live') return live<NavigationProduct>(`products/${encodeURIComponent(code)}`);
  const product = (await snapshot()).products.find((item) => item.code.toLowerCase() === code.toLowerCase());
  if (!product) throw new Error('Деталь не найдена');
  return product;
}

export const money = (amount: string | number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(amount));
export const supportUrl = 'https://t.me/lapostal';
export const botUrl = 'https://t.me/e_PartsBot';
