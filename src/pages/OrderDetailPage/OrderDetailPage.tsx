import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';
import { useParams } from 'react-router-dom';

import { getOrder } from '@/api/orders.ts';
import type { Order } from '@/api/types.ts';
import { Page } from '@/components/Page.tsx';
import { OrderStatusBadge } from '@/components/OrderStatusBadge/OrderStatusBadge.tsx';

const FULFILLMENT_LABELS: Record<Order['fulfillmentType'], string> = {
  PICKUP: 'Самовывоз',
  DELIVERY: 'Доставка',
};

const PAYMENT_LABELS: Record<Order['paymentMethod'], string> = {
  QR_LINK: 'Оплата по QR-коду',
  LEGAL_ENTITY: 'Безналичная оплата (юр. лицо)',
};

export const OrderDetailPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getOrder(id)
      .then(setOrder)
      .catch((err) => setError((err as Error).message));
  }, [id]);

  if (error) {
    return (
      <Page>
        <Placeholder header="Не удалось загрузить заказ" description={error} />
      </Page>
    );
  }

  if (!order) {
    return (
      <Page>
        <Spinner size="m" />
      </Page>
    );
  }

  return (
    <Page>
      <List>
        <Section header={`Заказ №${order.orderNumber}`}>
          <Cell after={<OrderStatusBadge status={order.status} />}>Статус</Cell>
          <Cell subtitle={FULFILLMENT_LABELS[order.fulfillmentType]}>Способ получения</Cell>
          {order.fulfillmentType === 'PICKUP' && order.pickupAddressLabel && (
            <Cell subtitle={order.pickupAddressLabel}>Адрес самовывоза</Cell>
          )}
          {order.fulfillmentType === 'DELIVERY' && order.deliveryPvzAddress && (
            <Cell subtitle={order.deliveryPvzAddress}>{order.deliveryCarrier === 'CDEK' ? 'СДЭК' : 'Яндекс.Доставка'}</Cell>
          )}
          <Cell subtitle={PAYMENT_LABELS[order.paymentMethod]}>Способ оплаты</Cell>
          {order.paymentLink && (
            <Cell subtitle={order.paymentLink}>Ссылка на оплату</Cell>
          )}
        </Section>
        <Section header="Состав заказа" footer={`Итого: ${order.totalAmount} ₽`}>
          {order.items.map((item) => (
            <Cell key={item.id} subtitle={`${item.unitPrice} ₽ × ${item.quantity}`}>
              {item.productName} ({item.productCode})
            </Cell>
          ))}
        </Section>
      </List>
    </Page>
  );
};
