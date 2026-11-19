import { useState } from 'react';
import { CENTRAL_LABEL, inStock, type CatalogOffer } from '../../server/src/catalog/offers';
import { money, type NavigationProduct } from './catalog';
import { Icon } from './Icons';

const number = new Intl.NumberFormat('ru-RU');

export function OfferList({
  offers,
  onAdd,
}: {
  offers: CatalogOffer[];
  onAdd?: (offer: CatalogOffer) => void;
}) {
  return (
    <ul className="offer-list" aria-label="Предложения складов">
      {offers.map((offer) => (
        <li key={offer.warehouse} className="offer-row">
          <div>
            <strong>{offer.warehouseName}</strong>
            <small>
              Мин. {number.format(offer.packQty)} шт. ·{' '}
              {inStock(offer)
                ? `В наличии ${number.format(offer.stockQty)} шт.`
                : offer.stockQty > 0
                  ? `Остаток ${number.format(offer.stockQty)} шт. · Под заказ`
                  : 'Под заказ'}
            </small>
          </div>
          <span className="offer-price">
            {money(offer.price)}
            <small>за шт.</small>
          </span>
          {onAdd && (
            <button
              type="button"
              className="add-button"
              disabled={!inStock(offer)}
              onClick={() => onAdd(offer)}
              aria-label={`В корзину · ${offer.warehouseName}`}
            >
              <Icon name="plus" size={19} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function safeImageUrl(value: string | null | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value, location.origin);
    if (
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin))
    )
      return url.href;
  } catch {
    /* Skip an invalid address. */
  }
  return '';
}

export function ProductGallery({ product }: { product: NavigationProduct }) {
  const images = [
    ...new Set(
      (product.images?.length ? product.images : [product.imageUrl]).map(safeImageUrl).filter(Boolean),
    ),
  ].slice(0, 4);
  const [current, setCurrent] = useState(0);
  if (!images.length) return null;
  return (
    <div className="detail-gallery">
      <img
        className="detail-image"
        src={images[current]}
        alt={product.name}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      {images.length > 1 && (
        <div className="gallery-thumbnails">
          {images.map((src, index) => (
            <button
              type="button"
              key={src}
              aria-pressed={current === index}
              aria-label={`Фото ${index + 1}`}
              onClick={() => setCurrent(index)}
            >
              <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function warehouseLabel(line: { warehouseName?: string }) {
  return line.warehouseName ?? CENTRAL_LABEL;
}
