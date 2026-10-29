import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FulfillmentType, OrderStatus, PaymentMethod, Prisma, type User } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PICKUP_ADDRESSES } from '../delivery/pickup-addresses';
import { AvtoligaService, AvtoligaUnavailableError } from '../avtoliga/avtoliga.service';
import type { LivePrice } from '../avtoliga/types';
import { normalizeLineQty } from '../cart/line-quantity';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ExternalNotifyService } from './external-notify.service';
import { OrderTelegramNotifyService } from './order-telegram-notify.service';

type CartItemWithProduct = Prisma.CartItemGetPayload<{ include: { product: true } }>;

const money = (value: Prisma.Decimal.Value) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(value));

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly externalNotify: ExternalNotifyService,
    private readonly telegramNotify: OrderTelegramNotifyService,
    private readonly avtoliga: AvtoligaService,
  ) {}

  async createFromCart(user: User, dto: CreateOrderDto) {
    const userId = user.id;
    // The operator confirms every order by phone or Telegram before issuing a payment link; the
    // Mini App asks for the number first, but the API must not depend on that.
    if (!user.phone) {
      throw new BadRequestException('Чтобы оформить заказ, поделитесь номером телефона в профиле.');
    }

    const cartItems = await this.prisma.cartItem.findMany({
      where: { userId },
      include: { product: true },
    });
    if (cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Prices shown while browsing can be stale (last price list). We only ever charge what
    // the supplier confirms live, right now, so we never sell below their current cost - and
    // only if that's what the customer was shown, so they're never charged a sum they never saw.
    let livePrices: Map<string, LivePrice>;
    try {
      livePrices = await this.avtoliga.getLivePrices(
        cartItems.map((item) => item.product.code),
        Object.fromEntries(cartItems.map((item) => [item.product.code, item.quantity])),
      );
    } catch (err) {
      if (err instanceof AvtoligaUnavailableError) {
        this.logger.error(`Avtoliga unavailable while creating order: ${err.message}`);
        throw new ServiceUnavailableException(
          'Не удалось подтвердить актуальную цену у поставщика. Попробуйте оформить заказ ещё раз через пару минут.',
        );
      }
      throw err;
    }

    const problems = this.findProblems(cartItems, livePrices, dto);
    if (problems.length > 0) {
      await this.syncCartWithSupplier(userId, cartItems, livePrices);
      throw new ConflictException({
        statusCode: 409,
        code: 'CART_CHANGED',
        message: ['Заказ не оформлен — с момента просмотра корзины изменилось:', ...problems.map((p) => `• ${p}`)].join('\n'),
      });
    }

    const priced = cartItems.map((item) => {
      const live = livePrices.get(item.product.code)!;
      return { item, unitPrice: new Prisma.Decimal(live.price), live };
    });

    const totalAmount = priced.reduce(
      (sum, p) => sum.add(p.unitPrice.mul(p.item.quantity)),
      new Prisma.Decimal(0),
    );

    // The checkout screen keeps both methods' choices (and pre-fills the carrier from the profile
    // even for pickup), so only the fields of the chosen method are stored - otherwise the order,
    // the operator's message and the external webhook would carry contradicting details.
    const isPickup = dto.fulfillmentType === FulfillmentType.PICKUP;
    const fulfillment = isPickup
      ? {
          pickupAddressCode: dto.pickupAddressCode,
          pickupAddressLabel: PICKUP_ADDRESSES.find((a) => a.code === dto.pickupAddressCode)?.label,
        }
      : {
          deliveryCarrier: dto.deliveryCarrier,
          deliveryPvzId: dto.deliveryPvzId,
          deliveryPvzAddress: dto.deliveryPvzAddress,
        };

    const order = await this.prisma.$transaction(async (tx) => {
      // Claim the cart first. A double tap on "Оформить заказ" sends two requests that both read
      // the same cart during the multi-second supplier check; the second one blocks here until
      // the first commits, then finds the lines already gone and rolls back instead of creating
      // a duplicate order.
      const claimed = await tx.cartItem.deleteMany({
        where: { userId, id: { in: cartItems.map((item) => item.id) } },
      });
      if (claimed.count !== cartItems.length) {
        throw new ConflictException('Этот заказ уже оформляется — проверьте раздел «Заказы».');
      }

      return tx.order.create({
        data: {
          userId,
          fulfillmentType: dto.fulfillmentType,
          ...fulfillment,
          paymentMethod: dto.paymentMethod,
          orgCardDetails: dto.paymentMethod === PaymentMethod.LEGAL_ENTITY ? dto.orgCardDetails : undefined,
          policyAcknowledgedAt: new Date(),
          totalAmount,
          status: 'NEW',
          items: {
            create: priced.map(({ item, unitPrice }) => ({
              productId: item.productId,
              productCode: item.product.code,
              productName: item.product.name,
              unitPrice,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: true },
      });
    });

    // Best-effort: let the catalog self-heal towards the price/stock we just confirmed live,
    // so browsing reflects reality more closely until the next full sync. Never blocks the order.
    for (const { item, unitPrice, live } of priced) {
      this.prisma.product
        .update({
          where: { id: item.productId },
          data: { price: unitPrice, stockQty: live.stockQty, packQty: live.packQty },
        })
        .catch((err) =>
          this.logger.warn(`Failed to refresh product ${item.product.code} after order: ${(err as Error).message}`),
        );
    }

    void this.externalNotify.notify(order);
    // The customer goes along: the order row only snapshots delivery details, but the manager
    // needs a phone number to actually follow up on the payment.
    void this.telegramNotify
      .notify({ ...order, user })
      .catch((err) => this.logger.warn(`Failed to push order #${order.orderNumber} to Telegram: ${(err as Error).message}`));

    return order;
  }

  /** Human-readable reasons the cart can't be ordered as shown; empty when it can. */
  private findProblems(cartItems: CartItemWithProduct[], live: Map<string, LivePrice>, dto: CreateOrderDto): string[] {
    const problems: string[] = [];
    const expected = dto.expectedItems ? new Map(dto.expectedItems.map((e) => [e.productId, e])) : undefined;

    if (expected && (expected.size !== cartItems.length || cartItems.some((i) => expected.get(i.productId)?.quantity !== i.quantity))) {
      problems.push('состав корзины (её меняли в другом окне)');
    }

    for (const item of cartItems) {
      const name = `«${item.product.name}»`;
      const entry = live.get(item.product.code);
      if (!item.product.isActive || !entry) {
        problems.push(`${name} — нет в наличии, уберите из корзины`);
        continue;
      }
      if (entry.stockQty < item.quantity) {
        const available = Math.floor(entry.stockQty / entry.packQty) * entry.packQty;
        problems.push(
          available > 0
            ? `${name} — в наличии только ${available} шт., количество уменьшено`
            : `${name} — закончился, уберите из корзины`,
        );
        continue;
      }
      if (item.quantity % entry.packQty !== 0) {
        problems.push(`${name} — продаётся только по ${entry.packQty} шт., количество исправлено`);
      }
      const shown = expected?.get(item.productId)?.unitPrice ?? item.product.price;
      if (!new Prisma.Decimal(entry.price).equals(shown)) {
        problems.push(`${name} — цена ${money(shown)} → ${money(entry.price)}`);
      }
    }
    return problems;
  }

  /**
   * After a rejected checkout, bring the catalog rows and cart quantities in line with what the
   * supplier just said, so the refreshed cart shows exactly what the next attempt will charge.
   * Lines that can't be bought at all stay put - the customer is told to remove them.
   */
  private async syncCartWithSupplier(userId: string, cartItems: CartItemWithProduct[], live: Map<string, LivePrice>) {
    for (const item of cartItems) {
      const entry = live.get(item.product.code);
      if (!entry) {
        continue;
      }
      await this.prisma.product.update({
        where: { id: item.productId },
        data: { price: new Prisma.Decimal(entry.price), stockQty: entry.stockQty, packQty: entry.packQty },
      });
      const quantity = normalizeLineQty(item.quantity, entry.packQty, entry.stockQty);
      if (quantity > 0 && quantity !== item.quantity) {
        await this.prisma.cartItem.updateMany({ where: { id: item.id, userId }, data: { quantity } });
      }
    }
  }

  listForUser(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForUser(userId: string, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.userId !== userId) {
      throw new ForbiddenException('Not your order');
    }
    return order;
  }

  listForAdmin(status?: OrderStatus) {
    return this.prisma.order.findMany({
      where: status ? { status } : undefined,
      include: { items: true, user: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Operator flow from the bot (/pay): record the payment link and move the order to "awaiting
   * payment". Refused once the order is already paid, in progress, done or cancelled - a fresh
   * link there would only confuse the customer.
   */
  async issuePaymentLink(orderNumber: number, paymentLink: string) {
    return this.operatorTransition(orderNumber, ['NEW', 'AWAITING_PAYMENT_LINK', 'AWAITING_PAYMENT'], {
      paymentLink,
      status: 'AWAITING_PAYMENT',
    });
  }

  /** Operator flow from the bot (/paid): the money has arrived. */
  async markPaid(orderNumber: number) {
    return this.operatorTransition(orderNumber, ['NEW', 'AWAITING_PAYMENT_LINK', 'AWAITING_PAYMENT'], {
      status: 'PAID',
    });
  }

  private async operatorTransition(
    orderNumber: number,
    allowedFrom: OrderStatus[],
    data: { status: OrderStatus; paymentLink?: string },
  ) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber } });
    if (!order) {
      return { ok: false as const, reason: 'not_found' as const };
    }
    if (!allowedFrom.includes(order.status)) {
      return { ok: false as const, reason: 'wrong_status' as const, status: order.status };
    }
    const updated = await this.prisma.order.update({ where: { orderNumber }, data, include: { user: true } });
    return { ok: true as const, order: updated };
  }

  async updateForAdmin(id: string, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return this.prisma.order.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.paymentLink !== undefined ? { paymentLink: dto.paymentLink } : {}),
      },
    });
  }
}
