import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';

import { TelegramAuthGuard } from '../common/guards/telegram-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Controller('cart')
@UseGuards(TelegramAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  getCart(@CurrentUser() user: User) {
    return this.cartService.getCart(user.id);
  }

  @Post('items')
  addItem(@CurrentUser() user: User, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.id, dto.productId, dto.quantity);
  }

  @Patch('items/:productId')
  updateItem(
    @CurrentUser() user: User,
    @Param('productId') productId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(user.id, productId, dto.quantity);
  }

  @Post('acknowledge-prices')
  acknowledgePrices(@CurrentUser() user: User) {
    return this.cartService.acknowledgePrices(user.id);
  }

  @Delete('items/:productId')
  removeItem(@CurrentUser() user: User, @Param('productId') productId: string) {
    return this.cartService.removeItem(user.id, productId);
  }

  @Delete()
  clearCart(@CurrentUser() user: User) {
    return this.cartService.clearCart(user.id);
  }
}
