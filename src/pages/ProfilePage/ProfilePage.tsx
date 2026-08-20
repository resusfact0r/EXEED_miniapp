import { Button, Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

import { useAuth } from '@/contexts/AuthContext.tsx';
import { useRequestPhone } from '@/hooks/useRequestPhone.ts';
import { Page } from '@/components/Page.tsx';
import { Link } from '@/components/Link/Link.tsx';

export const ProfilePage: FC = () => {
  const { user, loading, error, setUser } = useAuth();
  const { request, loading: requesting, error: requestError } = useRequestPhone(setUser);

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

        <Section header="Заказы">
          <Link to="/orders">
            <Cell subtitle="История и статусы ваших заказов">Мои заказы</Cell>
          </Link>
        </Section>
      </List>
    </Page>
  );
};
