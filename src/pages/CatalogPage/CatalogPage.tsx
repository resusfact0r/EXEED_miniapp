import { Button, Input, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useRef, useState, type FC } from 'react';
import { useSearchParams } from 'react-router-dom';

import { searchProducts } from '@/api/catalog.ts';
import type { Product } from '@/api/types.ts';
import { Page } from '@/components/Page.tsx';
import { ProductCard } from '@/components/ProductCard/ProductCard.tsx';

const SCROLL_KEY = 'catalog-scroll';

export const CatalogPage: FC = () => {
  // The query lives in the URL (#/catalog?q=заглушка), so "Назад" from a product brings the
  // search back instead of an empty catalog. replace: typing doesn't pile up history entries.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const setQuery = (value: string) => setSearchParams(value ? { q: value } : {}, { replace: true });
  // Where the list was scrolled for this query, to return there after the results reload.
  const restoreScroll = useRef<number | null>(readScroll(query));
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Reset to page 1 and refetch whenever the query changes (debounced) or a retry is requested.
  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => {
      searchProducts(query, 1)
        .then((result) => {
          setItems(result.items);
          setTotal(result.total);
          setPage(1);
          setError(null);
          const y = restoreScroll.current;
          restoreScroll.current = null;
          if (y) requestAnimationFrame(() => window.scrollTo(0, y));
        })
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, reloadToken]);

  const loadMore = () => {
    setLoadingMore(true);
    searchProducts(query, page + 1)
      .then((result) => {
        setItems((prev) => [...prev, ...result.items]);
        setTotal(result.total);
        setPage((p) => p + 1);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingMore(false));
  };

  // Remember the scroll position when leaving for a product.
  useEffect(() => {
    return () => {
      try {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ query, y: window.scrollY }));
      } catch {
        // storage unavailable: just don't restore
      }
    };
  }, [query]);

  const hasMore = total !== null && items.length < total;

  return (
    <Page back={false}>
      <List>
        <Section header="Поиск по каталогу">
          <Input
            placeholder="Артикул или название"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Section>
        <Section header={total !== null ? `Результаты (${total})` : 'Результаты'}>
          {loading ? (
            <Spinner size="m" />
          ) : error ? (
            <Placeholder header="Не удалось загрузить каталог" description={error}>
              <Button size="l" onClick={() => setReloadToken((t) => t + 1)}>
                Повторить
              </Button>
            </Placeholder>
          ) : items.length === 0 ? (
            <Placeholder header="Ничего не найдено" description="Попробуйте изменить запрос" />
          ) : (
            <>
              {items.map((product) => <ProductCard key={product.id} product={product} />)}
              {hasMore && (
                <div style={{ padding: 16 }}>
                  <Button size="l" stretched loading={loadingMore} onClick={loadMore}>
                    Показать ещё ({total! - items.length})
                  </Button>
                </div>
              )}
            </>
          )}
        </Section>
      </List>
    </Page>
  );
};

function readScroll(query: string): number | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null') as { query: string; y: number } | null;
    return saved && saved.query === query ? saved.y : null;
  } catch {
    return null;
  }
}
