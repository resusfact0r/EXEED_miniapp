import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { TelegramAuthGuard } from '../common/guards/telegram-auth.guard';
import { CatalogService } from './catalog.service';
import { SearchProductsDto } from './dto/search-products.dto';

@Controller('catalog')
@UseGuards(TelegramAuthGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('search')
  search(@Query() query: SearchProductsDto) {
    return this.catalogService.search(query.query, query.page ?? 1, query.pageSize ?? 20);
  }

  @Get('products/by-code/:code')
  getByCode(@Param('code') code: string) {
    return this.catalogService.getByCode(code);
  }

  @Get('products/:id')
  getById(@Param('id') id: string) {
    return this.catalogService.getById(id);
  }
}
