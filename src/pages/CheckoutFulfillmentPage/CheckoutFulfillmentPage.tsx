import { Button, Cell, List, Section, SegmentedControl } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { listOrders } from '@/api/orders.ts';
import type { Order } from '@/api/types.ts';
import { useAuth } from '@/contexts/AuthContext.tsx';
import { useCheckout } from '@/contexts/CheckoutContext.tsx';
import { CityPicker } from '@/components/CityPicker/CityPicker.tsx';
import { Page } from '@/components/Page.tsx';
import { PhoneGate } from '@/components/PhoneGate/PhoneGate.tsx';
import { PickupAddressPicker } from '@/components/PickupAddressPicker/PickupAddressPicker.tsx';
import { PvzPicker } from '@/components/PvzPicker/PvzPicker.tsx';

export const CheckoutFulfillmentPage: FC = () => {
  const { state, setState } = useCheckout();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lastOrder, setLastOrder] = useState<Order | null>(null);

  // Offer a one-tap "reuse my last PVZ" shortcut instead of making a returning customer search
  // for their address again - reuses the delivery snapshot already stored on their past orders,
  // no dedicated "favorites" list needed.
  useEffect(() => {
    listOrders()
      .then((orders) => {
        const last = orders.find((o) => o.fulfillmentType === 'DELIVERY' && o.deliveryPvzId);
        if (last) setLastOrder(last);
      })
      .catch(() => undefined);
  }, []);

  // Pre-fill from the user's saved preferences (Profile → "Настройки по умолчанию") the first
  // time this page is visited in a session - only when nothing's been picked yet, so it never
  // overrides a choice already made in this checkout.
  useEffect(() => {
    if (!state.fulfillmentType && user?.preferredFulfillmentType) {
      setState({ fulfillmentType: user.preferredFulfillmentType });
    }
    if (!state.deliveryCarrier && user?.preferredDeliveryCarrier) {
      setState({ deliveryCarrier: user.preferredDeliveryCarrier });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const canProceed =
    state.fulfillmentType === 'PICKUP'
      ? Boolean(state.pickupAddressCode)
      : state.fulfillmentType === 'DELIVERY'
        ? Boolean(state.deliveryCarrier && state.deliveryPvzId)
        : false;

  return (
    <Page>
      <PhoneGate>
        <List>
          <Section header="Способ получения">
            <SegmentedControl>
              <SegmentedControl.Item
                selected={state.fulfillmentType === 'PICKUP'}
                onClick={() => setState({ fulfillmentType: 'PICKUP' })}
              >
                Самовывоз
              </SegmentedControl.Item>
              <SegmentedControl.Item
                selected={state.fulfillmentType === 'DELIVERY'}
                onClick={() => setState({ fulfillmentType: 'DELIVERY' })}
              >
                Доставка
              </SegmentedControl.Item>
            </SegmentedControl>
          </Section>

          {state.fulfillmentType === 'PICKUP' && (
            <PickupAddressPicker
              selected={state.pickupAddressCode}
              onSelect={(address) =>
                setState({ pickupAddressCode: address.code, pickupAddressLabel: address.label })
              }
            />
          )}

          {state.fulfillmentType === 'DELIVERY' && (
            <>
              {lastOrder && !state.deliveryPvzId && (
                <Section>
                  <Cell
                    subtitle={lastOrder.deliveryPvzAddress}
                    onClick={() => {
                      setState({
                        deliveryCarrier: lastOrder.deliveryCarrier,
                        deliveryPvzId: lastOrder.deliveryPvzId,
                        deliveryPvzAddress: lastOrder.deliveryPvzAddress,
                      });
                      navigate('/checkout/payment');
                    }}
                  >
                    Использовать ПВЗ из прошлого заказа
                  </Cell>
                </Section>
              )}

              {!state.cityCode && !state.cityName && (
                <CityPicker onSelect={(city) => setState({ cityCode: city.code, cityName: city.name })} />
              )}
              {(state.cityCode !== null || state.cityName !== null) && (
                <Section>
                  <Cell
                    subtitle="Нажмите, чтобы выбрать другой город"
                    onClick={() =>
                      setState({ cityCode: null, cityName: null, deliveryPvzId: null, deliveryPvzAddress: null })
                    }
                  >
                    Город: {state.cityName}
                  </Cell>
                </Section>
              )}

              <PvzPicker
                selectedCarrier={state.deliveryCarrier}
                selectedPvzId={state.deliveryPvzId}
                cityCode={state.cityCode}
                cityName={state.cityName}
                onSelectCarrier={(carrier) =>
                  setState({ deliveryCarrier: carrier, deliveryPvzId: null, deliveryPvzAddress: null })
                }
                onSelectPvz={(pvz) => {
                  setState({ deliveryPvzId: pvz.id, deliveryPvzAddress: pvz.address });
                  // The PVZ list can be long - jump straight to the next step instead of leaving
                  // it sitting on screen waiting for a separate "Next" tap.
                  navigate('/checkout/payment');
                }}
              />
            </>
          )}

          {state.fulfillmentType === 'PICKUP' && (
            <Section>
              <div style={{ padding: 16 }}>
                <Button size="l" stretched disabled={!canProceed} onClick={() => navigate('/checkout/payment')}>
                  Далее
                </Button>
              </div>
            </Section>
          )}
        </List>
      </PhoneGate>
    </Page>
  );
};
