import { Injectable, Logger } from '@nestjs/common';

import { ETA_FAILURE_TTL_MS, ETA_TTL_MS, formatDays } from './eta';
import { paginateAndFilter } from './pvz-search';
import type { NormalizedCity, NormalizedPvz, PvzPage } from './types';

const MOCK_PVZ: NormalizedPvz[] = [
  { carrier: 'CDEK', id: 'MSK123', address: 'г. Москва, ул. Тестовая, д. 1', name: 'CDEK Тестовая', workingHours: '09:00-21:00', estimatedDeliveryDays: '1-3 дня' },
  { carrier: 'CDEK', id: 'MSK456', address: 'г. Москва, ул. Примерная, д. 5', name: 'CDEK Примерная', workingHours: '10:00-20:00', estimatedDeliveryDays: '2-4 дня' },
];

// Moscow, St. Petersburg - just enough for the picker to be usable while CDEK_MOCKED=true.
const MOCK_CITIES: NormalizedCity[] = [
  { code: 44, name: 'Москва', region: 'Москва' },
  { code: 137, name: 'Санкт-Петербург', region: 'Санкт-Петербург' },
];

// Standard parcel tariffs, warehouse-to-warehouse: the shop drops the parcel at CDEK, the
// customer collects it at a pickup point. Taking the fastest tariff overall would be wrong - to
// Новосибирск that's "Супер-экспресс" at 1 day, a premium service the shop doesn't use, against
// 4-5 days for an ordinary parcel. 136 "Посылка", then 483 "Экспресс", then 62 "Магистральный
// экспресс" where a route has no 136.
const ETA_TARIFF_PRIORITY = [136, 483, 62];
// Product weights aren't known, so the estimate uses a nominal 1 kg parcel - weight barely moves
// the delivery period, it's the price that depends on it.
const ETA_PARCEL_WEIGHT_GRAMS = 1000;

// CDEK's largest cities sit under 500 points, so one request covers a whole city.
const MAX_PVZ_PER_CITY = 1000;
const PVZ_CACHE_TTL_MS = 15 * 60 * 1000;

interface CdekTokenCache {
  token: string;
  expiresAt: number;
}

interface CdekDeliveryPoint {
  code: string;
  name?: string;
  work_time?: string;
  location: {
    address?: string;
    address_full?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface CdekCity {
  code: number;
  city: string;
  region?: string;
}

@Injectable()
export class CdekService {
  private readonly logger = new Logger(CdekService.name);
  private tokenCache: CdekTokenCache | null = null;
  private readonly pvzCache = new Map<number, { items: NormalizedPvz[]; expiresAt: number }>();
  private readonly etaCache = new Map<number, { value?: string; expiresAt: number }>();

  async getCities(query: string): Promise<NormalizedCity[]> {
    if (process.env.CDEK_MOCKED !== 'false') {
      const q = query.trim().toLowerCase();
      return q ? MOCK_CITIES.filter((c) => c.name.toLowerCase().startsWith(q)) : MOCK_CITIES;
    }
    if (!query.trim()) {
      return [];
    }

    try {
      const token = await this.getAccessToken();
      const baseUrl = process.env.CDEK_API_BASE_URL ?? 'https://api.cdek.ru';
      const url = new URL('/v2/location/cities', baseUrl);
      url.searchParams.set('country_codes', 'RU');
      url.searchParams.set('city', query);
      url.searchParams.set('size', '20');

      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        throw new Error(`CDEK API responded with ${response.status}`);
      }

      const data: CdekCity[] = await response.json();
      return data.map((c) => ({ code: c.code, name: c.city, region: c.region }));
    } catch (err) {
      this.logger.error(`Failed to fetch CDEK cities, falling back to empty list: ${(err as Error).message}`);
      return [];
    }
  }

  async getPvz(cityCode: number, page = 1, pageSize = 20, query = ''): Promise<PvzPage> {
    const [all, eta] = await Promise.all([this.getAllPvzForCity(cityCode), this.getDeliveryEstimate(cityCode)]);
    const result = paginateAndFilter(all, page, pageSize, query);
    // The period depends on the route, not the individual point, so one lookup covers the city.
    return eta ? { ...result, items: result.items.map((p) => ({ ...p, estimatedDeliveryDays: eta })) } : result;
  }

  /** Real delivery period from CDEK's tariff calculator, e.g. "4–5 дней", or undefined. */
  private async getDeliveryEstimate(cityCode: number): Promise<string | undefined> {
    if (process.env.CDEK_MOCKED !== 'false') {
      return undefined;
    }
    const cached = this.etaCache.get(cityCode);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let value: string | undefined;
    try {
      const token = await this.getAccessToken();
      const baseUrl = process.env.CDEK_API_BASE_URL ?? 'https://api.cdek.ru';
      const fromCode = Number(process.env.CDEK_FROM_CITY_CODE ?? 44);
      const response = await fetch(new URL('/v2/calculator/tarifflist', baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_location: { code: fromCode },
          to_location: { code: cityCode },
          packages: [{ weight: ETA_PARCEL_WEIGHT_GRAMS }],
        }),
      });
      if (!response.ok) {
        throw new Error(`CDEK calculator responded with ${response.status}`);
      }
      const data: { tariff_codes?: Array<{ tariff_code: number; period_min: number; period_max: number }> } =
        await response.json();
      const tariff = ETA_TARIFF_PRIORITY.map((code) => data.tariff_codes?.find((t) => t.tariff_code === code)).find(
        Boolean,
      );
      value = tariff ? formatDays(tariff.period_min, tariff.period_max) : undefined;
    } catch (err) {
      this.logger.warn(`CDEK delivery estimate for city ${cityCode} unavailable: ${(err as Error).message}`);
    }

