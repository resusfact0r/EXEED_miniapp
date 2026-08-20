import { Button, Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import type { FC, PropsWithChildren } from 'react';

import { useAuth } from '@/contexts/AuthContext.tsx';
import { useRequestPhone } from '@/hooks/useRequestPhone.ts';

export const PhoneGate: FC<PropsWithChildren> = ({ children }) => {
  const { hasPhone, loading, setUser } = useAuth();
  const { request, loading: requesting, error } = useRequestPhone(setUser);

  if (loading) {
    return <Spinner size="m" />;
  }

  if (hasPhone) {
    return <>{children}</>;
  }

  return (
    <Placeholder
      header="Нужен номер телефона"
      description={error ?? 'Чтобы оформить заказ, поделитесь номером телефона для связи.'}
      action={
        <Button size="l" loading={requesting} onClick={() => void request()}>
          Поделиться номером
        </Button>
      }
    />
  );
};
