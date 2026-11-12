import { Button, Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getOrder } from '@/api/orders.ts';
import type { Order } from '@/api/types.ts';
import { Page } from '@/components/Page.tsx';
import { SupportButton } from '@/components/SupportLink/SupportLink.tsx';
import { formatPrice } from '@/helpers/formatPrice.ts';

export const OrderConfirmationPage: FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    getOrder(orderId)
      .then(setOrder)
      .catch((err) => setError((err as Error).message));
  }, [orderId]);

  if (error) {
    return (
      <Page back={false}>
        <Placeholder header="Не удалось загрузить заказ" description={error} />
      </Page>
    );
  }

  if (!order) {
    return (
      <Page back={false}>
        <Spinner size="m" />
      </Page>
    );
  }

  return (
    <Page back={false}>
      <Placeholder
        header={`Заказ №${order.orderNumber} оформлен`}
        description={
          order.fulfillmentType === 'DELIVERY'
            ? `Сумма за товары: ${formatPrice(order.totalAmount)}. Пришлём ссылку на оплату с точной стоимостью доставки.`
            : `Сумма: ${formatPrice(order.totalAmount)}. Пришлём ссылку на оплату в этот чат.`
        }
        action={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <Button size="l" onClick={() => navigate('/catalog')}>
              Вернуться в каталог
            </Button>
            <SupportButton />
          </div>
        }
      />
    </Page>
  );
};
