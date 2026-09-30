import QuickNote from '../widgets/QuickNote.ios';
import type { WidgetData } from '../widgets/QuickNoteWidget';
import { fetchWidgetData, readWidgetData, writeWidgetData } from './widget-data';

function render(data: WidgetData) {
  writeWidgetData(data);
  try {
    QuickNote.updateSnapshot(data);
  } catch {
    /* widget extension not installed (e.g. simulator without it) */
  }
}

export async function updateWidgets(data: Partial<WidgetData>) {
  render({ ...(await readWidgetData()), signedIn: true, ...data });
}

export function clearWidgets() {
  render({ signedIn: false });
}

export async function refreshWidgets(currency: string) {
  try {
    render(await fetchWidgetData(currency, await readWidgetData()));
  } catch {
    /* offline: keep the last values */
  }
}
