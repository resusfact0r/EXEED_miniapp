import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { callTelegram } from './telegram-api';

// Statuses that are waiting on the operator, not on the customer or the warehouse.
const NEEDS_OPERATOR: Array<'NEW' | 'AWAITING_PAYMENT_LINK'> = ['NEW', 'AWAITING_PAYMENT_LINK'];
// Telegram caps a message at 4096 chars; cap the list well before that.
const QUEUE_LIMIT = 10;

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Typed as a loose Record rather than a strict Update interface: this is Telegram's payload,
  // not ours, and NestJS's global ValidationPipe (whitelist + forbidNonWhitelisted) would reject
  // fields we don't declare if this were a class-validator DTO - easier to just read defensively.
  async handleUpdate(update: Record<string, unknown>): Promise<void> {
    const message = update.message as { text?: string; chat?: { id?: number } } | undefined;
    const text = message?.text?.trim();
    const chatId = message?.chat?.id;
    if (!chatId || !text) {
      return;
    }

    // Telegram appends a deep-link payload as "/start <payload>" - we don't use payloads yet,
    // so just match on the command itself.
    if (text === '/start' || text.startsWith('/start ')) {
      await this.sendStartMessage(chatId);
      return;
    }

    if (text === '/help') {
      await this.sendHelp(chatId);
      return;
    }

    // Lets an operator find the chat id to put in ORDER_NOTIFY_CHAT_IDS without digging
    // through logs or the database.
    if (text === '/id') {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `ID этого чата: ${chatId}\n\nЧтобы сюда приходили новые заказы, добавьте его в ORDER_NOTIFY_CHAT_IDS в server/.env и перезапустите backend.`,
      });
      return;
    }

    if (text === '/queue') {
      await this.sendQueue(chatId);
    }
  }

  /**
   * The queue exposes order totals and customers' phone numbers, so it's restricted to the
   * operators configured for notifications - otherwise anyone who finds the bot could read
   * customer data.
   */
  private isOperator(chatId: number): boolean {
    return (process.env.ORDER_NOTIFY_CHAT_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(String(chatId));
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

  private async sendHelp(chatId: number): Promise<void> {
    const lines = [
      'Команды:',
      '',
      '/start — открыть каталог запчастей',
      '/help — эта справка',
    ];

    if (this.isOperator(chatId)) {
      lines.push('');
      lines.push('Для оператора:');
      lines.push('/queue — заказы, ожидающие действий');
      lines.push('/id — идентификатор этого чата');
    }

    await callTelegram('sendMessage', { chat_id: chatId, text: lines.join('\n') });
  }

  private async sendQueue(chatId: number): Promise<void> {
    if (!this.isOperator(chatId)) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: 'Эта команда доступна только операторам магазина.',
      });
      return;
    }

    try {
      const [pending, awaitingPayment] = await Promise.all([
        this.prisma.order.findMany({
          where: { status: { in: NEEDS_OPERATOR } },
          include: { user: true },
          orderBy: { orderNumber: 'asc' },
        }),
        this.prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } }),
      ]);

      if (pending.length === 0) {
        const tail = awaitingPayment > 0 ? `\n\nЖдут оплаты клиентом: ${awaitingPayment}` : '';
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: `Очередь пуста — все заказы обработаны.${tail}`,
        });
        return;
      }

      const lines = [`📋 Ожидают ссылку на оплату: ${pending.length}`, ''];
      for (const order of pending.slice(0, QUEUE_LIMIT)) {
        const name = [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') || 'без имени';
        lines.push(`№${order.orderNumber} — ${order.totalAmount.toString()} ₽`);
        lines.push(`${name}, ${order.user?.phone ?? 'телефон не указан'}`);
        lines.push(order.id);
        lines.push('');
      }

      if (pending.length > QUEUE_LIMIT) {
        lines.push(`…и ещё ${pending.length - QUEUE_LIMIT}. Полный список: GET /api/admin/orders`);
      }
      if (awaitingPayment > 0) {
        lines.push(`Ждут оплаты клиентом: ${awaitingPayment}`);
      }

      await callTelegram('sendMessage', { chat_id: chatId, text: lines.join('\n') });
    } catch (err) {
      this.logger.error(`Failed to build queue for chat ${chatId}: ${(err as Error).message}`);
      await callTelegram('sendMessage', { chat_id: chatId, text: 'Не удалось получить очередь заказов.' });
    }
  }
}
