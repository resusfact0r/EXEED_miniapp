export interface Seller {
  name: string;
  ogrn: string;
  inn: string;
  address: string;
  email: string;
  phone?: string;
}

/**
 * The seller's details, from SELLER_* in .env. Null until all the required ones are set: while
 * null, the documents, the "О продавце" block and the personal data consent stay switched off,
 * because a policy or a consent that names no one is worthless. Filling .env and restarting the
 * backend turns them all on.
 */
export function getSeller(): Seller | null {
  const { SELLER_NAME: name, SELLER_OGRN: ogrn, SELLER_INN: inn, SELLER_ADDRESS: address, SELLER_EMAIL: email } = process.env;
  if (!name || !ogrn || !inn || !address || !email) {
    return null;
  }
  return { name, ogrn, inn, address, email, phone: process.env.SELLER_PHONE || undefined };
}
