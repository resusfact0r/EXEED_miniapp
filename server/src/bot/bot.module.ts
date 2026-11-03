import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { BotController } from './bot.controller';
import { BotPollingService } from './bot-polling.service';
import { BotService } from './bot.service';

@Module({
  imports: [OrdersModule],
  controllers: [BotController],
  providers: [BotService, BotPollingService],
  exports: [BotPollingService],
})
export class BotModule {}
