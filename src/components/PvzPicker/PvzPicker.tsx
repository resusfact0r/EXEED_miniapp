import { Button, Cell, List, Placeholder, Radio, Section, SegmentedControl, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';

import { getCdekPvz, getYandexPvz } from '@/api/delivery.ts';
import type { DeliveryCarrier, Pvz } from '@/api/types.ts';

interface PvzPickerProps {
  selectedCarrier: DeliveryCarrier | null;
  selectedPvzId: string | null;
  cityCode: number | null;
  cityName: string | null;
  onSelectCarrier: (carrier: DeliveryCarrier) => void;
  onSelectPvz: (pvz: Pvz) => void;
}

const CARRIERS: { key: DeliveryCarrier; label: string }[] = [
  { key: 'CDEK', label: 'СДЭК' },
  { key: 'YANDEX', label: 'Яндекс.Доставка' },
];

export const PvzPicker: FC<PvzPickerProps> = ({
  selectedCarrier,
  selectedPvzId,
  cityCode,
  cityName,
  onSelectCarrier,
  onSelectPvz,
}) => {
  const carrier = selectedCarrier ?? 'CDEK';
  // CDEK's API is keyed by numeric city code; Yandex's (still mocked) takes a free-text name.
  const cityReady = carrier === 'CDEK' ? cityCode !== null : Boolean(cityName);

  const [pvzList, setPvzList] = useState<Pvz[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!cityReady) {
      setPvzList(null);
      return;
    }
    setPvzList(null);
    setPage(1);
    const fetcher = carrier === 'CDEK' ? () => getCdekPvz(cityCode!, 1) : () => getYandexPvz(cityName!);
    void fetcher().then((result) => {
      setPvzList(result.items);
      setHasMore(result.hasMore);
    });
  }, [carrier, cityCode, cityName, cityReady]);

  const loadMore = () => {
    if (carrier !== 'CDEK' || cityCode === null) return;
    setLoadingMore(true);
    getCdekPvz(cityCode, page + 1)
      .then((result) => {
        setPvzList((prev) => [...(prev ?? []), ...result.items]);
        setHasMore(result.hasMore);
        setPage((p) => p + 1);
      })
      .finally(() => setLoadingMore(false));
  };

  return (
    <List>
      <Section header="Способ доставки">
        <SegmentedControl>
          {CARRIERS.map((c) => (
            <SegmentedControl.Item key={c.key} selected={carrier === c.key} onClick={() => onSelectCarrier(c.key)}>
              {c.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </Section>
      <Section header="Пункт выдачи">
        {!cityReady ? (
          <Placeholder description="Сначала выберите город выше" />
        ) : pvzList === null ? (
          <Spinner size="m" />
        ) : pvzList.length === 0 ? (
          <Cell subtitle="Список пуст, попробуйте другой город или перевозчика">Нет доступных ПВЗ</Cell>
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
      </Section>
    </List>
  );
};
