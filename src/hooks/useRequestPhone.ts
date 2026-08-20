import { requestContact } from '@telegram-apps/sdk-react';
import { useCallback, useState } from 'react';

import { postPhone } from '@/api/auth.ts';
import type { UserProfile } from '@/api/types.ts';

export function useRequestPhone(onSuccess: (user: UserProfile) => void) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async () => {
    if (!requestContact.isAvailable()) {
      setError('Запрос телефона недоступен в этом окружении Telegram');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const contact = await requestContact();
      const user = await postPhone({
        user_id: contact.contact.user_id,
        phone_number: contact.contact.phone_number,
        first_name: contact.contact.first_name,
        last_name: contact.contact.last_name,
      });
      onSuccess(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onSuccess]);

  return { request, loading, error };
}
