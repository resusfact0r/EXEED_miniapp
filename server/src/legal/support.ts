/**
 * A person customers can write to (SUPPORT_TELEGRAM, a Telegram username). The bot itself only
 * answers articles, so returns, questions about an order and personal data requests need a human.
 */
export function getSupportUsername(): string | null {
  const name = process.env.SUPPORT_TELEGRAM?.trim().replace(/^@/, '');
  return name || null;
}

export function supportLink(username: string): string {
  return `https://t.me/${username}`;
}
