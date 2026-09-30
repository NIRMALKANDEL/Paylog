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
      <Pressable onPress={() => router.push('/quick')} accessibilityRole="button" accessibilityLabel="Quick add an expense"
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card,
          borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13,
          opacity: pressed ? 0.7 : 1 })}>
        <Icon name="edit" size={18} color={colors.accentText} />
        <Text style={{ color: colors.faint, fontSize: 15, flex: 1 }} numberOfLines={1}>Type “250 lunch” or “salary 65000”</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/scan')} accessibilityRole="button" accessibilityLabel="Scan a receipt"
        style={({ pressed }) => ({ backgroundColor: colors.accentSoft, borderRadius: 14, padding: 13, opacity: pressed ? 0.7 : 1 })}>
        <Icon name="scan" size={22} color={colors.accentText} />
      </Pressable>
    </Row>
  );
}
