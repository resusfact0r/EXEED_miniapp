import { Injectable, Logger } from '@nestjs/common';

import { Prisma, type Order, type User } from '@prisma/client';

import { PICKUP_ADDRESSES } from '../delivery/pickup-addresses';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { callTelegram, type TelegramApiResult } from './telegram-api';

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

    // "/pay@exeed_friends_bot 12 https://..." is how commands arrive from a group chat; Telegram
    // also appends a deep-link payload as "/start <payload>", which we don't use yet.
    const [rawCommand, ...args] = text.split(/\s+/);
    const command = rawCommand.split('@')[0];

    switch (command) {
      case '/start':
        return this.sendStartMessage(chatId);
      case '/help':
        return this.sendHelp(chatId);
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
    const link = args.length >= 3 ? args[2] : args[1];
    const costArg = args.length >= 3 ? args[1] : undefined;
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
    if (order && deliveryCost !== null && args[3] !== CONFIRM_WORD && this.looksLikeOrderTotal(deliveryCost, order)) {
      await this.reply(chatId, this.deliveryCostWarning(order, deliveryCost, `/pay ${orderNumber} ${costArg} ${link} ${CONFIRM_WORD}`));
      return;
    }

    const result = await this.orders.issuePaymentLink(orderNumber, url.toString(), deliveryCost);
    await this.afterTransition(chatId, orderNumber, result, (o) => ({
      customer: {
        text: `Заказ №${o.orderNumber} ждёт оплаты: ${this.amountBreakdown(o)}.`,
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
    const costArg = args[1];
    const deliveryCost = costArg === undefined ? null : this.parseDeliveryCost(costArg);
    if (costArg !== undefined && deliveryCost === null) {
      await this.reply(chatId, `«${costArg}» не похоже на стоимость доставки. Пример: /paid ${orderNumber} 450`);
      return;
    }

    const order = await this.prisma.order.findUnique({ where: { orderNumber } });
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
      if (deliveryCost !== null && args[2] !== CONFIRM_WORD && this.looksLikeOrderTotal(deliveryCost, order)) {
        await this.reply(chatId, this.deliveryCostWarning(order, deliveryCost, `/paid ${orderNumber} ${costArg} ${CONFIRM_WORD}`));
        return;
      }
    }

    const result = await this.orders.markPaid(orderNumber, deliveryCost);
    await this.afterTransition(chatId, orderNumber, result, (o) => ({
      customer: { text: `Оплата заказа №${o.orderNumber} получена. Спасибо! Сообщим, когда заказ будет готов.` },
      operator: `отмечен оплаченным (${this.amountBreakdown(o)}). Дальше: /work ${o.orderNumber}, когда закажете у поставщика`,
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

  private deliveryCostWarning(order: Order, deliveryCost: Prisma.Decimal, confirmCommand: string): string {
    const total = order.totalAmount.add(deliveryCost);
    return (
      `⚠️ Заказ №${order.orderNumber}: доставка ${this.money(deliveryCost)} при товарах на ${this.money(order.totalAmount)}, ` +
      `всего выйдет ${this.money(total)}.\n` +
      'Здесь указывается только стоимость доставки, а не сумма заказа. Ничего не записано.\n' +
      `Если всё верно, отправьте:\n${confirmCommand}`
    );
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
        lines.push(`Адрес: ${address.label}`, `Часы работы: ${address.schedule}`);
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

  private async sendHelp(chatId: number): Promise<void> {
    const lines = ['Команды:', '', '/start — открыть каталог запчастей', '/help — эта справка'];

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
