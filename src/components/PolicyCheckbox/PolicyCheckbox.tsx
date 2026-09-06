import { Cell, Checkbox, Section } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

interface PolicyCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const PolicyCheckbox: FC<PolicyCheckboxProps> = ({ checked, onChange }) => {
  return (
    <Section>
      {/* Wrapping everything in a single <label> means a click anywhere in the row - text or
          the checkbox graphic itself - toggles the native input. Two separate handlers (Cell's
          onClick plus the Checkbox's own onChange) raced/didn't reliably both fire, which is why
          clicking directly on the checkbox previously did nothing. */}
      <label style={{ display: 'block', cursor: 'pointer' }}>
        <Cell before={<Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />} multiline>
          Я подтверждаю, что заказанные запчасти возврату не подлежат
        </Cell>
      </label>
    </Section>
  );
};
