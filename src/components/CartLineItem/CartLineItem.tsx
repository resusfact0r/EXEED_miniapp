import { Cell, IconButton } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

import type { CartLine } from '@/api/types.ts';
import { QuantityStepper } from '@/components/QuantityStepper/QuantityStepper.tsx';

interface CartLineItemProps {
  line: CartLine;
  onChangeQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}

export const CartLineItem: FC<CartLineItemProps> = ({ line, onChangeQuantity, onRemove }) => {
  return (
    <Cell
      subtitle={`${line.product.price} ₽ × ${line.quantity} = ${line.lineTotal} ₽`}
      description={
        line.priceChanged ? (
          <span style={{ color: 'var(--tgui--destructive_text_color)' }}>
            Цена изменилась: было {line.priceAtAdd} ₽, стало {line.product.price} ₽
          </span>
        ) : undefined
      }
      after={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <QuantityStepper
            value={line.quantity}
            max={Math.min(10, line.product.stockQty || 10)}
            onChange={(next) => onChangeQuantity(line.productId, next)}
          />
          <IconButton mode="plain" onClick={() => onRemove(line.productId)}>
            ✕
          </IconButton>
        </div>
      }
    >
      {line.product.name}
    </Cell>
  );
};
