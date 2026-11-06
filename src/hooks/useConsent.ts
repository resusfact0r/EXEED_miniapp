import { useState } from 'react';

import { postConsent } from '@/api/auth.ts';
import { useAuth } from '@/contexts/AuthContext.tsx';
import { useLegal } from '@/hooks/useLegal.ts';

/** The personal data consent: asked for once, before the phone number is shared. */
export function useConsent() {
  const { user, setUser } = useAuth();
  const legal = useLegal();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needed = Boolean(legal?.configured && !user?.hasConsent);

  /** Records the consent if it's still needed. False if it couldn't be saved. */
  const accept = async (): Promise<boolean> => {
    if (!needed) return true;
    setError(null);
    try {
      setUser(await postConsent());
      return true;
    } catch {
      setError('Не удалось сохранить согласие. Попробуйте ещё раз.');
      return false;
    }
  };

  return { loading: legal === null, needed, checked, setChecked, accept, error, canProceed: !needed || checked };
}
