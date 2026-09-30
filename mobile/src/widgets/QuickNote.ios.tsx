// iOS home-screen widget (WidgetKit via expo-widgets). iOS widgets can't hold
// a text box, so tapping it opens Paylog's quick-add note with the keyboard up.
import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type QuickNoteProps = { signedIn: boolean; spent?: string; month?: string; last?: string };

const QuickNote = (props: QuickNoteProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const ink = dark ? '#f3f1ec' : '#141413';
  const muted = dark ? '#a5a29a' : '#6b6962';
  const accent = dark ? '#5fb3a9' : '#0e5e56';
  const small = environment.widgetFamily === 'systemSmall';
  const url = props.signedIn ? 'paylog://quick?from=widget' : 'paylog://';
  return (
    <VStack alignment="leading" modifiers={[padding({ all: 4 }), widgetURL(url)]}>
      <HStack>
        <Text modifiers={[font({ weight: 'bold', size: 14 }), foregroundStyle(accent)]}>Paylog</Text>
        <Spacer />
        {props.signedIn && props.spent && !small ? (
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{`${props.month ?? ''} ${props.spent}`}</Text>
        ) : null}
      </HStack>
      <Spacer />
      <Text modifiers={[font({ weight: 'semibold', size: small ? 16 : 19 }), foregroundStyle(ink)]}>
        {props.signedIn ? '✎ What did you spend?' : 'Sign in to Paylog'}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>
        {props.signedIn ? (small ? (props.spent ?? 'Tap to add') : (props.last ?? 'e.g. 250 lunch · 2k rent')) : 'Tap to open'}
      </Text>
      <Spacer />
      {props.signedIn ? (
        <Text modifiers={[font({ weight: 'bold', size: 13 }), foregroundStyle(accent)]}>+ Add expense</Text>
      ) : null}
    </VStack>
  );
};

export default createWidget<QuickNoteProps>('QuickNote', QuickNote);
