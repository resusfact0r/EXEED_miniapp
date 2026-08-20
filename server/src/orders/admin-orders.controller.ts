import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional } from 'class-validator';
import { OrderStatus } from '@prisma/client';

import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { OrdersService } from './orders.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

@Controller('admin/orders')
@UseGuards(AdminAuthGuard)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Query() query: ListOrdersQueryDto) {
    return this.ordersService.listForAdmin(query.status);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateForAdmin(id, dto);
  }
}
