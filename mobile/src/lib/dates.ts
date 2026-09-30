const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD (not UTC, so late-night entries land on the right day). */
export function toISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso: string, days: number) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** "Today", "Yesterday", "Mon 12 Sep", or "12 Sep 2025" for other years. */
export function friendlyDate(iso: string) {
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const d = fromISO(iso);
  if (d.getFullYear() === new Date().getFullYear()) return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function shortDate(iso: string) {
  const d = fromISO(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
