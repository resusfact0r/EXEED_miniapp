import { useMemo } from 'react';
import { Navigate, Route, Routes, HashRouter } from 'react-router-dom';
import { retrieveLaunchParams, useSignal, isMiniAppDark } from '@telegram-apps/sdk-react';
import { AppRoot } from '@telegram-apps/telegram-ui';

import { routes } from '@/navigation/routes.tsx';
import { AuthProvider } from '@/contexts/AuthContext.tsx';
import { CartProvider } from '@/contexts/CartContext.tsx';
import { CheckoutProvider } from '@/contexts/CheckoutContext.tsx';
import { AppTabbar } from '@/components/AppTabbar/AppTabbar.tsx';
import { SessionRejected } from '@/components/SessionRejected/SessionRejected.tsx';

export function App() {
  const lp = useMemo(() => retrieveLaunchParams(), []);
  const isDark = useSignal(isMiniAppDark);

  return (
    <AppRoot
      appearance={isDark ? 'dark' : 'light'}
      platform={['macos', 'ios'].includes(lp.tgWebAppPlatform) ? 'ios' : 'base'}
    >
      <HashRouter>
        <AuthProvider>
          <CartProvider>
            <CheckoutProvider>
              <div style={{ paddingBottom: 64 }}>
                <Routes>
                  {routes.map((route) => <Route key={route.path} {...route} />)}
                  <Route path="*" element={<Navigate to="/"/>}/>
                </Routes>
              </div>
              <AppTabbar />
              <SessionRejected />
            </CheckoutProvider>
          </CartProvider>
        </AuthProvider>
      </HashRouter>
    </AppRoot>
  );
}
