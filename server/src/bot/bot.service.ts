import { Injectable, Logger } from '@nestjs/common';

import type { Order, User } from '@prisma/client';

import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { callTelegram } from './telegram-api';

// Statuses that are waiting on the operator, not on the customer or the warehouse.
const NEEDS_OPERATOR: Array<'NEW' | 'AWAITING_PAYMENT_LINK'> = ['NEW', 'AWAITING_PAYMENT_LINK'];
// Telegram caps a message at 4096 chars; cap the list well before that.
const QUEUE_LIMIT = 10;

const STATUS_LABELS: Record<string, string> = {
  NEW: 'новый',
  AWAITING_PAYMENT_LINK: 'ждёт ссылку на оплату',
  AWAITING_PAYMENT: 'ожидает оплаты',
  PAID: 'оплачен',
  IN_PROGRESS: 'в работе',
  COMPLETED: 'выполнен',
  CANCELLED: 'отменён',
};

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

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
      return;
    }

    // "/pay@exeed_friends_bot 12 https://..." is how commands arrive from a group chat.
    const [rawCommand, ...args] = text.split(/\s+/);
    const command = rawCommand.split('@')[0];
    if (command === '/pay') {
      await this.handlePay(chatId, args);
      return;
    }
    if (command === '/paid') {
      await this.handlePaid(chatId, args);
    }
  }

  private reply(chatId: number, text: string) {
    return callTelegram('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  }

  /** "/pay 12 https://..." - record the payment link and send it to the customer. */
  private async handlePay(chatId: number, args: string[]): Promise<void> {
    if (!this.isOperator(chatId)) {
      await this.reply(chatId, 'Эта команда доступна только операторам магазина.');
      return;
    }

    const orderNumber = Number(args[0]);
    const link = args[1];
    if (!Number.isInteger(orderNumber) || orderNumber <= 0 || !link) {
      await this.reply(chatId, 'Формат: /pay <номер заказа> <ссылка на оплату>\nНапример: /pay 12 https://pay.example.ru/abc');
      return;
    }
    // Telegram rejects the whole message if a url button isn't a real http(s) URL, and the
    // customer would get nothing - so validate before writing anything.
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      url = new URL('invalid:');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      await this.reply(chatId, `«${link}» не похоже на ссылку. Нужен адрес вида https://…`);
      return;
    }

    const result = await this.orders.issuePaymentLink(orderNumber, url.toString());
    if (!result.ok) {
      await this.reply(chatId, this.transitionError(orderNumber, result));
      return;
    }

    const order = result.order;
    const delivered = await this.notifyCustomer(order, {
      text: `Заказ №${order.orderNumber} на сумму ${this.money(order)} ждёт оплаты.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Оплатить', url: url.toString() }],
          [{ text: 'Открыть заказ', web_app: { url: this.orderUrl(order) } }],
        ],
      },
    });
    await this.reply(
      chatId,
      `Заказ №${order.orderNumber}: ссылка записана, статус «ожидает оплаты».\n` + this.deliveryReport(order, delivered),
    );
  }

  /** "/paid 12" - mark the order paid and tell the customer. */
  private async handlePaid(chatId: number, args: string[]): Promise<void> {
    if (!this.isOperator(chatId)) {
      await this.reply(chatId, 'Эта команда доступна только операторам магазина.');
      return;
    }

    const orderNumber = Number(args[0]);
    if (!Number.isInteger(orderNumber) || orderNumber <= 0) {
      await this.reply(chatId, 'Формат: /paid <номер заказа>\nНапример: /paid 12');
      return;
    }

    const result = await this.orders.markPaid(orderNumber);
    if (!result.ok) {
      await this.reply(chatId, this.transitionError(orderNumber, result));
      return;
    }

    const order = result.order;
    const delivered = await this.notifyCustomer(order, {
      text: `Оплата заказа №${order.orderNumber} получена. Спасибо! Сообщим, когда заказ будет готов.`,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть заказ', web_app: { url: this.orderUrl(order) } }]] },
    });
    await this.reply(chatId, `Заказ №${order.orderNumber} отмечен оплаченным.\n` + this.deliveryReport(order, delivered));
  }

  /**
   * A bot can only write to someone who has opened a chat with it. A customer who reached the
   * Mini App some other way never did, and Telegram answers 403 - the operator then has to call.
   */
  private async notifyCustomer(order: Order & { user: User }, message: Record<string, unknown>): Promise<boolean> {
    const result = await callTelegram('sendMessage', { chat_id: order.user.telegramId.toString(), ...message });
    return Boolean(result?.ok);
  }

  private deliveryReport(order: Order & { user: User }, delivered: boolean): string {
    if (delivered) {
      return 'Клиенту отправлено сообщение.';
    }
    return `⚠️ Написать клиенту не удалось — он не запускал бота. Свяжитесь по телефону: ${order.user.phone ?? 'не указан'}.`;
  }

  private transitionError(
    orderNumber: number,
    result: { reason: 'not_found' } | { reason: 'wrong_status'; status: string },
  ): string {
    if (result.reason === 'not_found') {
      return `Заказа №${orderNumber} нет.`;
    }
    return `Заказ №${orderNumber} уже «${STATUS_LABELS[result.status] ?? result.status}» — для него это действие недоступно.`;
  }

  private money(order: Order): string {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(order.totalAmount));
  }

  private orderUrl(order: Order): string {
    // The Mini App uses a HashRouter, so deep links go after "#".
    return `${process.env.MINIAPP_URL ?? 'https://exeedbot.ru'}/#/orders/${order.id}`;
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
      lines.push('/pay <номер> <ссылка> — выставить оплату и отправить ссылку клиенту');
      lines.push('/paid <номер> — отметить заказ оплаченным');
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
