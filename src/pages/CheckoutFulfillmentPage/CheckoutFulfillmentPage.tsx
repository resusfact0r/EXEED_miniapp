import { Button, List, Section, SegmentedControl } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCheckout } from '@/contexts/CheckoutContext.tsx';
import { Page } from '@/components/Page.tsx';
import { PhoneGate } from '@/components/PhoneGate/PhoneGate.tsx';
import { PickupAddressPicker } from '@/components/PickupAddressPicker/PickupAddressPicker.tsx';
import { PvzPicker } from '@/components/PvzPicker/PvzPicker.tsx';

export const CheckoutFulfillmentPage: FC = () => {
  const { state, setState } = useCheckout();
  const navigate = useNavigate();

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
            <PvzPicker
              selectedCarrier={state.deliveryCarrier}
              selectedPvzId={state.deliveryPvzId}
              onSelectCarrier={(carrier) =>
                setState({ deliveryCarrier: carrier, deliveryPvzId: null, deliveryPvzAddress: null })
              }
              onSelectPvz={(pvz) => setState({ deliveryPvzId: pvz.id, deliveryPvzAddress: pvz.address })}
            />
          )}

          <Section>
            <div style={{ padding: 16 }}>
              <Button
                size="l"
                stretched
                disabled={!canProceed}
                onClick={() => navigate('/checkout/payment')}
              >
                Далее
              </Button>
            </div>
          </Section>
        </List>
      </PhoneGate>
    </Page>
  );
};
