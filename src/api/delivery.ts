import { apiClient } from '@/api/client.ts';
import type { City, PickupAddress, PvzPage } from '@/api/types.ts';

export const PVZ_PAGE_SIZE = 20;

export const getPickupAddresses = () => apiClient.get<PickupAddress[]>('/delivery/pickup-addresses');

export const getCdekCities = (query: string) =>
  apiClient.get<City[]>(`/delivery/cdek/cities?query=${encodeURIComponent(query)}`);

export const getCdekPvz = (cityCode: number, page = 1, pageSize = PVZ_PAGE_SIZE) =>
  apiClient.get<PvzPage>(`/delivery/cdek/pvz?cityCode=${cityCode}&page=${page}&pageSize=${pageSize}`);

export const getYandexPvz = (city = '') => apiClient.get<PvzPage>(`/delivery/yandex/pvz?city=${encodeURIComponent(city)}`);
