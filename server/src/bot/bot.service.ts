import { Injectable, Logger } from '@nestjs/common';

import { callTelegram } from './telegram-api';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  // Typed as a loose Record rather than a strict Update interface: this is Telegram's payload,
  // not ours, and NestJS's global ValidationPipe (whitelist + forbidNonWhitelisted) would reject
  // fields we don't declare if this were a class-validator DTO - easier to just read defensively.
  async handleUpdate(update: Record<string, unknown>): Promise<void> {
    const message = update.message as { text?: string; chat?: { id?: number } } | undefined;
    const text = message?.text;
    const chatId = message?.chat?.id;
    if (!chatId || !text) {
      return;
    }

    // Telegram appends a deep-link payload as "/start <payload>" - we don't use payloads yet,
    // so just match on the command itself.
    if (text === '/start' || text.startsWith('/start ')) {
      await this.sendStartMessage(chatId);
    }
  }

  private async sendStartMessage(chatId: number): Promise<void> {
    const miniAppUrl = process.env.MINIAPP_URL ?? 'https://exeedbot.ru';

    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'Запчасти CHERY, EXEED, OMODA и JAECOO — подбор по артикулу прямо здесь, в Telegram.',
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть каталог', web_app: { url: miniAppUrl } }]],
      },
    });
  }
}
