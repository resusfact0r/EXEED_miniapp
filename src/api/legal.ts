import { apiClient } from '@/api/client.ts';

export interface Seller {
  name: string;
  ogrn: string;
  /** "ОГРНИП" for an individual entrepreneur, "ОГРН" for a company. */
  ogrnLabel: string;
  inn: string;
  address: string;
  email?: string;
  phone?: string;
  /** Where to send requests: email or the bot chat. */
  contact: string;
}

export interface LegalInfo {
  /** False until the seller's details are set on the server: no documents, no consent step. */
  configured: boolean;
  seller: Seller | null;
}

export type LegalDocument = 'privacy' | 'consent' | 'terms';

export const getLegal = () => apiClient.get<LegalInfo>('/legal');

/** Absolute, because Telegram opens it outside the Mini App. */
export const legalUrl = (document: LegalDocument) =>
  new URL(`${import.meta.env.VITE_API_BASE_URL as string}/legal/${document}`, window.location.href).href;
