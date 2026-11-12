import { Button, Cell, List, Placeholder, Section, SegmentedControl, Spinner } from '@telegram-apps/telegram-ui';
import { openLink } from '@telegram-apps/sdk-react';
import { useEffect, useState, type FC } from 'react';

import { patchPreferences } from '@/api/auth.ts';
import { legalUrl } from '@/api/legal.ts';
import { getCarriers } from '@/api/delivery.ts';
import type { Carrier, DeliveryCarrier, FulfillmentType, PaymentMethod } from '@/api/types.ts';
import { useAuth } from '@/contexts/AuthContext.tsx';
import { useConsent } from '@/hooks/useConsent.ts';
import { useLegal } from '@/hooks/useLegal.ts';
import { useRequestPhone } from '@/hooks/useRequestPhone.ts';
import { ConsentCheckbox } from '@/components/ConsentCheckbox/ConsentCheckbox.tsx';
import { Page } from '@/components/Page.tsx';
import { Link } from '@/components/Link/Link.tsx';

export const ProfilePage: FC = () => {
  const { user, loading, error, setUser } = useAuth();
  const { request, loading: requesting, error: requestError, hint } = useRequestPhone(setUser);
  const consent = useConsent();
  const seller = useLegal()?.seller;
  const [savingPrefs, setSavingPrefs] = useState(false);
  // Same source as checkout, so the profile never offers a carrier the order flow won't show.
  const [carriers, setCarriers] = useState<Carrier[]>([]);

  useEffect(() => {
    void getCarriers().then(setCarriers).catch(() => undefined);
  }, []);

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

  const sharePhone = async () => {
    if (await consent.accept()) {
      await request();
    }
  };

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени';

  return (
    <Page back={false}>
      <List>
        <Section header="Личный кабинет">
          <Cell subtitle="Имя">{fullName}</Cell>
          {user.username && <Cell subtitle="Username в Telegram">@{user.username}</Cell>}
          <Cell subtitle="Телефон">{user.phone ?? 'Не указан'}</Cell>
        </Section>

        {consent.needed && <ConsentCheckbox checked={consent.checked} onChange={consent.setChecked} />}

        <Section footer={requestError ?? consent.error ?? hint ?? undefined}>
          <div style={{ padding: 16 }}>
            <Button size="l" stretched loading={requesting} disabled={!consent.canProceed} onClick={() => void sharePhone()}>
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
          {carriers.length > 1 && (
            <Cell subtitle="Перевозчик">
              <SegmentedControl>
                {carriers.map((c) => (
                  <SegmentedControl.Item
                    key={c.key}
                    selected={user.preferredDeliveryCarrier === c.key}
                    disabled={savingPrefs}
                    onClick={() => void savePreference({ preferredDeliveryCarrier: c.key })}
                  >
                    {c.label}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl>
            </Cell>
          )}
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

        {seller && (
          <Section header="О продавце">
            <Cell multiline subtitle={`${seller.ogrnLabel} ${seller.ogrn}, ИНН ${seller.inn}`}>
              {seller.name}
            </Cell>
            <Cell multiline subtitle="Адрес">
              {seller.address}
            </Cell>
            <Cell multiline subtitle="Связь">
              {[seller.contact, seller.phone].filter(Boolean).join(', ')}
            </Cell>
            <Cell onClick={() => openLink(legalUrl('terms'))}>Условия покупки и возврата</Cell>
            <Cell onClick={() => openLink(legalUrl('privacy'))}>Политика обработки данных</Cell>
          </Section>
        )}
      </List>
    </Page>
  );
};
