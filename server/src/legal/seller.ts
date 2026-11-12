import { getSupportUsername } from './support';

export interface Seller {
  name: string;
  ogrn: string;
  inn: string;
  address: string;
  email?: string;
  phone?: string;
  /** Bank details for the terms of sale ("р/с … в АО «ТБанк», БИК …"). */
  bank?: string;
}

/**
 * The seller's details, from SELLER_* in .env. Null until name, OGRN(IP), INN and address are
 * set: while null, the documents, the "О продавце" block and the personal data consent stay off,
 * because a policy or a consent that names no one is worthless. Filling .env and restarting the
 * backend turns them all on. Email is optional - without it, requests go through the bot chat.
 */
export function getSeller(): Seller | null {
  const { SELLER_NAME: name, SELLER_OGRN: ogrn, SELLER_INN: inn, SELLER_ADDRESS: address } = process.env;
  if (!name || !ogrn || !inn || !address) {
    return null;
  }
  return {
    name,
    ogrn,
    inn,
    address,
    email: process.env.SELLER_EMAIL || undefined,
    phone: process.env.SELLER_PHONE || undefined,
    bank: process.env.SELLER_BANK || undefined,
  };
}

/** An individual entrepreneur has an ОГРНИП rather than an ОГРН. */
export function isSoleTrader(seller: Seller): boolean {
  // Not \b: in JavaScript it only knows Latin letters, so it never matches after "ИП".
  return /^(ип|индивидуальный предприниматель)(\s|$)/i.test(seller.name.trim());
}

/**
 * Where customers send requests: the support person in Telegram, plus email if there is one.
 * Not the bot chat when there's a person: nobody reads what customers write to the bot.
 */
export function contactLine(seller: Seller, botUsername: string | null): string {
  const support = getSupportUsername();
  const telegram = support
    ? `Telegram @${support}`
    : botUsername
      ? `чат с ботом @${botUsername}`
      : 'чат с ботом магазина в Telegram';
  return seller.email ? `электронная почта ${seller.email} или ${telegram}` : telegram;
}
