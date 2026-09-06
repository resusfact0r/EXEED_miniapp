import { apiClient } from '@/api/client.ts';
import type { RequestedContactPayload, UpdatePreferencesPayload, UserProfile } from '@/api/types.ts';

export const postSession = () => apiClient.post<UserProfile>('/auth/session');

export const postPhone = (contact: RequestedContactPayload) =>
  apiClient.post<UserProfile>('/auth/phone', { contact });

export const getMe = () => apiClient.get<UserProfile>('/auth/me');

export const patchPreferences = (payload: UpdatePreferencesPayload) =>
  apiClient.patch<UserProfile>('/auth/preferences', payload);
