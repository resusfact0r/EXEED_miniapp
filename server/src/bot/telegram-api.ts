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

let botUsername: Promise<string | null> | undefined;

/** The bot's @username, asked once. A failed ask is retried next time. */
export function getBotUsername(): Promise<string | null> {
  if (!botUsername) {
    botUsername = callTelegram<{ username?: string }>('getMe', {}).then((r) => {
      const name = r?.ok ? (r.result?.username ?? null) : null;
      if (!name) botUsername = undefined;
      return name;
    });
  }
  return botUsername;
}

export interface TelegramApiResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// The proxy drops a few dozen requests a day. A sendMessage lost to that is an operator who never
// hears about an order, so transport failures are retried. A retry after a lost response can
// deliver a message twice, which beats not delivering it.
const RETRY_DELAYS_MS = [2000, 5000, 15000];

/**
 * Calls a Bot API method. Returns null (and logs) if Telegram stayed unreachable through the
 * retries, so callers can treat that as "call failed" without try/catch at every site. An answer
 * from Telegram, even a refusal, is returned as is. getUpdates isn't retried here: the polling
 * loop is its own retry.
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

  let result = await requestOnce<T>(token, method, payload, timeoutMs);
  if (method === 'getUpdates') {
    return result;
  }
  for (const delay of RETRY_DELAYS_MS) {
    if (result) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await requestOnce<T>(token, method, payload, timeoutMs);
  }
  return result;
}

async function requestOnce<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<TelegramApiResult<T> | null> {
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
