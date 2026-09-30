import { requestWidgetUpdate } from 'react-native-android-widget';

import { QuickNoteWidget, type WidgetData } from '../widgets/QuickNoteWidget';
import { fetchWidgetData, readWidgetData, writeWidgetData } from './widget-data';

async function render(data: WidgetData) {
  await writeWidgetData(data);
  await requestWidgetUpdate({
    widgetName: 'QuickNote',
    renderWidget: () => QuickNoteWidget(data),
  }).catch(() => {});
}

/** Merge new values (e.g. the last quick entry) into what the widget shows. */
export async function updateWidgets(data: Partial<WidgetData>) {
  const current = await readWidgetData();
  await render({ ...current, signedIn: true, ...data });
}

export function clearWidgets() {
  render({ signedIn: false });
}

export async function refreshWidgets(currency: string) {
  try {
    await render(await fetchWidgetData(currency, await readWidgetData()));
  } catch {
    /* offline: keep showing the last known values */
  }
}
