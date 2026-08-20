import { Button } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

export const MAX_QTY_PER_LINE = 10;

interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}

export const QuantityStepper: FC<QuantityStepperProps> = ({
  value,
  min = 1,
  max = MAX_QTY_PER_LINE,
  onChange,
}) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Button
        mode="outline"
        size="s"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </Button>
      <span style={{ minWidth: 24, textAlign: 'center' }}>{value}</span>
      <Button
        mode="outline"
        size="s"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </Button>
    </div>
  );
};
