import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { BotService } from './bot.service';
import { callTelegram } from './telegram-api';

const LONG_POLL_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 5000;

interface TelegramUpdate {
  update_id: number;
  [key: string]: unknown;
}

/**
 * Pulls updates with getUpdates instead of receiving them over a webhook. Two reasons this is
 * the mode that actually works for this deployment:
 *   - a webhook needs Telegram to resolve and reach our domain, which it currently can't
 *     (verified: setWebhook fails with "Failed to resolve host" for exeedbot.ru while the same
 *     call succeeds for other domains);
 *   - polling only needs outbound access, which TELEGRAM_PROXY_URL provides.
 *
 * Disabled unless TELEGRAM_BOT_POLLING=true, so that without a working proxy the app doesn't
 * spin uselessly against a blocked endpoint and fill the logs with timeouts.
 */
@Injectable()
export class BotPollingService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BotPollingService.name);
  private offset = 0;
  private stopped = false;
  /** Last time Telegram answered a getUpdates - the watchdog's sign that the bot (and the proxy
   *  it depends on) is alive. Stays null while polling is disabled. */
  private lastOkAt: Date | null = null;
  private readonly startedAt = new Date();

  constructor(private readonly botService: BotService) {}

  onModuleInit() {
    if (process.env.TELEGRAM_BOT_POLLING !== 'true') {
      this.logger.log('Bot polling disabled (set TELEGRAM_BOT_POLLING=true to enable)');
      return;
    }
    this.logger.log('Bot polling enabled');
    void this.loop();
  }

  onApplicationShutdown() {
    this.stopped = true;
  }

  getStatus() {
    return {
      enabled: process.env.TELEGRAM_BOT_POLLING === 'true',
      startedAt: this.startedAt.toISOString(),
      lastOkAt: this.lastOkAt?.toISOString() ?? null,
    };
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const response = await callTelegram<TelegramUpdate[]>(
        'getUpdates',
        { offset: this.offset, timeout: LONG_POLL_TIMEOUT_SECONDS },
        // Has to outlast the long-poll window itself, or every request aborts early.
        (LONG_POLL_TIMEOUT_SECONDS + 10) * 1000,
      );

      if (!response?.ok || !response.result) {
        // Unreachable Telegram (no proxy, blocked network) or an API error - back off so we
        // don't hammer it in a tight loop.
        await this.sleep(RETRY_DELAY_MS);
        continue;
      }
      this.lastOkAt = new Date();

      for (const update of response.result) {
        this.offset = update.update_id + 1;
        try {
          await this.botService.handleUpdate(update);
        } catch (err) {
          this.logger.error(`Failed to handle update ${update.update_id}: ${(err as Error).message}`);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
