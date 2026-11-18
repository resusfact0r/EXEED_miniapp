import { articleKey, inStock, type CatalogOffer } from './offers';
import { articleApplications, type CatalogApplication } from './article-applications';

/** Catalog navigation; final vehicle compatibility still requires VIN verification. */
export const BRAND_RULES = [
  { name: 'EXEED', aliases: ['EXEED', 'ЭКСИД'], models: ['TXL', 'VX', 'LX', 'RX'] },
  { name: 'CHERY', aliases: ['CHERY', 'ЧЕРИ', 'TIGGO', 'ARRIZO', 'AMULET', 'KIMO', 'INDIS', 'BONUS', 'VERY'], models: ['Tiggo 9', 'Tiggo 8 Pro Max', 'Tiggo 8 Pro', 'Tiggo 8', 'Tiggo 7 Pro Max', 'Tiggo 7 Pro', 'Tiggo 7', 'Tiggo 4 Pro', 'Tiggo 4', 'Tiggo 3', 'Tiggo 2 Pro', 'Tiggo 2', 'Arrizo 8', 'Arrizo 7', 'Arrizo 5', 'Amulet', 'Kimo', 'Indis', 'Bonus', 'Very'] },
  { name: 'OMODA', aliases: ['OMODA', 'ОМОДА'], models: ['C5', 'S5 GT', 'S5', 'C7'] },
  { name: 'JAECOO', aliases: ['JAECOO', 'JAECO', 'ДЖЕЙКУ'], models: ['J7', 'J8', 'J6'] },
  { name: 'JETOUR', aliases: ['JETOUR', 'ДЖЕТУР'], models: ['Dashing', 'X70 Plus', 'X90 Plus', 'T2'] },
  { name: 'GEELY', aliases: ['GEELY', 'ДЖИЛИ'], models: ['Monjaro', 'Atlas Pro', 'Atlas', 'Coolray', 'Tugella', 'Emgrand'] },
  { name: 'HAVAL', aliases: ['HAVAL', 'ХАВАЛ', 'ХАВЕЙЛ'], models: ['Jolion', 'Dargo', 'F7x', 'F7', 'H6', 'H9', 'M6'] },
  { name: 'CHANGAN', aliases: ['CHANGAN', 'ЧАНГАН'], models: ['CS35 Plus', 'CS55 Plus', 'CS75 Plus', 'UNI-K', 'UNI-T', 'UNI-V'] },
  { name: 'TANK', aliases: ['TANK'], models: ['300', '500'] },
  { name: 'LIFAN', aliases: ['LIFAN', 'ЛИФАН'], models: ['X50', 'X60', 'Solano', 'Smily'] },
  { name: 'GREAT WALL', aliases: ['GREAT WALL', 'ГРЕЙТ ВОЛЛ'], models: ['Hover H3', 'Hover H5', 'Wingle'] },
  { name: 'TENET', aliases: ['TENET'], models: ['T4', 'T7', 'T8'] },
];

export const WEB_CATEGORIES = [
  { id: 'engine', name: 'Двигатель', terms: ['двигател', 'порш', 'коленвал', 'распредвал', 'грм', 'клапан', 'маслян', 'масляный', 'масляного', 'свеч', 'впуск', 'турбин', 'турбокомпресс', 'форсунк', 'топлив', 'воздушн', 'дроссел', 'ремень', 'ролик', 'головка блока'] },
  { id: 'body', name: 'Кузов и оптика', terms: ['кузов', 'бампер', 'капот', 'крыло', 'крыла', 'двер', 'зеркал', 'фар', 'фонар', 'решетк', 'решётк', 'стекло', 'стекла', 'молдинг', 'порог', 'эмблем', 'логотип', 'пневмоупор', 'спойлер'] },
  { id: 'suspension', name: 'Подвеска и рулевое', terms: ['амортизатор', 'рычаг', 'стойка', 'стойки', 'стабилизатор', 'сайлентблок', 'шаров', 'пружин', 'ступиц', 'рулев', 'рулевой', 'подшипник ступ', 'поворотн'] },
  { id: 'brakes', name: 'Тормозная система', terms: ['тормозн', 'суппорт', 'колодк', 'abs', 'абс'] },
  { id: 'transmission', name: 'Трансмиссия', terms: ['сцеплен', 'кпп', 'акпп', 'вариатор', 'шрус', 'привод', 'кардан', 'дифференциал', 'маховик', 'трансмис', 'dsg', 'cvt'] },
  { id: 'cooling', name: 'Охлаждение и климат', terms: ['радиатор', 'термостат', 'помпа', 'охлажден', 'вентилятор', 'кондиционер', 'отопител', 'антифриз', 'патрубок', 'компрессор'] },
  { id: 'electric', name: 'Электрика', terms: ['датчик', 'генератор', 'стартер', 'провод', 'реле', 'предохранител', 'аккумулятор', 'катушка', 'электр', 'блок управлен', 'жгут'] },
  { id: 'interior', name: 'Салон и аксессуары', terms: ['салон', 'коврик', 'сиден', 'обивк', 'прибор', 'багажник', 'ручка', 'подлокотник', 'дефлектор', 'очистител', 'микрофибр', 'полирол'] },
];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelPatterns = new Map<string, RegExp>();
const containsLabel = (text: string, label: string) => {
  let pattern = labelPatterns.get(label);
  if (!pattern) {
    pattern = new RegExp(`(?:^|[^A-ZА-ЯЁ0-9])${escapeRegex(label).replace(/ /g, '[\\s-]*')}(?=$|[^A-ZА-ЯЁ0-9])`, 'i');
    labelPatterns.set(label, pattern);
  }
  return pattern.test(text);
};

