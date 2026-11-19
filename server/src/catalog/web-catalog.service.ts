import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { articleKey, inStock } from './offers';
import { activeWebProduct, productOffers } from './warehouse-offer';
import { classifyProduct, filterWebProducts, webMetadata, type NavigationProduct, type WebFilters } from './web-taxonomy';

@Injectable()
export class WebCatalogService {
  private cached: { expires: number; products: NavigationProduct[] } | undefined;
  private pending: Promise<NavigationProduct[]> | undefined;
  private revision = 0;

  constructor(private readonly prisma: PrismaService) {}

  invalidate() {
    this.revision++;
    this.cached = undefined;
    this.pending = undefined;
  }

  private async products(): Promise<NavigationProduct[]> {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.products;
    if (this.pending) return this.pending;
    const revision = this.revision;
    this.pending = this.prisma.product.findMany({
      where: activeWebProduct,
      select: {
        id: true, code: true, name: true, description: true,
        price: true, stockQty: true, packQty: true, imageUrl: true, images: true, isActive: true,
        originals: { select: { originalCode: true }, orderBy: { originalCode: 'asc' } },
        offers: { where: { isActive: true }, include: { warehouse: true }, orderBy: { warehouseCode: 'asc' } },
      },
    }).then((rows) => {
      const products = rows.map((product) => {
        const { id, code, name, description, imageUrl, images, originals } = product;
        const offers = productOffers(product);
        const preferred = offers.filter(inStock).sort((a, b) => Number(a.price) - Number(b.price))[0] ?? offers[0];
        return {
          id, code, name, description, imageUrl, ...(images.length ? { images } : {}),
          price: preferred.price, packQty: preferred.packQty, stockQty: preferred.stockQty,
          offers,
          ...(originals.length ? { originalArticles: originals.map((item) => item.originalCode) } : {}),
          ...classifyProduct({ code, name }),
        };
      });
      if (revision === this.revision) this.cached = { expires: Date.now() + 60_000, products };
      return products;
    }).finally(() => { if (revision === this.revision) this.pending = undefined; });
    return this.pending;
  }

  async metadata() { return webMetadata(await this.products()); }
  async search(filters: WebFilters) { return filterWebProducts(await this.products(), filters); }
  async product(code: string) {
    const product = (await this.products()).find((item) => articleKey(item.code) === articleKey(code));
    if (!product) throw new NotFoundException('Деталь не найдена');
    return product;
  }
}
