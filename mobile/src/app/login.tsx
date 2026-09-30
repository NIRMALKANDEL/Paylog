import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Button, Card, Field, H1, Logo, Muted, Notice, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function Login() {
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <Screen>
        <View style={{ alignItems: 'center', gap: 10, marginTop: 28, marginBottom: 8 }}>
          <Logo size={64} />
          <H1>Welcome to Paylog</H1>
          <Body style={{ textAlign: 'center', color: colors.muted }}>Know where your money goes.</Body>
        </View>
        <Card style={{ gap: 14 }}>
          {error ? <Notice tone="critical">{error}</Notice> : null}
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none"
            autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()} />
          <View>
            <Field ref={passwordRef} label="Password" value={password} onChangeText={setPassword} placeholder="Your password"
              secureTextEntry={!show} autoComplete="current-password" textContentType="password" returnKeyType="go"
              onSubmitEditing={submit} />
            <Pressable onPress={() => setShow(!show)} hitSlop={8} accessibilityRole="button"
              style={{ position: 'absolute', right: 12, top: 38 }}>
              <Text style={{ color: colors.accentText, fontWeight: '600' }}>{show ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>
          <Button title="Sign in" onPress={submit} loading={busy} />
          <Link href="/forgot" asChild>
            <Pressable accessibilityRole="link"><Muted style={{ textAlign: 'center', color: colors.accentText }}>Forgot password?</Muted></Pressable>
          </Link>
        </Card>
        <Muted style={{ textAlign: 'center' }}>You stay signed in on this phone until you sign out.</Muted>
        <Link href="/register" asChild>
          <Pressable accessibilityRole="link" style={{ padding: 8 }}>
            <Text style={{ textAlign: 'center', color: colors.inkSoft, fontSize: 15 }}>
              New here? <Text style={{ color: colors.accentText, fontWeight: '700' }}>Create a free account</Text>
            </Text>
          </Pressable>
        </Link>
      </Screen>
    </SafeAreaView>
  );
}
