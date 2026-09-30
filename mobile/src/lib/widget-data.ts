import * as SecureStore from 'expo-secure-store';

import type { WidgetData } from '../widgets/QuickNoteWidget';
import { api, loadToken } from './api';
import { toISO } from './dates';
import { formatMoney } from './money';

const KEY = 'paylog.widget';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];

export async function readWidgetData(): Promise<WidgetData> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return { signedIn: !!(await loadToken().catch(() => null)) };
}

export async function writeWidgetData(data: WidgetData) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(data)).catch(() => {});
}

/** This month's spending, fetched with the saved sign-in (works while the app is closed). */
export async function fetchWidgetData(currency: string, previous?: WidgetData): Promise<WidgetData> {
  if (!(await loadToken())) return { signedIn: false };
  const now = new Date();
  const start = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const data = await api<{ summary: { expense: number } }>(`/transactions?kind=expense&start=${start}`);
  return {
    ...previous,
    signedIn: true,
    spent: formatMoney(data.summary.expense, currency),
    month: MONTHS[now.getMonth()],
  };
}
