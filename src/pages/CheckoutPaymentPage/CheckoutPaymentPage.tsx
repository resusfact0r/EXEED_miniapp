import { Button, Cell, List, Section, SegmentedControl } from '@telegram-apps/telegram-ui';
import { useEffect, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '@/api/client.ts';
import { createOrder } from '@/api/orders.ts';
import { useAuth } from '@/contexts/AuthContext.tsx';
import { useCart } from '@/contexts/CartContext.tsx';
import { useCheckout } from '@/contexts/CheckoutContext.tsx';
import { Page } from '@/components/Page.tsx';
import { OrgCardTextarea } from '@/components/OrgCardTextarea/OrgCardTextarea.tsx';
import { PolicyCheckbox } from '@/components/PolicyCheckbox/PolicyCheckbox.tsx';
import { formatPrice } from '@/helpers/formatPrice.ts';

export const CheckoutPaymentPage: FC = () => {
  const { state, setState, reset } = useCheckout();
  const { user } = useAuth();
  const { cart, refresh: refreshCart } = useCart();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  // The button's loading state only hides its label - it still takes taps - so a second tap
  // during the multi-second supplier check would send a second order. State updates are async,
  // hence a ref rather than the `submitting` flag.
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Reload the cart so the summary below shows the latest catalog prices, not whatever the cart
  // page last fetched.
  useEffect(() => {
    void refreshCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The checkout choices live only in memory: after the Mini App is reloaded on this step they're
  // gone, and the button would silently do nothing.
  useEffect(() => {
    if (!state.fulfillmentType) {
      navigate('/checkout/fulfillment', { replace: true });
    }
  }, [state.fulfillmentType, navigate]);

  // Same "only fill in what's unset" pre-fill as the fulfillment step, from Profile settings.
  useEffect(() => {
    if (!state.paymentMethod && user?.preferredPaymentMethod) {
      setState({ paymentMethod: user.preferredPaymentMethod });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const hasPriceChanges = cart?.items.some((line) => line.priceChanged) ?? false;

  const canSubmit =
    Boolean(cart && cart.items.length > 0) &&
    Boolean(state.paymentMethod) &&
    state.policyAcknowledged &&
    (state.paymentMethod !== 'LEGAL_ENTITY' || state.orgCardDetails.trim().length > 0);

  const handleSubmit = async () => {
    if (!state.fulfillmentType || !state.paymentMethod || !cart || inFlight.current) return;

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const order = await createOrder({
        fulfillmentType: state.fulfillmentType,
        pickupAddressCode: state.pickupAddressCode ?? undefined,
        deliveryCarrier: state.deliveryCarrier ?? undefined,
        deliveryPvzId: state.deliveryPvzId ?? undefined,
        deliveryPvzAddress: state.deliveryPvzAddress ?? undefined,
        paymentMethod: state.paymentMethod,
        orgCardDetails: state.paymentMethod === 'LEGAL_ENTITY' ? state.orgCardDetails : undefined,
        policyAcknowledged: state.policyAcknowledged,
        expectedItems: cart.items.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.product.price,
        })),
      });
      await refreshCart();
      // Navigate before reset: an emptied checkout state on this page would trigger the
      // "back to step 1" redirect above.
      navigate(`/checkout/confirmation/${order.id}`);
      reset();
    } catch (err) {
      setError((err as Error).message);
      // 409: the supplier's live price/stock differs from what was shown. The backend has already
      // updated the cart to match - reload it so the summary shows what the next tap will charge.
      if (err instanceof ApiError && err.status === 409) {
        await refreshCart();
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <List>
        {hasPriceChanges && (
          <p style={{ padding: '12px 16px', margin: 0 }}>
            Внимание, цена некоторых товаров изменилась с момента добавления их в корзину. Актуальная цена отображена на этой странице.
          </p>
        )}
        {cart && cart.items.length > 0 && (
          <Section header="Ваш заказ" footer={`Итого: ${formatPrice(cart.subtotal)}`}>
            {cart.items.map((line) => (
              <Cell
                key={line.productId}
                multiline
                subtitle={`${formatPrice(line.product.price)} × ${line.quantity} шт.`}
                after={<span style={{ whiteSpace: 'nowrap' }}>{formatPrice(line.lineTotal)}</span>}
              >
                {line.product.name}
              </Cell>
            ))}
          </Section>
        )}
        <Section header="Способ оплаты">
          <SegmentedControl>
            <SegmentedControl.Item
              selected={state.paymentMethod === 'QR_LINK'}
              onClick={() => setState({ paymentMethod: 'QR_LINK' })}
            >
              Оплата по QR-коду
            </SegmentedControl.Item>
            <SegmentedControl.Item
              selected={state.paymentMethod === 'LEGAL_ENTITY'}
              onClick={() => setState({ paymentMethod: 'LEGAL_ENTITY' })}
            >
              Безналичная оплата (юр. лицо)
            </SegmentedControl.Item>
          </SegmentedControl>
        </Section>

        {state.paymentMethod === 'LEGAL_ENTITY' && (
          <OrgCardTextarea
            value={state.orgCardDetails}
            onChange={(value) => setState({ orgCardDetails: value })}
          />
        )}

        <PolicyCheckbox
          checked={state.policyAcknowledged}
          onChange={(checked) => setState({ policyAcknowledged: checked })}
        />

        {error && (
          <Section>
            <div style={{ padding: 16, color: 'var(--tgui--destructive_text_color)', whiteSpace: 'pre-line' }}>{error}</div>
          </Section>
        )}

        <Section>
          <div style={{ padding: 16 }}>
            <Button size="l" stretched disabled={!canSubmit} loading={submitting} onClick={() => void handleSubmit()}>
              Оформить заказ
            </Button>
          </div>
        </Section>
      </List>
    </Page>
  );
};
