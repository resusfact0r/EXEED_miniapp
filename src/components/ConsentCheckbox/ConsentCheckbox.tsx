import { Cell, Checkbox, Section } from '@telegram-apps/telegram-ui';
import { openLink } from '@telegram-apps/sdk-react';
import type { FC } from 'react';

import { legalUrl } from '@/api/legal.ts';

interface ConsentCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const ConsentCheckbox: FC<ConsentCheckboxProps> = ({ checked, onChange }) => {
  return (
    <Section>
      <label style={{ display: 'block', cursor: 'pointer' }}>
        <Cell before={<Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />} multiline>
          Даю согласие на обработку персональных данных
        </Cell>
      </label>
      <Cell subtitle="Откроется в браузере" onClick={() => openLink(legalUrl('consent'))}>
        Текст согласия
      </Cell>
      <Cell subtitle="Откроется в браузере" onClick={() => openLink(legalUrl('privacy'))}>
        Политика обработки данных
      </Cell>
    </Section>
  );
};
