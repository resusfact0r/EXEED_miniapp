import { Module } from '@nestjs/common';

import { AdminPriceMailController } from './admin-price-mail.controller';
import { PriceSyncService } from './price-sync.service';

@Module({
  controllers: [AdminPriceMailController],
  providers: [PriceSyncService],
  exports: [PriceSyncService],
})
export class PriceSyncModule {}
