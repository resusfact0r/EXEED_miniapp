import { Button, Placeholder, Section, Snackbar, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getProduct } from '@/api/catalog.ts';
import type { Product } from '@/api/types.ts';
import { useCart } from '@/contexts/CartContext.tsx';
import { Page } from '@/components/Page.tsx';
import { QuantityStepper } from '@/components/QuantityStepper/QuantityStepper.tsx';
import { formatPrice } from '@/helpers/formatPrice.ts';
import { maxLineQty } from '@/helpers/lineQuantity.ts';

export const ProductDetailPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { cart, addItem } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getProduct(id)
      .then((loaded) => {
        setProduct(loaded);
        setQuantity(Math.max(1, loaded.packQty));
      })
      .catch((err) => setLoadError((err as Error).message));
  }, [id]);

  if (loadError) {
    return (
      <Page>
        <Placeholder header="Не удалось загрузить товар" description={loadError} />
      </Page>
    );
  }

  if (!product) {
    return (
      <Page>
        <Spinner size="m" />
      </Page>
    );
  }

  const maxQty = maxLineQty(product.packQty, product.stockQty);
  const outOfStock = maxQty === 0;
  const cartLine = cart?.items.find((item) => item.productId === product.id);

  const handleAdd = async () => {
    setAdding(true);
    try {
      const { capped } = await addItem(product.id, quantity);
      setSnackbar(capped ? `Добавлено с учётом ограничения: не больше ${maxQty} шт. на позицию` : 'Добавлено в корзину');
    } catch (err) {
      setSnackbar((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Page>
      <Section header={product.name}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ color: 'var(--tgui--hint_color)' }}>Артикул: {product.code}</div>
          {cartLine && (
            <div style={{ color: 'var(--tgui--hint_color)' }}>В корзине: {cartLine.quantity} шт.</div>
          )}
          <div style={{ fontSize: 20, fontWeight: 600 }}>{formatPrice(product.price)}</div>
          <div>{outOfStock ? 'Нет в наличии' : `В наличии: ${product.stockQty} шт.`}</div>
          {product.packQty > 1 && (
            <div style={{ color: 'var(--tgui--hint_color)' }}>
              Продаётся упаковками по {product.packQty} шт., цена указана за 1 шт.
            </div>
          )}
          {product.description && <div>{product.description}</div>}
          {!outOfStock && (
            <>
              <QuantityStepper value={quantity} step={Math.max(1, product.packQty)} max={maxQty} onChange={setQuantity} />
              <Button size="l" loading={adding} onClick={() => void handleAdd()}>
                Добавить в корзину
              </Button>
            </>
          )}
          <Button mode="plain" onClick={() => navigate('/cart')}>
            Перейти в корзину
          </Button>
        </div>
      </Section>
      {outOfStock && <Placeholder header="Нет в наличии" description="Этот товар временно недоступен" />}
      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)} duration={3000}>
          {snackbar}
        </Snackbar>
      )}
    </Page>
  );
};
