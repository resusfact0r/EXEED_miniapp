import { Equals, IsEnum, IsString, MinLength, ValidateIf } from 'class-validator';
import { DeliveryCarrier, FulfillmentType, PaymentMethod, PickupAddress } from '@prisma/client';

export class CreateOrderDto {
  @IsEnum(FulfillmentType)
  fulfillmentType!: FulfillmentType;

  @ValidateIf((o) => o.fulfillmentType === FulfillmentType.PICKUP)
  @IsEnum(PickupAddress)
  pickupAddressCode?: PickupAddress;

  @ValidateIf((o) => o.fulfillmentType === FulfillmentType.DELIVERY)
  @IsEnum(DeliveryCarrier)
  deliveryCarrier?: DeliveryCarrier;

  @ValidateIf((o) => o.fulfillmentType === FulfillmentType.DELIVERY)
  @IsString()
  @MinLength(1)
  deliveryPvzId?: string;

  @ValidateIf((o) => o.fulfillmentType === FulfillmentType.DELIVERY)
  @IsString()
  @MinLength(1)
  deliveryPvzAddress?: string;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ValidateIf((o) => o.paymentMethod === PaymentMethod.LEGAL_ENTITY)
  @IsString()
  @MinLength(1)
  orgCardDetails?: string;

  @Equals(true)
  policyAcknowledged!: boolean;
}