    this.etaCache.set(cityCode, { value, expiresAt: Date.now() + (value ? ETA_TTL_MS : ETA_FAILURE_TTL_MS) });
    return value;
  }

  /**
   * CDEK has no address-substring search on /v2/deliverypoints, and a big city is ~500 points
   * (Moscow: 498, ~1MB of raw JSON), so we pull the whole city once, normalize it down to the
   * few fields we show, and keep it in memory. Search then filters that list server-side -
   * the phone never downloads the full list, and CDEK sees one request per city per TTL
   * instead of one per keystroke.
   */
  private async getAllPvzForCity(cityCode: number): Promise<NormalizedPvz[]> {
    const cached = this.pvzCache.get(cityCode);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.items;
    }

    if (process.env.CDEK_MOCKED !== 'false') {
      return MOCK_PVZ;
    }

    try {
      const token = await this.getAccessToken();
      const baseUrl = process.env.CDEK_API_BASE_URL ?? 'https://api.cdek.ru';
      const url = new URL('/v2/deliverypoints', baseUrl);
      url.searchParams.set('city_code', String(cityCode));
      url.searchParams.set('size', String(MAX_PVZ_PER_CITY));

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`CDEK API responded with ${response.status}`);
      }

      const data: CdekDeliveryPoint[] = await response.json();

      const items = data.map((point) => ({
        carrier: 'CDEK' as const,
        id: point.code,
        address: point.location.address_full ?? '',
        shortAddress: point.location.address || point.location.address_full,
        name: point.name,
        workingHours: point.work_time,
        lat: point.location.latitude,
        lon: point.location.longitude,
      }));

      this.pvzCache.set(cityCode, { items, expiresAt: Date.now() + PVZ_CACHE_TTL_MS });
      return items;
    } catch (err) {
      this.logger.error(`Failed to fetch CDEK PVZ list, falling back to empty list: ${(err as Error).message}`);
      return [];
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const baseUrl = process.env.CDEK_API_BASE_URL ?? 'https://api.cdek.ru';
    const clientId = process.env.CDEK_CLIENT_ID ?? '';
    const clientSecret = process.env.CDEK_CLIENT_SECRET ?? '';

    const response = await fetch(new URL('/v2/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!response.ok) {
      throw new Error(`CDEK OAuth token request failed with ${response.status}`);
    }

    const data: { access_token: string; expires_in: number } = await response.json();
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    return this.tokenCache.token;
  }
}
