import type { Order } from '@/api/types.ts';

/** What the customer pays: goods plus delivery, once the operator has priced the delivery. */
export function payableAmount(order: Pick<Order, 'totalAmount' | 'deliveryCost'>): number {
  return Number(order.totalAmount) + Number(order.deliveryCost ?? 0);
}
