import { retrieveRawInitData } from '@telegram-apps/sdk-react';

import { SESSION_REJECTED_EVENT } from '@/helpers/launchFreshness.ts';
import { SERVICE_DOWN_EVENT, serviceState } from '@/helpers/serviceStatus.ts';

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const rawInitData = retrieveRawInitData();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(rawInitData ? { Authorization: `tma ${rawInitData}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    window.dispatchEvent(new Event(SERVICE_DOWN_EVENT));
    throw new ApiError(0, 'Нет связи с сервером. Пробуем снова…');
  }

  // 502/504 come from nginx while the backend is restarting or down. Not 503: the backend itself
  // answers 503 with a message when the supplier can't confirm a price, and that's for the screen.
  if (response.status === 502 || response.status === 504) {
    window.dispatchEvent(new Event(SERVICE_DOWN_EVENT));
    throw new ApiError(response.status, 'Сервер обновляется. Пробуем снова…');
  }
  serviceState.everReached = true;

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    // The session itself was refused: every other request will fail the same way.
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent(SESSION_REJECTED_EVENT, { detail: body.message ?? response.statusText }));
    }
    throw new ApiError(response.status, body.message ?? response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
