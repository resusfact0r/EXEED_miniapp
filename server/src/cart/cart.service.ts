import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Product } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AvtoligaService } from '../avtoliga/avtoliga.service';
import { normalizeLineQty } from './line-quantity';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly avtoliga: AvtoligaService,
  ) {}

  /**
   * Looks up the live supplier price, stock and lot size for this product and, if reachable,
   * self-heals the cached catalog row to match. Never blocks adding to cart: if Avtoliga can't be
   * reached right now, falls back to what's cached - the hard guarantee against selling below
   * cost or beyond stock lives in OrdersService at order-creation time, not here.
   */
  private async refreshFromSupplier(product: Product, quantity: number): Promise<Product> {
    try {
      const live = await this.avtoliga.getLivePrices([product.code], { [product.code]: quantity });
      const entry = live.get(product.code);
      if (!entry) {
        return product;
      }
      return await this.prisma.product.update({
        where: { id: product.id },
        data: { price: new Prisma.Decimal(entry.price), stockQty: entry.stockQty, packQty: entry.packQty },
      });
    } catch (err) {
      this.logger.warn(`Live price lookup failed for ${product.code}, using cached price: ${(err as Error).message}`);
      return product;
    }
  }

  async getCart(userId: string) {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });
    return this.toCartResponse(items);
  }

  async addItem(userId: string, productId: string, quantity: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) {
      throw new NotFoundException('Product not found');
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_productId: { userId, productId } },
    });

    const rawQuantity = (existing?.quantity ?? 0) + quantity;

    // Refresh from the supplier right now, so the price, stock and lot size the line is built on
    // are as current as possible (not the last emailed price list).
    const fresh = await this.refreshFromSupplier(product, rawQuantity);
    const clampedQuantity = normalizeLineQty(rawQuantity, fresh.packQty, fresh.stockQty);
    if (clampedQuantity === 0) {
      throw new BadRequestException('Этого товара сейчас нет в наличии');
    }
    const capped = clampedQuantity < rawQuantity;

    await this.prisma.cartItem.upsert({
      where: { userId_productId: { userId, productId } },
      update: { quantity: clampedQuantity },
      // priceAtAdd is only ever set when the line is first created - it's a snapshot of "what
      // the catalog said when the user found this item", not touched by later quantity changes.
      create: { userId, productId, quantity: clampedQuantity, priceAtAdd: fresh.price },
    });

    const cart = await this.getCart(userId);
    return { ...cart, capped };
  }

  async updateItem(userId: string, productId: string, quantity: number) {
    if (quantity <= 0) {
      await this.prisma.cartItem.deleteMany({ where: { userId, productId } });
      return { ...(await this.getCart(userId)), capped: false };
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_productId: { userId, productId } },
      include: { product: true },
    });
    if (!existing) {
      throw new NotFoundException('Cart item not found');
    }

    // Cached stock is good enough here: the stepper already offers only valid steps, and the
    // order itself is checked against the supplier live.
    const clampedQuantity = normalizeLineQty(quantity, existing.product.packQty, existing.product.stockQty);
    if (clampedQuantity === 0) {
      throw new BadRequestException('Этого товара сейчас нет в наличии');
    }
    const capped = clampedQuantity < quantity;

    await this.prisma.cartItem.update({
      where: { userId_productId: { userId, productId } },
      data: { quantity: clampedQuantity },
    });

    return { ...(await this.getCart(userId)), capped };
  }

  async removeItem(userId: string, productId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId, productId } });
    return this.getCart(userId);
  }

  async clearCart(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
    return this.getCart(userId);
  }

  private toCartResponse(
    items: Prisma.CartItemGetPayload<{ include: { product: true } }>[],
  ) {
    const lines = items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      product: {
        id: item.product.id,
        code: item.product.code,
        name: item.product.name,
        price: item.product.price,
        stockQty: item.product.stockQty,
        packQty: item.product.packQty,
        isActive: item.product.isActive,
      },
      lineTotal: item.product.price.mul(item.quantity),
      priceAtAdd: item.priceAtAdd,
      priceChanged: !item.product.price.equals(item.priceAtAdd),
    }));

    const subtotal = lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      new Prisma.Decimal(0),
    );

    return { items: lines, subtotal };
  }
}
