import { Button, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCart } from '@/contexts/CartContext.tsx';
import { Page } from '@/components/Page.tsx';
import { CartLineItem } from '@/components/CartLineItem/CartLineItem.tsx';
import { formatPrice } from '@/helpers/formatPrice.ts';
import { useAcknowledgePriceChanges } from '@/hooks/useAcknowledgePriceChanges.ts';

export const CartPage: FC = () => {
  const { cart, loading, error, refresh, updateItem, removeItem } = useCart();
  const navigate = useNavigate();
  useAcknowledgePriceChanges(cart);

  if (error) {
    return (
      <Page back={false}>
        <Placeholder header="Не удалось загрузить корзину" description={error}>
          <Button size="l" onClick={() => void refresh()}>
            Повторить
          </Button>
        </Placeholder>
      </Page>
    );
  }

  if (loading || !cart) {
    return (
      <Page back={false}>
        <Spinner size="m" />
      </Page>
    );
  }

  if (cart.items.length === 0) {
    return (
      <Page back={false}>
        <Placeholder header="Корзина пуста" description="Найдите нужные запчасти в каталоге">
          <Button size="l" onClick={() => navigate('/catalog')}>
            В каталог
          </Button>
        </Placeholder>
      </Page>
    );
  }

  const hasPriceChanges = cart.items.some((line) => line.priceChanged);

  return (
    <Page back={false}>
      <List>
        {hasPriceChanges && (
          <p style={{ padding: '12px 16px', margin: 0 }}>
            Внимание, цена некоторых товаров изменилась. Актуальные цены отображены в корзине.
          </p>
        )}
        <Section header="Ваша корзина">
          {cart.items.map((line) => (
            <CartLineItem
              key={line.productId}
              line={line}
              onChangeQuantity={(productId, quantity) => void updateItem(productId, quantity)}
              onRemove={(productId) => void removeItem(productId)}
            />
          ))}
        </Section>
        <Section footer={`Итого: ${formatPrice(cart.subtotal)}`}>
          <div style={{ padding: 16 }}>
            <Button size="l" stretched onClick={() => navigate('/checkout/fulfillment')}>
              Оформить заказ
            </Button>
          </div>
        </Section>
      </List>
    </Page>
  );
};
