import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { TelegramAuthGuard } from '../common/guards/telegram-auth.guard';
import { PICKUP_ADDRESSES } from './pickup-addresses';
import { CdekService } from './cdek.service';
import { YandexService } from './yandex.service';

class PvzQueryDto {
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

  @Get('cdek/pvz')
  getCdekPvz(@Query() query: PvzQueryDto) {
    return this.cdekService.getPvz(query.page, query.pageSize);
  }

  @Get('yandex/pvz')
  getYandexPvz(@Query('city') city = '') {
    return this.yandexService.getPvz(city);
  }
}
