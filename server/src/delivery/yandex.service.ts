import { Injectable, Logger } from '@nestjs/common';

import { normalizeLocality, regionsMatch } from './locality';
import { paginateAndFilter } from './pvz-search';
import type { NormalizedPvz, PvzPage } from './types';

const MOCK_PVZ: NormalizedPvz[] = [
  { carrier: 'YANDEX', id: 'YND001', address: 'г. Москва, ул. Демонстрационная, д. 2', name: 'Яндекс ПВЗ Демонстрационная', workingHours: '09:00-22:00', estimatedDeliveryDays: '1-2 дня' },
  { carrier: 'YANDEX', id: 'YND002', address: 'г. Москва, ул. Образцовая, д. 8', name: 'Яндекс ПВЗ Образцовая', workingHours: '10:00-21:00', estimatedDeliveryDays: '2-3 дня' },
];

// TODO: stub - replace with a real ETA once Yandex's tariff/ETA endpoint is wired up.
const STUB_ESTIMATED_DELIVERY_DAYS = '1-2 дня';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DAY_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

interface YandexPoint {
  id: string;
  name?: string;
  type?: string;
  position?: { latitude?: number; longitude?: number };
  address?: { locality?: string; region?: string; full_address?: string };
  schedule?: {
    restrictions?: Array<{
      days?: number[];
      time_from?: { hours?: number; minutes?: number };
      time_to?: { hours?: number; minutes?: number };
    }>;
  };
}

function pad(n = 0): string {
  return String(n).padStart(2, '0');
}

/**
 * Yandex returns opening hours as per-weekday structs; collapse consecutive days sharing the
 * same interval into "Пн-Пт 09:00-21:00" so the list stays readable.
 */
function formatSchedule(schedule: YandexPoint['schedule']): string | undefined {
  const restrictions = schedule?.restrictions;
  if (!restrictions?.length) {
    return undefined;
  }

  const byInterval = new Map<string, number[]>();
  for (const r of restrictions) {
    const interval = `${pad(r.time_from?.hours)}:${pad(r.time_from?.minutes)}-${pad(r.time_to?.hours)}:${pad(r.time_to?.minutes)}`;
    const days = byInterval.get(interval) ?? [];
    days.push(...(r.days ?? []));
    byInterval.set(interval, days);
  }

  return Array.from(byInterval.entries())
    .map(([interval, days]) => {
      const sorted = [...new Set(days)].sort((a, b) => a - b);
      if (sorted.length === 7) {
        return `Ежедневно ${interval}`;
      }
      // Contiguous run gets a range, anything else is listed out.
      const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
      const label =
        contiguous && sorted.length > 1
          ? `${DAY_NAMES[sorted[0]]}-${DAY_NAMES[sorted[sorted.length - 1]]}`
          : sorted.map((d) => DAY_NAMES[d]).join(', ');
      return `${label} ${interval}`;
    })
    .join(', ');
}

@Injectable()
export class YandexService {
  private readonly logger = new Logger(YandexService.name);
  private cache: { items: NormalizedPvz[]; expiresAt: number } | null = null;

  async getPvz(city: string, page = 1, pageSize = 20, query = '', region = ''): Promise<PvzPage> {
    if (process.env.YANDEX_MOCKED !== 'false') {
      return paginateAndFilter(MOCK_PVZ, page, pageSize, query);
    }

    const all = await this.getAllPoints();
    // Yandex's API ignores text filters (locality/city are silently dropped - verified) and only
    // honours a numeric Yandex geo_id, which we don't have: the city picker is backed by CDEK's
    // own city codes. So we match locality names ourselves, normalizing away the settlement-type
    // prefix Yandex includes and CDEK doesn't. The region check disambiguates namesakes - there
    // are three Малаховка and five Мытищи in CDEK's list alone.
    const cityKey = normalizeLocality(city);
    const inCity = cityKey
      ? all.filter((p) => p.cityKey === cityKey && regionsMatch(p.region, region))
      : all;
    return paginateAndFilter(inCity, page, pageSize, query);
  }

  /**
   * The list endpoint has no city filter we can use, and returns every point in the country in
   * one ~25MB response (13k points). Fetch it rarely, keep only the normalized fields (~2MB),
   * and filter per request from memory.
   */
  private async getAllPoints(): Promise<Array<NormalizedPvz & { cityKey: string; region: string }>> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.items as Array<NormalizedPvz & { cityKey: string; region: string }>;
    }

    try {
      const baseUrl = process.env.YANDEX_DELIVERY_API_BASE_URL ?? 'https://b2b-authproxy.taxi.yandex.net';
      const apiKey = process.env.YANDEX_DELIVERY_API_KEY ?? '';

      const response = await fetch(new URL('/api/b2b/platform/pickup-points/list', baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // An empty body returns zero points - the filter is required, not optional.
        body: JSON.stringify({ available_for_dropoff: true, type: 'pickup_point' }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        throw new Error(`Yandex Delivery API responded with ${response.status}`);
      }

      const data: { points?: YandexPoint[] } = await response.json();
      const items = (data.points ?? [])
        .filter((p) => p.type === 'pickup_point')
        .map((point) => ({
          carrier: 'YANDEX' as const,
          id: point.id,
          address: point.address?.full_address ?? '',
          name: point.name,
          workingHours: formatSchedule(point.schedule),
          estimatedDeliveryDays: STUB_ESTIMATED_DELIVERY_DAYS,
          lat: point.position?.latitude,
          lon: point.position?.longitude,
          cityKey: normalizeLocality(point.address?.locality ?? ''),
          region: point.address?.region ?? '',
        }));

      this.cache = { items, expiresAt: Date.now() + CACHE_TTL_MS };
      this.logger.log(`Cached ${items.length} Yandex pickup points`);
      return items;
    } catch (err) {
      this.logger.error(`Failed to fetch Yandex pickup points: ${(err as Error).message}`);
      // Serve a stale cache rather than nothing if we have one.
      return (this.cache?.items ?? []) as Array<NormalizedPvz & { cityKey: string; region: string }>;
    }
  }
}
