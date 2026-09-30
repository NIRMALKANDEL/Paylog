'use no memo';
// Runs in the background when Android adds, resizes or refreshes the widget
// (every 30 minutes), even while the app itself is closed.
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import * as SecureStore from 'expo-secure-store';

import { fetchWidgetData, readWidgetData, writeWidgetData } from '../lib/widget-data';
import { QuickNoteWidget } from './QuickNoteWidget';

export async function widgetTaskHandler({ widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED') return;
  let data = await readWidgetData();
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
