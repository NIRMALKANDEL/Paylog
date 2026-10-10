import { router, type Href } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Card, Divider, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

const LINKS: { href: Href; icon: IconName; title: string; text: string }[] = [
  { href: '/scan', icon: 'scan', title: 'Scan receipt', text: 'Read a GPay, PhonePe or Paytm screenshot' },
  { href: '/budgets', icon: 'wallet', title: 'Budgets', text: 'Monthly and per-category limits' },
  { href: '/goals', icon: 'target', title: 'Savings goals', text: 'Track what you are saving for' },
  { href: '/recurring', icon: 'repeat', title: 'Recurring', text: 'Rent, salary and subscriptions, added automatically' },
  { href: '/calculators', icon: 'calc', title: 'Calculators', text: 'Savings growth, goals, emergency fund, loan EMI' },
  { href: '/import', icon: 'upload', title: 'Import CSV', text: 'Bring in transactions from a spreadsheet' },
  { href: '/settings', icon: 'settings', title: 'Settings', text: 'Profile, appearance, security, your data' },
];

export default function More() {
  const { colors } = useTheme();
  const { user, signOut } = useAuth();

  function confirmSignOut() {
    Alert.alert('Sign out of Paylog?', 'You will need your password to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  return (
    <Screen tabBar>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {LINKS.map((link, i) => (
          <View key={link.title}>
            {i ? <Divider /> : null}
            <Pressable onPress={() => router.push(link.href)} accessibilityRole="button"
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ backgroundColor: colors.accentSoft, borderRadius: 11, padding: 8 }}>
                <Icon name={link.icon} size={20} color={colors.accentText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }}>{link.title}</Text>
                <Muted>{link.text}</Muted>
              </View>
              <Icon name="chevron-right" size={18} color={colors.faint} />
            </Pressable>
          </View>
        ))}
      </Card>

      <Card>
        <Muted>Signed in as {user?.email}</Muted>
        <Pressable onPress={confirmSignOut} accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
          <Icon name="logout" size={20} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 15 }}>Sign out</Text>
        </Pressable>
      </Card>
      <Muted style={{ textAlign: 'center' }}>Tip: long-press your home screen → Widgets → Paylog to add the quick note widget.</Muted>
    </Screen>
  );
}
