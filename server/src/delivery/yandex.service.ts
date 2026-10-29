import { Injectable, Logger } from '@nestjs/common';

import { ETA_FAILURE_TTL_MS, ETA_TTL_MS, formatDays, roundCost, withEstimate, type DeliveryEstimate } from './eta';
import { normalizeLocality, regionsMatch } from './locality';
import { paginateAndFilter } from './pvz-search';
import type { NormalizedPvz, PvzPage } from './types';

const MOCK_PVZ: NormalizedPvz[] = [
  { carrier: 'YANDEX', id: 'YND001', address: 'г. Москва, ул. Демонстрационная, д. 2', name: 'Яндекс ПВЗ Демонстрационная', workingHours: '09:00-22:00', estimatedDeliveryDays: '1-2 дня' },
  { carrier: 'YANDEX', id: 'YND002', address: 'г. Москва, ул. Образцовая, д. 8', name: 'Яндекс ПВЗ Образцовая', workingHours: '10:00-21:00', estimatedDeliveryDays: '2-3 дня' },
];


const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DAY_NAMES = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

interface YandexPoint {
  id: string;
  name?: string;
  type?: string;
  position?: { latitude?: number; longitude?: number };
  address?: {
    locality?: string;
    region?: string;
    full_address?: string;
    street?: string;
    house?: string;
    housing?: string;
    building?: string;
  };
  schedule?: {
    restrictions?: Array<{
      days?: number[];
      time_from?: { hours?: number; minutes?: number };
      time_to?: { hours?: number; minutes?: number };
    }>;
  };
}

/**
 * "Ленинградское шоссе 128" instead of "Москва Ленинградское шоссе 128" - but only when what
 * precedes the street is the point's own city. Yandex files outlying places under the big city
 * (289 points: "район Коммунарка ..." under Москва, "посёлок Шушары ..." / "Колпино ..." under
 * Санкт-Петербург), and dropping that part would present a point tens of km out as if it were in
 * town, so it stays: "посёлок Шушары, Школьная улица 6 к2".
 *
 * About 2% of points have no street at all ("Троицк  15") - stripping the leading part there
 * would leave a bare house number, so they keep the full address.
 */
function shortAddress(address: YandexPoint['address']): string {
  const clean = (v?: string) => (v ?? '').replace(/\s+/g, ' ').trim();
  const full = clean(address?.full_address);
  const street = clean(address?.street);
  if (!street) {
    return full;
  }

  const housing = clean(address?.housing);
  const building = clean(address?.building);
  const streetAndHouse = [street, clean(address?.house), housing && `к${housing}`, building && `стр${building}`]
    .filter(Boolean)
    .join(' ');

  const at = full.indexOf(street);
  const settlement = at > 0 ? full.slice(0, at).trim() : '';
  const isOwnCity = normalizeLocality(settlement) === normalizeLocality(address?.locality ?? '');
  return settlement && !isOwnCity ? `${settlement}, ${streetAndHouse}` : streetAndHouse;
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
  private readonly etaCache = new Map<string, { value?: DeliveryEstimate; expiresAt: number }>();

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
    const result = paginateAndFilter(inCity, page, pageSize, query);
    const estimate =
      inCity.length && cityKey ? await this.getDeliveryEstimate(`${cityKey}|${region}`, inCity[0].id) : undefined;
    return withEstimate(result, estimate);
  }

  /**
   * Delivery period from Yandex's pricing calculator ("delivery_days"). It's a property of the
   * route, not of one point, so it's looked up once per city using any point there. The source
   * is YANDEX_SOURCE_ADDRESS - "Москва" by default; verified that a city-only source is accepted
   * and that the exact street barely moves the result (Новосибирск: 8 vs 9 days).
   */
  private async getDeliveryEstimate(cacheKey: string, sampleStationId: string): Promise<DeliveryEstimate | undefined> {
    const cached = this.etaCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let value: DeliveryEstimate | undefined;
    try {
      const baseUrl = process.env.YANDEX_DELIVERY_API_BASE_URL ?? 'https://b2b-authproxy.taxi.yandex.net';
      const response = await fetch(new URL('/api/b2b/platform/pricing-calculator', baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.YANDEX_DELIVERY_API_KEY ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: { address: process.env.YANDEX_SOURCE_ADDRESS ?? 'Москва' },
          destination: { platform_station_id: sampleStationId },
          tariff: 'self_pickup',
          // Nominal 1 kg parcel - product weights aren't known.
          total_weight: 1000,
          total_assessed_price: 100000,
          client_price: 0,
          payment_method: 'already_paid',
          places: [{ physical_dims: { weight_gross: 1000, dx: 20, dy: 20, dz: 20 } }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new Error(`Yandex pricing calculator responded with ${response.status}`);
      }
      // pricing_total comes as "167.14 RUB".
      const data: { delivery_days?: number; pricing_total?: string } = await response.json();
      const days = typeof data.delivery_days === 'number' ? formatDays(data.delivery_days, data.delivery_days) : undefined;
      const cost = roundCost(parseFloat(data.pricing_total ?? ''));
      value = days || cost ? { days, cost } : undefined;
    } catch (err) {
      this.logger.warn(`Yandex delivery estimate for ${cacheKey} unavailable: ${(err as Error).message}`);
    }

    this.etaCache.set(cacheKey, { value, expiresAt: Date.now() + (value ? ETA_TTL_MS : ETA_FAILURE_TTL_MS) });
    return value;
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
          shortAddress: shortAddress(point.address),
          name: point.name,
          workingHours: formatSchedule(point.schedule),
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
