import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { Row } from './ui';

/** Looks like a text box; opens the quick-add note (same screen the widget opens). */
export function QuickBar() {
  const { colors } = useTheme();
  return (
    <Row gap={10}>
      <Pressable onPress={() => router.push('/quick')} accessibilityRole="button" accessibilityLabel="Quick add a transaction"
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.glassStrong,
          borderWidth: 1, borderColor: colors.glassBorder, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13,
          opacity: pressed ? 0.7 : 1 })}>
        <Icon name="edit" size={18} color={colors.accentText} />
        <Text style={{ color: colors.faint, fontSize: 15, flex: 1 }} numberOfLines={1}>Type “250 lunch” or “+1200 from Rahul”</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/scan')} accessibilityRole="button" accessibilityLabel="Scan a receipt"
        style={({ pressed }) => ({ backgroundColor: colors.accent, borderRadius: 16, padding: 13, opacity: pressed ? 0.8 : 1,
          shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 })}>
        <Icon name="scan" size={22} color={colors.onAccent} />
      </Pressable>
    </Row>
  );
}
