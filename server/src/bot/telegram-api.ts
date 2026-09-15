import { Logger } from '@nestjs/common';
import { ProxyAgent, type Dispatcher } from 'undici';

const logger = new Logger('TelegramApi');

let cachedDispatcher: Dispatcher | undefined;
let dispatcherResolved = false;

/**
 * api.telegram.org is blocked from some hosting providers (notably Russian ones - verified on
 * this project's VPS: api.cdek.ru and google.com respond, Telegram times out on both IPv4 and
 * IPv6). Setting TELEGRAM_PROXY_URL routes only Telegram traffic through an HTTP(S) proxy that
 * can reach it; everything else keeps going out directly.
 */
function getDispatcher(): Dispatcher | undefined {
  if (dispatcherResolved) {
    return cachedDispatcher;
  }
  dispatcherResolved = true;

  const proxyUrl = process.env.TELEGRAM_PROXY_URL;
  if (proxyUrl) {
    cachedDispatcher = new ProxyAgent(proxyUrl);
    logger.log(`Telegram API calls go through proxy ${new URL(proxyUrl).host}`);
  }
  return cachedDispatcher;
}

export interface TelegramApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/**
 * Calls a Bot API method. Returns null (and logs) on transport failure, so callers can treat
 * "Telegram unreachable" the same as "call failed" without try/catch at every site.
 */
export async function callTelegram<T>(
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<TelegramApiResult<T> | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN is not set');
    return null;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      // @ts-expect-error - undici's dispatcher option isn't in the DOM fetch typings Node reuses
      dispatcher: getDispatcher(),
    });

    const data = (await response.json()) as TelegramApiResult<T>;
    if (!data.ok) {
      logger.error(`${method} returned not-ok: ${data.description ?? 'no description'}`);
    }
    return data;
  } catch (err) {
    logger.error(`${method} request failed: ${(err as Error).message}`);
    return null;
  }
}
