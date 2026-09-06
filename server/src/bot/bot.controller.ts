import { Body, Controller, HttpCode, Post, UnauthorizedException, Headers } from '@nestjs/common';

import { BotService } from './bot.service';

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  // Called by Telegram's servers directly (registered once via setWebhook), never by the Mini
  // App client - so this is intentionally NOT behind TelegramAuthGuard (there's no initData
  // here, just a Bot API Update object). Instead it's protected by the secret_token Telegram
  // echoes back on every webhook call, set at registration time (see DEPLOYMENT-VPS.md).
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() update: Record<string, unknown>,
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
  ) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected && secretToken !== expected) {
      throw new UnauthorizedException();
    }

    await this.botService.handleUpdate(update);
    return { ok: true };
  }
}
