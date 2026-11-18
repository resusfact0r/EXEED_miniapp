import { useEffect, useState, type FormEvent } from 'react';
import type { BagItem } from './basket';
import { money } from './catalog';
import {
  allocate,
  api,
  ApiError,
  guest,
  historyList,
  pending,
  remember,
  request,
  states,
  type Order,
} from './orders';

type Options = { pickup: string; cdek: boolean; legal: boolean };
type City = { code: number; name: string; region: string };
type Point = { id: string; address: string };
export function Checkout({
  bag,
  number,
  onPlaced,
}: {
  bag: BagItem[];
  number?: number;
  onPlaced: () => void;
}) {
  const [options, setOptions] = useState<Options>(),
    [order, setOrder] = useState<Order>(),
    [key, setKey] = useState('');
  const [method, setMethod] = useState('pickup'),
    [exact, setExact] = useState(false),
    [query, setQuery] = useState(''),
    [cities, setCities] = useState<City[]>([]),
    [city, setCity] = useState(0),
    [points, setPoints] = useState<Point[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    async function init() {
      const token = number ? historyList().find((o) => o.number === number)?.key : pending();
      if (number && !token) throw Error('Откройте заказ в том браузере, где вы его оформили.');
      if (token) {
        try {
          const found = await guest<Order>('order', token);
          if (active) {
            remember(found, token);
            setKey(token);
            setOrder(found);
            if (
              !number &&
              found.items.length === bag.length &&
              bag.every((l) =>
                found.items.some((i) => i.code === l.product.code && i.quantity === l.quantity),
              )
            )
              onPlaced();
          }
          return;
        } catch (e) {
          if (number || !(e instanceof ApiError) || e.status !== 404) throw e;
        }
      }
      const opts = await request<Options>('/web/checkout/options');
      if (active) setOptions(opts);
    }
    init().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [number, retry]);
  useEffect(() => {
    if (!key) return;
    let active = true;
    const id = setInterval(
      () =>
        void guest<Order>('order', key)
          .then((o) => {
            if (active) setOrder(o);
          })
          .catch(() => {}),
      15000,
    );
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [key]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      request<City[]>('/web/checkout/cities?q=' + encodeURIComponent(query))
        .then((d) => {
          if (active) setCities(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    if (!city) return;
    let active = true;
    request<Point[]>('/web/checkout/points/' + city)
      .then((d) => {
        if (active) setPoints(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [city]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fields = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const digits = String(fields.get('phone')).replace(/\D/g, ''),
        phone = '+7' + (digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits);
      if (!/^\+7\d{10}$/.test(phone)) throw Error('Введите номер телефона в формате +7 и 10 цифр.');
      const token = allocate();
      const dto = {
        name: String(fields.get('name')).trim(),
        phone,
        method,
        exactArticle: exact,
        consent: fields.has('consent'),
        ...(exact ? {} : { vin: String(fields.get('vin')).toUpperCase() }),
        ...(method === 'cdek' ? { city, point: fields.get('point') } : {}),
        lines: bag.map(({ product, quantity }) => ({ code: product.code, quantity })),
      };
      const o = await guest<Order>('orders', token, dto);
      remember(o, token);
      setOrder(o);
      setKey(token);
      onPlaced();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: 'pay' | 'subscribe') {
    if (!order || busy) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'subscribe') {
        const r = await guest<{ url: string }>('subscribe', key, {});
        if (new URL(r.url).origin === 'https://t.me') location.assign(r.url);
      } else {
        const o = await guest<Order>('pay', key, {
          totalCents: order.goodsCents + (order.deliveryCents ?? 0),
        });
        setOrder(o);
        if (o.paymentUrl && new URL(o.paymentUrl).protocol === 'https:') location.assign(o.paymentUrl);
      }
    } catch (e) {
      setError((e as Error).message);
      await guest<Order>('order', key)
        .then(setOrder)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const alert = error && <p role="alert">{error}</p>;
  if (order)
    return (
      <section className="checkout-form">
        <h3>Заказ W{order.number}</h3>
        <strong role="status">{states[order.state]}</strong>
        <ul>
          {order.items.map((i) => (
            <li key={i.code}>
              {i.name} · {i.quantity} шт. · {money((i.quantity * i.cents) / 100)}
            </li>
          ))}
        </ul>
        <p>{order.address}</p>
        <p>
          Товары · {money(order.goodsCents / 100)}
          <br />
          Доставка ·{' '}
          {order.deliveryCents === null ? 'после замера упаковки' : money(order.deliveryCents / 100)}
        </p>
        {order.deliveryCents !== null && (
          <strong>Итого {money((order.goodsCents + order.deliveryCents) / 100)}</strong>
        )}
        {order.state === 'REVIEW' && (
          <p>Менеджер проверит подбор или упаковку. Подтверждённая сумма появится здесь.</p>
        )}
        {['QUOTED', 'PAYMENT'].includes(order.state) &&
          (order.canPay ? (
            <button className="button" disabled={busy} onClick={() => action('pay')}>
              Перейти к оплате
            </button>
          ) : (
            <p>Магазин подключает онлайн-оплату. Менеджер свяжется с вами по телефону.</p>
          ))}
        {order.tracking && (
          <a
            href={'https://www.cdek.ru/ru/tracking/?order_id=' + encodeURIComponent(order.tracking)}
            target="_blank"
            rel="noreferrer"
          >
            Отследить СДЭК · {order.tracking}
          </a>
        )}
        {!order.subscribed && (
          <button className="button button-secondary" disabled={busy} onClick={() => action('subscribe')}>
            Получать статус в Telegram
          </button>
        )}
        <p className="dialog-note">Заказ сохранён в «Моих заказах» этого браузера.</p>
        {alert}
      </section>
    );
  if (!options)
    return (
      <>
        {error ? (
          <>
            {alert}
            <button
              className="button"
              onClick={() => {
                setError('');
                setRetry((n) => n + 1);
              }}
            >
              Повторить
            </button>
          </>
        ) : (
          <p role="status">Загрузка…</p>
        )}
      </>
    );
  return (
    <form className="checkout-form" onSubmit={create}>
      <label>
        Имя и фамилия получателя
        <input name="name" required minLength={2} maxLength={100} autoComplete="name" />
      </label>
      <label>
        Телефон
        <input name="phone" required type="tel" placeholder="+7" autoComplete="tel" />
      </label>
      <label className="checkout-check">
        <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} />Я проверил
        артикулы для своей машины
      </label>
      {!exact && (
        <label>
          VIN для проверки совместимости
          <input name="vin" required pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" maxLength={17} />
        </label>
      )}
      <label>
        Способ получения
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="pickup">Самовывоз</option>
          {options.cdek && <option value="cdek">Пункт выдачи СДЭК</option>}
        </select>
      </label>
      {method === 'pickup' ? (
        <p>{options.pickup}</p>
      ) : (
        <>
          <label>
            Найти город
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCities([]);
                setPoints([]);
                setCity(0);
              }}
            />
          </label>
          <label>
            Город
            <select
              required
              value={city || ''}
              onChange={(e) => {
                setCity(+e.target.value);
                setPoints([]);
              }}
            >
              <option value="">Выберите город</option>
              {cities.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} {c.region}
                </option>
              ))}
            </select>
          </label>
          <label>
            Пункт выдачи
            <select name="point" required key={city}>
              <option value="">Выберите ПВЗ</option>
              {points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="checkout-check">
        <input required type="checkbox" name="consent" />
        <span>Согласен на обработку данных для оформления заказа</span>
      </label>
      {options.legal && (
        <p>
          <a target="_blank" rel="noreferrer" href={api + '/legal/consent'}>
            Согласие
          </a>{' '}
          ·{' '}
          <a target="_blank" rel="noreferrer" href={api + '/legal/terms'}>
            Условия продажи
          </a>
        </p>
      )}
      {alert}
      <button disabled={busy || !bag.length} className="button" type="submit">
        {busy ? 'Проверяем заказ…' : 'Оформить заказ'}
      </button>
    </form>
  );
}
