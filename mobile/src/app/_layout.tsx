import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider as NavThemeProvider, usePathname } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { Loading } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { refreshWidgets } from '@/lib/widget';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Back from a deep-linked screen (widget, share) lands on Home.
export const unstable_settings = { initialRouteName: '(tabs)' };

function Navigator() {
  const { status, user } = useAuth();
  const { colors, dark } = useTheme();
  const signedIn = status === 'signedIn';
  const pathname = usePathname();
  const { hasShareIntent } = useShareIntentContext();

  // Something was shared to Paylog while signed out: open the scanner once signed in.
  useEffect(() => {
    if (signedIn && hasShareIntent && pathname !== '/scan') router.push('/scan');
  }, [signedIn, hasShareIntent, pathname]);

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  // Keep the home-screen widget's month total fresh whenever the app is opened.
  const currency = user?.currency;
  useEffect(() => {
    if (!signedIn || !currency) return;
    refreshWidgets(currency);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshWidgets(currency);
    });
    return () => sub.remove();
  }, [signedIn, currency]);

  if (status === 'loading') return null;
  // Signed in but the profile hasn't loaded yet (first start, slow network).
  if (signedIn && !user) return <Loading />;

  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: colors.accent, background: colors.bg, card: colors.card, text: colors.ink, border: colors.border },
  };
  const header = {
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.ink,
    headerShadowVisible: false,
    headerTitleStyle: { fontWeight: '700' as const },
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: colors.bg },
  };

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={header}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="quick" options={{ presentation: 'modal', title: 'Quick note' }} />
          <Stack.Screen name="transaction/new" options={{ presentation: 'modal', title: 'New transaction' }} />
          <Stack.Screen name="transaction/[id]" options={{ title: 'Edit transaction' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan receipt' }} />
          <Stack.Screen name="budgets" options={{ title: 'Budgets' }} />
          <Stack.Screen name="goals" options={{ title: 'Savings goals' }} />
          <Stack.Screen name="recurring" options={{ title: 'Recurring' }} />
          <Stack.Screen name="calculators" options={{ title: 'Calculators' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="import" options={{ title: 'Import CSV' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ title: '' }} />
          <Stack.Screen name="forgot" options={{ title: '' }} />
        </Stack.Protected>
      </Stack>
    </NavThemeProvider>
  );
}

function Themed() {
  const { user } = useAuth();
  return (
    <ThemeProvider mode={user?.mode} themeKey={user?.theme} accent={user?.accent}>
      <Navigator />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ resetOnBackground: true }}>
      <AuthProvider>
        <Themed />
      </AuthProvider>
    </ShareIntentProvider>
  );
}
