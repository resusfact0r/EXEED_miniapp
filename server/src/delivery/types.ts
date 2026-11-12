export interface NormalizedPvz {
  carrier: 'CDEK' | 'YANDEX';
  id: string;
  /** Full address incl. postcode/region/city - what gets stored on the order for the operator. */
  address: string;
  /** Street and house only - for the picker list, where the city is already known and every
   *  row repeating "109544, Россия, Москва, Москва, ..." is just noise. */
  shortAddress?: string;
  name?: string;
  workingHours?: string;
  /** Approximate time to deliver an order to this pickup point, e.g. "1-3 дня". */
  estimatedDeliveryDays?: string;
  /** Lower-bound delivery cost in rubles for a nominal 1 kg parcel ("от N ₽"). */
  estimatedDeliveryCost?: number;
  lat?: number;
  lon?: number;
}

export interface PvzPage {
  items: NormalizedPvz[];
  /** True if requesting the next page is likely to return more results. */
  hasMore: boolean;
  /** Total matches for the current city/query - lets the UI show "found N". */
  total: number;
}

export interface NormalizedCity {
  code: number;
  name: string;
  region?: string;
  /** District between the settlement and the region ("Одинцовский городской округ"), to tell
   *  namesakes apart in the list. */
  area?: string;
}
