import { Badge } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

interface CartBadgeProps {
  count: number;
}

export const CartBadge: FC<CartBadgeProps> = ({ count }) => {
  if (count <= 0) {
    return null;
  }
  return <Badge type="number" mode="critical">{count}</Badge>;
};
