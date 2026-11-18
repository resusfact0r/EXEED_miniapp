import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { WebOrder } from '@prisma/client';
import { CdekService } from '../delivery/cdek.service';
import { Item, Parcel } from './model';

export const rub = (cents: number) => (cents / 100).toFixed(2);
type BankPayment = {
  id: string;
  status: string;
  paid: boolean;
  test: boolean;
  amount: { value: string; currency: string };
  metadata?: { order: string; attempt: string };
  confirmation?: { confirmation_url?: string };
};
@Injectable()
export class Bank {
  ready() {
    const key = process.env.YOOKASSA_SECRET_KEY || '';
    const mode = process.env.YOOKASSA_MODE;
    const receipts = process.env.YOOKASSA_RECEIPTS;
    return Boolean(
      process.env.YOOKASSA_SHOP_ID &&
      (mode === 'live' || mode === 'test') &&
      key.startsWith(mode + '_') &&
      (receipts === 'external' ||
        (receipts === 'provider' && /^[1-9]\d?$/.test(process.env.YOOKASSA_VAT_CODE || ''))),
    );
  }
  private async request(path: string, init: RequestInit = {}): Promise<BankPayment> {
    if (!this.ready()) throw new ServiceUnavailableException('Магазин подключает онлайн-оплату.');
    const auth = Buffer.from(process.env.YOOKASSA_SHOP_ID + ':' + process.env.YOOKASSA_SECRET_KEY).toString(
      'base64',
    );
    const response = await fetch('https://api.yookassa.ru/v3/payments' + path, {
      ...init,
      signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!response.ok) throw new ServiceUnavailableException('Банк не подтвердил операцию. Попробуйте позже.');
    return response.json();
  }
  find(id: string) {
    return this.request('/' + encodeURIComponent(id));
  }
  matches(p: BankPayment, o: WebOrder) {
    return (
      p.test === (process.env.YOOKASSA_MODE === 'test') &&
      p.metadata?.order === 'W' + o.number &&
      p.metadata.attempt === String(o.attempt) &&
      p.amount?.currency === 'RUB' &&
      p.amount.value === rub(o.goodsCents + o.deliveryCents!)
    );
  }
  create(o: WebOrder) {
    const lines = (o.items as Item[]).map((i) => ({
      description: i.name.slice(0, 128),
      quantity: String(i.quantity),
      amount: { value: rub(i.cents), currency: 'RUB' },
      payment_subject: 'commodity',
    }));
    if (o.deliveryCents)
      lines.push({
        description: 'Доставка СДЭК',
        quantity: '1',
        amount: { value: rub(o.deliveryCents), currency: 'RUB' },
        payment_subject: 'service',
      });
    return this.request('', {
      method: 'POST',
      headers: { 'Idempotence-Key': 'exeed-web-' + o.number + '-' + o.attempt },
      body: JSON.stringify({
        amount: { value: rub(o.goodsCents + o.deliveryCents!), currency: 'RUB' },
        capture: true,
        description: 'Заказ W' + o.number,
        confirmation: {
          type: 'redirect',
          return_url: (process.env.WEB_STORE_ORIGIN || 'https://exeedbot.ru') + '/?webOrder=' + o.number,
        },
        metadata: { order: 'W' + o.number, attempt: String(o.attempt) },
        ...(process.env.YOOKASSA_RECEIPTS === 'provider'
          ? {
              receipt: {
                customer: { phone: o.phone.slice(1) },
                items: lines.map((l) => ({
                  ...l,
                  vat_code: Number(process.env.YOOKASSA_VAT_CODE),
                  payment_mode: 'full_prepayment',
                })),
              },
            }
          : {}),
      }),
    });
  }
}

type Entity = {
  uuid: string;
  number?: string;
  cdek_number?: string;
  statuses?: { code: string; date_time: string }[];
};
@Injectable()
export class Shipping {
  constructor(readonly cdek: CdekService) {}
  pointsAvailable() {
    return (
      process.env.CDEK_MOCKED === 'false' &&
      Boolean(process.env.CDEK_CLIENT_ID && process.env.CDEK_CLIENT_SECRET)
    );
  }
  configured() {
    return (
      this.pointsAvailable() && Boolean(process.env.CDEK_FROM_CITY_CODE && process.env.CDEK_SHIPMENT_POINT)
    );
  }
  async quote(city: number, parcel: Parcel) {
    if (!this.configured()) throw new ServiceUnavailableException('Уточняется пункт отправки СДЭК.');
    const { weight, length, width, height } = parcel;
    const r = await this.cdek.carrier('/v2/calculator/tariff', {
      method: 'POST',
      body: JSON.stringify({
        type: 1,
        tariff_code: 136,
        from_location: { code: Number(process.env.CDEK_FROM_CITY_CODE) },
        to_location: { code: city },
        packages: [{ weight, length, width, height }],
      }),
    });
    const data = await r.json();
    if (!r.ok || !Number.isFinite(data.total_sum) || data.total_sum <= 0 || data.total_sum > 1000000)
      throw new ServiceUnavailableException('СДЭК не подтвердил стоимость доставки.');
    return Math.round(data.total_sum * 100);
  }
  validateMode() {
    const host = new URL(process.env.CDEK_API_BASE_URL || 'https://api.cdek.ru').hostname;
    if (
      !this.configured() ||
      host !== (process.env.YOOKASSA_MODE === 'test' ? 'api.edu.cdek.ru' : 'api.cdek.ru')
    )
      throw new ServiceUnavailableException('Проверьте режим СДЭК и пункт отправки.');
  }
  private async entity(path: string, init?: RequestInit): Promise<Entity> {
    const res = await this.cdek.carrier(path, init);
    const data = await res.json();
    if (!res.ok || !data.entity?.uuid || data.requests?.some((r: { state: string }) => r.state === 'INVALID'))
      throw new ServiceUnavailableException('СДЭК пока не подтвердил операцию.');
    return data.entity;
  }
  create(o: WebOrder) {
    const { weight, length, width, height, itemGrams } = o.parcel as unknown as Parcel;
    return this.entity('/v2/orders', {
      method: 'POST',
      body: JSON.stringify({
        type: 1,
        number: 'EXEED-W' + o.number,
        tariff_code: 136,
        shipment_point: process.env.CDEK_SHIPMENT_POINT,
        delivery_point: o.point,
        recipient: { name: o.name, phones: [{ number: o.phone }] },
        packages: [
          {
            number: '1',
            weight,
            length,
            width,
            height,
            items: (o.items as Item[]).map((i, n) => ({
              name: i.name.slice(0, 255),
              ware_key: i.code,
              cost: i.cents / 100,
              amount: i.quantity,
              weight: itemGrams[n],
              payment: { value: 0 },
            })),
          },
        ],
      }),
    });
  }
  lookup(o: WebOrder) {
    return this.entity(
      o.shipmentId
        ? '/v2/orders/' + encodeURIComponent(o.shipmentId)
        : '/v2/orders?im_number=EXEED-W' + o.number,
    );
  }
  async label(uuid: string) {
    return (
      await this.entity('/v2/print/barcodes', {
        method: 'POST',
        body: JSON.stringify({ orders: [{ order_uuid: uuid }], copy_count: 1, format: 'A6' }),
      })
    ).uuid;
  }
  async pdf(uuid: string) {
    const res = await this.cdek.carrier('/v2/print/barcodes/' + encodeURIComponent(uuid) + '.pdf');
    if (!res.ok || !res.headers.get('content-type')?.includes('application/pdf'))
      throw new ServiceUnavailableException('Этикетка формируется, повторите загрузку.');
    return Buffer.from(await res.arrayBuffer());
  }
}
