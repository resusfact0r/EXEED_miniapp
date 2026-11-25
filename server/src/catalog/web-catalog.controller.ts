import { Controller, Get, Param, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { WebCatalogService } from './web-catalog.service';

class WebSearchDto {
  @IsOptional() @IsString() @MaxLength(200) query?: string;
  @IsOptional() @IsString() @MaxLength(50) brand?: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  @IsOptional() @IsString() @MaxLength(128) category?: string;
  @IsOptional() @IsIn(['true', 'false']) inStock?: string;
  @IsOptional() @IsIn(['name', 'price-asc', 'price-desc']) sort?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

/** Public, read-only browsing. Cart, account and order routes still require Telegram auth. */
@Controller('web')
export class WebCatalogController {
  constructor(private readonly catalog: WebCatalogService) {}

  @Get('catalog') metadata() { return this.catalog.metadata(); }

  @Get('products') search(@Query() query: WebSearchDto) {
    return this.catalog.search({ ...query, inStock: query.inStock === 'true' });
  }

  @Get('products/:code') product(@Param('code') code: string) { return this.catalog.product(code); }
}
