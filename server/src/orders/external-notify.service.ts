import { Injectable, Logger } from '@nestjs/common';
import type { Order, OrderItem } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Extension point: the real order-processing system is external and not yet specified.
 * For now we POST a webhook (if configured) and always expose GET /api/admin/orders as a
 * polling fallback. Replace/extend this once the external system's contract is known.
 */
@Injectable()
export class ExternalNotifyService {
  private readonly logger = new Logger(ExternalNotifyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(order: Order & { items: OrderItem[] }): Promise<void> {
    const webhookUrl = process.env.EXTERNAL_ORDER_WEBHOOK_URL;
    if (!webhookUrl) {
      this.logger.log(`EXTERNAL_ORDER_WEBHOOK_URL not configured; skipping webhook for order #${order.orderNumber}`);
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.toPayload(order)),
      });
      if (!response.ok) {
        throw new Error(`Webhook responded with ${response.status}`);
      }
      await this.prisma.order.update({
        where: { id: order.id },
        data: { externalNotifiedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`Failed to notify external system for order #${order.orderNumber}: ${(err as Error).message}`);
    }
  }

  private toPayload(order: Order & { items: OrderItem[] }) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      pickupAddressLabel: order.pickupAddressLabel,
      deliveryCarrier: order.deliveryCarrier,
      deliveryPvzAddress: order.deliveryPvzAddress,
      paymentMethod: order.paymentMethod,
      orgCardDetails: order.orgCardDetails,
      totalAmount: order.totalAmount.toString(),
      items: order.items.map((item) => ({
        productCode: item.productCode,
        productName: item.productName,
        unitPrice: item.unitPrice.toString(),
        quantity: item.quantity,
      })),
      createdAt: order.createdAt.toISOString(),
    };
  }
}
