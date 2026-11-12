import { Button, Placeholder } from '@telegram-apps/telegram-ui';
import { closeMiniApp } from '@telegram-apps/sdk-react';
import { useEffect, useState, type FC } from 'react';

import { SESSION_REJECTED_EVENT, launchedFresh } from '@/helpers/launchFreshness.ts';

/**
 * Covers the app when the server refuses the Telegram session. Without it every screen just fails
 * on its own ("Invalid Telegram init data", an empty catalog), and nobody knows that the fix is to
 * close this window for real and open the shop again from the bot.
 */
export const SessionRejected: FC = () => {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onRejected = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener(SESSION_REJECTED_EVENT, onRejected);
    return () => window.removeEventListener(SESSION_REJECTED_EVENT, onRejected);
  }, []);

  if (message === null) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--tgui--bg_color)',
      }}
    >
      <Placeholder
        header="Откройте приложение заново"
        description={
          launchedFresh
            ? message
            : 'Telegram открыл старое окно приложения. Нажмите «Закрыть», затем откройте магазин в чате с ботом кнопкой «Каталог».'
        }
        action={
          <Button size="l" onClick={() => closeMiniApp.ifAvailable()}>
            Закрыть
          </Button>
        }
      />
    </div>
  );
};
