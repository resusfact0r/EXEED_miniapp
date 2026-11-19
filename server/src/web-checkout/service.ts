import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, WebOrder } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AvtoligaService } from '../avtoliga/avtoliga.service';
import type { LivePrice } from '../avtoliga/types';
import { CENTRAL_LABEL, CENTRAL_WAREHOUSE } from '../catalog/offers';
import { activeWebProduct, catalogOffer, centralOffer } from '../catalog/warehouse-offer';
import { PICKUP_ADDRESSES } from '../delivery/pickup-addresses';
import { callTelegram, getBotUsername } from '../bot/telegram-api';
import { Checkout, Line, Parcel, Approval, Item } from './model';
import { Bank, Shipping } from './providers';

const centralStoreId = () => process.env.AVTOLIGA_CS_STORE_ID?.trim() || undefined;
const needsReview = (item: Item) =>
  item.warehouse !== undefined && (item.warehouse !== CENTRAL_WAREHOUSE || !centralStoreId());

export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const hashKey = (key: string) => {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new NotFoundException();
  return digest(key);
};
function total(items: Item[]) {
  const cents = items.reduce((n, i) => n + i.quantity * i.cents, 0);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 2000000000)
    throw new BadRequestException('Сумму должен уточнить менеджер.');
  return cents;
}
function checkParcel(p: Parcel, items: Item[]) {
  if (
    p.itemGrams.length !== items.length ||
    items.reduce((n, i, k) => n + i.quantity * p.itemGrams[k], 0) > p.weight
  )
    throw new BadRequestException('Проверьте массу деталей и упаковки.');
}
function preset(items: Item[]) {
  if (items.length !== 1 || !process.env.WEB_PACKAGES_JSON) return;
  try {
    const data = JSON.parse(process.env.WEB_PACKAGES_JSON);
    const item = items[0],
      raw = data[item.code + ':' + item.quantity];
    if (!raw) return;
    const p = plainToInstance(Parcel, raw as object);
    if (validateSync(p, { whitelist: true, forbidNonWhitelisted: true }).length) return;
    checkParcel(p, items);
    return p;
  } catch {
    return;
  }
}
@Injectable()
export class WebOrders implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private log = new Logger(WebOrders.name);
  constructor(
    private db: PrismaService,
    private supplier: AvtoligaService,
    readonly bank: Bank,
    readonly shipping: Shipping,
  ) {}
  async price(lines: Line[]): Promise<Item[]> {
    const sourceKey = ({ code, warehouse }: Line) => JSON.stringify([code, warehouse ?? CENTRAL_WAREHOUSE]);
    if (new Set(lines.map(sourceKey)).size !== lines.length) {
      throw new BadRequestException('Повторяющийся артикул на одном складе.');
    }
    const codes = [...new Set(lines.map((i) => i.code))];
    const products = await this.db.product.findMany({
      where: { ...activeWebProduct, code: { in: codes } },
      include: { offers: { where: { isActive: true }, include: { warehouse: true } } },
    });
    const byCode = new Map(products.map((product) => [product.code, product]));
    if (byCode.size !== codes.length) {
      throw new ConflictException('Состав каталога изменился. Проверьте корзину.');
    }

    const storeId = centralStoreId();
    const [legacy, central] = await Promise.all([
      this.livePrices(lines.filter((line) => !line.warehouse)),
      storeId ? this.livePrices(lines.filter((line) => line.warehouse === CENTRAL_WAREHOUSE), storeId) : undefined,
    ]);

    return lines.map(({ code, quantity, warehouse }) => {
      const product = byCode.get(code)!;
      const extra = product.offers.find((offer) => offer.warehouseCode === warehouse);
      const selected = warehouse && warehouse !== CENTRAL_WAREHOUSE
        ? (extra && catalogOffer(extra))
        : (product.isActive
          ? (!warehouse ? legacy.get(code) : central ? central.get(code) : extra ? catalogOffer(extra) : centralOffer(product))
          : undefined);
      const price = Number(selected?.price);
      if (!selected || !Number.isFinite(price) || price <= 0 || selected.stockQty < quantity
          || quantity % selected.packQty !== 0 || quantity > (selected.packQty > 1 ? selected.packQty : 10)) {
        throw new ConflictException('Изменились условия для ' + code + '. Проверьте выбранный склад и количество.');
      }
      return {
        code, quantity, cents: Math.round(price * 100), name: product.name,
        ...(warehouse ? { warehouse, warehouseName: extra?.warehouse.name ?? CENTRAL_LABEL } : {}),
      };
    });
  }
  private async livePrices(lines: Line[], storeId?: string): Promise<Map<string, LivePrice>> {
    if (!lines.length) return new Map();
    return this.supplier.getLivePrices(
      lines.map(({ code }) => code),
      Object.fromEntries(lines.map(({ code, quantity }) => [code, quantity])),
      storeId,
    ).catch(() => {
      throw new ServiceUnavailableException('Поставщик пока не подтвердил цену и остаток ЦС.');
    });
  }
  async create(key: string, dto: Checkout) {
    const accessHash = hashKey(key);
    const requestHash = digest(
      JSON.stringify([
        dto.name,
        dto.phone,
        dto.method,
        dto.exactArticle,
        dto.vin,
        dto.city,
        dto.point,
        dto.lines.map((i) => i.warehouse ? [i.code, i.quantity, i.warehouse] : [i.code, i.quantity]),
      ]),
    );
    const replay = (o: WebOrder) => {
      if (o.requestHash !== requestHash) throw new ConflictException('Откройте уже созданный заказ.');
      return this.view(o);
    };
    const old = await this.db.webOrder.findUnique({ where: { accessHash } });
    if (old) return replay(old);
    if (!dto.exactArticle && !dto.vin)
      throw new BadRequestException('Для проверки применяемости укажите VIN.');
    const items = await this.price(dto.lines);
    let deliveryCents: number | null = 0,
      address = PICKUP_ADDRESSES[0].label,
      parcel: Parcel | undefined;
    if (dto.method === 'cdek') {
      if (!dto.city || !dto.point || !this.shipping.pointsAvailable())
        throw new BadRequestException('Выберите доступный ПВЗ.');
      const point = (await this.shipping.cdek.getAllPvzForCity(dto.city)).find((p) => p.id === dto.point);
      if (!point?.address) throw new ConflictException('Этот пункт выдачи недоступен.');
      address = point.address;
      deliveryCents = null;
      parcel = preset(items);
      if (parcel && this.shipping.configured())
        try {
          deliveryCents = await this.shipping.quote(dto.city, parcel);
        } catch {
          this.log.warn('Delivery needs review');
        }
    }
    try {
      const order = await this.db.webOrder.create({
        data: {
          accessHash,
          requestHash,
          name: dto.name,
          phone: dto.phone,
          vin: dto.exactArticle ? null : dto.vin,
          city: dto.method === 'cdek' ? dto.city : null,
          point: dto.method === 'cdek' ? dto.point : null,
          address,
          items,
          goodsCents: total(items),
          deliveryCents,
          ...(parcel ? { parcel: { ...parcel } } : {}),
          state: dto.exactArticle && deliveryCents !== null && !items.some(needsReview) ? 'QUOTED' : 'REVIEW',
        },
      });
      const chats = (process.env.ORDER_NOTIFY_CHAT_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const chat_id of chats)
        void callTelegram('sendMessage', {
          chat_id,
          text: 'Новый заказ с сайта W' + order.number + '. Откройте раздел заказов склада.',
        }).catch(() => this.log.warn('Operator notification deferred to queue'));
      return this.view(order);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return replay(await this.db.webOrder.findUniqueOrThrow({ where: { accessHash } }));
      throw e;
    }
  }
  view(o: WebOrder) {
    return {
      number: o.number,
      state: o.state,
      items: o.items,
      goodsCents: o.goodsCents,
      deliveryCents: o.deliveryCents,
      address: o.address,
      method: o.city ? 'cdek' : 'pickup',
      canPay: this.bank.ready(),
      paymentUrl: o.state === 'PAYMENT' ? o.paymentUrl : null,
      tracking: o.tracking,
      carrierStatus: o.carrierStatus,
      subscribed: Boolean(o.chat),
    };
  }
  async guest(key: string) {
    const o = await this.db.webOrder.findUnique({ where: { accessHash: hashKey(key) } });
    if (!o) throw new NotFoundException();
    return o;
  }
  async byNumber(number: number) {
    const o = await this.db.webOrder.findUnique({ where: { number } });
    if (!o) throw new NotFoundException();
    return o;
  }
  private async change(o: WebOrder, data: Prisma.WebOrderUpdateManyMutationInput) {
    const result = await this.db.webOrder.updateMany({
      where: { number: o.number, state: o.state, updatedAt: o.updatedAt },
      data,
    });
    if (!result.count) throw new ConflictException('Заказ уже обновился. Проверьте его статус.');
    return this.byNumber(o.number);
  }
  async approve(number: number, dto: Approval) {
    const o = await this.byNumber(number);
    if (o.state !== 'REVIEW') throw new ConflictException('Заказ уже обработан.');
    const items = await this.price(o.items as Item[]);
    let fee = 0;
    if (o.city) {
      if (!dto.parcel) throw new BadRequestException('Введите вес и размеры.');
      checkParcel(dto.parcel, items);
      fee = await this.shipping.quote(o.city, dto.parcel);
    }
    return this.change(o, {
      state: 'QUOTED',
      items,
      goodsCents: total(items),
      deliveryCents: fee,
      ...(dto.parcel ? { parcel: { ...dto.parcel } } : {}),
    });
  }
  async pay(key: string, expected: number) {
    let o = await this.guest(key);
    if (!this.bank.ready()) throw new ServiceUnavailableException('Магазин подключает оплату.');
    if (o.state === 'QUOTED') {
      const items = await this.price(o.items as Item[]),
        goodsCents = total(items);
      const fee = o.city ? await this.shipping.quote(o.city, o.parcel as unknown as Parcel) : 0;
      if (
        goodsCents !== o.goodsCents ||
        fee !== o.deliveryCents ||
        items.some((i, k) => i.cents !== (o.items as Item[])[k].cents)
      ) {
        await this.change(o, { items, goodsCents, deliveryCents: fee });
        throw new ConflictException('Цена обновилась. Проверьте итог и подтвердите повторно.');
      }
      if (expected !== goodsCents + fee) throw new ConflictException('Подтвердите обновлённую сумму.');
      o = await this.change(o, { state: 'PAYMENT', paymentSince: new Date() });
    }
    if (o.state !== 'PAYMENT' || expected !== o.goodsCents + o.deliveryCents!)
      throw new ConflictException('Проверьте состояние заказа.');
    if (!o.paymentUrl) await this.issue(o);
    return this.view(await this.byNumber(o.number));
  }
  private async issue(o: WebOrder) {
    if (!o.paymentSince || Date.now() - o.paymentSince.getTime() > 23 * 3600000)
      throw new ConflictException('Требуется сверка с банком.');
    const p = await this.bank.create(o);
    if (!this.bank.matches(p, o)) throw new ServiceUnavailableException('Данные платежа требуют сверки.');
    const url = p.confirmation?.confirmation_url;
    if (url && new URL(url).protocol !== 'https:') throw new ServiceUnavailableException();
    await this.db.webOrder.updateMany({
      where: { number: o.number, state: 'PAYMENT', attempt: o.attempt },
      data: { paymentId: p.id, paymentUrl: url },
    });
    if (p.status === 'succeeded' || p.status === 'canceled') await this.payment(p.id);
  }
  async payment(id: string) {
    const p = await this.bank.find(id),
      number = Number(p.metadata?.order?.match(/^W(\d+)$/)?.[1]);
    if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) return;
    const o = await this.db.webOrder.findUnique({ where: { number } });
    if (
      !o ||
      o.state !== 'PAYMENT' ||
      (o.paymentId && o.paymentId !== id) ||
      p.id !== id ||
      !this.bank.matches(p, o)
    )
      return;
    const where = { number, state: 'PAYMENT', attempt: o.attempt };
    if (p.status === 'succeeded' && p.paid)
      await this.db.webOrder.updateMany({ where, data: { state: 'PAID', paymentId: id, paymentUrl: null } });
    if (p.status === 'canceled')
      await this.db.webOrder.updateMany({
        where,
        data: {
          state: 'QUOTED',
          paymentId: null,
          paymentUrl: null,
          paymentSince: null,
          attempt: { increment: 1 },
        },
      });
  }
  async packed(number: number) {
    let o = await this.byNumber(number);
    if (o.state !== 'PAID') throw new ConflictException('Нужен оплаченный заказ.');
    if (!o.city) return this.change(o, { state: 'PICKUP_READY' });
    this.shipping.validateMode();
    // Claim before the carrier call. A lost response is recovered by the unique merchant number.
    o = await this.change(o, { state: 'REGISTERING' });
    const entity = await this.shipping.create(o);
    await this.db.webOrder.updateMany({
      where: { number, state: 'REGISTERING' },
      data: { shipmentId: entity.uuid },
    });
    return this.byNumber(number);
  }
  async complete(number: number) {
    const o = await this.byNumber(number);
    if (o.state !== 'PICKUP_READY') throw new ConflictException();
    return this.change(o, { state: 'DONE' });
  }
  async track(o: WebOrder) {
    const e = await this.shipping.lookup(o);
    if (e.number !== 'EXEED-W' + o.number) return;
    const code = e.statuses?.slice().sort((a, b) => b.date_time.localeCompare(a.date_time))[0]?.code;
    await this.db.webOrder.updateMany({
      where: { number: o.number, state: o.state },
      data: {
        shipmentId: e.uuid,
        tracking: e.cdek_number,
        carrierStatus: code,
        state: code === 'DELIVERED' ? 'DONE' : e.cdek_number ? 'REGISTERED' : o.state,
      },
    });
  }
  async label(number: number) {
    const o = await this.byNumber(number);
    if (!o.shipmentId) throw new ConflictException('Отправление обрабатывается.');
    const uuid = o.labelId ?? (await this.shipping.label(o.shipmentId));
    if (!o.labelId) await this.db.webOrder.update({ where: { number }, data: { labelId: uuid } });
    return this.shipping.pdf(uuid);
  }
  async list(before?: number) {
    return (
      await this.db.webOrder.findMany({
        where: { state: { not: 'DONE' }, ...(before ? { number: { lt: before } } : {}) },
        orderBy: { number: 'desc' },
        take: 100,
      })
    ).map((o) => ({ ...this.view(o), name: o.name, phone: o.phone, vin: o.vin }));
  }
  async subscribe(key: string) {
    const o = await this.guest(key),
      bot = await getBotUsername();
    if (!bot) throw new ServiceUnavailableException('Бот временно недоступен.');
    const claim = randomBytes(24).toString('hex');
    await this.db.webOrder.update({
      where: { number: o.number },
      data: { claimHash: digest(claim), claimUntil: new Date(Date.now() + 600000) },
    });
    return { url: 'https://t.me/' + bot + '?start=w_' + claim };
  }
  onModuleInit() {
    this.timer = setInterval(() => void this.sync().catch(() => this.log.warn('Order sync deferred')), 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async sync() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.db.webOrder.findMany({
        where: { state: { in: ['PAYMENT', 'REGISTERING', 'REGISTERED'] } },
        orderBy: { checkedAt: 'asc' },
        take: 20,
      });
      for (const o of rows) {
        await this.db.webOrder.updateMany({ where: { number: o.number }, data: { checkedAt: new Date() } });
        try {
          if (o.state !== 'PAYMENT') await this.track(o);
          else if (o.paymentId) await this.payment(o.paymentId);
          else await this.issue(o);
        } catch {
          this.log.warn('Reconciliation pending for W' + o.number);
        }
      }
      const pending = await this.db.$queryRaw<
        WebOrder[]
      >`SELECT * FROM "WebOrder" WHERE "chat" IS NOT NULL AND "notice" IS DISTINCT FROM "state" ORDER BY "checkedAt", "number" LIMIT 50`;
      const messages: Record<string, string> = {
        REVIEW: 'Магазин проверяет заказ',
        QUOTED: 'Сумма подтверждена, откройте заказ на сайте',
        PAYMENT: 'Ожидает оплаты',
        PAID: 'Оплачен',
        PICKUP_READY: 'Можно забирать заказ',
        REGISTERING: 'Готовится отправление',
        REGISTERED: 'СДЭК зарегистрировал отправление',
        DONE: 'Заказ получен',
      };
      for (const o of pending) {
        const result = await callTelegram('sendMessage', {
          chat_id: o.chat,
          text:
            'Заказ W' + o.number + '. ' + messages[o.state] + (o.tracking ? '. Трек СДЭК ' + o.tracking : ''),
        });
        await this.db.webOrder.updateMany({
          where: { number: o.number, state: o.state, chat: o.chat },
          data: {
            checkedAt: new Date(),
            ...(result?.ok ? { notice: o.state } : {}),
            ...(result?.error_code === 403 ? { chat: null } : {}),
          },
        });
      }
    } finally {
      this.running = false;
    }
  }
}
