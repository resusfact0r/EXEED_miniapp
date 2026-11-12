import { Button, Cell, Placeholder, Section } from '@telegram-apps/telegram-ui';
import { openLink } from '@telegram-apps/sdk-react';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { legalUrl } from '@/api/legal.ts';
import { ConsentCheckbox } from '@/components/ConsentCheckbox/ConsentCheckbox.tsx';
import { useLegal } from '@/hooks/useLegal.ts';
import { useAuth } from '@/contexts/AuthContext.tsx';
import { useConsent } from '@/hooks/useConsent.ts';
import { useRequestPhone } from '@/hooks/useRequestPhone.ts';

const BRANDS = ['CHERY', 'EXEED', 'OMODA', 'JAECOO'];

export const WelcomePage: FC = () => {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const { request, loading, error, hint } = useRequestPhone((user) => {
    setUser(user);
    navigate('/catalog', { replace: true });
  });
  const consent = useConsent();
  const seller = useLegal()?.seller;

  const sharePhone = async () => {
    if (await consent.accept()) {
      await request();
    }
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Section header="EXEED Friends — запчасти CHERY, EXEED, OMODA, JAECOO">
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            Ищем и подбираем оригинальные и аналоговые запчасти по артикулу прямо в Telegram —
            без звонков и переписки с менеджерами.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {BRANDS.map((brand) => (
              <span
                key={brand}
                style={{
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'var(--tgui--secondary_bg_color)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {brand}
              </span>
            ))}
          </div>
          <div>
            Как это работает: находите деталь по артикулу или названию → кладёте в корзину →
            выбираете самовывоз или доставку СДЭК/Яндекс → оплачиваете. Актуальность цены и
            наличия всегда проверяется у поставщика перед оформлением.
          </div>
        </div>
      </Section>
      {seller && (
        <Section header="Продавец">
          <Cell multiline subtitle={`${seller.ogrnLabel} ${seller.ogrn}, ИНН ${seller.inn}`}>
            {seller.name}
          </Cell>
          <Cell subtitle="Откроется в браузере" onClick={() => openLink(legalUrl('terms'))}>
            Условия продажи и возврата
          </Cell>
          <Cell subtitle="Откроется в браузере" onClick={() => openLink(legalUrl('privacy'))}>
            Политика обработки персональных данных
          </Cell>
        </Section>
      )}
      {consent.needed && <ConsentCheckbox checked={consent.checked} onChange={consent.setChecked} />}
      <Placeholder
        header="Начнём с номера телефона"
        description={error ?? consent.error ?? hint ?? 'Он нужен, чтобы мы могли связаться с вами по заказу.'}
        action={
          <Button size="l" loading={loading} disabled={!consent.canProceed} onClick={() => void sharePhone()}>
            Поделиться номером
          </Button>
        }
      />
      <Button mode="plain" onClick={() => navigate('/catalog')}>
        Пропустить и перейти в каталог
      </Button>
    </div>
  );
};
