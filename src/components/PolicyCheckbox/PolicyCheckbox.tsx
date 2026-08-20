import { Cell, Checkbox, Section } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

interface PolicyCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const PolicyCheckbox: FC<PolicyCheckboxProps> = ({ checked, onChange }) => {
  return (
    <Section>
      <Cell
        before={<Checkbox checked={checked} readOnly style={{ pointerEvents: 'none' }} />}
        onClick={() => onChange(!checked)}
        multiline
      >
        Я подтверждаю, что заказанные запчасти возврату не подлежат
      </Cell>
    </Section>
  );
};
