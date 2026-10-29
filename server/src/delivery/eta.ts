/** "1 день", "1–2 дня", "4–5 дней" - the noun agrees with the upper bound. */
export function formatDays(min: number, max: number): string {
  const n = Math.max(min, max);
  const lastTwo = n % 100;
  const last = n % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? 'дней' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дня' : 'дней';
  return min === max || min <= 0 ? `${n} ${noun}` : `${min}–${max} ${noun}`;
}

/** What a carrier's calculator says about delivering a nominal parcel to a city. */
export interface DeliveryEstimate {
  /** "4–5 дней" */
  days?: string;
  /** Rubles, rounded up to 10 - shown as "от N ₽": the nominal 1 kg parcel is a lower bound,
   *  since product weights aren't known. The exact cost goes into the payment link. */
  cost?: number;
}

export function roundCost(rubles: number): number | undefined {
  return Number.isFinite(rubles) && rubles > 0 ? Math.ceil(rubles / 10) * 10 : undefined;
}

/** Stamps a city-wide estimate onto each pickup point of a page. */
export function withEstimate<T extends { items: object[] }>(page: T, estimate: DeliveryEstimate | undefined): T {
  if (!estimate || (!estimate.days && !estimate.cost)) {
    return page;
  }
  return {
    ...page,
    items: page.items.map((p) => ({ ...p, estimatedDeliveryDays: estimate.days, estimatedDeliveryCost: estimate.cost })),
  };
}

// A failed lookup is cached too, but briefly, so a calculator outage doesn't turn every
// keystroke in the pickup point search into another doomed request.
export const ETA_TTL_MS = 24 * 60 * 60 * 1000;
export const ETA_FAILURE_TTL_MS = 60 * 60 * 1000;
