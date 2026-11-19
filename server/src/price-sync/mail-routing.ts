import { CENTRAL_WAREHOUSE, CHERY_WAREHOUSE } from '../catalog/offers';
import type { PriceFormat } from './excel-parser';

export const GEELY_WAREHOUSE = 'geely-cs';

export const knownMailSubjects: Record<string, string[]> = {
  [CENTRAL_WAREHOUSE]: ['chery цс'],
  [CHERY_WAREHOUSE]: ['мск опт-2', 'автолига-лион мск наличие', 'склад автолига-лион'],
  [GEELY_WAREHOUSE]: ['geely цс'],
};

export interface MailRoute {
  warehouseCode: string;
  from: string;
  subjects: string[];
  attachment: string;
  enabled: boolean;
  format?: PriceFormat;
}

export function mailKey(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—−]\s*/g, '-');
}

export function mailRoutes(env = process.env): MailRoute[] {
  return [
    {
      warehouseCode: CHERY_WAREHOUSE,
      from: mailKey(env.PRICE_MSK_OPT2_MAIL_FROM || env.PRICE_MAIL_FROM || ''),
      subjects: [mailKey(env.PRICE_MSK_OPT2_MAIL_SUBJECT || 'МСК ОПТ-2')],
      attachment: mailKey(env.PRICE_MSK_OPT2_MAIL_ATTACHMENT || ''),
      enabled: env.PRICE_MSK_OPT2_ENABLED === 'true',
    },
    {
      warehouseCode: CENTRAL_WAREHOUSE,
      from: mailKey(env.PRICE_MAIL_FROM || ''),
      subjects: [mailKey(env.PRICE_MAIL_SUBJECT || '')],
      attachment: mailKey(env.PRICE_MAIL_ATTACHMENT || ''),
      enabled: true,
    },
  ];
}

export function routeMail(from: string[], subject: string, routes = mailRoutes()) {
  const senders = from.map(mailKey);
  const key = mailKey(subject);
  const named = Object.entries(knownMailSubjects).filter(([, markers]) =>
    markers.some((marker) => key.includes(marker)),
  );
  if (named.length > 1) return undefined;
  const namedWarehouse = named[0]?.[0];
  const candidates = routes.filter(
    (route) =>
      route.from &&
      senders.includes(route.from) &&
      (!namedWarehouse || route.warehouseCode === namedWarehouse) &&
      route.subjects.some((marker) => key.includes(marker)),
  );

  const specificity = (route: MailRoute) =>
    Math.max(...route.subjects.filter((marker) => key.includes(marker)).map((marker) => marker.length));
  candidates.sort((a, b) => specificity(b) - specificity(a));
  if (candidates.length > 1 && specificity(candidates[0]) === specificity(candidates[1])) return undefined;
  return candidates[0];
}
