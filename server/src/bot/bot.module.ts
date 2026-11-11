import { Module } from '@nestjs/common';

import { AvtoligaModule } from '../avtoliga/avtoliga.module';
import { OrdersModule } from '../orders/orders.module';
import { BotController } from './bot.controller';
import { BotPollingService } from './bot-polling.service';
import { BotService } from './bot.service';
import { PartLookupService } from './part-lookup.service';

@Module({
  imports: [OrdersModule, AvtoligaModule],
  controllers: [BotController],
  providers: [BotService, BotPollingService, PartLookupService],
  exports: [BotPollingService],
})
export class BotModule {}
