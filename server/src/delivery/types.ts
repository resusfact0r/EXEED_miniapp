export interface NormalizedPvz {
  carrier: 'CDEK' | 'YANDEX';
  id: string;
  address: string;
  name?: string;
  workingHours?: string;
  /** Approximate time to deliver an order to this pickup point, e.g. "1-3 дня". */
  estimatedDeliveryDays?: string;
  lat?: number;
  lon?: number;
}

export interface PvzPage {
  items: NormalizedPvz[];
  /** True if requesting the next page is likely to return more results. */
  hasMore: boolean;
}

export interface NormalizedCity {
  code: number;
  name: string;
  region?: string;
}
