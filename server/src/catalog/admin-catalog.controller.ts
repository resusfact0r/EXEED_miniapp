import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { CatalogService } from './catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 50;
}

@Controller('admin/products')
@UseGuards(AdminAuthGuard)
export class AdminCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  list(@Query() query: PaginationDto) {
    return this.catalogService.listAllForAdmin(query.page ?? 1, query.pageSize ?? 50);
  }

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.catalogService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.catalogService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.catalogService.softDelete(id);
  }
}
