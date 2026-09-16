import { Button, Cell, Input, List, Placeholder, Radio, Section, SegmentedControl, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';

import { getCarriers, getCdekPvz, getYandexPvz } from '@/api/delivery.ts';
import type { Carrier, DeliveryCarrier, Pvz } from '@/api/types.ts';

interface PvzPickerProps {
  selectedCarrier: DeliveryCarrier | null;
  selectedPvzId: string | null;
  cityCode: number | null;
  cityName: string | null;
  cityRegion: string | null;
  onSelectCarrier: (carrier: DeliveryCarrier) => void;
  onSelectPvz: (pvz: Pvz) => void;
}

export const PvzPicker: FC<PvzPickerProps> = ({
  selectedCarrier,
  selectedPvzId,
  cityCode,
  cityName,
  cityRegion,
  onSelectCarrier,
  onSelectPvz,
}) => {
  // Carriers come from the backend rather than a hardcoded list: one still running on mock data
  // is hidden in production, so customers never see made-up pickup points.
  const [carriers, setCarriers] = useState<Carrier[] | null>(null);
  const [pvzList, setPvzList] = useState<Pvz[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void getCarriers().then((list) => {
      setCarriers(list);
      // A carrier saved earlier (e.g. from profile preferences) may no longer be offered - say
      // Yandex went back to mock mode. Fall back to the first available one instead of trying
      // to load a carrier the backend won't serve.
      if (selectedCarrier && list.length > 0 && !list.some((c) => c.key === selectedCarrier)) {
        onSelectCarrier(list[0].key);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carrier = selectedCarrier ?? carriers?.[0]?.key ?? null;
  // CDEK's API is keyed by numeric city code; Yandex has no usable city filter, so it matches
  // on the city name (plus region, to separate namesakes) server-side.
  const cityReady = carrier === 'CDEK' ? cityCode !== null : Boolean(cityName);

  const fetchPage = (targetPage: number, search: string) =>
    carrier === 'CDEK'
      ? getCdekPvz(cityCode!, targetPage, search)
      : getYandexPvz(cityName ?? '', targetPage, search, cityRegion ?? '');

  // Refetch on carrier/city change and on every (debounced) keystroke, always from page 1.
  useEffect(() => {
    if (!carrier || !cityReady) {
      setPvzList(null);
      return;
    }
    const timeout = setTimeout(() => {
      setPvzList(null);
      setPage(1);
      void fetchPage(1, query).then((result) => {
        setPvzList(result.items);
        setHasMore(result.hasMore);
        setTotal(result.total);
      });
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrier, cityCode, cityName, cityRegion, cityReady, query]);

  const loadMore = () => {
    if (!carrier) return;
    setLoadingMore(true);
    fetchPage(page + 1, query)
      .then((result) => {
        setPvzList((prev) => [...(prev ?? []), ...result.items]);
        setHasMore(result.hasMore);
        setPage((p) => p + 1);
      })
      .finally(() => setLoadingMore(false));
  };

  if (carriers && carriers.length === 0) {
    return (
      <Section header="Способ доставки">
        <Placeholder description="Доставка транспортными компаниями временно недоступна — выберите самовывоз" />
      </Section>
    );
  }

  return (
    <List>
      <Section header="Способ доставки">
        {carriers === null ? (
          <Spinner size="s" />
        ) : (
          <SegmentedControl>
            {carriers.map((c) => (
              <SegmentedControl.Item key={c.key} selected={carrier === c.key} onClick={() => onSelectCarrier(c.key)}>
                {c.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
        )}
      </Section>
      <Section header={total > 0 ? `Пункт выдачи (найдено ${total})` : 'Пункт выдачи'}>
        {!cityReady ? (
          <Placeholder description="Сначала выберите город выше" />
        ) : (
          <>
            <Input
              placeholder="Поиск по адресу или названию"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {pvzList === null ? (
              <Spinner size="m" />
            ) : pvzList.length === 0 ? (
              <Cell subtitle={query ? 'Попробуйте изменить запрос' : 'Попробуйте другой город или перевозчика'}>
                Ничего не найдено
              </Cell>
            ) : (
              <>
                {pvzList.map((pvz) => (
                  <Cell
                    key={pvz.id}
                    subtitle={pvz.workingHours}
                    description={pvz.estimatedDeliveryDays ? `Срок доставки: ${pvz.estimatedDeliveryDays}` : undefined}
                    before={<Radio name="pvz" checked={selectedPvzId === pvz.id} onChange={() => onSelectPvz(pvz)} />}
                    onClick={() => onSelectPvz(pvz)}
                  >
                    {pvz.name ?? pvz.address}
                    {pvz.name ? ` — ${pvz.address}` : ''}
                  </Cell>
                ))}
                {hasMore && (
                  <div style={{ padding: 16 }}>
                    <Button size="l" stretched loading={loadingMore} onClick={loadMore}>
                      Показать ещё
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Section>
    </List>
  );
};
