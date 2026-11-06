export interface PickupPoint {
  code: 'ADDRESS_1';
  label: string;
  /** Left out until the real working hours are known: customers shouldn't be sent invented ones. */
  schedule?: string;
}

export const PICKUP_ADDRESSES: PickupPoint[] = [{ code: 'ADDRESS_1', label: 'Москва, Новоивановское, вл.110' }];
