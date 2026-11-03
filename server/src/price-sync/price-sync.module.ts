import { Module } from '@nestjs/common';

import { PriceSyncService } from './price-sync.service';

@Module({
  providers: [PriceSyncService],
  exports: [PriceSyncService],
})
export class PriceSyncModule {}
