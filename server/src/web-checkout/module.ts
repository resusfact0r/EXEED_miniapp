import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeliveryModule } from '../delivery/delivery.module';
import { AvtoligaModule } from '../avtoliga/avtoliga.module';
import { PICKUP_ADDRESSES } from '../delivery/pickup-addresses';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { getSeller } from '../legal/seller';
import { Approval, Checkout, PaymentConsent } from './model';
import { WebOrders } from './service';
import { Bank, Shipping } from './providers';

@Controller('web/checkout')
export class CheckoutController {
  constructor(private orders: WebOrders) {}
  @Get('options') options() {
    return {
      pickup: PICKUP_ADDRESSES[0].label,
      cdek: this.orders.shipping.pointsAvailable(),
      legal: Boolean(getSeller()),
    };
  }
  @Get('cities') async cities(@Query('q') q = '') {
    if (typeof q !== 'string' || q.length < 2 || q.length > 80 || !this.orders.shipping.pointsAvailable())
      return [];
    return (await this.orders.shipping.cdek.getCities(q)).slice(0, 50);
  }
  @Get('points/:city') async points(@Param('city', ParseIntPipe) city: number) {
    if (city < 1 || !this.orders.shipping.pointsAvailable()) return [];
    return (await this.orders.shipping.cdek.getAllPvzForCity(city)).map((p) => ({
      id: p.id,
      address: p.address,
    }));
  }
  @Post('orders')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  create(@Headers('x-order-key') key: string, @Body() dto: Checkout) {
    return this.orders.create(key, dto);
  }
  @Get('order')
  @Header('Cache-Control', 'private, no-store')
  async status(@Headers('x-order-key') key: string) {
    return this.orders.view(await this.orders.guest(key));
  }
  @Post('pay')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  pay(@Headers('x-order-key') key: string, @Body() dto: PaymentConsent) {
    return this.orders.pay(key, dto.totalCents);
  }
  @Post('subscribe') subscription(@Headers('x-order-key') key: string) {
    return this.orders.subscribe(key);
  }
  @Post('yookassa')
  @HttpCode(200)
  async webhook(@Body() event: { event?: string; object?: { id?: string } }) {
    if (!['payment.succeeded', 'payment.canceled'].includes(event?.event || '')) return;
    const id = event.object?.id;
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new BadRequestException();
    await this.orders.payment(id);
    return { ok: true };
  }
}
@Controller('admin/web-orders')
@UseGuards(AdminAuthGuard)
export class WarehouseController {
  constructor(private orders: WebOrders) {}
  @Get() @Header('Cache-Control', 'no-store') list(@Query('before') before?: string) {
    if (before && !/^[1-9]\d{0,8}$/.test(before)) throw new BadRequestException();
    return this.orders.list(Number(before) || undefined);
  }
  @Post(':n/approve') async approve(@Param('n', ParseIntPipe) n: number, @Body() dto: Approval) {
    return this.orders.view(await this.orders.approve(n, dto));
  }
  @Post(':n/packed') async packed(@Param('n', ParseIntPipe) n: number) {
    return this.orders.view(await this.orders.packed(n));
  }
  @Post(':n/complete') async complete(@Param('n', ParseIntPipe) n: number) {
    return this.orders.view(await this.orders.complete(n));
  }
  @Get(':n/label')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'application/pdf')
  async label(@Param('n', ParseIntPipe) n: number) {
    return new StreamableFile(await this.orders.label(n));
  }
}
@Module({
  imports: [AvtoligaModule, DeliveryModule],
  controllers: [CheckoutController, WarehouseController],
  providers: [WebOrders, Bank, Shipping],
})
export class WebCheckoutModule {}
