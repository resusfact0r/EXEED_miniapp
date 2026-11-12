import { Injectable } from '@nestjs/common';
import type { Product } from '@prisma/client';

import { AvtoligaService, AvtoligaUnavailableError } from '../avtoliga/avtoliga.service';
import type { LivePrice } from '../avtoliga/types';
import { getSupportUsername } from '../legal/support';
import { PrismaService } from '../prisma/prisma.service';

const MAX_ARTICLES = 5;
// An article has a digit and at least 4 characters once separators are dropped - that keeps
// ordinary words ("подскажите", "цена") out of a free-text question.
const ARTICLE = /^(?=.*\d)[0-9A-ZА-ЯЁ]{4,30}$/i;

const compact = (code: string) => code.replace(/[^0-9A-ZА-ЯЁ]/gi, '').toUpperCase();

const money = (value: number | string) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(Number(value));

export interface PartCard {
  text: string;
  /** Products that can be ordered in the Mini App right now - they get an order button. */
  orderable: Array<Pick<Product, 'id' | 'code'>>;
}

/**
 * Answers "what about part X?" in a chat: our price and the supplier's stock right now. Prices
 * come from the same live check the order uses, so what the bot says is what the order charges.
 */
@Injectable()
export class PartLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avtoliga: AvtoligaService,
  ) {}

  /**
   * "@bot подскажите 501014147AA и T11-3502010?" -> ["501014147AA", "T11-3502010"]. Separators
   * inside are kept: some catalog codes really contain a hyphen ("A-1014"), others are written
   * with one by people ("T11-3502010" for T113502010) - describe() tries both spellings.
   */
  static extractArticles(text: string): string[] {
    const tokens = text
      .replace(/@\w+/g, ' ')
      .split(/[\s,;]+/)
      .map((token) => token.replace(/^[^0-9A-Za-zА-Яа-яЁё]+|[^0-9A-Za-zА-Яа-яЁё]+$/g, '').toUpperCase())
      .filter((token) => ARTICLE.test(compact(token)));
    return [...new Set(tokens)].slice(0, MAX_ARTICLES);
  }

  async describe(articles: string[]): Promise<PartCard> {
    const spellings = [...new Set(articles.flatMap((a) => [a, compact(a)]))];
    const products = await this.prisma.product.findMany({
      where: { OR: spellings.map((code) => ({ code: { equals: code, mode: 'insensitive' as const } })) },
    });
    // As typed first, then without separators.
    const find = (article: string) =>
      products.find((p) => p.code.toUpperCase() === article) ?? products.find((p) => p.code.toUpperCase() === compact(article));
    const codes = articles.map((a) => find(a)?.code ?? compact(a));

    let live: Map<string, LivePrice> | null = null;
    try {
      live = await this.avtoliga.getLivePrices(codes);
    } catch (err) {
      if (!(err instanceof AvtoligaUnavailableError)) {
        throw err;
      }
    }
    const priceListDate = live ? null : await this.lastPriceListDate();

    const blocks: string[] = [];
    const orderable: PartCard['orderable'] = [];
    let anyFound = false;
    for (const [i, article] of articles.entries()) {
      const product = find(article);
      const code = codes[i];
      anyFound ||= Boolean(product || live?.get(code));
      blocks.push(await this.describeOne(code, product, live, priceListDate, orderable));
    }

    const footer = !anyFound
      ? null
      : live
        ? 'Цена и наличие — на эту минуту, при оформлении заказа проверяются снова.'
        : 'Поставщик сейчас не отвечает, поэтому цены и остатки — из последнего прайса. При оформлении заказа они проверятся.';
    return { text: [...blocks, ...(footer ? [footer] : [])].join('\n\n'), orderable };
  }

  private async describeOne(
    code: string,
    product: Product | undefined,
    live: Map<string, LivePrice> | null,
    priceListDate: Date | null,
    orderable: PartCard['orderable'],
  ): Promise<string> {
    const entry = live?.get(code);
    if (!product && !entry) {
      return this.notFound(code);
    }

    const lines = [`🔧 ${code}${product ? ` — ${product.name}` : ''}`];
    const packQty = entry?.packQty ?? product?.packQty ?? 1;

    if (entry) {
      lines.push(`💰 ${money(entry.price)}`);
      lines.push(entry.stockQty > 0 ? `📦 В наличии: ${entry.stockQty} шт.` : '📦 Нет в наличии');
    } else if (live) {
      // The supplier answered, and this code isn't among what it has.
      lines.push('📦 Нет в наличии у поставщика');
    } else if (product) {
      const asOf = priceListDate ? ` по прайсу от ${priceListDate.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}` : ' по прайсу';
      lines.push(`💰 ${money(product.price.toString())}${asOf}`);
      lines.push(product.stockQty > 0 ? `📦 ${product.stockQty} шт.${asOf}` : `📦 Нет в наличии${asOf}`);
    }
    if (packQty > 1) {
      lines.push(`Продаётся по ${packQty} шт., цена за 1 шт.`);
    }

    const inStock = entry ? entry.stockQty >= packQty : !live && (product?.stockQty ?? 0) >= packQty;
    if (product?.isActive && inStock) {
      orderable.push({ id: product.id, code: product.code });
    } else if (inStock) {
      // Known to the supplier but hidden from the catalog (not in the current price list): the
      // app won't let it into a cart, so a person has to handle it.
      lines.push('Через приложение сейчас не заказать — уточните у оператора.');
    }
    return lines.join('\n');
  }

  private async notFound(code: string): Promise<string> {
    const similar = await this.prisma.product.findMany({
      where: { isActive: true, code: { contains: code.slice(0, Math.max(4, code.length - 2)), mode: 'insensitive' } },
      orderBy: { code: 'asc' },
      take: 3,
      select: { code: true, name: true },
    });
    const lines = [`❓ ${code} — не нашли ни в каталоге, ни у поставщика.`];
    if (similar.length > 0) {
      lines.push('Похожие артикулы:', ...similar.map((p) => `• ${p.code} — ${p.name}`));
    }
    const support = getSupportUsername();
    if (support) {
      lines.push(`Поможет подобрать менеджер: @${support}`);
    }
    return lines.join('\n');
  }

  private async lastPriceListDate(): Promise<Date | null> {
    const last = await this.prisma.priceImport.findFirst({
      where: { status: 'APPLIED' },
      orderBy: { createdAt: 'desc' },
      select: { receivedAt: true, createdAt: true },
    });
    return last ? (last.receivedAt ?? last.createdAt) : null;
  }
}
