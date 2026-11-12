import { Cell, Input, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState, type FC } from 'react';

import { getCdekCities } from '@/api/delivery.ts';
import type { City } from '@/api/types.ts';

const MIN_QUERY = 2;

interface CityPickerProps {
  onSelect: (city: City) => void;
}

export const CityPicker: FC<CityPickerProps> = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(false);

  // Suggestions start from the second letter: one letter matches half the country.
  const searchable = query.trim().length >= MIN_QUERY;

  useEffect(() => {
    if (!searchable) {
      setCities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timeout = setTimeout(() => {
      getCdekCities(query)
        .then(setCities)
        .catch(() => setCities([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, searchable]);

  return (
    <Section header="Город">
      <Input placeholder="Начните вводить город" value={query} onChange={(e) => setQuery(e.target.value)} />
      {loading ? (
        <Spinner size="s" />
      ) : cities.length === 0 ? (
        searchable && <Placeholder description="Город не найден" />
      ) : (
        cities.map((city) => (
          <Cell
            key={city.code}
            multiline
            subtitle={[city.area, city.region !== city.name ? city.region : undefined].filter(Boolean).join(', ') || undefined}
            onClick={() => onSelect(city)}
          >
            {city.name}
          </Cell>
        ))
      )}
    </Section>
  );
};
