import { Module } from '@nestjs/common';

import { PriceSyncService } from './price-sync.service';

@Module({
  providers: [PriceSyncService],
})
export class PriceSyncModule {}
