import type { NormalizedPvz, PvzPage } from './types';

// Street-type words people type but carriers abbreviate differently - CDEK writes "ул.", Yandex
// "улица", someone searching types either. Dropped from the query so they never block a match.
const STREET_TYPE_WORDS = new Set([
  'ул', 'улица', 'пр', 'пр-т', 'пр-кт', 'проспект', 'ш', 'шоссе', 'б-р', 'бул', 'бульвар',
  'пер', 'переулок', 'пл', 'площадь', 'проезд', 'пр-д', 'наб', 'набережная', 'д', 'дом',
  'к', 'корп', 'корпус', 'стр', 'строение', 'мкр', 'микрорайон',
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,;:()"«»/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryWords(query: string): string[] {
  return normalize(query)
    .split(' ')
    .filter((word) => word && !STREET_TYPE_WORDS.has(word));
}

/**
 * Shared by both carriers so CDEK and Yandex lists behave identically. Every word of the query
 * has to appear somewhere in the point (address, short address, name or code), in any order -
 * so "ленинградское 128" finds "Ленинградское шоссе 128", and "улица международная" finds
 * CDEK's "ул. Международная, 15". A plain substring match missed both.
 */
export function paginateAndFilter(
  all: NormalizedPvz[],
  page: number,
  pageSize: number,
  query: string,
): PvzPage {
  const words = queryWords(query);
  const filtered = words.length
    ? all.filter((pvz) => {
        const haystack = normalize(`${pvz.address} ${pvz.shortAddress ?? ''} ${pvz.name ?? ''} ${pvz.id}`);
        return words.every((word) => haystack.includes(word));
      })
    : all;

  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    hasMore: start + pageSize < filtered.length,
    total: filtered.length,
  };
}
