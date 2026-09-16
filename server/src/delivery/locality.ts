/**
 * CDEK and Yandex name the same place differently, so matching them needs normalization:
 *   CDEK "Тучково"          <-> Yandex "посёлок городского типа Тучково"
 *   CDEK "Малаховка"        <-> Yandex "рабочий посёлок Малаховка"
 *   CDEK "Московская область" <-> Yandex "Москва и Московская область"
 * Without this, ~12% of Yandex's settlements (163 of 1351 - every посёлок/село/деревня) could
 * never be matched, which is why pickup points in a ПГТ came back empty.
 */

// Longest first, so "посёлок городского типа" wins over "посёлок".
const SETTLEMENT_PREFIXES = [
  'посёлок городского типа',
  'поселок городского типа',
  'рабочий посёлок',
  'рабочий поселок',
  'дачный посёлок',
  'дачный поселок',
  'курортный посёлок',
  'курортный поселок',
  'городской округ',
  'населённый пункт',
  'населенный пункт',
  'посёлок',
  'поселок',
  'деревня',
  'станица',
  'слобода',
  'село',
  'хутор',
  'аул',
  'пгт',
  'рп',
  'п',
  'с',
  'д',
  'г',
];

function base(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strips the settlement-type prefix so only the place name itself remains. */
export function normalizeLocality(value: string): string {
  let result = base(value);
  for (const prefix of SETTLEMENT_PREFIXES) {
    if (result.startsWith(`${prefix} `)) {
      result = result.slice(prefix.length + 1).trim();
      break;
    }
  }
  return result;
}

/**
 * Regions match if either contains the other, so Yandex's combined "Москва и Московская область"
 * still matches CDEK's "Московская область". An empty region on either side matches anything -
 * better to show a few extra points than to hide the right one.
 */
export function regionsMatch(a: string | undefined, b: string | undefined): boolean {
  const left = base(a ?? '');
  const right = base(b ?? '');
  if (!left || !right) {
    return true;
  }
  return left.includes(right) || right.includes(left);
}
