import { apiClient } from '@/api/client.ts';
import type { Product, SearchProductsResult } from '@/api/types.ts';

export const SEARCH_PAGE_SIZE = 30;

export const searchProducts = (query: string, page = 1, pageSize = SEARCH_PAGE_SIZE) =>
  apiClient.get<SearchProductsResult>(
    `/catalog/search?query=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`,
  );

export const getProduct = (id: string) => apiClient.get<Product>(`/catalog/products/${id}`);
