import { apiClient } from '@/api/client.ts';
import type { RequestedContactPayload, UpdatePreferencesPayload, UserProfile } from '@/api/types.ts';

export const postSession = () => apiClient.post<UserProfile>('/auth/session');

export const postPhone = (contact: RequestedContactPayload) =>
  apiClient.post<UserProfile>('/auth/phone', { contact });

/** Asks the bot to send a "share phone" button into the customer's chat with it. */
export const requestPhoneInChat = () =>
  apiClient.post<{ sent: boolean; botUsername: string | null }>('/auth/request-phone');

export const postConsent = () => apiClient.post<UserProfile>('/auth/consent');

export const getMe = () => apiClient.get<UserProfile>('/auth/me');

export const patchPreferences = (payload: UpdatePreferencesPayload) =>
  apiClient.patch<UserProfile>('/auth/preferences', payload);
