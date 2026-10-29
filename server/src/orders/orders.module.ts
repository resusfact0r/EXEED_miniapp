import { Module } from '@nestjs/common';

import { AvtoligaModule } from '../avtoliga/avtoliga.module';
import { OrdersController } from './orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersService } from './orders.service';
import { ExternalNotifyService } from './external-notify.service';
import { OrderTelegramNotifyService } from './order-telegram-notify.service';

@Module({
  imports: [AvtoligaModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService, ExternalNotifyService, OrderTelegramNotifyService],
  exports: [OrdersService],
})
export class OrdersModule {}
