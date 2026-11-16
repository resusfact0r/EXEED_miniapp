import { shouldOpenMiniApp } from './web/launch';

// A browser visitor has no Telegram credentials: do not initialize Telegram mocks here.
if (shouldOpenMiniApp(window.location.href, window)) {
  await import('./telegram');
} else {
  const [{ createRoot }, { StrictMode }, { WebApp }] = await Promise.all([
    import('react-dom/client'), import('react'), import('./web/WebApp'),
  ]);
  createRoot(document.getElementById('root')!).render(<StrictMode><WebApp/></StrictMode>);
}
