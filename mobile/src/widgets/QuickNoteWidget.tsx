'use no memo';
// Android home-screen widget. Android widgets can't contain a text box, so
// the note area opens Paylog's quick-add screen with the keyboard already up;
// after saving, the app closes itself and you're back on the home screen.
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

export type WidgetData = {
  signedIn: boolean;
  spent?: string; // "₹12,450"
  month?: string; // "September"
  last?: string; // "Saved ₹250 · Food"
};

const QUICK_URI = 'paylog://quick?from=widget';
const SCAN_URI = 'paylog://scan?from=widget';

function palette(dark: boolean) {
  return dark
    ? { paper: '#1f201e', ink: '#f3f1ec', muted: '#a5a29a', line: '#3a3a36', accent: '#5fb3a9', chip: '#2b3b38' } as const
    : { paper: '#fbf8f1', ink: '#141413', muted: '#6b6962', line: '#e4dfd2', accent: '#0e5e56', chip: '#e3efec' } as const;
}

function Note({ data, dark }: { data: WidgetData; dark: boolean }) {
  const c = palette(dark);
  const uri = data.signedIn ? QUICK_URI : 'paylog://';
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel="Add an expense in Paylog"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: c.paper,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        <ImageWidget image={require('../../assets/images/logo.png')} imageWidth={22} imageHeight={22} radius={6} />
        <TextWidget text="Paylog" style={{ fontSize: 14, fontWeight: '700', color: c.ink, marginLeft: 8 }} />
        <FlexWidget style={{ flex: 1 }} />
        {data.signedIn && data.spent ? (
          <TextWidget
            text={`${data.month ?? 'This month'}  ${data.spent}`}
            style={{ fontSize: 12, color: c.muted }}
            maxLines={1}
            truncate="END"
          />
        ) : null}
      </FlexWidget>

      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri }}
        style={{
          width: 'match_parent',
          flex: 1,
          marginTop: 8,
          marginBottom: 8,
          borderBottomWidth: 1,
          borderColor: c.line,
          flexDirection: 'column',
          justifyContent: 'center',
        }}>
        <TextWidget
          text={data.signedIn ? '✎  What did you spend?' : 'Sign in to Paylog'}
          style={{ fontSize: 18, fontWeight: '600', color: c.ink }}
          maxLines={1}
        />
        <TextWidget
          text={data.signedIn ? (data.last ?? 'e.g. 250 lunch · 2k rent · salary 65000') : 'Tap to open the app'}
          style={{ fontSize: 12, color: c.muted, marginTop: 2 }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>

      {data.signedIn ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: QUICK_URI }}
            style={{ backgroundColor: c.accent, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 }}>
            <TextWidget text="+ Add" style={{ fontSize: 13, fontWeight: '700', color: dark ? '#0d1f1c' : '#ffffff' }} />
          </FlexWidget>
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: SCAN_URI }}
            style={{ backgroundColor: c.chip, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6, marginLeft: 8 }}>
            <TextWidget text="Scan receipt" style={{ fontSize: 13, fontWeight: '600', color: c.accent }} />
          </FlexWidget>
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

export function QuickNoteWidget(data: WidgetData) {
  return { light: <Note data={data} dark={false} />, dark: <Note data={data} dark /> };
}
