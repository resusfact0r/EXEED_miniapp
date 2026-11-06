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
   * one that has the wanted quantity is taken (`quantities`, default 1 per code) and our markup
   * is applied on top of it. If no store has enough, the one with the most stock is reported, so
   * the caller can tell the customer how many there are.
   *
   * Throws AvtoligaUnavailableError if the supplier can't be reached or returns an error -
   * callers should treat this as "cannot verify price right now", not as "product doesn't exist".
   * Codes with no matching live entry are simply absent from the returned map.
   */
  async getLivePrices(codes: string[], quantities: Record<string, number> = {}): Promise<Map<string, LivePrice>> {
    const result = new Map<string, LivePrice>();
    for (let i = 0; i < codes.length; i += BATCH_SIZE) {
      const batch = codes.slice(i, i + BATCH_SIZE);
      const parts = await this.fetchBatch(batch, quantities);
      this.mergeInto(result, parts, quantities);
    }
    return result;
  }

  private async fetchBatch(codes: string[], quantities: Record<string, number>) {
    const baseUrl = process.env.AVTOLIGA_API_BASE_URL ?? 'https://avtoliga-parts.ru/api/v1';
    const token = process.env.AVTOLIGA_API_TOKEN ?? '';
    const addressId = process.env.AVTOLIGA_ADDRESS_ID ?? '';

    const body = new URLSearchParams({
      Token: token,
      Data: JSON.stringify({
        AddressId: addressId,
        SpareParts: codes.map((code) => ({ Articul: code, Count: quantities[code] ?? 1 })),
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

    // A real answer accounts for every code, as found or as undefined. Status 1 with both lists
    // empty means the supplier's side has nothing to say right now (seen around midnight Moscow
    // time) - that's "can't verify", not "out of stock", and must not be shown as the latter.
    if (codes.length > 0 && !data.SpareParts?.length && !data.UndefinedSpareParts?.length) {
      throw new AvtoligaUnavailableError('Avtoliga returned an empty answer');
    }

    return data.SpareParts ?? [];
  }

  private mergeInto(
    result: Map<string, LivePrice>,
    parts: AvtoligaPartsResponse['SpareParts'],
    quantities: Record<string, number>,
  ) {
    const vendorFilter = process.env.AVTOLIGA_VENDOR_FILTER ?? 'CHERY';

    for (const part of parts ?? []) {
      if (part.Vendor !== vendorFilter) {
        continue;
      }
      if (!part.Prices || part.Prices.length === 0) {
        continue;
      }

      const wanted = quantities[part.Articul] ?? 1;
      for (const store of part.Prices) {
        const candidate: LivePrice = {
          price: applyMarkup(store.Price),
          cost: store.Price,
          stockQty: store.Count,
          packQty: Math.max(1, store.InPackage || 1),
        };
        const existing = result.get(part.Articul);
        if (!existing || this.isBetter(candidate, existing, wanted)) {
          result.set(part.Articul, candidate);
        }
      }
    }
  }

  /** A store that can supply the whole quantity beats one that can't; then cheaper wins; among
   *  stores that can't, more stock wins (that's the number worth telling the customer). */
  private isBetter(candidate: LivePrice, existing: LivePrice, wanted: number): boolean {
    const candidateEnough = candidate.stockQty >= wanted;
    const existingEnough = existing.stockQty >= wanted;
    if (candidateEnough !== existingEnough) {
      return candidateEnough;
    }
    return candidateEnough ? candidate.price < existing.price : candidate.stockQty > existing.stockQty;
  }
}
