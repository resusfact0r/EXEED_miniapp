import { Button } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

import { MAX_QTY_PER_LINE } from '@/helpers/lineQuantity.ts';

interface QuantityStepperProps {
  value: number;
  /** Supplier lot size: each tap adds or removes a whole lot. */
  step?: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}

export const QuantityStepper: FC<QuantityStepperProps> = ({
  value,
  step = 1,
  min = step,
  max = MAX_QTY_PER_LINE,
  onChange,
}) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Button
        mode="outline"
        size="s"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </Button>
      <span style={{ minWidth: 24, textAlign: 'center' }}>{value}</span>
      <Button
        mode="outline"
        size="s"
        disabled={value + step > max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </Button>
    </div>
  );
};
