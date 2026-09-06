import { Cell, Input, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';

import { getCdekCities } from '@/api/delivery.ts';
import type { City } from '@/api/types.ts';

interface CityPickerProps {
  onSelect: (city: City) => void;
}

export const CityPicker: FC<CityPickerProps> = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => {
      getCdekCities(query)
        .then(setCities)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <Section header="Город">
      <Input placeholder="Начните вводить город" value={query} onChange={(e) => setQuery(e.target.value)} />
      {loading ? (
        <Spinner size="s" />
      ) : cities.length === 0 ? (
        query && <Placeholder description="Город не найден" />
      ) : (
        cities.map((city) => (
          <Cell key={city.code} subtitle={city.region} onClick={() => onSelect(city)}>
            {city.name}
          </Cell>
        ))
      )}
    </Section>
  );
};
