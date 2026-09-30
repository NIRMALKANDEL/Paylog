import { useState } from 'react';

import { Body, Button, Card, Field, H1, Notice, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ message: string }>('/auth/forgot-password', { body: { email: email.trim() } });
      setMessage(data.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Reset your password</H1>
      <Body>We’ll email you a link to choose a new password. It works for one hour.</Body>
      <Card style={{ gap: 14 }}>
        {message ? <Notice tone="good">{message}</Notice> : null}
        {error ? <Notice tone="critical">{error}</Notice> : null}
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none"
          autoComplete="email" keyboardType="email-address" returnKeyType="send" onSubmitEditing={submit} />
        <Button title="Send reset link" onPress={submit} loading={busy} disabled={!email.trim()} />
      </Card>
    </Screen>
  );
}
