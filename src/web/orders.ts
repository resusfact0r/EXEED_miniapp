export const api = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');
export type Order = {
  number: number;
  state: string;
  items: { code: string; name: string; quantity: number; cents: number; warehouse?: string; warehouseName?: string }[];
  goodsCents: number;
  deliveryCents: number | null;
  address: string;
  method: string;
  canPay: boolean;
  paymentUrl: string | null;
  tracking: string | null;
  subscribed: boolean;
};
export const states: Record<string, string> = {
  REVIEW: 'На проверке у менеджера',
  QUOTED: 'Сумма подтверждена',
  PAYMENT: 'Ожидает оплаты',
  PAID: 'Оплачен, ожидает сборки',
  PICKUP_READY: 'Готов к самовывозу',
  REGISTERING: 'Оформляется отправление',
  REGISTERED: 'Отправление зарегистрировано',
  DONE: 'Получен',
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(api + path, {
    ...init,
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(35000),
    headers,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      Array.isArray(d.message) ? d.message.join('. ') : d.message || 'Попробуйте ещё раз.',
    );
  }
  return res.json();
}
const prefix = 'exeed-friends:orders:v1';
export function historyList(): { number: number; key: string }[] {
  try {
    const a = JSON.parse(localStorage.getItem(prefix) || '[]');
    return a.filter(
      (v: { number: number; key: string }) => Number.isInteger(v.number) && /^[a-f0-9]{64}$/.test(v.key),
    );
  } catch {
    return [];
  }
}
export function pending() {
  return localStorage.getItem(prefix + ':pending');
}
export function allocate() {
  const k =
    pending() ||
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) => v.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(prefix + ':pending', k);
  return k;
}
export function remember(o: Order, key: string) {
  localStorage.setItem(
    prefix,
    JSON.stringify([{ number: o.number, key }, ...historyList().filter((v) => v.number !== o.number)]),
  );
  localStorage.removeItem(prefix + ':pending');
}
export function guest<T>(path: string, key: string, body?: object) {
  return request<T>('/web/checkout/' + path, {
    headers: { 'x-order-key': key },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
}
