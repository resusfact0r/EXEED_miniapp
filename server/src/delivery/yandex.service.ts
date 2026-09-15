import { Injectable, Logger } from '@nestjs/common';

import { paginateAndFilter } from './pvz-search';
import type { NormalizedPvz, PvzPage } from './types';

// TODO: estimatedDeliveryDays is a stub - replace with a real calculation once Yandex
// Delivery's tariff/ETA endpoint is wired up.
const MOCK_PVZ: NormalizedPvz[] = [
  { carrier: 'YANDEX', id: 'YND001', address: 'г. Москва, ул. Демонстрационная, д. 2', name: 'Яндекс ПВЗ Демонстрационная', workingHours: '09:00-22:00', estimatedDeliveryDays: '1-2 дня' },
  { carrier: 'YANDEX', id: 'YND002', address: 'г. Москва, ул. Образцовая, д. 8', name: 'Яндекс ПВЗ Образцовая', workingHours: '10:00-21:00', estimatedDeliveryDays: '2-3 дня' },
];

const STUB_ESTIMATED_DELIVERY_DAYS = '1-2 дня';

/**
 * Exact endpoint/header names should be confirmed against current Yandex Delivery API
 * docs at implementation time — isolated behind this service so any change stays local.
 * Still mocked as of now (no YANDEX_DELIVERY_API_KEY yet) - the real-API path below is
 * unverified against a live account, unlike CdekService's.
 */
@Injectable()
export class YandexService {
  private readonly logger = new Logger(YandexService.name);

  async getPvz(city: string, page = 1, pageSize = 20, query = ''): Promise<PvzPage> {
    if (process.env.YANDEX_MOCKED !== 'false') {
      return paginateAndFilter(MOCK_PVZ, page, pageSize, query);
    }

    try {
      const baseUrl = process.env.YANDEX_DELIVERY_API_BASE_URL ?? '';
      const apiKey = process.env.YANDEX_DELIVERY_API_KEY ?? '';
      const url = new URL('/api/b2b/platform/pickup-points', baseUrl);
      if (city) {
        url.searchParams.set('city', city);
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        throw new Error(`Yandex Delivery API responded with ${response.status}`);
      }

      const data: Array<{
        id: string;
        address?: { full_address?: string };
        name?: string;
        schedule?: string;
        position?: { latitude?: number; longitude?: number };
      }> = await response.json();

      const items = data.map((point) => ({
        carrier: 'YANDEX' as const,
        id: point.id,
        address: point.address?.full_address ?? '',
        name: point.name,
        workingHours: point.schedule,
        estimatedDeliveryDays: STUB_ESTIMATED_DELIVERY_DAYS,
        lat: point.position?.latitude,
        lon: point.position?.longitude,
      }));

      return paginateAndFilter(items, page, pageSize, query);
    } catch (err) {
      this.logger.error(`Failed to fetch Yandex Delivery PVZ list, falling back to empty list: ${(err as Error).message}`);
      return { items: [], hasMore: false, total: 0 };
    }
  }
}
