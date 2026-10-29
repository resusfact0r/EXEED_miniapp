import { Badge } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

import type { OrderStatus } from '@/api/types.ts';

const STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Новый',
  AWAITING_PAYMENT_LINK: 'Ожидает ссылку на оплату',
  AWAITING_PAYMENT: 'Ожидает оплаты',
  PAID: 'Оплачен',
  IN_PROGRESS: 'В работе',
  READY_FOR_PICKUP: 'Готов к выдаче',
  SHIPPED: 'Отправлен',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
};

const STATUS_MODES: Record<OrderStatus, 'primary' | 'critical' | 'secondary' | 'gray'> = {
  NEW: 'primary',
  AWAITING_PAYMENT_LINK: 'secondary',
  AWAITING_PAYMENT: 'secondary',
  PAID: 'primary',
  IN_PROGRESS: 'primary',
  READY_FOR_PICKUP: 'primary',
  SHIPPED: 'primary',
  COMPLETED: 'gray',
  CANCELLED: 'critical',
};

interface OrderStatusBadgeProps {
  status: OrderStatus;
}

export const OrderStatusBadge: FC<OrderStatusBadgeProps> = ({ status }) => {
  return (
    <Badge type="number" mode={STATUS_MODES[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
};
