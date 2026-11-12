import { Button, Cell, Section } from '@telegram-apps/telegram-ui';
import { openTelegramLink } from '@telegram-apps/sdk-react';
import type { FC } from 'react';

import { useLegal } from '@/hooks/useLegal.ts';

const open = (username: string) => openTelegramLink.ifAvailable(`https://t.me/${username}`);

/** "Написать менеджеру" - the shop's person in Telegram (SUPPORT_TELEGRAM on the server). */
export const SupportCell: FC = () => {
  const support = useLegal()?.support;
  if (!support) return null;
  return (
    <Section header="Поддержка">
      <Cell subtitle={`@${support} в Telegram`} onClick={() => open(support)}>
        Написать менеджеру
      </Cell>
    </Section>
  );
};

export const SupportButton: FC = () => {
  const support = useLegal()?.support;
  if (!support) return null;
  return (
    <Button size="l" mode="plain" onClick={() => open(support)}>
      Написать менеджеру
    </Button>
  );
};
