import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readAnalogueLinks, writeAnalogueLinks } from './analogue-file';
import { findArticleIds, lockCatalogWrites } from './catalog-write';
import { CardsQuery, EditCatalogCard, NewCatalogCard, NewWarehouse } from './dto/admin-web-catalog.dto';
import { articleKey, CENTRAL_WAREHOUSE, SHOP_WAREHOUSE, validArticle } from './offers';
import { productOffers } from './warehouse-offer';

const CARD_PAGE_SIZE = 30;
const include = {
  originals: { orderBy: { originalCode: 'asc' } },
  offers: { where: { isActive: true }, include: { warehouse: true }, orderBy: { warehouseCode: 'asc' } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class AdminWebCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async cards(query: CardsQuery) {
    const page = query.page ?? 1;
    const q = query.q?.trim();
    const where: Prisma.ProductWhereInput = q
      ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        take: CARD_PAGE_SIZE,
        skip: (page - 1) * CARD_PAGE_SIZE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        include,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items: products.map(card), pageSize: CARD_PAGE_SIZE, total };
  }

  async save(id: string | null, dto: NewCatalogCard | EditCatalogCard) {
    const originals = [...new Set(dto.originalArticles.map(articleKey))];
    if (originals.some((key) => !validArticle(key)))
      throw new BadRequestException('Проверьте оригинальные артикулы.');
    if (!dto.name.trim()) throw new BadRequestException('Введите название.');
    const images = [...new Set(dto.images.map(photoUrl))];

    return this.prisma.$transaction(async (tx) => {
      await lockCatalogWrites(tx);
      const current = id ? await tx.product.findUnique({ where: { id } }) : null;
      if (id && !current) throw new NotFoundException('Карточка не найдена.');
      if (current && dto.version && current.updatedAt.toISOString() !== dto.version) {
        throw new ConflictException('Карточка уже обновилась. Откройте её заново.');
      }
      const code = current?.code ?? articleKey((dto as NewCatalogCard).code);
      if (!validArticle(code) || originals.includes(articleKey(code))) {
        throw new BadRequestException('Артикул и артикулы оригиналов должны отличаться.');
      }
      const data = {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        images,
        imageUrl: images[0] ?? null,
      };
      if (!current) {
        if (!dto.storeOffer) throw new BadRequestException('Введите цену и остаток для новой карточки.');
        if ((await findArticleIds(tx, [code])).has(code))
          throw new ConflictException('Карточка с таким артикулом уже есть.');
        id = (await tx.product.create({ data: { ...data, code, price: 0, isActive: false } })).id;
      } else {
        await tx.product.update({ where: { id: current.id }, data });
      }
      const productId = id!;
      await tx.originalArticle.deleteMany({ where: { productId } });
      if (originals.length) {
        await tx.originalArticle.createMany({
          data: originals.map((originalCode) => ({ productId, originalCode })),
        });
      }
      if (dto.storeOffer) {
        const manual = { ...dto.storeOffer, isActive: true, packQty: 1 };
        await tx.warehouseOffer.upsert({
          where: { productId_warehouseCode: { productId, warehouseCode: SHOP_WAREHOUSE } },
          create: { productId, warehouseCode: SHOP_WAREHOUSE, ...manual },
          update: manual,
        });
      }
      return card(await tx.product.findUniqueOrThrow({ where: { id: productId }, include }));
    });
  }

  async warehouses() {
    const warehouses = await this.prisma.warehouse.findMany({ orderBy: { code: 'asc' } });
    return warehouses.map((warehouse) => ({
      code: warehouse.code,
      name: warehouse.name,
      extraMarkup: warehouse.extraMarkup.toString(),
      defaultPackQty: warehouse.defaultPackQty,
      retail: warehouse.retail,
    }));
  }

  addWarehouse(dto: NewWarehouse) {
    if (dto.code === CENTRAL_WAREHOUSE || !dto.name.trim())
      throw new BadRequestException('Введите новый код и название склада.');
    return this.prisma.warehouse
      .create({
        data: { ...dto, name: dto.name.trim(), brandFilter: dto.brandFilter?.trim() || null },
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Склад с таким кодом уже есть.');
        }
        throw error;
      });
  }

  imports(warehouse?: string) {
    return this.prisma.priceImport.findMany({
      where: warehouse ? { warehouseCode: warehouse } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 20,
      select: {
        id: true,
        warehouseCode: true,
        rows: true,
        fileName: true,
        status: true,
        error: true,
        createdAt: true,
      },
    });
  }

  async importAnalogs(file: Buffer) {
    const links = readAnalogueLinks(file);
    return this.prisma.$transaction(
      async (tx) => {
        await lockCatalogWrites(tx);
        const codes = [...new Set(links.map((link) => link.code))];
        const ids = await findArticleIds(tx, codes);
        const missing = codes.filter((code) => !ids.has(code));
        if (missing.length) {
          throw new BadRequestException(
            'Сначала загрузите карточки аналогов: ' + missing.slice(0, 10).join(', '),
          );
        }
        const added = await tx.$executeRaw`
        INSERT INTO "OriginalArticle" ("productId", "originalCode")
        SELECT * FROM unnest(
          ${links.map((link) => ids.get(link.code)!)}::text[],
          ${links.map((link) => link.originalCode)}::text[]
        )
        ON CONFLICT DO NOTHING`;
        return { rows: links.length, added };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  async exportAnalogs() {
    const rows = await this.prisma.originalArticle.findMany({
      orderBy: [{ originalCode: 'asc' }, { productId: 'asc' }],
      select: { originalCode: true, product: { select: { code: true } } },
    });
    return writeAnalogueLinks(
      rows.map(({ originalCode, product }) => ({ originalCode, code: product.code })),
    );
  }
}

function card(row: Prisma.ProductGetPayload<{ include: typeof include }>) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    updatedAt: row.updatedAt,
    images: row.images.length ? row.images : row.imageUrl ? [row.imageUrl] : [],
    originalArticles: row.originals.map((link) => link.originalCode),
    offers: productOffers(row),
  };
}

function photoUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    /* Report the invalid field below. */
  }
  throw new BadRequestException('Укажите ссылки на фотографии в формате HTTPS.');
}
