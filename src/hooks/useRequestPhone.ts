import { openTelegramLink } from '@telegram-apps/sdk-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getMe, requestPhoneInChat } from '@/api/auth.ts';
import type { UserProfile } from '@/api/types.ts';

const POLL_MS = 2000;
const WAIT_MS = 5 * 60 * 1000;

/**
 * Gets the customer's phone through the chat with the bot: the bot sends a "📱 Поделиться
 * номером" keyboard button, the chat opens, and this polls the profile until the number shows up.
 * Telegram's in-app phone request (requestContact) crashed the whole Telegram client on the
 * owner's phone, so it isn't used.
 */
export function useRequestPhone(onSuccess: (user: UserProfile) => void) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const request = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const before = await getMe();
      const { sent, botUsername } = await requestPhoneInChat();
      const chatLink = botUsername ? `https://t.me/${botUsername}` : null;
      if (!sent) {
        setError('Откройте чат с ботом, нажмите «Старт» и попробуйте ещё раз.');
        if (chatLink) openTelegramLink.ifAvailable(chatLink);
        return;
      }
      setHint('Мы прислали кнопку «📱 Поделиться номером» в чат с ботом — нажмите её и вернитесь сюда.');
      if (chatLink) openTelegramLink.ifAvailable(chatLink);
      setLoading(false);

      const deadline = Date.now() + WAIT_MS;
      while (alive.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const me = await getMe().catch(() => null);
        // A first number, or a changed one. Re-sending the same number leaves nothing to detect,
        // and that's fine: the profile already has it.
        if (me?.hasPhone && me.phone !== before.phone) {
          setHint(null);
          onSuccess(me);
          return;
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [onSuccess]);

  return { request, loading, error, hint };
}
