import { apiClient } from '@/api/client.ts';
import type { Cart } from '@/api/types.ts';

export const getCart = () => apiClient.get<Cart>('/cart');

export const addCartItem = (productId: string, quantity: number) =>
  apiClient.post<Cart>('/cart/items', { productId, quantity });

export const updateCartItem = (productId: string, quantity: number) =>
  apiClient.patch<Cart>(`/cart/items/${productId}`, { quantity });

export const removeCartItem = (productId: string) => apiClient.delete<Cart>(`/cart/items/${productId}`);

export const clearCart = () => apiClient.delete<Cart>('/cart');
