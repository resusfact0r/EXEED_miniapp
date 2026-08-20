import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FC, type PropsWithChildren } from 'react';

import { addCartItem, clearCart as clearCartRequest, getCart, removeCartItem, updateCartItem } from '@/api/cart.ts';
import type { Cart } from '@/api/types.ts';

interface CartContextValue {
  cart: Cart | null;
  loading: boolean;
  error: string | null;
  itemCount: number;
  refresh: () => Promise<void>;
  addItem: (productId: string, quantity: number) => Promise<{ capped?: boolean }>;
  updateItem: (productId: string, quantity: number) => Promise<{ capped?: boolean }>;
  removeItem: (productId: string) => Promise<void>;
  clear: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export const CartProvider: FC<PropsWithChildren> = ({ children }) => {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCart();
      setCart(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addItem = useCallback(async (productId: string, quantity: number) => {
    const data = await addCartItem(productId, quantity);
    setCart(data);
    return { capped: data.capped };
  }, []);

  const updateItem = useCallback(async (productId: string, quantity: number) => {
    const data = await updateCartItem(productId, quantity);
    setCart(data);
    return { capped: data.capped };
  }, []);

  const removeItem = useCallback(async (productId: string) => {
    const data = await removeCartItem(productId);
    setCart(data);
  }, []);

  const clear = useCallback(async () => {
    const data = await clearCartRequest();
    setCart(data);
  }, []);

  const itemCount = useMemo(
    () => cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
    [cart],
  );

  const value = useMemo(
    () => ({ cart, loading, error, itemCount, refresh, addItem, updateItem, removeItem, clear }),
    [cart, loading, error, itemCount, refresh, addItem, updateItem, removeItem, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within CartProvider');
  }
  return ctx;
}
