import { Module } from '@nestjs/common';

import { BotController } from './bot.controller';
import { BotPollingService } from './bot-polling.service';
import { BotService } from './bot.service';

@Module({
  controllers: [BotController],
  providers: [BotService, BotPollingService],
})
export class BotModule {}
