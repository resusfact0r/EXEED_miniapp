import { Module } from '@nestjs/common';

import { DeliveryController } from './delivery.controller';
import { CdekService } from './cdek.service';
import { YandexService } from './yandex.service';

@Module({
  exports: [CdekService],
  controllers: [DeliveryController],
  providers: [CdekService, YandexService],
})
export class DeliveryModule {}
