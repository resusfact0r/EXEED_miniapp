import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DeliveryCarrier, FulfillmentType, PaymentMethod, PickupAddress } from '@prisma/client';

/** One cart line exactly as the customer saw it on the checkout screen. */
export class ExpectedItemDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @Matches(/^\d+(\.\d{1,2})?$/)
  unitPrice!: string;
}

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

  /**
   * What the checkout screen showed. The order is only placed if the live supplier check agrees
   * with it - otherwise the customer would be charged a sum they never saw. Optional only so a
   * Mini App bundle cached from before this field existed still works; those orders are checked
   * against the catalog price instead.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExpectedItemDto)
  expectedItems?: ExpectedItemDto[];
}
