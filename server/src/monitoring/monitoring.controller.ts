import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AvtoligaService } from '../avtoliga/avtoliga.service';
import { BotPollingService } from '../bot/bot-polling.service';
import { PriceSyncService } from '../price-sync/price-sync.service';
import { PrismaService } from '../prisma/prisma.service';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Internal state for the watchdog (deploy/watchdog): when the bot last heard from Telegram, when
 * the mailbox was last checked, how old the price list is, which orders wait on the operator.
 * Order data includes nothing personal, but it's still nobody else's business: only callers on
 * the server itself get an answer. Requests from outside come through nginx, which always adds
 * X-Forwarded-For / X-Real-IP - so those headers mean "not local" even from 127.0.0.1.
 */
@Controller('health')
export class MonitoringController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botPolling: BotPollingService,
    private readonly priceSync: PriceSyncService,
    private readonly avtoliga: AvtoligaService,
  ) {}

  /** Orders can't be placed while the supplier doesn't answer, so that's checked on real stock. */
  private async supplierStatus() {
    const sample = await this.prisma.product.findMany({
      where: { isActive: true, stockQty: { gt: 0 } },
      orderBy: { code: 'asc' },
      take: 5,
      select: { code: true },
    });
    try {
      const live = await this.avtoliga.getLivePrices(sample.map((p) => p.code));
      return { ok: live.size > 0, error: live.size > 0 ? null : 'ни одна из проверочных позиций не найдена' };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @Get('details')
  async details(@Req() req: Request) {
    const proxied = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
    if (proxied || !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      throw new ForbiddenException();
    }

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [lastApplied, lastImport, awaitingLink, awaitingPayment, inWork, createdLastDay, activeProducts] =
      await Promise.all([
        this.prisma.priceImport.findFirst({
          where: { warehouseCode: 'cs', status: 'APPLIED', source: 'email' },
          orderBy: { receivedAt: 'desc' },
          select: { receivedAt: true, createdAt: true, rows: true, fileName: true },
        }),
        this.prisma.priceImport.findFirst({
          where: { warehouseCode: 'cs', status: { not: 'SKIPPED' } },
          orderBy: { createdAt: 'desc' },
          select: { status: true, createdAt: true, rows: true, error: true },
        }),
        this.prisma.order.findMany({
          where: { status: { in: ['NEW', 'AWAITING_PAYMENT_LINK'] } },
          orderBy: { orderNumber: 'asc' },
          select: { orderNumber: true, createdAt: true, totalAmount: true, fulfillmentType: true },
        }),
        this.prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } }),
        this.prisma.order.count({ where: { status: { in: ['PAID', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'SHIPPED'] } } }),
        this.prisma.order.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.product.count({ where: { isActive: true } }),
      ]);

    return {
      now: new Date().toISOString(),
      supplier: await this.supplierStatus(),
      bot: this.botPolling.getStatus(),
      priceSync: { ...this.priceSync.getStatus(), filter: process.env.PRICE_MAIL_SUBJECT ?? null },
      prices: { lastApplied, lastImport, activeProducts },
      orders: {
        awaitingLink: awaitingLink.map((o) => ({ ...o, totalAmount: o.totalAmount.toString() })),
        awaitingPayment,
        inWork,
        createdLastDay,
      },
    };
  }
}
