import { Tabbar } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useCart } from '@/contexts/CartContext.tsx';
import { CartBadge } from '@/components/CartBadge/CartBadge.tsx';

const TABS = [
  { path: '/catalog', label: 'Каталог', icon: '📦' },
  { path: '/cart', label: 'Корзина', icon: '🛒' },
  { path: '/orders', label: 'Заказы', icon: '📋' },
  { path: '/profile', label: 'Профиль', icon: '👤' },
];

export const AppTabbar: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { itemCount } = useCart();

  return (
    <Tabbar>
      {TABS.map((tab) => (
        <Tabbar.Item
          key={tab.path}
          text={tab.label}
          selected={location.pathname.startsWith(tab.path)}
          onClick={() => navigate(tab.path)}
        >
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            {tab.path === '/cart' && (
              <span style={{ position: 'absolute', top: -6, right: -10 }}>
                <CartBadge count={itemCount} />
              </span>
            )}
          </div>
        </Tabbar.Item>
      ))}
    </Tabbar>
  );
};
