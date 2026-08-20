import { apiClient } from '@/api/client.ts';
import type { PickupAddress, PvzPage } from '@/api/types.ts';

export const PVZ_PAGE_SIZE = 20;

export const getPickupAddresses = () => apiClient.get<PickupAddress[]>('/delivery/pickup-addresses');

export const getCdekPvz = (page = 1, pageSize = PVZ_PAGE_SIZE) =>
  apiClient.get<PvzPage>(`/delivery/cdek/pvz?page=${page}&pageSize=${pageSize}`);

export const getYandexPvz = (city = '') => apiClient.get<PvzPage>(`/delivery/yandex/pvz?city=${encodeURIComponent(city)}`);
