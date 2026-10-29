/** "1 день", "1–2 дня", "4–5 дней" - the noun agrees with the upper bound. */
export function formatDays(min: number, max: number): string {
  const n = Math.max(min, max);
  const lastTwo = n % 100;
  const last = n % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? 'дней' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дня' : 'дней';
  return min === max || min <= 0 ? `${n} ${noun}` : `${min}–${max} ${noun}`;
}

// A failed lookup is cached too, but briefly, so a calculator outage doesn't turn every
// keystroke in the pickup point search into another doomed request.
export const ETA_TTL_MS = 24 * 60 * 60 * 1000;
export const ETA_FAILURE_TTL_MS = 60 * 60 * 1000;
