import { Icon } from './Icons';

const sections: Record<string, { name: string; query: string; icon: string }[]> = {
  engine: [{ name: 'Масляный фильтр', query: 'фильтр масляный', icon: 'engine' }, { name: 'Воздушный фильтр', query: 'фильтр воздушный', icon: 'cooling' }, { name: 'Свечи зажигания', query: 'свеча', icon: 'electric' }, { name: 'Ремни и ролики', query: 'ремень', icon: 'transmission' }],
  body: [{ name: 'Фары', query: 'фара', icon: 'body' }, { name: 'Бамперы', query: 'бампер', icon: 'body' }, { name: 'Зеркала', query: 'зеркало', icon: 'body' }, { name: 'Капот и упоры', query: 'капот', icon: 'body' }],
  suspension: [{ name: 'Амортизаторы', query: 'амортизатор', icon: 'suspension' }, { name: 'Рычаги', query: 'рычаг', icon: 'suspension' }, { name: 'Ступицы', query: 'ступица', icon: 'brakes' }, { name: 'Шаровые опоры', query: 'опора шаровая', icon: 'suspension' }],
  brakes: [{ name: 'Тормозные колодки', query: 'колодки', icon: 'brakes' }, { name: 'Тормозные диски', query: 'диск тормозной', icon: 'brakes' }, { name: 'Суппорты', query: 'суппорт', icon: 'brakes' }, { name: 'Тормозные шланги', query: 'шланг тормозной', icon: 'cooling' }],
  transmission: [{ name: 'Сцепление', query: 'сцепление', icon: 'transmission' }, { name: 'Приводы', query: 'привод', icon: 'transmission' }, { name: 'ШРУСы', query: 'шрус', icon: 'transmission' }, { name: 'Масло для КПП', query: 'масло', icon: 'engine' }],
  cooling: [{ name: 'Радиаторы', query: 'радиатор', icon: 'cooling' }, { name: 'Термостаты', query: 'термостат', icon: 'cooling' }, { name: 'Водяные насосы', query: 'помпа', icon: 'engine' }, { name: 'Патрубки', query: 'патрубок', icon: 'cooling' }],
  electric: [{ name: 'Датчики', query: 'датчик', icon: 'electric' }, { name: 'Генераторы', query: 'генератор', icon: 'electric' }, { name: 'Стартеры', query: 'стартер', icon: 'engine' }, { name: 'Катушки зажигания', query: 'катушка', icon: 'electric' }],
  interior: [{ name: 'Коврики', query: 'коврик', icon: 'interior' }, { name: 'Сиденья', query: 'сидень', icon: 'interior' }, { name: 'Ручки дверей', query: 'ручка', icon: 'body' }, { name: 'Дефлекторы', query: 'дефлектор', icon: 'cooling' }],
};

export function AssemblyMap({ category, title, query, onSelect }: { category: string; title: string; query: string; onSelect: (query: string) => void }) {
  const entries = sections[category];
  if (!entries) return null;
  return <div className="assembly-map" aria-label={`Детали раздела: ${title}`}><div className="assembly-parts">{entries.map((part) => <button key={part.query} className={query === part.query ? 'is-selected' : ''} onClick={() => onSelect(query === part.query ? '' : part.query)} aria-pressed={query === part.query}><Icon name={part.icon} size={18}/><span>{part.name}</span></button>)}</div></div>;
}
