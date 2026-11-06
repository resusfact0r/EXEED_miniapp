import { useEffect, useState } from 'react';

import { getLegal, type LegalInfo } from '@/api/legal.ts';

/** Null while loading. If the request fails the app carries on as if nothing is configured:
 *  the order API still refuses an order that needs a consent. */
export function useLegal(): LegalInfo | null {
  const [legal, setLegal] = useState<LegalInfo | null>(null);

  useEffect(() => {
    getLegal()
      .then(setLegal)
      .catch(() => setLegal({ configured: false, seller: null }));
  }, []);

  return legal;
}
