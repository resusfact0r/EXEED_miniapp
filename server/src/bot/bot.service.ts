import { Injectable, Logger } from '@nestjs/common';

import { Prisma, type Order, type User } from '@prisma/client';

import { PICKUP_ADDRESSES } from '../delivery/pickup-addresses';
import { getSeller, isSoleTrader } from '../legal/seller';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { PartLookupService } from './part-lookup.service';
import { callTelegram, getBotUsername, type TelegramApiResult } from './telegram-api';

// Statuses that are waiting on the operator, not on the customer or the warehouse.
const NEEDS_OPERATOR: Array<'NEW' | 'AWAITING_PAYMENT_LINK'> = ['NEW', 'AWAITING_PAYMENT_LINK'];
// Telegram caps a message at 4096 chars; cap the list well before that.
const QUEUE_LIMIT = 10;
const CARD_ITEMS_LIMIT = 30;

const STATUS_LABELS: Record<string, string> = {
  NEW: 'новый',
  AWAITING_PAYMENT_LINK: 'ждёт ссылку на оплату',
  AWAITING_PAYMENT: 'ожидает оплаты',
  PAID: 'оплачен',
  IN_PROGRESS: 'заказан у поставщика',
  READY_FOR_PICKUP: 'готов к выдаче',
  SHIPPED: 'отправлен',
  COMPLETED: 'выполнен',
  CANCELLED: 'отменён',
};

const CARRIER_LABELS: Record<string, string> = { CDEK: 'СДЭК', YANDEX: 'Яндекс.Доставку' };

// /pay and /paid take the delivery cost alone, and it's easy to type the order total there out of
// habit - the customer would then be asked to pay nearly double. A cost this large relative to
// the goods has to be confirmed. Below the floor it's ordinary delivery of a cheap part.
const DELIVERY_CONFIRM_SHARE = 0.5;
const DELIVERY_CONFIRM_FLOOR = 1000;
const CONFIRM_WORD = 'да';

// Statuses in which the order can still be marked paid.
const UNPAID_STATUSES = ['NEW', 'AWAITING_PAYMENT_LINK', 'AWAITING_PAYMENT'];

// Statuses in which the customer has already paid - cancelling then means refunding.
const PAID_STATUSES = ['PAID', 'IN_PROGRESS', 'READY_FOR_PICKUP'];

type TransitionFailure =
  | { reason: 'not_found' }
  | { reason: 'wrong_status'; status: string }
  | { reason: 'wrong_fulfillment'; fulfillmentType: string };
