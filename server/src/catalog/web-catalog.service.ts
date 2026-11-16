import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { classifyProduct, filterWebProducts, webMetadata, type NavigationProduct, type WebFilters } from './web-taxonomy';

@Injectable()
export class WebCatalogService {
  private cached: { expires: number; products: NavigationProduct[] } | undefined;
  private pending: Promise<NavigationProduct[]> | undefined;
  constructor(private readonly prisma: PrismaService) {}

  private async products(): Promise<NavigationProduct[]> {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.products;
    if (this.pending) return this.pending;
    this.pending = this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, description: true, price: true, stockQty: true, packQty: true, imageUrl: true },
    }).then((rows) => {
      const products = rows.map((row) => ({ ...row, price: row.price.toString(), ...classifyProduct(row) }));
      this.cached = { expires: Date.now() + 60_000, products };
      return products;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async metadata() { return webMetadata(await this.products()); }
  async search(filters: WebFilters) { return filterWebProducts(await this.products(), filters); }
  async product(code: string) {
    const product = (await this.products()).find((item) => item.code.toLowerCase() === code.toLowerCase());
    if (!product) throw new NotFoundException('Деталь не найдена');
    return product;
  }
}
