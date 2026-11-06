import { Module } from '@nestjs/common';

import { AvtoligaModule } from '../avtoliga/avtoliga.module';
import { BotModule } from '../bot/bot.module';
import { PriceSyncModule } from '../price-sync/price-sync.module';
import { MonitoringController } from './monitoring.controller';

@Module({
  imports: [AvtoligaModule, BotModule, PriceSyncModule],
  controllers: [MonitoringController],
})
export class MonitoringModule {}
