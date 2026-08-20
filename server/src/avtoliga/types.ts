export interface AvtoligaPriceEntry {
  StoreId: string;
  Count: number;
  Price: number;
  InPackage: number;
  Shipment: string;
}

export interface AvtoligaSparePart {
  Articul: string;
  Name: string;
  Vendor: string;
  Prices: AvtoligaPriceEntry[];
}

export interface AvtoligaPartsResponse {
  Status: 0 | 1;
  Message?: string;
  SpareParts?: AvtoligaSparePart[];
  UndefinedSpareParts?: { Articul: string }[];
}

/** Live price/stock for one of our products, derived from Avtoliga's response. */
export interface LivePrice {
  /** Our shop price = Avtoliga's cheapest matching-store price + markup. */
  price: number;
  /** Stock at the store that offered the cheapest price. */
  stockQty: number;
}
