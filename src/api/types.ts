export interface UserProfile {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  hasPhone: boolean;
  preferredFulfillmentType: FulfillmentType | null;
  preferredDeliveryCarrier: DeliveryCarrier | null;
  preferredPaymentMethod: PaymentMethod | null;
}

export interface UpdatePreferencesPayload {
  preferredFulfillmentType?: FulfillmentType;
  preferredDeliveryCarrier?: DeliveryCarrier;
  preferredPaymentMethod?: PaymentMethod;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  price: string;
  stockQty: number;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
}

export interface SearchProductsResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CartLine {
  productId: string;
  quantity: number;
  product: Pick<Product, 'id' | 'code' | 'name' | 'price' | 'stockQty'>;
  lineTotal: string;
  /** Catalog price at the moment this item was first added to the cart. */
  priceAtAdd: string;
  /** True if the catalog price has moved since this item was added. */
  priceChanged: boolean;
}

export interface Cart {
  items: CartLine[];
  subtotal: string;
  capped?: boolean;
}

export interface PickupAddress {
  code: 'ADDRESS_1' | 'ADDRESS_2';
  label: string;
  schedule: string;
}

export interface Pvz {
  carrier: 'CDEK' | 'YANDEX';
  id: string;
  address: string;
  /** Street and house only - the city is already chosen above the list. */
  shortAddress?: string;
  name?: string;
  workingHours?: string;
  estimatedDeliveryDays?: string;
  lat?: number;
  lon?: number;
}

export interface PvzPage {
  items: Pvz[];
  hasMore: boolean;
  total: number;
}

export interface Carrier {
  key: DeliveryCarrier;
  label: string;
}

export interface City {
  code: number;
  name: string;
  region?: string;
}

export type FulfillmentType = 'PICKUP' | 'DELIVERY';
export type DeliveryCarrier = 'CDEK' | 'YANDEX';
export type PaymentMethod = 'QR_LINK' | 'LEGAL_ENTITY';
export type OrderStatus =
  | 'NEW'
  | 'AWAITING_PAYMENT_LINK'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface CreateOrderPayload {
  fulfillmentType: FulfillmentType;
  pickupAddressCode?: PickupAddress['code'];
  deliveryCarrier?: DeliveryCarrier;
  deliveryPvzId?: string;
  deliveryPvzAddress?: string;
  paymentMethod: PaymentMethod;
  orgCardDetails?: string;
  policyAcknowledged: boolean;
}

export interface OrderItemDto {
  id: string;
  productCode: string;
  productName: string;
  unitPrice: string;
  quantity: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  pickupAddressLabel: string | null;
  deliveryCarrier: DeliveryCarrier | null;
  deliveryPvzId: string | null;
  deliveryPvzAddress: string | null;
  paymentMethod: PaymentMethod;
  orgCardDetails: string | null;
  paymentLink: string | null;
  totalAmount: string;
  createdAt: string;
  items: OrderItemDto[];
}

export interface RequestedContactPayload {
  user_id: number;
  phone_number: string;
  first_name?: string;
  last_name?: string;
}
