import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FulfillmentType, OrderStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PICKUP_ADDRESSES } from '../delivery/pickup-addresses';
import { AvtoligaService, AvtoligaUnavailableError } from '../avtoliga/avtoliga.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ExternalNotifyService } from './external-notify.service';
import { OrderTelegramNotifyService } from './order-telegram-notify.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly externalNotify: ExternalNotifyService,
    private readonly telegramNotify: OrderTelegramNotifyService,
    private readonly avtoliga: AvtoligaService,
  ) {}

  async createFromCart(userId: string, dto: CreateOrderDto) {
    const cartItems = await this.prisma.cartItem.findMany({
      where: { userId },
      include: { product: true },
    });
    if (cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Prices shown while browsing can be stale (last catalog sync). We only ever charge what
    // the supplier confirms live, right now, so we never sell below their current cost.
    let livePrices;
    try {
      livePrices = await this.avtoliga.getLivePrices(cartItems.map((item) => item.product.code));
    } catch (err) {
      if (err instanceof AvtoligaUnavailableError) {
        this.logger.error(`Avtoliga unavailable while creating order: ${err.message}`);
        throw new ServiceUnavailableException(
          'Не удалось подтвердить актуальную цену у поставщика. Попробуйте оформить заказ ещё раз через пару минут.',
        );
      }
      throw err;
    }

    const missing = cartItems.filter((item) => !livePrices.has(item.product.code));
    if (missing.length > 0) {
      throw new ServiceUnavailableException(
        `Не удалось подтвердить актуальную цену у поставщика для: ${missing.map((i) => i.product.code).join(', ')}. Попробуйте убрать эти позиции из корзины или повторить позже.`,
      );
    }

    const priced = cartItems.map((item) => {
      const live = livePrices.get(item.product.code)!;
      return { item, unitPrice: new Prisma.Decimal(live.price), stockQty: live.stockQty };
    });

    const totalAmount = priced.reduce(
      (sum, p) => sum.add(p.unitPrice.mul(p.item.quantity)),
      new Prisma.Decimal(0),
    );

    const pickupAddressLabel =
      dto.fulfillmentType === FulfillmentType.PICKUP
        ? PICKUP_ADDRESSES.find((a) => a.code === dto.pickupAddressCode)?.label
        : undefined;

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId,
          fulfillmentType: dto.fulfillmentType,
          pickupAddressCode: dto.pickupAddressCode,
          pickupAddressLabel,
          deliveryCarrier: dto.deliveryCarrier,
          deliveryPvzId: dto.deliveryPvzId,
          deliveryPvzAddress: dto.deliveryPvzAddress,
          paymentMethod: dto.paymentMethod,
          orgCardDetails: dto.orgCardDetails,
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

      await tx.cartItem.deleteMany({ where: { userId } });

      return created;
    });

    // Best-effort: let the catalog self-heal towards the price/stock we just confirmed live,
    // so browsing reflects reality more closely until the next full sync. Never blocks the order.
    for (const { item, unitPrice, stockQty } of priced) {
      this.prisma.product
        .update({ where: { id: item.productId }, data: { price: unitPrice, stockQty } })
        .catch((err) =>
          this.logger.warn(`Failed to refresh product ${item.product.code} after order: ${(err as Error).message}`),
        );
    }

    void this.externalNotify.notify(order);
    // Load the customer separately: the order row only snapshots delivery details, but the
    // manager needs a phone number to actually follow up on the payment.
    void this.prisma.user
      .findUnique({ where: { id: userId } })
      .then((user) => this.telegramNotify.notify({ ...order, user }))
      .catch((err) => this.logger.warn(`Failed to push order #${order.orderNumber} to Telegram: ${(err as Error).message}`));

    return order;
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
