import { Module } from '@nestjs/common';

import { AvtoligaModule } from '../avtoliga/avtoliga.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [AvtoligaModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
