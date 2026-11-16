import { shouldOpenMiniApp } from './web/launch';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';

function StartupError() {
  return <main style={{ maxWidth: 520, margin: '12vh auto', padding: 24, fontFamily: 'Arial, sans-serif', lineHeight: 1.7 }}>
    <h1>Не удалось открыть каталог</h1>
    <p>Обновите страницу. Если ошибка повторится, поможем подобрать детали в Telegram.</p>
    <button onClick={() => location.reload()} style={{ padding: '12px 20px', cursor: 'pointer' }}>Обновить страницу</button>
    <p><a href="https://t.me/lapostal">Написать менеджеру</a></p>
  </main>;
}

// Do not await dynamic chunks at module scope. Rollup can place shared React/JSX helpers in
// this entry, so a chunk importing those helpers would wait for the entry that awaits it.
// Let this module finish evaluating before the asynchronous application startup finishes.
async function start() {
  if (shouldOpenMiniApp(window.location.href, window)) {
    await import('./telegram');
  } else {
    const { WebApp } = await import('./web/WebApp');
    createRoot(document.getElementById('root')!).render(
      <StrictMode><ErrorBoundary fallback={<StartupError/>}><WebApp/></ErrorBoundary></StrictMode>,
    );
  }
}

void start().catch((error: unknown) => {
  console.error('Application startup failed', error);
  createRoot(document.getElementById('root')!).render(<StartupError/>);
});
