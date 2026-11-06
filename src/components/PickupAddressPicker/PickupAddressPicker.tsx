import { Cell, List, Radio, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';

import { getPickupAddresses } from '@/api/delivery.ts';
import type { PickupAddress } from '@/api/types.ts';

interface PickupAddressPickerProps {
  selected: PickupAddress['code'] | null;
  onSelect: (address: PickupAddress) => void;
}

export const PickupAddressPicker: FC<PickupAddressPickerProps> = ({ selected, onSelect }) => {
  const [addresses, setAddresses] = useState<PickupAddress[] | null>(null);

  useEffect(() => {
    void getPickupAddresses().then((list) => {
      setAddresses(list);
      // With a single address there is nothing to choose.
      if (list.length === 1 && selected !== list[0].code) {
        onSelect(list[0]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!addresses) {
    return <Spinner size="m" />;
  }

  return (
    <List>
      <Section header="Адрес самовывоза">
        {addresses.map((address) => (
          <Cell
            key={address.code}
            subtitle={address.schedule}
            before={<Radio name="pickup-address" checked={selected === address.code} onChange={() => onSelect(address)} />}
            onClick={() => onSelect(address)}
          >
            {address.label}
          </Cell>
        ))}
      </Section>
    </List>
  );
};
