import { createContext, useContext, useMemo, useState, type FC, type PropsWithChildren } from 'react';

import type { DeliveryCarrier, FulfillmentType, PaymentMethod, PickupAddress } from '@/api/types.ts';

export interface CheckoutState {
  fulfillmentType: FulfillmentType | null;
  pickupAddressCode: PickupAddress['code'] | null;
  pickupAddressLabel: string | null;
  deliveryCarrier: DeliveryCarrier | null;
  /** CDEK's numeric city code (needed for the CDEK PVZ API) - null for Yandex, which takes a name. */
  cityCode: number | null;
  cityName: string | null;
  /** Needed to tell namesake settlements apart when matching Yandex's own city names. */
  cityRegion: string | null;
  deliveryPvzId: string | null;
  deliveryPvzAddress: string | null;
  paymentMethod: PaymentMethod | null;
  orgCardDetails: string;
  policyAcknowledged: boolean;
}

const initialState: CheckoutState = {
  fulfillmentType: null,
  pickupAddressCode: null,
  pickupAddressLabel: null,
  deliveryCarrier: null,
  cityCode: null,
  cityName: null,
  cityRegion: null,
  deliveryPvzId: null,
  deliveryPvzAddress: null,
  paymentMethod: null,
  orgCardDetails: '',
  policyAcknowledged: false,
};

interface CheckoutContextValue {
  state: CheckoutState;
  setState: (patch: Partial<CheckoutState>) => void;
  reset: () => void;
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null);

export const CheckoutProvider: FC<PropsWithChildren> = ({ children }) => {
  const [state, setStateRaw] = useState<CheckoutState>(initialState);

  const value = useMemo<CheckoutContextValue>(
    () => ({
      state,
      setState: (patch) => setStateRaw((prev) => ({ ...prev, ...patch })),
      reset: () => setStateRaw(initialState),
    }),
    [state],
  );

  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
};

export function useCheckout() {
  const ctx = useContext(CheckoutContext);
  if (!ctx) {
    throw new Error('useCheckout must be used within CheckoutProvider');
  }
  return ctx;
}
