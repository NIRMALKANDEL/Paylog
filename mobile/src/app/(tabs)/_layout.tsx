import { router, Tabs } from 'expo-router';
import { Pressable, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/lib/theme';

function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={22} color={String(color)} />;
  };
}

export default function TabLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.accentText,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: 60 + insets.bottom, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false, tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: tabIcon('list') }} />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Add',
          tabBarAccessibilityLabel: 'Add a transaction',
          tabBarButton: () => (
            <Pressable
              onPress={() => router.push('/quick')}
              onLongPress={() => router.push('/transaction/new')}
              accessibilityRole="button"
              accessibilityLabel="Add a transaction. Long press for the full form."
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center',
                justifyContent: 'center', marginTop: -14, elevation: 4, shadowColor: '#000', shadowOpacity: 0.18,
                shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
                <Icon name="plus" size={26} color={colors.onAccent} strokeWidth={2.4} />
              </View>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics', tabBarIcon: tabIcon('chart') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('more') }} />
    </Tabs>
  );
}
