/** Text navigation only. These labels never establish OEM fitment or VIN compatibility. */
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

export function classifyProduct(product: { name: string; description?: string | null }) {
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
  brands: string[];
  models: string[];
  categories: string[];
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

export function filterWebProducts(products: NavigationProduct[], filters: WebFilters) {
  const words = (filters.query ?? '').trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean).slice(0, 8);
  const compact = (value: string) => value.replace(/[-.\s/]/g, '').toLowerCase();
  const result = products.filter((product) =>
    (!filters.brand || product.brands.includes(filters.brand)) &&
    (!filters.model || product.models.includes(`${filters.brand}:${filters.model}`)) &&
    (!filters.category || product.categories.includes(filters.category)) &&
    (!filters.inStock || product.stockQty >= product.packQty) &&
    words.every((word) => product.name.toLowerCase().includes(word) || product.code.toLowerCase().includes(word) || compact(product.code).includes(compact(word))),
  );
  const exact = compact(filters.query ?? '');
  result.sort((a, b) => {
    const exactOrder = Number(compact(b.code) === exact) - Number(compact(a.code) === exact);
    if (exactOrder) return exactOrder;
    if (filters.sort === 'price-asc') return Number(a.price) - Number(b.price);
    if (filters.sort === 'price-desc') return Number(b.price) - Number(a.price);
    return a.name.localeCompare(b.name, 'ru');
  });
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 12));
  return { items: result.slice((page - 1) * pageSize, page * pageSize), total: result.length, page, pageSize };
}

export function webMetadata(products: NavigationProduct[]) {
  return {
    total: products.length,
    unclassified: products.filter((product) => product.brands.length === 0).length,
    brands: BRAND_RULES.map((brand) => {
      const items = products.filter((product) => product.brands.includes(brand.name));
      return { name: brand.name, count: items.length, models: brand.models.filter((model) => items.some((product) => product.models.includes(`${brand.name}:${model}`))) };
    }).filter((brand) => brand.count > 0),
    categories: WEB_CATEGORIES.map(({ id, name }) => ({ id, name, count: products.filter((product) => product.categories.includes(id)).length })),
  };
}
