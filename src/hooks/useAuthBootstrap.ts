import { useCallback, useEffect, useState } from 'react';

import { postSession } from '@/api/auth.ts';
import type { UserProfile } from '@/api/types.ts';

interface AuthBootstrapState {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
}

export function useAuthBootstrap() {
  const [state, setState] = useState<AuthBootstrapState>({ user: null, loading: true, error: null });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const user = await postSession();
      setState({ user, loading: false, error: null });
    } catch (err) {
      setState({ user: null, loading: false, error: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setUser = useCallback((user: UserProfile) => {
    setState((prev) => ({ ...prev, user }));
  }, []);

  return { ...state, refresh, setUser };
}
