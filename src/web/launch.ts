declare global {
  interface Window {
    TelegramWebviewProxy?: unknown;
    TelegramWebviewProxyProto?: unknown;
    Telegram?: { WebApp?: { initData?: string } };
  }
}

export function shouldOpenMiniApp(url: string, environment: Pick<Window, 'TelegramWebviewProxy' | 'TelegramWebviewProxyProto' | 'Telegram'>) {
  const parsed = new URL(url);
  if (parsed.searchParams.get('web') === '1') return false;
  return parsed.searchParams.get('miniapp') === '1'
    || /(?:[?#&])tgWebApp(?:Data|Platform|Version)=/.test(url)
    || Boolean(environment.TelegramWebviewProxy || environment.TelegramWebviewProxyProto || environment.Telegram?.WebApp?.initData);
}
