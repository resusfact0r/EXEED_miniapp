import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { TelegramAuthGuard } from '../common/guards/telegram-auth.guard';
import { PICKUP_ADDRESSES } from './pickup-addresses';
import { CdekService } from './cdek.service';
import { YandexService } from './yandex.service';

class PvzQueryDto {
  @Type(() => Number)
  @IsInt()
  cityCode!: number;

  @IsOptional()
  @IsString()
  query?: string = '';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}

@Controller('delivery')
@UseGuards(TelegramAuthGuard)
export class DeliveryController {
  constructor(
    private readonly cdekService: CdekService,
    private readonly yandexService: YandexService,
  ) {}

  @Get('pickup-addresses')
  getPickupAddresses() {
    return PICKUP_ADDRESSES;
  }

  /**
   * A carrier still in mock mode would show made-up pickup points ("ул. Демонстрационная") that
   * a real customer could place an order against, so outside development we only advertise
   * carriers wired to a real API. Yandex reappears here automatically once
   * YANDEX_DELIVERY_API_KEY is set and YANDEX_MOCKED=false.
   */
  @Get('carriers')
  getCarriers() {
    const isDev = process.env.NODE_ENV !== 'production';
    const carriers = [
      { key: 'CDEK', label: 'СДЭК', mocked: process.env.CDEK_MOCKED !== 'false' },
      { key: 'YANDEX', label: 'Яндекс.Доставка', mocked: process.env.YANDEX_MOCKED !== 'false' },
    ];
    return carriers.filter((c) => isDev || !c.mocked).map(({ key, label }) => ({ key, label }));
  }

  @Get('cdek/cities')
  getCdekCities(@Query('query') query = '') {
    return this.cdekService.getCities(query);
  }

  @Get('cdek/pvz')
  getCdekPvz(@Query() query: PvzQueryDto) {
    return this.cdekService.getPvz(query.cityCode, query.page, query.pageSize, query.query);
  }

  @Get('yandex/pvz')
  getYandexPvz(
    @Query('city') city = '',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('query') query = '',
  ) {
    return this.yandexService.getPvz(city, Number(page), Number(pageSize), query);
  }
}
