import { Injectable, Logger } from '@nestjs/common';

import { applyMarkup } from './markup';
import type { AvtoligaPartsResponse, LivePrice } from './types';

const BATCH_SIZE = 200;

export class AvtoligaUnavailableError extends Error {}

@Injectable()
export class AvtoligaService {
  private readonly logger = new Logger(AvtoligaService.name);

  /**
   * Looks up live prices/stock for the given product codes directly from the supplier.
   * Only entries whose Vendor matches AVTOLIGA_VENDOR_FILTER are trusted (a raw Articul can
   * collide across unrelated brands in Avtoliga's system). Among matching stores, the cheapest
   * price is taken and our markup is applied on top of it.
   *
   * Throws AvtoligaUnavailableError if the supplier can't be reached or returns an error -
   * callers should treat this as "cannot verify price right now", not as "product doesn't exist".
   * Codes with no matching live entry are simply absent from the returned map.
   */
  async getLivePrices(codes: string[]): Promise<Map<string, LivePrice>> {
    const result = new Map<string, LivePrice>();
    for (let i = 0; i < codes.length; i += BATCH_SIZE) {
      const batch = codes.slice(i, i + BATCH_SIZE);
      const parts = await this.fetchBatch(batch);
      this.mergeInto(result, parts);
    }
    return result;
  }

  private async fetchBatch(codes: string[]) {
    const baseUrl = process.env.AVTOLIGA_API_BASE_URL ?? 'https://avtoliga-parts.ru/api/v1';
    const token = process.env.AVTOLIGA_API_TOKEN ?? '';
    const addressId = process.env.AVTOLIGA_ADDRESS_ID ?? '';

    const body = new URLSearchParams({
      Token: token,
      Data: JSON.stringify({
        AddressId: addressId,
        SpareParts: codes.map((code) => ({ Articul: code, Count: 1 })),
      }),
    });

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/get/parts/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new AvtoligaUnavailableError(`Avtoliga request failed: ${(err as Error).message}`);
    }

    let data: AvtoligaPartsResponse;
    try {
      data = await response.json();
    } catch {
      throw new AvtoligaUnavailableError('Avtoliga returned a non-JSON response');
    }

    if (data.Status !== 1) {
      throw new AvtoligaUnavailableError(data.Message ?? 'Avtoliga returned an error status');
    }

    return data.SpareParts ?? [];
  }

  private mergeInto(result: Map<string, LivePrice>, parts: AvtoligaPartsResponse['SpareParts']) {
    const vendorFilter = process.env.AVTOLIGA_VENDOR_FILTER ?? 'CHERY';

    for (const part of parts ?? []) {
      if (part.Vendor !== vendorFilter) {
        continue;
      }
      if (!part.Prices || part.Prices.length === 0) {
        continue;
      }

      const cheapest = part.Prices.reduce((min, p) => (p.Price < min.Price ? p : min));
      const existing = result.get(part.Articul);
      const markedUpPrice = applyMarkup(cheapest.Price);

      if (!existing || markedUpPrice < existing.price) {
        result.set(part.Articul, { price: markedUpPrice, stockQty: cheapest.Count });
      }
    }
  }
}
