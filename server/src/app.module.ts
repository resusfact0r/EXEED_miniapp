import { Controller, Get, Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BotModule } from './bot/bot.module';
import { CatalogModule } from './catalog/catalog.module';
import { CartModule } from './cart/cart.module';
import { DeliveryModule } from './delivery/delivery.module';
import { OrdersModule } from './orders/orders.module';
import { PriceSyncModule } from './price-sync/price-sync.module';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    // Not a captcha (doesn't fit the Mini App WebView, and initData's HMAC signature already
    // requires a real Telegram session to reach any endpoint) - just a baseline limit against
    // automated hammering. Individual endpoints can tighten this further via @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    PrismaModule,
    AuthModule,
    BotModule,
    CatalogModule,
    CartModule,
    DeliveryModule,
    OrdersModule,
    PriceSyncModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
