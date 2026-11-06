export interface UserProfile {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  hasPhone: boolean;
  hasConsent: boolean;
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
  /** Supplier lot size: only whole multiples can be ordered (price is per piece). */
  packQty: number;
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
  product: Pick<Product, 'id' | 'code' | 'name' | 'price' | 'stockQty' | 'packQty' | 'isActive'>;
  lineTotal: string;
  /** Price the customer last saw for this line. */
  priceAtAdd: string;
  /** True if the catalog price has moved since the customer last saw it. */
  priceChanged: boolean;
}

export interface Cart {
  items: CartLine[];
  subtotal: string;
  capped?: boolean;
}

export interface PickupAddress {
  code: 'ADDRESS_1';
  label: string;
  schedule?: string;
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
  /** Lower bound for a nominal 1 kg parcel, rubles - shown as "от N ₽". */
  estimatedDeliveryCost?: number;
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
  | 'READY_FOR_PICKUP'
  | 'SHIPPED'
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
  /** The lines exactly as shown on the checkout screen - the order is refused if the live check differs. */
  expectedItems?: { productId: string; quantity: number; unitPrice: string }[];
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
  /** Goods only. */
  totalAmount: string;
  /** Exact delivery cost, set by the operator together with the payment link. */
  deliveryCost: string | null;
  trackingNumber: string | null;
  cancelReason: string | null;
  createdAt: string;
  items: OrderItemDto[];
}

export interface RequestedContactPayload {
  user_id: number;
  phone_number: string;
  first_name?: string;
  last_name?: string;
}
