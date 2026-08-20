import { Section, Textarea } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

interface OrgCardTextareaProps {
  value: string;
  onChange: (value: string) => void;
}

export const OrgCardTextarea: FC<OrgCardTextareaProps> = ({ value, onChange }) => {
  return (
    <Section header="Реквизиты организации" footer="Укажите карточку организации в свободной форме: название, ИНН, банковские реквизиты и т.д.">
      <Textarea
        placeholder="ООО «Компания», ИНН, р/с, банк..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Section>
  );
};
