import { Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';

import { SERVICE_DOWN_EVENT, serviceState } from '@/helpers/serviceStatus.ts';

const CHECK_EVERY_MS = 3000;
const HEALTH_URL = `${import.meta.env.VITE_API_BASE_URL as string}/health`;

/**
 * Covers the app while the server is unreachable - usually the few seconds of a backend restart
 * during a deploy - instead of every screen failing on its own. Checks the server every few
 * seconds and gets out of the way as soon as it answers.
 */
export const ServiceUnavailable: FC = () => {
  const [down, setDown] = useState(false);

  useEffect(() => {
    const onDown = () => setDown(true);
    window.addEventListener(SERVICE_DOWN_EVENT, onDown);
    return () => window.removeEventListener(SERVICE_DOWN_EVENT, onDown);
  }, []);

  useEffect(() => {
    if (!down) return;
    const timer = setInterval(() => {
      fetch(HEALTH_URL, { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) return;
          if (serviceState.everReached) {
            setDown(false);
          } else {
            // Nothing loaded at launch: start over now that the server is back.
            window.location.reload();
          }
        })
        .catch(() => undefined);
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [down]);

  if (!down) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--tgui--bg_color)',
      }}
    >
      <Placeholder
        header="Обновляем магазин"
        description="Это займёт несколько секунд — страница вернётся сама. Если не вернулась за минуту, проверьте интернет."
      >
        <Spinner size="l" />
      </Placeholder>
    </div>
  );
};
