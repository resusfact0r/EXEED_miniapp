import { Button, List, Section, SegmentedControl } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { createOrder } from '@/api/orders.ts';
import { useCart } from '@/contexts/CartContext.tsx';
import { useCheckout } from '@/contexts/CheckoutContext.tsx';
import { Page } from '@/components/Page.tsx';
import { OrgCardTextarea } from '@/components/OrgCardTextarea/OrgCardTextarea.tsx';
import { PolicyCheckbox } from '@/components/PolicyCheckbox/PolicyCheckbox.tsx';

export const CheckoutPaymentPage: FC = () => {
  const { state, setState, reset } = useCheckout();
  const { cart, refresh: refreshCart } = useCart();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-check prices right before the user commits to buying, not just whatever the cart
  // last showed when they navigated here.
  useEffect(() => {
    void refreshCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPriceChanges = cart?.items.some((line) => line.priceChanged) ?? false;

  const canSubmit =
    Boolean(state.paymentMethod) &&
    state.policyAcknowledged &&
    (state.paymentMethod !== 'LEGAL_ENTITY' || state.orgCardDetails.trim().length > 0);

  const handleSubmit = async () => {
    if (!state.fulfillmentType || !state.paymentMethod) return;

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
      });
      await refreshCart();
      reset();
      navigate(`/checkout/confirmation/${order.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
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
            <div style={{ padding: 16, color: 'var(--tgui--destructive_text_color)' }}>{error}</div>
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
