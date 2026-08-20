import { apiClient } from '@/api/client.ts';
import type { CreateOrderPayload, Order } from '@/api/types.ts';

export const createOrder = (payload: CreateOrderPayload) => apiClient.post<Order>('/orders', payload);

export const listOrders = () => apiClient.get<Order[]>('/orders');

export const getOrder = (id: string) => apiClient.get<Order>(`/orders/${id}`);
