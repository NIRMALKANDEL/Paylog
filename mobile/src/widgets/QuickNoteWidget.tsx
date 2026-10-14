'use no memo';
// Android home-screen widget: one compact row. Tap anywhere to add an expense,
// see this month's spending, or tap the scan icon. Android widgets can't
// contain a text box, so a tap opens the quick note: a native card over the
// home screen with the keyboard up (modules/paylog-quicknote). It saves straight
// to the server without opening the app; this widget then redraws with the new total.
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

export type WidgetData = {
  signedIn: boolean;
  spent?: string; // "₹12,450"
  month?: string; // "September" (cached; the widget says "this month")
  last?: string; // "Saved ₹250 · Food" (kept for older cached data; no longer shown)
  pending?: number; // notes typed offline, not sent yet
};

const QUICK_URI = 'paylog-note://add';
const SCAN_URI = 'paylog://scan?from=widget';

function palette(dark: boolean) {
  return dark
    ? { paper: '#1f201e', ink: '#f3f1ec', muted: '#a5a29a', accent: '#5fb3a9', onAccent: '#0d1f1c', chip: '#2b3b38' } as const
    : { paper: '#fbf8f1', ink: '#141413', muted: '#6b6962', accent: '#0e5e56', onAccent: '#ffffff', chip: '#e3efec' } as const;
}

// Same "scan" outline as the website's icon set.
function scanIcon(color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" `
    + 'stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3'
    + 'M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 12h8"/></svg>';
}

/** The one line under "Add expense": what's waiting offline, else this month's spending. */
export function subtitle(data: WidgetData) {
  if (data.pending) return `${data.pending} note${data.pending === 1 ? '' : 's'} waiting for internet`;
  if (data.spent) return `${data.spent} this month`;
  return 'e.g. 250 lunch, 40 tea';
}

function Note({ data, dark }: { data: WidgetData; dark: boolean }) {
  const c = palette(dark);
  const uri = data.signedIn ? QUICK_URI : 'paylog://';
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel={data.signedIn ? 'Add an expense in Paylog' : 'Open Paylog to sign in'}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: c.paper,
        borderRadius: 22,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
      }}>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri }}
        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, justifyContent: 'center',
          alignItems: 'center' }}>
        <TextWidget text="+" style={{ fontSize: 22, fontWeight: '700', color: c.onAccent }} />
      </FlexWidget>

      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri }}
        style={{ flex: 1, height: 'match_parent', marginLeft: 10, flexDirection: 'column', justifyContent: 'center' }}>
        <TextWidget
          text={data.signedIn ? 'Add expense' : 'Sign in to Paylog'}
          style={{ fontSize: 16, fontWeight: '600', color: c.ink }}
          maxLines={1}
          truncate="END"
        />
        <TextWidget
          text={data.signedIn ? subtitle(data) : 'Tap to open the app'}
          style={{ fontSize: 12, color: c.muted, marginTop: 1 }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>

      {data.signedIn ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: SCAN_URI }}
          accessibilityLabel="Scan a receipt"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.chip, justifyContent: 'center',
            alignItems: 'center', marginLeft: 8 }}>
          <SvgWidget svg={scanIcon(c.accent)} style={{ width: 22, height: 22 }} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

export function QuickNoteWidget(data: WidgetData) {
  return { light: <Note data={data} dark={false} />, dark: <Note data={data} dark /> };
}
