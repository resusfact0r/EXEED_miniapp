import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const MAX_QUERY_WORDS = 8;
const ARTICLE_SEPARATORS = /[-.\s/]/g;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every word of the query must appear in the article or the name, in any order - so
   * "масляный фильтр" finds "ФИЛЬТР МАСЛЯНЫЙ". Articles are also matched with separators removed
   * ("481F-3707010" finds 481F3707010). An exact article match goes first: searching by article
   * is the main use, and a short one like "3640" is also part of many longer articles.
   */
  async search(query: string | undefined, page: number, pageSize: number) {
    const words = (query ?? '').trim().split(/\s+/).filter(Boolean).slice(0, MAX_QUERY_WORDS);
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      AND: words.map((word) => {
        const compact = word.replace(ARTICLE_SEPARATORS, '');
        return {
          OR: [
            { code: { contains: word, mode: 'insensitive' } },
            ...(compact && compact !== word ? [{ code: { contains: compact, mode: 'insensitive' as const } }] : []),
            { name: { contains: word, mode: 'insensitive' } },
          ],
        };
      }),
    };

    const article = words.length === 1 ? words[0].replace(ARTICLE_SEPARATORS, '') : '';
    const exact = article
      ? await this.prisma.product.findFirst({ where: { isActive: true, code: { equals: article, mode: 'insensitive' } } })
      : null;

    // With the exact match pinned to the top of page 1, the rest shifts down by one.
    const offset = exact ? 1 : 0;
    const skip = Math.max(0, (page - 1) * pageSize - offset);
    const take = page === 1 ? pageSize - offset : pageSize;
    const [rest, total] = await Promise.all([
      this.prisma.product.findMany({
        where: exact ? { ...where, id: { not: exact.id } } : where,
        skip,
        take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    const items = exact && page === 1 ? [exact, ...rest] : rest;
    return { items, total, page, pageSize };
  }

  async getById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || !product.isActive) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async getByCode(code: string) {
    const product = await this.prisma.product.findUnique({ where: { code } });
    if (!product || !product.isActive) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  listAllForAdmin(page: number, pageSize: number) {
    return this.prisma.product.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { updatedAt: 'desc' },
    });
  }

  create(dto: CreateProductDto) {
    return this.prisma.product.create({ data: dto });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.assertExists(id);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async softDelete(id: string) {
    await this.assertExists(id);
    return this.prisma.product.update({ where: { id }, data: { isActive: false } });
  }

  private async assertExists(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }
}
