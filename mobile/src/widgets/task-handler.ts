'use no memo';
// Runs in the background when Android adds, resizes or refreshes the widget
// (every 30 minutes, and right after the quick note saves), even while the app
// itself is closed.
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import * as SecureStore from 'expo-secure-store';

import { pendingQuickNotes, takeQuickNoteSaved } from '../../modules/paylog-quicknote';
import { fetchWidgetData, readWidgetData, writeWidgetData } from '../lib/widget-data';
import { QuickNoteWidget } from './QuickNoteWidget';

export async function widgetTaskHandler({ widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED') return;
  let data = await readWidgetData();
  // What the quick note just saved ("Saved ₹250 · Food") and what's still offline.
  const saved = takeQuickNoteSaved();
  data = { ...data, last: saved ?? data.last, pending: pendingQuickNotes() };
  if (saved) await writeWidgetData(data);
  renderWidget(QuickNoteWidget(data));
  if (widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_ADDED') {
    try {
      const user = await SecureStore.getItemAsync('paylog.user');
      const currency = user ? JSON.parse(user).currency : 'INR';
      data = await fetchWidgetData(currency, data);
      await writeWidgetData(data);
      renderWidget(QuickNoteWidget(data));
    } catch {
      /* offline: the cached figures stay */
    }
  }
}