export function classifyProduct(product: { code?: string; name: string; description?: string | null }) {
  const text = `${product.name} ${product.description ?? ''}`;
  const brands: string[] = [];
  const models: string[] = [];
  for (const brand of BRAND_RULES) {
    const named = brand.aliases.some((alias) => containsLabel(text, alias));
    // EXEED model names and Chery's named families are distinctive without a brand prefix.
    const distinct = brand.name === 'EXEED' || brand.name === 'CHERY';
    const matched = brand.models.filter((model) => (named || distinct) && containsLabel(text, model));
    if (named || matched.length > 0) {
      brands.push(brand.name);
      // Keep the most specific model: Tiggo 7 Pro Max shouldn't also match Tiggo 7.
      models.push(...matched.filter((model) => !matched.some((other) => other !== model && other.toLowerCase().startsWith(`${model.toLowerCase()} `))).map((model) => `${brand.name}:${model}`));
    }
  }
  const folded = text.toLowerCase().replace(/ё/g, 'е');
  const categories = WEB_CATEGORIES.filter((category) => category.terms.some((term) => folded.includes(term.replace(/ё/g, 'е')))).map((category) => category.id);
  const vehicleApplications = articleApplications(product.code);
  if (vehicleApplications) {
    // Use only the reviewed, explicitly named revisions for these articles. A generic
    // VX in the supplier title must not silently expand a VX FL source to older VX.
    return {
      brands: [...new Set(vehicleApplications.map((application) => application.brand))],
      models: [...new Set(vehicleApplications.map((application) => `${application.brand}:${application.model}`))],
      categories, vehicleApplications,
    };
  }
  return { brands, models, categories };
}

export interface NavigationProduct {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  price: string;
  stockQty: number;
  packQty: number;
  imageUrl?: string | null;
  images?: string[];
  offers?: CatalogOffer[];
  originalArticles?: string[];
  brands: string[];
  models: string[];
  categories: string[];
  // Older clients ignore this field instead of requiring the retired attribution URLs.
  vehicleApplications?: CatalogApplication[];
}

export interface WebFilters {
  query?: string;
  brand?: string;
  model?: string;
  category?: string;
  inStock?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function matchesOriginal(product: NavigationProduct, query: string) {
  return product.originalArticles?.includes(articleKey(query)) ?? false;
}

export function filterWebProducts(products: NavigationProduct[], filters: WebFilters) {
  const words = (filters.query ?? '').trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean).slice(0, 8);
  const compact = (value: string) => value.replace(/[-.\s/]/g, '').toLowerCase();
  const matchesWords = (product: NavigationProduct) => {
    const baseMatch = (word: string) => product.name.toLowerCase().includes(word) || product.code.toLowerCase().includes(word) || compact(product.code).includes(compact(word));
    if (words.every(baseMatch)) return true;
    // Keep each vehicle together: EXEED from one application and C5 from another
    // must never manufacture an EXEED C5 association.
    return product.vehicleApplications?.some((application) => {
      const label = `${application.brand} ${application.model} ${application.configuration}`.toLowerCase();
      return words.every((word) => baseMatch(word) || label.includes(word));
    }) ?? false;
  };
  const query = filters.query ?? '';
  const result = products.filter((product) =>
    (!filters.inStock || (product.offers ? product.offers.some(inStock) : product.stockQty >= product.packQty)) &&
    (matchesOriginal(product, query) || (
      (!filters.brand || product.brands.includes(filters.brand)) &&
      (!filters.model || product.models.includes(`${filters.brand}:${filters.model}`)) &&
      (!filters.category || product.categories.includes(filters.category)) &&
      matchesWords(product)
    )),
  );
  const exact = compact(query);
  result.sort((a, b) => {
    const exactOrder = Number(compact(b.code) === exact) - Number(compact(a.code) === exact);
    if (exactOrder) return exactOrder;
    const originalOrder = Number(matchesOriginal(b, query)) - Number(matchesOriginal(a, query));
    if (originalOrder) return originalOrder;
    if (filters.sort === 'price-asc') return Number(a.price) - Number(b.price);
    if (filters.sort === 'price-desc') return Number(b.price) - Number(a.price);
    return a.name.localeCompare(b.name, 'ru');
  });
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 12));
  return { items: result.slice((page - 1) * pageSize, page * pageSize), total: result.length, page, pageSize };
}

export function webMetadata(products: NavigationProduct[]) {
  const knownBrands = BRAND_RULES.map((brand) => brand.name);
  const extraBrands = [...new Set(products.flatMap((product) => product.brands))].filter((name) => !knownBrands.includes(name)).sort();
  return {
    total: products.length,
    unclassified: products.filter((product) => product.brands.length === 0).length,
    brands: [...knownBrands, ...extraBrands].map((name) => {
      const items = products.filter((product) => product.brands.includes(name));
      const namedModels = BRAND_RULES.find((brand) => brand.name === name)?.models ?? [];
      const models = [...new Set(items.flatMap((product) => product.models.filter((model) => model.startsWith(`${name}:`)).map((model) => model.slice(name.length + 1))))];
      return { name, count: items.length, models: [...namedModels.filter((model) => models.includes(model)), ...models.filter((model) => !namedModels.includes(model)).sort((a, b) => a.localeCompare(b, 'ru'))] };
    }).filter((brand) => brand.count > 0),
    categories: WEB_CATEGORIES.map(({ id, name }) => ({ id, name, count: products.filter((product) => product.categories.includes(id)).length })),
  };
}
