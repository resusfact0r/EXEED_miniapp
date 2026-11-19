import { CENTRAL_WAREHOUSE, CHERY_WAREHOUSE } from '../catalog/offers';

export function mailKey(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—−]\s*/g, '-');
}

export function mailRoutes(env = process.env) {
  return [
    {
      warehouseCode: CHERY_WAREHOUSE,
      from: mailKey(env.PRICE_MSK_OPT2_MAIL_FROM || env.PRICE_MAIL_FROM || ''),
      subject: mailKey(env.PRICE_MSK_OPT2_MAIL_SUBJECT || 'МСК ОПТ-2'),
      attachment: mailKey(env.PRICE_MSK_OPT2_MAIL_ATTACHMENT || ''),
      enabled: env.PRICE_MSK_OPT2_ENABLED === 'true',
    },
    {
      warehouseCode: CENTRAL_WAREHOUSE,
      from: mailKey(env.PRICE_MAIL_FROM || ''),
      subject: mailKey(env.PRICE_MAIL_SUBJECT || ''),
      attachment: mailKey(env.PRICE_MAIL_ATTACHMENT || ''),
      enabled: true,
    },
  ];
}

export function routeMail(from: string[], subject: string, routes = mailRoutes()) {
  const senders = from.map(mailKey);
  return routes.find(
    (route) => route.from && senders.includes(route.from) && mailKey(subject).includes(route.subject),
  );
}
