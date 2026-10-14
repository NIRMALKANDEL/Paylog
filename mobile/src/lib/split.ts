import { formatMoney } from './money';

/** "You're owed ₹500" / "You owe ₹200" / "Settled up", with its tone. */
export function netLabel(cents: number, currency: string) {
  if (cents > 0) return { text: `You're owed ${formatMoney(cents, currency)}`, tone: 'good' as const };
  if (cents < 0) return { text: `You owe ${formatMoney(-cents, currency)}`, tone: 'critical' as const };
  return { text: 'Settled up', tone: 'muted' as const };
}
