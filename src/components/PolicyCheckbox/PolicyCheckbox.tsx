import { Cell, Checkbox, Section } from '@telegram-apps/telegram-ui';
import { openLink } from '@telegram-apps/sdk-react';
import type { FC } from 'react';

import { legalUrl } from '@/api/legal.ts';
import { useLegal } from '@/hooks/useLegal.ts';

interface PolicyCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const PolicyCheckbox: FC<PolicyCheckboxProps> = ({ checked, onChange }) => {
  const legal = useLegal();

  return (
    <Section>
      {/* Wrapping everything in a single <label> means a click anywhere in the row - text or
          the checkbox graphic itself - toggles the native input. Two separate handlers (Cell's
          onClick plus the Checkbox's own onChange) raced/didn't reliably both fire, which is why
          clicking directly on the checkbox previously did nothing. */}
      <label style={{ display: 'block', cursor: 'pointer' }}>
        <Cell before={<Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />} multiline>
          Согласен с условиями покупки. Запчасть надлежащего качества можно вернуть в течение 7 дней
          после получения, если сохранены товарный вид и упаковка
        </Cell>
      </label>
      {legal?.configured && (
        <Cell subtitle="Откроется в браузере" onClick={() => openLink(legalUrl('terms'))}>
          Условия покупки и возврата
        </Cell>
      )}
    </Section>
  );
};
