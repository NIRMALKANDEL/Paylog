// Mirrors services/money.py and services/categories.py on the server.

export const CURRENCIES: Record<string, { symbol: string; grouping: 'indian' | 'western'; label: string }> = {
  INR: { symbol: '₹', grouping: 'indian', label: 'Indian Rupee' },
  NPR: { symbol: 'रू', grouping: 'indian', label: 'Nepalese Rupee' },
  USD: { symbol: '$', grouping: 'western', label: 'US Dollar' },
  EUR: { symbol: '€', grouping: 'western', label: 'Euro' },
  GBP: { symbol: '£', grouping: 'western', label: 'British Pound' },
  AUD: { symbol: 'A$', grouping: 'western', label: 'Australian Dollar' },
  CAD: { symbol: 'C$', grouping: 'western', label: 'Canadian Dollar' },
};

export const EXPENSE_CATEGORIES = [
  'Food', 'Groceries', 'Rent', 'Bills', 'Transport', 'Shopping', 'Health', 'Entertainment', 'Education', 'Travel', 'Other',
];
export const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Business', 'Investment', 'Gift', 'Other'];
export const CATEGORIES = { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES };

function groupWestern(digits: string) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function groupIndian(digits: string) {
  if (digits.length <= 3) return digits;
  let head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const parts: string[] = [];
  while (head.length > 2) {
    parts.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head) parts.unshift(head);
  return `${parts.join(',')},${tail}`;
}

/** ₹1,23,456 or $123,456.78 — paise shown only when there are any (like the website). */
export function formatMoney(cents: number | null | undefined, currency = 'INR', decimals: boolean | null = null) {
  let value = Math.round(Number(cents) || 0);
  const info = CURRENCIES[currency] || CURRENCIES.INR;
  const sign = value < 0 ? '−' : '';
  value = Math.abs(value);
  const whole = Math.floor(value / 100);
  const frac = value % 100;
  const group = info.grouping === 'indian' ? groupIndian : groupWestern;
  let text = group(String(whole));
  if (decimals === true || (decimals === null && frac)) text += `.${String(frac).padStart(2, '0')}`;
  return `${sign}${info.symbol}${text}`;
}

/** Whole-unit amounts (calculators), e.g. 125000 -> ₹1,25,000. */
export function formatUnits(units: number, currency = 'INR') {
  if (!Number.isFinite(units)) return '—';
  return formatMoney(Math.round(units) * 100, currency, false);
}

/** 125050 -> "1250.50", 100000 -> "1000" (for editing in an input). */
export function centsToInput(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '';
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac ? `${whole}.${String(frac).padStart(2, '0')}` : String(whole);
}

export function symbolFor(currency: string) {
  return (CURRENCIES[currency] || CURRENCIES.INR).symbol;
}
