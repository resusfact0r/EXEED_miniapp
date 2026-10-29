import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';
import { useParams } from 'react-router-dom';
import { openLink } from '@telegram-apps/sdk-react';

import { getOrder } from '@/api/orders.ts';
import type { Order } from '@/api/types.ts';
import { Page } from '@/components/Page.tsx';
import { OrderStatusBadge } from '@/components/OrderStatusBadge/OrderStatusBadge.tsx';
import { formatPrice } from '@/helpers/formatPrice.ts';
import { payableAmount } from '@/helpers/orderAmount.ts';

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
          {order.trackingNumber && (
            <Cell
              subtitle={order.deliveryCarrier === 'CDEK' ? 'Нажмите, чтобы отследить' : undefined}
              onClick={
                order.deliveryCarrier === 'CDEK'
                  ? () => openLink(`https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(order.trackingNumber!)}`)
                  : undefined
              }
            >
              Трек-номер: {order.trackingNumber}
            </Cell>
          )}
          {order.status === 'CANCELLED' && order.cancelReason && (
            <Cell multiline subtitle={order.cancelReason}>
              Причина отмены
            </Cell>
          )}
          <Cell subtitle={PAYMENT_LABELS[order.paymentMethod]}>Способ оплаты</Cell>
          {order.paymentLink && (
            // Rendered as a real link: inside Telegram's WebView plain text can't be tapped,
            // leaving the customer to select and copy a long URL by hand.
            <Cell
              subtitle="Нажмите, чтобы перейти к оплате"
              onClick={() => openLink(order.paymentLink!)}
            >
              Ссылка на оплату
            </Cell>
          )}
        </Section>
        <Section
          header="Состав заказа"
          footer={
            order.fulfillmentType === 'DELIVERY' && order.deliveryCost === null
              ? 'Стоимость доставки придёт вместе со ссылкой на оплату.'
              : undefined
          }
        >
          {order.items.map((item) => (
            <Cell key={item.id} subtitle={`${formatPrice(item.unitPrice)} × ${item.quantity}`}>
              {item.productName} ({item.productCode})
            </Cell>
          ))}
          {order.deliveryCost !== null && (
            <Cell after={<span style={{ whiteSpace: 'nowrap' }}>{formatPrice(order.deliveryCost)}</span>}>Доставка</Cell>
          )}
          <Cell after={<b style={{ whiteSpace: 'nowrap' }}>{formatPrice(payableAmount(order))}</b>}>
            {order.deliveryCost !== null ? 'К оплате' : order.fulfillmentType === 'DELIVERY' ? 'Итого за товары' : 'Итого'}
          </Cell>
        </Section>
      </List>
    </Page>
  );
};
