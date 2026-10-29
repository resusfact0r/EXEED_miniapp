import { Section, Textarea } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

// Same limit as the backend (server/src/orders/dto/create-order.dto.ts).
const MAX_LENGTH = 1500;

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
        maxLength={MAX_LENGTH}
        onChange={(e) => onChange(e.target.value)}
      />
    </Section>
  );
};
