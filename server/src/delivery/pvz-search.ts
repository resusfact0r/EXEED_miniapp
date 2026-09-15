import type { NormalizedPvz, PvzPage } from './types';

/**
 * Shared by both carriers so CDEK and Yandex lists behave identically: substring match over
 * the address and the point's name (people search by street, by metro station wording that
 * appears in the address, or by the point code), then page the matches.
 */
export function paginateAndFilter(
  all: NormalizedPvz[],
  page: number,
  pageSize: number,
  query: string,
): PvzPage {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? all.filter(
        (pvz) =>
          pvz.address.toLowerCase().includes(q) ||
          (pvz.name?.toLowerCase().includes(q) ?? false) ||
          pvz.id.toLowerCase().includes(q),
      )
    : all;

  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    hasMore: start + pageSize < filtered.length,
    total: filtered.length,
  };
}
