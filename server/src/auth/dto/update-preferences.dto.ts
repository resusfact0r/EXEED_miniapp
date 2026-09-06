import { FulfillmentType, DeliveryCarrier, PaymentMethod } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsEnum(FulfillmentType)
  preferredFulfillmentType?: FulfillmentType;

  @IsOptional()
  @IsEnum(DeliveryCarrier)
  preferredDeliveryCarrier?: DeliveryCarrier;

  @IsOptional()
  @IsEnum(PaymentMethod)
  preferredPaymentMethod?: PaymentMethod;
}
