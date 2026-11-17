import { filterWebProducts, type NavigationProduct, type WebFilters, type webMetadata } from '../../server/src/catalog/web-taxonomy';

export type { NavigationProduct, WebFilters };
export type CatalogMetadata = ReturnType<typeof webMetadata>;
type Snapshot = { sourceDate: string | null; metadata: CatalogMetadata; products: NavigationProduct[] };
const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');
let snapshotPromise: Promise<Snapshot> | undefined;
export type CatalogSource = 'live' | 'snapshot';
export type CatalogSession = { metadata: CatalogMetadata; source: CatalogSource; sourceDate: string | null };

function validMetadata(data: CatalogMetadata) {
  return Boolean(data && Number.isSafeInteger(data.total) && data.total >= 0 && Array.isArray(data.brands) && Array.isArray(data.categories)
    && data.brands.every((brand) => brand && typeof brand.name === 'string' && Number.isSafeInteger(brand.count) && Array.isArray(brand.models) && brand.models.every((model) => typeof model === 'string'))
    && data.categories.every((category) => category && typeof category.id === 'string' && typeof category.name === 'string' && Number.isSafeInteger(category.count)));
}

function validProduct(product: NavigationProduct) {
  return Boolean(product && typeof product.id === 'string' && typeof product.code === 'string' && typeof product.name === 'string'
    && typeof product.price === 'string' && product.price.trim() && Number.isFinite(Number(product.price)) && Number(product.price) >= 0
    && Number.isSafeInteger(product.stockQty) && product.stockQty >= 0 && Number.isSafeInteger(product.packQty) && product.packQty >= 1
    && [product.brands, product.models, product.categories].every((values) => Array.isArray(values) && values.every((value) => typeof value === 'string'))
    && (product.description == null || typeof product.description === 'string') && (product.imageUrl == null || typeof product.imageUrl === 'string')
    && (product.vehicleApplications === undefined || (Array.isArray(product.vehicleApplications) && product.vehicleApplications.length > 0
      && product.vehicleApplications.every((application) => application && typeof application.brand === 'string' && typeof application.model === 'string'
        && typeof application.configuration === 'string' && typeof application.checkedDate === 'string'
        && (application.modelYearFrom === undefined || (Number.isSafeInteger(application.modelYearFrom) && application.modelYearFrom >= 1886 && application.modelYearFrom <= 2200))))));
}

async function snapshot() {
  snapshotPromise ??= fetch(`${import.meta.env.BASE_URL}web-catalog.json`).then(async (response) => {
    if (!response.ok) throw new Error('Не удалось загрузить каталог. Попробуйте обновить страницу.');
    const data = await response.json() as Snapshot;
    if (!Array.isArray(data.products) || !data.products.every(validProduct) || !validMetadata(data.metadata)) throw new Error('Не удалось прочитать каталог. Попробуйте ещё раз.');
    return data;
  }).catch((error) => { snapshotPromise = undefined; throw error; });
  return snapshotPromise;
}

async function live<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${base}/web/${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}

export async function loadCatalog(): Promise<CatalogSession> {
  try {
    const metadata = await live<CatalogMetadata>('catalog');
    if (!validMetadata(metadata)) throw new Error('Invalid catalog metadata');
    return { metadata, source: 'live' as const, sourceDate: null };
  }
  catch { const data = await snapshot(); return { metadata: data.metadata, source: 'snapshot' as const, sourceDate: data.sourceDate }; }
}

export async function findProducts(filters: WebFilters, source: CatalogSource) {
  if (source === 'live') {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
    // A live outage must be visible, rather than silently showing old stock as live.
    const result = await live<ReturnType<typeof filterWebProducts>>(`products?${params}`);
    if (!Array.isArray(result.items) || !result.items.every(validProduct) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('Некорректный ответ каталога');
    return result;
  }
  return filterWebProducts((await snapshot()).products, filters);
}

export async function findProduct(code: string, source: CatalogSource) {
  if (source === 'live') {
    const product = await live<NavigationProduct>(`products/${encodeURIComponent(code)}`);
    if (!validProduct(product)) throw new Error('Некорректный ответ каталога');
    return product;
  }
  const product = (await snapshot()).products.find((item) => item.code.toLowerCase() === code.toLowerCase());
  if (!product) throw new Error('Деталь не найдена');
  return product;
}

export const money = (amount: string | number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(amount));
export const supportUrl = 'https://t.me/lapostal';
export const botUrl = 'https://t.me/e_PartsBot';
