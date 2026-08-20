import { Button, Placeholder, Section, Snackbar, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getProduct } from '@/api/catalog.ts';
import type { Product } from '@/api/types.ts';
import { useCart } from '@/contexts/CartContext.tsx';
import { Page } from '@/components/Page.tsx';
import { QuantityStepper } from '@/components/QuantityStepper/QuantityStepper.tsx';

export const ProductDetailPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addItem } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getProduct(id)
      .then(setProduct)
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

  const outOfStock = product.stockQty <= 0;

  const handleAdd = async () => {
    setAdding(true);
    try {
      const { capped } = await addItem(product.id, quantity);
      setSnackbar(capped ? 'Добавлено с учётом лимита 10 шт. на позицию' : 'Добавлено в корзину');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Page>
      <Section header={product.name} footer={`Артикул: ${product.code}`}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{product.price} ₽</div>
          <div>{outOfStock ? 'Нет в наличии' : `В наличии: ${product.stockQty} шт.`}</div>
          {product.description && <div>{product.description}</div>}
          {!outOfStock && (
            <>
              <QuantityStepper value={quantity} max={Math.min(10, product.stockQty)} onChange={setQuantity} />
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
