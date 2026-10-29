import { Injectable, Logger } from '@nestjs/common';
import type { Order, OrderItem, User } from '@prisma/client';

import { callTelegram } from '../bot/telegram-api';

const FULFILLMENT_LABELS: Record<string, string> = {
  PICKUP: 'Самовывоз',
  DELIVERY: 'Доставка',
};

const PAYMENT_LABELS: Record<string, string> = {
  QR_LINK: 'QR-ссылка',
  LEGAL_ENTITY: 'Безнал (юр. лицо)',
};

// Telegram rejects a message over 4096 characters outright - the operator would get nothing.
const TELEGRAM_TEXT_LIMIT = 4096;

const CARRIER_LABELS: Record<string, string> = {
  CDEK: 'СДЭК',
  YANDEX: 'Яндекс.Доставка',
};

/**
 * Pushes new orders to the manager instead of making them poll GET /api/admin/orders. Every
 * order lands as NEW and needs a payment link issued by hand, so without this the queue is
 * invisible until someone goes looking for it.
 *
 * Fire-and-forget by design: a Telegram outage must never fail an order that's already been
 * paid for with a live supplier price check.
 */
@Injectable()
export class OrderTelegramNotifyService {
  private readonly logger = new Logger(OrderTelegramNotifyService.name);

  async notify(order: Order & { items: OrderItem[]; user?: User | null }): Promise<void> {
    const chatIds = (process.env.ORDER_NOTIFY_CHAT_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (chatIds.length === 0) {
      this.logger.log(
        `ORDER_NOTIFY_CHAT_IDS not configured; order #${order.orderNumber} not pushed to Telegram`,
      );
      return;
    }

    const text = this.fitTelegramLimit(this.buildMessage(order), order.orderNumber);
    for (const chatId of chatIds) {
      const result = await callTelegram('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
      if (!result?.ok) {
        this.logger.warn(`Order #${order.orderNumber} not delivered to chat ${chatId}: ${result?.description ?? 'Telegram unreachable'}`);
      }
    }
  }

  private fitTelegramLimit(text: string, orderNumber: number): string {
    if (text.length <= TELEGRAM_TEXT_LIMIT) {
      return text;
    }
    const tail = `\n…\nСообщение обрезано. Полный заказ №${orderNumber}: GET /api/admin/orders`;
    return text.slice(0, TELEGRAM_TEXT_LIMIT - tail.length) + tail;
  }

  private buildMessage(order: Order & { items: OrderItem[]; user?: User | null }): string {
    const lines: string[] = [];
    lines.push(`🆕 Заказ №${order.orderNumber} — ${order.totalAmount.toString()} ₽`);
    lines.push('');

    const user = order.user;
    if (user) {
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'без имени';
      const username = user.username ? ` (@${user.username})` : '';
      lines.push(`Клиент: ${name}${username}`);
      lines.push(`Телефон: ${user.phone ?? 'не указан'}`);
    }

    const fulfillment = FULFILLMENT_LABELS[order.fulfillmentType] ?? order.fulfillmentType;
    if (order.fulfillmentType === 'PICKUP') {
      lines.push(`Получение: ${fulfillment} — ${order.pickupAddressLabel ?? '-'}`);
    } else {
      const carrier = order.deliveryCarrier ? CARRIER_LABELS[order.deliveryCarrier] ?? order.deliveryCarrier : '-';
      lines.push(`Получение: ${fulfillment} ${carrier}`);
      lines.push(`ПВЗ: ${order.deliveryPvzAddress ?? '-'}`);
    }

    lines.push(`Оплата: ${PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}`);
    if (order.orgCardDetails) {
      lines.push(`Реквизиты: ${order.orgCardDetails}`);
    }

    lines.push('');
    lines.push('Состав:');
    for (const item of order.items) {
      lines.push(`• ${item.productCode} — ${item.productName} × ${item.quantity} = ${item.unitPrice.toString()} ₽/шт`);
    }

    lines.push('');
    lines.push(`Выставить оплату: /pay ${order.orderNumber} <ссылка>`);
    lines.push(`Отметить оплату: /paid ${order.orderNumber}`);
    return lines.join('\n');
  }
}
