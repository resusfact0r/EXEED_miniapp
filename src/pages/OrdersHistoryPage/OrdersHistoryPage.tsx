import { Button, Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useCallback, useEffect, useState, type FC } from 'react';

import { listOrders } from '@/api/orders.ts';
import type { Order } from '@/api/types.ts';
import { Page } from '@/components/Page.tsx';
import { Link } from '@/components/Link/Link.tsx';
import { OrderStatusBadge } from '@/components/OrderStatusBadge/OrderStatusBadge.tsx';
import { formatPrice } from '@/helpers/formatPrice.ts';
import { payableAmount } from '@/helpers/orderAmount.ts';

export const OrdersHistoryPage: FC = () => {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listOrders()
      .then(setOrders)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Page back={false}>
        <Placeholder header="Не удалось загрузить заказы" description={error}>
          <Button size="l" onClick={load}>
            Повторить
          </Button>
        </Placeholder>
      </Page>
    );
  }

  if (!orders) {
    return (
      <Page back={false}>
        <Spinner size="m" />
      </Page>
    );
  }

  if (orders.length === 0) {
    return (
      <Page back={false}>
        <Placeholder header="Заказов пока нет" description="Оформленные заказы появятся здесь" />
      </Page>
    );
  }

  return (
    <Page back={false}>
      <List>
        <Section header="Мои заказы">
          {orders.map((order) => (
            <Link key={order.id} to={`/orders/${order.id}`}>
              <Cell subtitle={formatPrice(payableAmount(order))} after={<OrderStatusBadge status={order.status} />}>
                Заказ №{order.orderNumber}
              </Cell>
            </Link>
          ))}
        </Section>
      </List>
    </Page>
  );
};
