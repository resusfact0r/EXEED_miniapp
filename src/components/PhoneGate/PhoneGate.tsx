import { Button, Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import type { FC, PropsWithChildren } from 'react';

import { ConsentCheckbox } from '@/components/ConsentCheckbox/ConsentCheckbox.tsx';
import { useAuth } from '@/contexts/AuthContext.tsx';
import { useConsent } from '@/hooks/useConsent.ts';
import { useRequestPhone } from '@/hooks/useRequestPhone.ts';

export const PhoneGate: FC<PropsWithChildren> = ({ children }) => {
  const { hasPhone, loading, setUser } = useAuth();
  const { request, loading: requesting, error, hint } = useRequestPhone(setUser);
  const consent = useConsent();

  if (loading || consent.loading) {
    return <Spinner size="m" />;
  }

  if (hasPhone && !consent.needed) {
    return <>{children}</>;
  }

  const proceed = async () => {
    if ((await consent.accept()) && !hasPhone) {
      await request();
    }
  };

  return (
    <>
      {consent.needed && <ConsentCheckbox checked={consent.checked} onChange={consent.setChecked} />}
      <Placeholder
        header={hasPhone ? 'Нужно ваше согласие' : 'Нужен номер телефона'}
        description={
          error ??
          consent.error ??
          hint ??
          (hasPhone
            ? 'Чтобы оформить заказ, дайте согласие на обработку персональных данных.'
            : 'Чтобы оформить заказ, поделитесь номером телефона для связи.')
        }
        action={
          <Button size="l" loading={requesting} disabled={!consent.canProceed} onClick={() => void proceed()}>
            {hasPhone ? 'Продолжить' : 'Поделиться номером'}
          </Button>
        }
      />
    </>
  );
};
