import { createContext, useContext, useMemo, type FC, type PropsWithChildren } from 'react';

import { useAuthBootstrap } from '@/hooks/useAuthBootstrap.ts';
import type { UserProfile } from '@/api/types.ts';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  hasPhone: boolean;
  setUser: (user: UserProfile) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: FC<PropsWithChildren> = ({ children }) => {
  const { user, loading, error, setUser } = useAuthBootstrap();

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, error, hasPhone: Boolean(user?.hasPhone), setUser }),
    [user, loading, error, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
