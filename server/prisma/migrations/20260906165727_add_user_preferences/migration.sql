-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredDeliveryCarrier" "DeliveryCarrier",
ADD COLUMN     "preferredFulfillmentType" "FulfillmentType",
ADD COLUMN     "preferredPaymentMethod" "PaymentMethod";
