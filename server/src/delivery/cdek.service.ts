import { Injectable, Logger } from '@nestjs/common';

import type { NormalizedPvz, PvzPage } from './types';

// TODO: estimatedDeliveryDays is a stub - replace with a real calculation (e.g. CDEK's
// /v2/calculator/tarifflist) once weight/dimensions per order are available.
const MOCK_PVZ: NormalizedPvz[] = [
  { carrier: 'CDEK', id: 'MSK123', address: 'г. Москва, ул. Тестовая, д. 1', name: 'CDEK Тестовая', workingHours: '09:00-21:00', estimatedDeliveryDays: '1-3 дня' },
  { carrier: 'CDEK', id: 'MSK456', address: 'г. Москва, ул. Примерная, д. 5', name: 'CDEK Примерная', workingHours: '10:00-20:00', estimatedDeliveryDays: '2-4 дня' },
];

const STUB_ESTIMATED_DELIVERY_DAYS = '1-3 дня';

// The app only supports Moscow pickup/delivery for now (see PICKUP_ADDRESSES) - there's no
// city picker in the UI yet, so we hardcode CDEK's numeric code for Moscow.
// TODO: replace with a real city resolver (CDEK's /v2/location/cities) once other cities are supported.
const DEFAULT_CDEK_CITY_CODE = 44;

interface CdekTokenCache {
  token: string;
  expiresAt: number;
}

interface CdekDeliveryPoint {
  code: string;
  name?: string;
  work_time?: string;
  location: {
    address_full?: string;
    latitude?: number;
    longitude?: number;
  };
}

@Injectable()
export class CdekService {
  private readonly logger = new Logger(CdekService.name);
  private tokenCache: CdekTokenCache | null = null;

  async getPvz(page = 1, pageSize = 20): Promise<PvzPage> {
    if (process.env.CDEK_MOCKED !== 'false') {
      return { items: MOCK_PVZ, hasMore: false };
    }

    try {
      const token = await this.getAccessToken();
      const baseUrl = process.env.CDEK_API_BASE_URL ?? 'https://api.cdek.ru';
      const url = new URL('/v2/deliverypoints', baseUrl);
      url.searchParams.set('city_code', String(DEFAULT_CDEK_CITY_CODE));
      // CDEK's pagination is 0-indexed; ours (matching the catalog search convention) is 1-indexed.
      url.searchParams.set('page', String(page - 1));
      url.searchParams.set('size', String(pageSize));

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
        name: point.name,
        workingHours: point.work_time,
        estimatedDeliveryDays: STUB_ESTIMATED_DELIVERY_DAYS,
        lat: point.location.latitude,
        lon: point.location.longitude,
      }));

      // CDEK doesn't return a total count on this endpoint - a full page means there's
      // probably more, an under-full page means we've reached the end.
      return { items, hasMore: data.length === pageSize };
    } catch (err) {
      this.logger.error(`Failed to fetch CDEK PVZ list, falling back to empty list: ${(err as Error).message}`);
      return { items: [], hasMore: false };
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
