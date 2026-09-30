import { useState } from 'react';

import { Body, Button, Card, Field, H1, Notice, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Same rules as the server (routes/auth.py), checked here first for quick feedback.
function checkPassword(password: string) {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number.';
  return null;
}

export default function Register() {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const problem = !name.trim() ? 'Please enter your name.'
      : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? 'Enter a valid email address.'
      : checkPassword(password) || (password !== confirm ? 'Passwords do not match.' : null);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(name.trim(), email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Create your account</H1>
      <Body>Free and private. Your data stays in your account.</Body>
      <Card style={{ gap: 14 }}>
        {error ? <Notice tone="critical">{error}</Notice> : null}
        <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" autoComplete="name" maxLength={60} />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none"
          autoComplete="email" keyboardType="email-address" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number." />
        <Field label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password"
          returnKeyType="go" onSubmitEditing={submit} />
        <Button title="Create account" onPress={submit} loading={busy} />
      </Card>
    </Screen>
  );
}
