import { Module } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { PriceSyncModule } from '../price-sync/price-sync.module';
import { MonitoringController } from './monitoring.controller';

@Module({
  imports: [BotModule, PriceSyncModule],
  controllers: [MonitoringController],
})
export class MonitoringModule {}
