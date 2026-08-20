import { Button, Input, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';

import { searchProducts } from '@/api/catalog.ts';
import type { Product } from '@/api/types.ts';
import { Page } from '@/components/Page.tsx';
import { ProductCard } from '@/components/ProductCard/ProductCard.tsx';

export const CatalogPage: FC = () => {
  const [query, setQuery] = useState('');
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
