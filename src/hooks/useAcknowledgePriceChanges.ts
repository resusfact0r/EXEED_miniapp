import { useEffect } from 'react';

import { acknowledgeCartPrices } from '@/api/cart.ts';
import type { Cart } from '@/api/types.ts';

/**
 * Once a screen has shown the "price changed" warning, tell the backend: the warning stays on
 * this screen, but won't come back until the price moves again.
 */
export function useAcknowledgePriceChanges(cart: Cart | null): void {
  const hasChanges = cart?.items.some((line) => line.priceChanged) ?? false;
  useEffect(() => {
    if (hasChanges) {
      acknowledgeCartPrices().catch(() => undefined);
    }
  }, [cart, hasChanges]);
}
