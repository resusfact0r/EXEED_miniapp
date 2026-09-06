import { Button, Cell, List, Placeholder, Section, SegmentedControl, Spinner } from '@telegram-apps/telegram-ui';
import { useState, type FC } from 'react';

import { patchPreferences } from '@/api/auth.ts';
import type { DeliveryCarrier, FulfillmentType, PaymentMethod } from '@/api/types.ts';
import { useAuth } from '@/contexts/AuthContext.tsx';
import { useRequestPhone } from '@/hooks/useRequestPhone.ts';
import { Page } from '@/components/Page.tsx';
import { Link } from '@/components/Link/Link.tsx';

export const ProfilePage: FC = () => {
  const { user, loading, error, setUser } = useAuth();
  const { request, loading: requesting, error: requestError } = useRequestPhone(setUser);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const savePreference = async (patch: {
    preferredFulfillmentType?: FulfillmentType;
    preferredDeliveryCarrier?: DeliveryCarrier;
    preferredPaymentMethod?: PaymentMethod;
  }) => {
    setSavingPrefs(true);
    try {
      const updated = await patchPreferences(patch);
      setUser(updated);
    } finally {
      setSavingPrefs(false);
    }
  };

  if (loading) {
    return (
      <Page back={false}>
        <Spinner size="m" />
      </Page>
    );
  }

  if (error || !user) {
    return (
      <Page back={false}>
        <Placeholder header="Не удалось загрузить профиль" description={error ?? undefined} />
      </Page>
    );
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени';

  return (
    <Page back={false}>
      <List>
        <Section header="Личный кабинет">
          <Cell subtitle="Имя">{fullName}</Cell>
          {user.username && <Cell subtitle="Username в Telegram">@{user.username}</Cell>}
          <Cell subtitle="Телефон">{user.phone ?? 'Не указан'}</Cell>
        </Section>

        <Section footer={requestError ?? undefined}>
          <div style={{ padding: 16 }}>
            <Button size="l" stretched loading={requesting} onClick={() => void request()}>
              {user.hasPhone ? 'Изменить номер телефона' : 'Поделиться номером телефона'}
            </Button>
          </div>
        </Section>

        <Section header="Настройки по умолчанию" footer="Подставляются при оформлении заказа, всегда можно изменить">
          <Cell subtitle="Способ получения">
            <SegmentedControl>
              <SegmentedControl.Item
                selected={user.preferredFulfillmentType === 'PICKUP'}
                disabled={savingPrefs}
                onClick={() => void savePreference({ preferredFulfillmentType: 'PICKUP' })}
              >
                Самовывоз
              </SegmentedControl.Item>
              <SegmentedControl.Item
                selected={user.preferredFulfillmentType === 'DELIVERY'}
                disabled={savingPrefs}
                onClick={() => void savePreference({ preferredFulfillmentType: 'DELIVERY' })}
              >
                Доставка
              </SegmentedControl.Item>
            </SegmentedControl>
          </Cell>
          <Cell subtitle="Перевозчик">
            <SegmentedControl>
              <SegmentedControl.Item
                selected={user.preferredDeliveryCarrier === 'CDEK'}
                disabled={savingPrefs}
                onClick={() => void savePreference({ preferredDeliveryCarrier: 'CDEK' })}
              >
                СДЭК
              </SegmentedControl.Item>
              <SegmentedControl.Item
                selected={user.preferredDeliveryCarrier === 'YANDEX'}
                disabled={savingPrefs}
                onClick={() => void savePreference({ preferredDeliveryCarrier: 'YANDEX' })}
              >
                Яндекс.Доставка
              </SegmentedControl.Item>
            </SegmentedControl>
          </Cell>
          <Cell subtitle="Способ оплаты">
            <SegmentedControl>
              <SegmentedControl.Item
                selected={user.preferredPaymentMethod === 'QR_LINK'}
                disabled={savingPrefs}
                onClick={() => void savePreference({ preferredPaymentMethod: 'QR_LINK' })}
              >
                QR-код
              </SegmentedControl.Item>
              <SegmentedControl.Item
                selected={user.preferredPaymentMethod === 'LEGAL_ENTITY'}
                disabled={savingPrefs}
                onClick={() => void savePreference({ preferredPaymentMethod: 'LEGAL_ENTITY' })}
              >
                Юр. лицо
              </SegmentedControl.Item>
            </SegmentedControl>
          </Cell>
        </Section>

        <Section header="Заказы">
          <Link to="/orders">
            <Cell subtitle="История и статусы ваших заказов">Мои заказы</Cell>
          </Link>
        </Section>
      </List>
    </Page>
  );
};
