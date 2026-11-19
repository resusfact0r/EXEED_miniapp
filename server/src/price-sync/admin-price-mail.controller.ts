import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { WAREHOUSE_CODE } from '../catalog/offers';
import { PriceSyncService } from './price-sync.service';

class MailColumns {
  @IsOptional() @IsString() @MaxLength(140) code?: string;
  @IsOptional() @IsString() @MaxLength(140) name?: string;
  @IsOptional() @IsString() @MaxLength(140) price?: string;
  @IsOptional() @IsString() @MaxLength(140) stock?: string;
  @IsOptional() @IsString() @MaxLength(140) pack?: string;
  @IsOptional() @IsString() @MaxLength(140) brand?: string;
}

class MailRequest {
  @Matches(WAREHOUSE_CODE) warehouseCode!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(5, { each: true })
  @MaxLength(200, { each: true })
  subjects!: string[];
  @IsOptional() @IsString() @MaxLength(180) attachment?: string;
  @IsOptional() @IsString() @MaxLength(140) sheet?: string;
  @IsOptional() @ValidateNested() @Type(() => MailColumns) columns?: MailColumns;
}
class ConnectMailRequest extends MailRequest {
  @Matches(/^[a-f0-9]{64}$/) previewId!: string;
}

@Controller('admin/catalog/mail')
@UseGuards(AdminAuthGuard)
export class AdminPriceMailController {
  constructor(private readonly prices: PriceSyncService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  overview() {
    return this.prices.mailOverview();
  }

  @Post('preview')
  @Header('Cache-Control', 'no-store')
  preview(@Body() dto: MailRequest) {
    return this.prices.previewMail(dto);
  }

  @Post('connect')
  @Header('Cache-Control', 'no-store')
  connect(@Body() dto: ConnectMailRequest) {
    return this.prices.connectMail(dto);
  }
}