type TransitionResult =
  | ({ ok: false } & TransitionFailure)
  | { ok: true; order: Order & { user: User }; previousStatus: string };

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly parts: PartLookupService,
  ) {}

  /** The bot's own @username, to spot mentions of it. */
  private getUsername(): Promise<string | null> {
    return getBotUsername();
  }

  // Typed as a loose Record rather than a strict Update interface: this is Telegram's payload,
  // not ours, and NestJS's global ValidationPipe (whitelist + forbidNonWhitelisted) would reject
  // fields we don't declare if this were a class-validator DTO - easier to just read defensively.
  async handleUpdate(update: Record<string, unknown>): Promise<void> {
    const message = update.message as
      | {
          message_id?: number;
          text?: string;
          chat?: { id?: number; type?: string };
          from?: { id?: number; first_name?: string; last_name?: string; username?: string };
          contact?: { user_id?: number; phone_number?: string };
          reply_to_message?: { from?: { username?: string } };
        }
      | undefined;
    const text = message?.text?.trim();
    const chatId = message?.chat?.id;
    if (chatId && message?.contact && message.chat?.type === 'private') {
      await this.handleContact(chatId, message.from, message.contact);
      return;
    }
    if (!chatId || !text) {
      return;
    }

    // "/pay@e_PartsBot 12 https://..." is how commands arrive from a group chat; a deep
    // link arrives as "/start <payload>".
    const [rawCommand, ...args] = text.split(/\s+/);
    const command = rawCommand.split('@')[0];
    const isPrivate = message?.chat?.type === 'private';

    if (!text.startsWith('/')) {
      // A part question: tagging the bot in a group, replying to its message, or just writing to
      // it directly. A group in privacy mode doesn't pass plain mentions to bots - there /part
      // works, or the owner disables privacy in BotFather (see DEPLOYMENT-VPS.md).
      const username = (await this.getUsername())?.toLowerCase();
      const mentioned = Boolean(username && text.toLowerCase().includes(`@${username}`));
      const repliedToBot = Boolean(username && message?.reply_to_message?.from?.username?.toLowerCase() === username);
      if (isPrivate || mentioned || repliedToBot) {
        await this.answerPartQuestion(chatId, message?.message_id, text, isPrivate);
      }
      return;
    }

    switch (command) {
      case '/start':
        if (args[0]?.startsWith('p_')) {
          return this.sendProductLink(chatId, args[0].slice(2));
        }
        return this.sendStartMessage(chatId);
      case '/part':
        return this.answerPartQuestion(chatId, message?.message_id, args.join(' '), isPrivate);
      case '/help':
        return this.sendHelp(chatId);
      case '/about':
        return this.sendAbout(chatId);
      case '/id':
        // Lets an operator find the chat id to put in ORDER_NOTIFY_CHAT_IDS without digging
        // through logs or the database.
        await this.reply(
          chatId,
          `ID этого чата: ${chatId}\n\nЧтобы сюда приходили новые заказы, добавьте его в ORDER_NOTIFY_CHAT_IDS в server/.env и перезапустите backend.`,
        );
        return;
    }

    const operatorCommands: Record<string, (chatId: number, args: string[]) => Promise<void>> = {
      '/queue': (id) => this.sendQueue(id),
      '/order': (id, a) => this.handleOrderCard(id, a),
      '/pay': (id, a) => this.handlePay(id, a),
      '/paid': (id, a) => this.handlePaid(id, a),
      '/work': (id, a) => this.handleWork(id, a),
      '/ready': (id, a) => this.handleReady(id, a),
      '/ship': (id, a) => this.handleShip(id, a),
      '/done': (id, a) => this.handleDone(id, a),
      '/cancel': (id, a) => this.handleCancel(id, a),
    };
    const handler = operatorCommands[command];
    if (!handler) {
      return;
    }
    // The queue and order cards expose customers' phone numbers, and the rest change orders,
    // so all of this is limited to the operators configured for notifications.
    if (!this.isOperator(chatId)) {
      await this.reply(chatId, 'Эта команда доступна только операторам магазина.');
      return;
    }
    await handler(chatId, args);
  }

  /**
   * The answer to the "📱 Поделиться номером" button (AuthService.requestPhoneInChat). Only the
   * sender's own number is taken - Telegram marks it with their user_id - and only after the
   * personal data consent, when that's switched on.
   */
  private async handleContact(
    chatId: number,
    from: { id?: number; first_name?: string; last_name?: string; username?: string } | undefined,
    contact: { user_id?: number; phone_number?: string },
  ) {
    const removeKeyboard = { reply_markup: { remove_keyboard: true } };
    if (!from?.id || contact.user_id !== from.id || !contact.phone_number) {
      await callTelegram('sendMessage', { chat_id: chatId, text: 'Отправьте свой номер кнопкой «📱 Поделиться номером».' });
      return;
    }
    const telegramId = BigInt(from.id);
    const existing = await this.prisma.user.findUnique({ where: { telegramId } });
    if (getSeller() && !existing?.pdConsentAt) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: 'Сначала откройте приложение и дайте согласие на обработку персональных данных — номер сохраним после этого.',
        ...removeKeyboard,
      });
      return;
    }
    await this.prisma.user.upsert({
      where: { telegramId },
      update: { phone: contact.phone_number },
      create: {
        telegramId,
        phone: contact.phone_number,
        firstName: from.first_name,
        lastName: from.last_name,
        username: from.username,
      },
    });
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '✅ Номер сохранён. Можно вернуться в приложение.',
      ...removeKeyboard,
    });
  }

  /** Price and stock for the articles in `text`, as a reply to the asking message. */
  private async answerPartQuestion(chatId: number, messageId: number | undefined, text: string, isPrivate: boolean) {
    const replyTo = messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {};
    const articles = PartLookupService.extractArticles(text);
    if (articles.length === 0) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: 'Пришлите артикул, например: /part 501014147AA — подскажу цену и наличие. Можно несколько через пробел.',
        ...replyTo,
      });
      return;
    }

    let card;
    try {
      card = await this.parts.describe(articles);
    } catch (err) {
      this.logger.error(`Part lookup failed for ${articles.join(', ')}: ${(err as Error).message}`);
      await callTelegram('sendMessage', { chat_id: chatId, text: 'Не получилось проверить артикул, попробуйте чуть позже.', ...replyTo });
      return;
    }

    // A Mini App button only works in a private chat; in a group the button opens the private
    // chat with the bot, which then offers the product (see sendProductLink).
    const username = await this.getUsername();
    const buttons = card.orderable.map((p) =>
      isPrivate
        ? [{ text: `Открыть ${p.code}`, web_app: { url: this.productUrl(p.id) } }]
        : username
          ? [{ text: `Заказать ${p.code}`, url: `https://t.me/${username}?start=p_${p.id}` }]
          : null,
    ).filter(Boolean);

    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: card.text,
      disable_web_page_preview: true,
      ...replyTo,
      ...(buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  }

  /** "Заказать" from a group lands here, in the private chat, where the Mini App can open. */
  private async sendProductLink(chatId: number, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) {
      await this.sendStartMessage(chatId);
      return;
    }
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `🔧 ${product.code} — ${product.name}`,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть в каталоге', web_app: { url: this.productUrl(product.id) } }]] },
    });
  }

  private productUrl(productId: string): string {
    return `${process.env.MINIAPP_URL ?? 'https://exeedbot.ru'}/#/product/${productId}`;
  }

  private reply(chatId: number, text: string) {
    return callTelegram('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  }

  /** The order number from "/cmd 12 ...", or null after telling the operator the usage. */
  private async orderNumberArg(chatId: number, args: string[], usage: string): Promise<number | null> {
    const orderNumber = Number(args[0]);
    if (!Number.isInteger(orderNumber) || orderNumber <= 0) {
      await this.reply(chatId, `Формат: ${usage}`);
      return null;
    }
    return orderNumber;
  }

  /**
   * "/pay 12 https://..." for pickup, "/pay 12 450 https://..." for delivery - the delivery cost
   * is required there: the customer only saw an estimate, and pays goods + exact delivery here.
   */
  private async handlePay(chatId: number, args: string[]): Promise<void> {
    const usage = '/pay <номер> <ссылка> — самовывоз\n/pay <номер> <доставка, ₽> <ссылка> — доставка\nНапример: /pay 12 450 https://pay.example.ru/abc';
    const orderNumber = await this.orderNumberArg(chatId, args, usage);
    if (orderNumber === null) {
      return;
    }
    const confirmed = args[args.length - 1] === CONFIRM_WORD;
    const rest = confirmed ? args.slice(0, -1) : args;
    const link = rest.length >= 3 ? rest[2] : rest[1];
    const costArg = rest.length >= 3 ? rest[1] : undefined;
    if (!link) {
      await this.reply(chatId, `Формат:\n${usage}`);
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

    const deliveryCost = costArg === undefined ? null : this.parseDeliveryCost(costArg);
    if (costArg !== undefined && deliveryCost === null) {
      await this.reply(chatId, `«${costArg}» не похоже на стоимость доставки. Пример: /pay ${orderNumber} 450 https://…`);
      return;
    }

    const order = await this.prisma.order.findUnique({ where: { orderNumber } });
    if (order?.fulfillmentType === 'DELIVERY' && deliveryCost === null) {
      await this.reply(
        chatId,
        `Заказ №${orderNumber} с доставкой — укажите её стоимость (0, если бесплатно):\n/pay ${orderNumber} <доставка, ₽> ${link}`,
      );
      return;
    }
    if (order?.fulfillmentType === 'PICKUP' && deliveryCost !== null) {
      await this.reply(chatId, `Заказ №${orderNumber} — самовывоз, доставку указывать не нужно:\n/pay ${orderNumber} ${link}`);
      return;
    }
    // The last moment before taking the customer's money: anything that could cost us stops here.
    if (order && UNPAID_STATUSES.includes(order.status) && !confirmed) {
      const warnings = [
        ...(deliveryCost !== null && this.looksLikeOrderTotal(deliveryCost, order)
          ? [this.deliveryCostWarning(order, deliveryCost)]
          : []),
        ...(await this.supplierWarnings(orderNumber)),
      ];
      if (warnings.length > 0) {
        const command = ['/pay', orderNumber, costArg, link, CONFIRM_WORD].filter((part) => part !== undefined).join(' ');
        await this.reply(chatId, this.confirmPrompt(orderNumber, 'ссылка не отправлена', warnings, command));
        return;
      }
    }

    const result = await this.orders.issuePaymentLink(orderNumber, url.toString(), deliveryCost);
    await this.afterTransition(chatId, orderNumber, result, (o) => ({
      customer: {
        text: `✅ Заказ №${o.orderNumber} подтверждён и ждёт оплаты: ${this.amountBreakdown(o)}.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Оплатить', url: url.toString() }],
            [{ text: 'Открыть заказ', web_app: { url: this.orderUrl(o) } }],
          ],
        },
      },
      operator: `ссылка записана, к оплате ${this.money(this.payable(o))}`,
    }));
  }

  /**
   * "/paid 12" - the money has arrived. A delivery order paid without /pay (a legal entity's
   * invoice) has no delivery cost yet: "/paid 12 450" records it, so the order's total is right.
   */
  private async handlePaid(chatId: number, args: string[]): Promise<void> {
    const orderNumber = await this.orderNumberArg(
      chatId,
      args,
      '/paid <номер заказа>\n/paid <номер заказа> <доставка, ₽> — если оплата пришла без /pay\nНапример: /paid 12',
    );
    if (orderNumber === null) {
      return;
    }
    const confirmed = args[args.length - 1] === CONFIRM_WORD;
    const costArg = (confirmed ? args.slice(0, -1) : args)[1];
    const deliveryCost = costArg === undefined ? null : this.parseDeliveryCost(costArg);
    if (costArg !== undefined && deliveryCost === null) {
      await this.reply(chatId, `«${costArg}» не похоже на стоимость доставки. Пример: /paid ${orderNumber} 450`);
      return;
    }

    const order = await this.prisma.order.findUnique({ where: { orderNumber } });
    let beforeBuying: string[] = [];
    // Orders past this point get the usual "not available in this status" answer below.
    if (order && UNPAID_STATUSES.includes(order.status)) {
      if (order.fulfillmentType === 'PICKUP' && deliveryCost !== null) {
        await this.reply(chatId, `Заказ №${orderNumber} — самовывоз, доставку указывать не нужно:\n/paid ${orderNumber}`);
        return;
      }
      if (order.fulfillmentType === 'DELIVERY' && deliveryCost === null && order.deliveryCost === null) {
        await this.reply(
          chatId,
          `Заказ №${orderNumber} с доставкой, а её стоимость не указана, поэтому сумма заказа неполная.\n` +
            `Выставить оплату: /pay ${orderNumber} <доставка, ₽> <ссылка>\n` +
            `Если деньги уже пришли: /paid ${orderNumber} <доставка, ₽> (0, если бесплатно)`,
        );
        return;
      }
      if (deliveryCost !== null && !confirmed && this.looksLikeOrderTotal(deliveryCost, order)) {
        await this.reply(
          chatId,
          this.confirmPrompt(orderNumber, 'ничего не записано', [this.deliveryCostWarning(order, deliveryCost)], `/paid ${orderNumber} ${costArg} ${CONFIRM_WORD}`),
        );
        return;
      }
      // The money is in, so this doesn't stop anything: it's what to know before buying the parts.
      beforeBuying = await this.supplierWarnings(orderNumber);
    }

    const result = await this.orders.markPaid(orderNumber, deliveryCost);
    await this.afterTransition(chatId, orderNumber, result, (o) => ({
      customer: { text: `Оплата заказа №${o.orderNumber} получена. Спасибо! Сообщим, когда заказ будет готов.` },
      operator:
        `отмечен оплаченным (${this.amountBreakdown(o)}). Дальше: /work ${o.orderNumber}, когда закажете у поставщика` +
        (beforeBuying.length > 0 ? `.\n⚠️ Перед закупкой:\n${beforeBuying.join('\n')}` : ''),
    }));
  }

  /** "450", "450,50" -> the cost; anything else -> null. */
  private parseDeliveryCost(value: string): Prisma.Decimal | null {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? new Prisma.Decimal(parsed.toFixed(2)) : null;
  }

  private looksLikeOrderTotal(deliveryCost: Prisma.Decimal, order: Order): boolean {
    return deliveryCost.gte(DELIVERY_CONFIRM_FLOOR) && deliveryCost.gte(order.totalAmount.mul(DELIVERY_CONFIRM_SHARE));
  }

  private deliveryCostWarning(order: Order, deliveryCost: Prisma.Decimal): string {
    const total = order.totalAmount.add(deliveryCost);
    return (
      `• Доставка ${this.money(deliveryCost)} при товарах на ${this.money(order.totalAmount)}, всего выйдет ${this.money(total)}. ` +
      'Здесь указывается только стоимость доставки, а не сумма заказа.'
    );
  }

  /** What's changed at the supplier since the order was placed; empty if it still adds up. */
  private async supplierWarnings(orderNumber: number): Promise<string[]> {
    const { reachable, problems } = await this.orders.checkAgainstSupplier(orderNumber);
    if (!reachable) {
      return ['• Автолига сейчас не отвечает: цену и наличие проверить не удалось.'];
    }
    return problems.map((problem) => `• ${problem}`);
  }

  private confirmPrompt(orderNumber: number, outcome: string, warnings: string[], command: string): string {
    return [`⚠️ Заказ №${orderNumber}: ${outcome}.`, ...warnings, '', `Если всё верно, отправьте:\n${command}`].join('\n');
  }

  /** "/work 12" - ordered from the supplier. */
  private async handleWork(chatId: number, args: string[]): Promise<void> {
    const orderNumber = await this.orderNumberArg(chatId, args, '/work <номер заказа>');
    if (orderNumber === null) {
      return;
    }
    const result = await this.orders.startWork(orderNumber);
    await this.afterTransition(chatId, orderNumber, result, (o) => ({
      customer: { text: `Заказ №${o.orderNumber} в работе: детали заказаны у поставщика. Сообщим, когда заказ будет готов.` },
      operator:
        o.fulfillmentType === 'PICKUP'
          ? `в работе. Когда привезут: /ready ${o.orderNumber}`
          : `в работе. Когда отправите: /ship ${o.orderNumber} <трек-номер>`,
    }));
  }

  /** "/ready 12" - pickup order waiting at the pickup address. */
  private async handleReady(chatId: number, args: string[]): Promise<void> {
    const orderNumber = await this.orderNumberArg(chatId, args, '/ready <номер заказа>');
    if (orderNumber === null) {
      return;
    }
    const result = await this.orders.markReadyForPickup(orderNumber);
    await this.afterTransition(chatId, orderNumber, result, (o) => {
      const address = PICKUP_ADDRESSES.find((a) => a.code === o.pickupAddressCode);
      const lines = [`Заказ №${o.orderNumber} готов к выдаче.`];
      if (address) {
        lines.push(`Адрес: ${address.label}`);
      }
      if (address?.schedule) {
        lines.push(`Часы работы: ${address.schedule}`);
      }
      return {
        customer: { text: lines.join('\n') },
        operator: `готов к выдаче. После выдачи: /done ${o.orderNumber}`,
      };
    });
  }

  /** "/ship 12 1234567890" - delivery order handed to the carrier. */
  private async handleShip(chatId: number, args: string[]): Promise<void> {
    const usage = '/ship <номер заказа> <трек-номер>\nНапример: /ship 12 1234567890';
    const orderNumber = await this.orderNumberArg(chatId, args, usage);
    if (orderNumber === null) {
      return;
    }
    const trackingNumber = args[1];
    if (!trackingNumber) {
      await this.reply(chatId, `Укажите трек-номер.\nФормат: ${usage}`);
      return;
    }
    const result = await this.orders.markShipped(orderNumber, trackingNumber);
    await this.afterTransition(chatId, orderNumber, result, (o) => {
      const carrier = o.deliveryCarrier ? CARRIER_LABELS[o.deliveryCarrier] : 'службу доставки';
      const trackUrl = this.trackingUrl(o);
      return {
        customer: {
          text: `Заказ №${o.orderNumber} отправлен через ${carrier}.\nТрек-номер: ${trackingNumber}\nПункт выдачи: ${o.deliveryPvzAddress ?? '—'}`,
          ...(trackUrl ? { extraButtons: [[{ text: 'Отследить посылку', url: trackUrl }]] } : {}),
        },
        operator: `отправлен, трек ${trackingNumber}. После получения: /done ${o.orderNumber}`,
      };
    });
  }

  /** "/done 12" - collected or received. */
  private async handleDone(chatId: number, args: string[]): Promise<void> {
    const orderNumber = await this.orderNumberArg(chatId, args, '/done <номер заказа>');
    if (orderNumber === null) {
      return;
    }
    const result = await this.orders.complete(orderNumber);
    await this.afterTransition(chatId, orderNumber, result, (o) => ({
      customer: { text: `Заказ №${o.orderNumber} выполнен. Спасибо за покупку!` },
      operator: 'выполнен',
    }));
  }

  /** "/cancel 12 нет у поставщика" - the reason goes to the customer. */
  private async handleCancel(chatId: number, args: string[]): Promise<void> {
    const orderNumber = await this.orderNumberArg(chatId, args, '/cancel <номер заказа> [причина]\nНапример: /cancel 12 нет у поставщика');
    if (orderNumber === null) {
      return;
    }
    const reason = args.slice(1).join(' ').trim() || null;
    const result = await this.orders.cancel(orderNumber, reason);
    await this.afterTransition(chatId, orderNumber, result, (o, previousStatus) => {
      const wasPaid = PAID_STATUSES.includes(previousStatus);
      const lines = [`Заказ №${o.orderNumber} отменён.`];
      if (reason) {
        lines.push(`Причина: ${reason}`);
      }
      if (wasPaid) {
        lines.push('Деньги вернём — оператор свяжется с вами.');
      }
      return {
        customer: { text: lines.join('\n') },
        operator: wasPaid
          ? `отменён. ⚠️ Заказ был оплачен — верните клиенту ${this.money(this.payable(o))}`
          : 'отменён',
      };
    });
  }

  /**
   * Shared tail of every order command: report a refused transition, or tell the customer and
   * confirm to the operator (with the customer's phone if the customer can't be reached).
   */
  private async afterTransition(
    chatId: number,
    orderNumber: number,
    result: TransitionResult,
    build: (
      order: Order & { user: User },
      previousStatus: string,
    ) => {
      customer: { text: string; reply_markup?: Record<string, unknown>; extraButtons?: Array<Array<Record<string, unknown>>> };
      operator: string;
    },
  ): Promise<void> {
    if (!result.ok) {
      await this.reply(chatId, this.transitionError(orderNumber, result));
      return;
    }
    const order = result.order;
    const { customer, operator } = build(order, result.previousStatus);
    const { extraButtons, reply_markup, ...message } = customer;
    const delivery = await this.notifyCustomer(order, {
      ...message,
      reply_markup: reply_markup ?? {
        inline_keyboard: [...(extraButtons ?? []), [{ text: 'Открыть заказ', web_app: { url: this.orderUrl(order) } }]],
      },
    });
    await this.reply(chatId, `Заказ №${order.orderNumber}: ${operator}.\n` + this.deliveryReport(order, delivery));
  }

  /**
   * A bot can only write to someone who has opened a chat with it. A customer who reached the
   * Mini App some other way never did, and Telegram answers 403 - the operator then has to call.
   */
  private notifyCustomer(order: Order & { user: User }, message: Record<string, unknown>) {
    return callTelegram('sendMessage', { chat_id: order.user.telegramId.toString(), ...message });
  }

  private deliveryReport(order: Order & { user: User }, delivery: TelegramApiResult<unknown> | null): string {
    if (delivery?.ok) {
      return 'Клиенту отправлено сообщение.';
    }
    const call = `Свяжитесь по телефону: ${order.user.phone ?? 'не указан'}.`;
    if (!delivery) {
      return `⚠️ Сообщение клиенту не ушло: нет связи с Telegram. ${call}`;
    }
    if (delivery.error_code === 403) {
      return `⚠️ Написать клиенту не удалось — он не запускал бота или заблокировал его. ${call}`;
    }
    return `⚠️ Telegram не принял сообщение клиенту: ${delivery.description ?? 'без описания'}. ${call}`;
  }

  private transitionError(orderNumber: number, failure: TransitionFailure): string {
    if (failure.reason === 'not_found') {
      return `Заказа №${orderNumber} нет.`;
    }
    if (failure.reason === 'wrong_fulfillment') {
      return failure.fulfillmentType === 'PICKUP'
        ? `Заказ №${orderNumber} — самовывоз: вместо /ship используйте /ready ${orderNumber}.`
        : `Заказ №${orderNumber} — с доставкой: вместо /ready используйте /ship ${orderNumber} <трек-номер>.`;
    }
    return `Заказ №${orderNumber} сейчас «${STATUS_LABELS[failure.status] ?? failure.status}» — для него это действие недоступно. Подробности: /order ${orderNumber}`;
  }

  /** "/order 12" - everything about one order, including how it got to its current status. */
  private async handleOrderCard(chatId: number, args: string[]): Promise<void> {
    const orderNumber = await this.orderNumberArg(chatId, args, '/order <номер заказа>');
    if (orderNumber === null) {
      return;
    }
    const order = await this.orders.getOperatorCard(orderNumber);
    if (!order) {
      await this.reply(chatId, `Заказа №${orderNumber} нет.`);
      return;
    }

    const user = order.user;
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'без имени';
    const lines = [
      `Заказ №${order.orderNumber} — ${STATUS_LABELS[order.status] ?? order.status}`,
      '',
      `Клиент: ${name}${user.username ? ` (@${user.username})` : ''}, ${user.phone ?? 'телефон не указан'}`,
    ];
    if (order.fulfillmentType === 'PICKUP') {
      lines.push(`Самовывоз: ${order.pickupAddressLabel ?? '—'}`);
    } else {
      lines.push(`Доставка ${order.deliveryCarrier ? CARRIER_LABELS[order.deliveryCarrier] : ''}: ${order.deliveryPvzAddress ?? '—'}`);
      if (order.trackingNumber) {
        lines.push(`Трек-номер: ${order.trackingNumber}`);
      }
    }
    lines.push(`Оплата: ${order.paymentMethod === 'LEGAL_ENTITY' ? 'безнал (юр. лицо)' : 'по ссылке'}`);
    if (order.orgCardDetails) {
      lines.push(`Реквизиты: ${order.orgCardDetails.slice(0, 500)}`);
    }
    lines.push(`Сумма: ${this.amountBreakdown(order)}`);
    if (order.paymentLink) {
      lines.push(`Ссылка: ${order.paymentLink}`);
    }
    if (order.cancelReason) {
      lines.push(`Причина отмены: ${order.cancelReason}`);
    }

    lines.push('', 'Состав:');
    for (const item of order.items.slice(0, CARD_ITEMS_LIMIT)) {
      lines.push(`• ${item.productCode} — ${item.productName} × ${item.quantity} по ${this.money(item.unitPrice)}`);
    }
    if (order.items.length > CARD_ITEMS_LIMIT) {
      lines.push(`…и ещё ${order.items.length - CARD_ITEMS_LIMIT} позиций`);
    }

    lines.push('', 'История:');
    for (const change of order.statusChanges) {
      const note = change.note ? ` (${change.note})` : '';
      lines.push(`${this.moscowTime(change.createdAt)} — ${STATUS_LABELS[change.status] ?? change.status}${note}`);
    }
    if (order.statusChanges.length === 0) {
      lines.push(`${this.moscowTime(order.createdAt)} — оформлен (подробная история ведётся с 29.10.2026)`);
    }

    await this.reply(chatId, lines.join('\n').slice(0, 4096));
  }

  private payable(order: Order): Prisma.Decimal {
    return order.totalAmount.add(order.deliveryCost ?? 0);
  }

  /** "3 200 ₽" for pickup, "товары 3 200 ₽ + доставка 450 ₽ = 3 650 ₽" once delivery is priced. */
  private amountBreakdown(order: Order): string {
    if (order.deliveryCost === null) {
      return this.money(order.totalAmount);
    }
    return `товары ${this.money(order.totalAmount)} + доставка ${this.money(order.deliveryCost)} = ${this.money(this.payable(order))}`;
  }

  private money(value: Prisma.Decimal.Value): string {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(value));
  }

  private moscowTime(date: Date): string {
    return date.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private trackingUrl(order: Order): string | undefined {
    // CDEK has a public tracking page by number; Yandex's tracking links are per shipment and
    // come from their API, so for Yandex the customer gets the number only.
    if (order.deliveryCarrier === 'CDEK' && order.trackingNumber) {
      return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(order.trackingNumber)}`;
    }
    return undefined;
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

  private async sendAbout(chatId: number): Promise<void> {
    const seller = getSeller();
    if (!seller) {
      await this.reply(chatId, 'Сведения о продавце скоро появятся здесь.');
      return;
    }
    const base = `${process.env.MINIAPP_URL ?? 'https://exeedbot.ru'}/api/legal`;
    const lines = [
      `Продавец: ${seller.name}`,
      `${isSoleTrader(seller) ? 'ОГРНИП' : 'ОГРН'} ${seller.ogrn}, ИНН ${seller.inn}`,
      `Адрес: ${seller.address}`,
      ...(seller.email ? [`Почта: ${seller.email}`] : []),
      ...(seller.phone ? [`Телефон: ${seller.phone}`] : []),
      'Вопросы, возвраты и запросы по персональным данным — пишите сюда, в этот чат.',
      '',
      `Условия покупки и возврата: ${base}/terms`,
      `Обработка персональных данных: ${base}/privacy`,
    ];
    await this.reply(chatId, lines.join('\n'));
  }

  private async sendHelp(chatId: number): Promise<void> {
    const lines = [
      'Команды:',
      '',
      '/start — открыть каталог запчастей',
      '/part <артикул> — цена и наличие (можно несколько через пробел)',
      '/help — эта справка',
      '',
      'Можно просто написать артикул сюда, а в группе — отметить бота: @бот 501014147AA.',
    ];
    if (getSeller()) {
      lines.push('/about — о продавце и документы');
    }

    if (this.isOperator(chatId)) {
      lines.push(
        '',
        'Для оператора:',
        '/queue — заказы, ожидающие ссылку на оплату',
        '/order <номер> — карточка заказа с историей',
        '',
        'Путь заказа:',
        '/pay <номер> <ссылка> — выставить оплату (самовывоз)',
        '/pay <номер> <доставка, ₽> <ссылка> — выставить оплату с доставкой',
        '/paid <номер> — оплата получена',
        '/paid <номер> <доставка, ₽> — оплата пришла без /pay (счёт юрлицу)',
        '/work <номер> — заказали у поставщика',
        '/ready <номер> — самовывоз: готов к выдаче',
        '/ship <номер> <трек> — доставка: отправлен',
        '/done <номер> — выдан / получен',
        '/cancel <номер> [причина] — отменить',
        '',
        'Клиенту каждый раз приходит сообщение.',
        '/id — идентификатор этого чата',
      );
    }

    await callTelegram('sendMessage', { chat_id: chatId, text: lines.join('\n') });
  }

  private async sendQueue(chatId: number): Promise<void> {
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
        await this.reply(chatId, `Очередь пуста — все заказы обработаны.${tail}`);
        return;
      }

      const lines = [`📋 Ожидают ссылку на оплату: ${pending.length}`, ''];
      for (const order of pending.slice(0, QUEUE_LIMIT)) {
        const name = [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') || 'без имени';
        const delivery = order.fulfillmentType === 'DELIVERY' ? ' + доставка' : '';
        lines.push(`№${order.orderNumber} — ${this.money(order.totalAmount)}${delivery}`);
        lines.push(`${name}, ${order.user?.phone ?? 'телефон не указан'}`);
        lines.push(`/order ${order.orderNumber}`);
        lines.push('');
      }

      if (pending.length > QUEUE_LIMIT) {
        lines.push(`…и ещё ${pending.length - QUEUE_LIMIT}. Полный список: GET /api/admin/orders`);
      }
      if (awaitingPayment > 0) {
        lines.push(`Ждут оплаты клиентом: ${awaitingPayment}`);
      }

      await this.reply(chatId, lines.join('\n'));
    } catch (err) {
      this.logger.error(`Failed to build queue for chat ${chatId}: ${(err as Error).message}`);
      await this.reply(chatId, 'Не удалось получить очередь заказов.');
    }
  }
}
