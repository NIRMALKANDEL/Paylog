import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Button, Card, Chip, Field, H2, Label, Muted, Notice, Row, Screen, Segmented } from '@/components/ui';
import { api, API_URL, errorMessage } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { todayISO } from '@/lib/dates';
import { CURRENCIES } from '@/lib/money';
import { THEMES, useTheme } from '@/lib/theme';
import type { Mode, User } from '@/lib/types';

type Msg = { tone: 'good' | 'critical' | 'info'; text: string } | null;

export default function Settings() {
  const user = useUser();
  const { setUser, signOut } = useAuth();
  const { colors } = useTheme();
  const [msg, setMsg] = useState<Msg>(null);
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [emailForm, setEmailForm] = useState({ email: '', password: '' });
  const [deletePw, setDeletePw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<{ message?: string; user?: User } | void>, success?: string) {
    setBusy(key);
    setMsg(null);
    try {
      const result = await action();
      if (result && result.user) setUser(result.user);
      const text = (result && result.message) || success;
      if (text) setMsg({ tone: 'good', text });
      return true;
    } catch (err) {
      setMsg({ tone: 'critical', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: Partial<User>, success?: string) => run('patch', () => api('/me', { method: 'PATCH', body }), success);

  async function exportFile(kind: 'csv' | 'json') {
    await run(`export-${kind}`, async () => {
      const path = kind === 'csv' ? '/transactions/export.csv' : '/me/export.json';
      const text = await api<string>(path, { raw: true });
      const file = new File(Paths.cache, `paylog-${kind === 'csv' ? 'transactions' : 'backup'}-${todayISO()}.${kind}`);
      if (file.exists) file.delete();
      file.create();
      file.write(text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: kind === 'csv' ? 'text/csv' : 'application/json', dialogTitle: 'Save or send your Paylog data' });
      }
    });
  }

  function confirmDelete() {
    Alert.alert('Delete your account?', 'Every transaction, budget, goal and recurring item will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete forever', style: 'destructive', onPress: async () => {
          if (await run('delete', () => api('/me/delete', { body: { password: deletePw } }))) await signOut();
        },
      },
    ]);
  }

  return (
    <Screen>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card>
        <H2>Profile</H2>
        <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
        <Button title="Save name" variant="soft" small disabled={name.trim() === user.name || !name.trim()}
          loading={busy === 'patch'} onPress={() => patch({ name: name.trim() }, 'Profile saved.')} />
        <Label>Currency</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(CURRENCIES).map(([code, c]) => (
            <Chip key={code} label={`${c.symbol} ${code}`} active={user.currency === code}
              onPress={() => patch({ currency: code }, `Currency set to ${c.label}.`)} />
          ))}
        </View>
        <Muted>Changing currency changes the symbol only. Amounts aren’t converted.</Muted>
      </Card>

      <Card>
        <H2>Appearance</H2>
        <Segmented<Mode> value={user.mode} onChange={(mode) => patch({ mode })}
          options={[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <Label>Colour</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {Object.entries(THEMES).map(([key, t]) => {
            const active = (user.theme || 'paylog') === key && !user.accent;
            return (
              <Pressable key={key} onPress={() => patch({ theme: key, accent: null })} accessibilityRole="button"
                accessibilityLabel={`${t.label} theme`} accessibilityState={{ selected: active }}
                style={{ alignItems: 'center', gap: 4 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, borderWidth: 3,
                  borderColor: active ? colors.ink : 'transparent' }} />
                <Muted>{t.label}</Muted>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <H2>Email</H2>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: colors.ink, flex: 1 }} numberOfLines={1}>{user.email}</Text>
          <Text style={{ color: user.email_verified ? colors.good : colors.warning, fontWeight: '600' }}>
            {user.email_verified ? 'Confirmed' : 'Not confirmed'}
          </Text>
        </Row>
        {!user.email_verified ? (
          <Button title="Resend confirmation email" variant="ghost" small loading={busy === 'verify'}
            onPress={() => run('verify', () => api('/me/resend-verification', { method: 'POST' }))} />
        ) : null}
        <Field label="New email" value={emailForm.email} onChangeText={(email) => setEmailForm({ ...emailForm, email })}
          autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Your password" value={emailForm.password} secureTextEntry autoComplete="current-password"
          onChangeText={(password) => setEmailForm({ ...emailForm, password })} />
        <Button title="Change email" variant="soft" small loading={busy === 'email'} disabled={!emailForm.email || !emailForm.password}
          onPress={async () => {
            if (await run('email', () => api('/me/email', { body: emailForm }))) setEmailForm({ email: '', password: '' });
          }} />
      </Card>

      <Card>
        <H2>Password</H2>
        <Field label="Current password" value={pw.current} secureTextEntry autoComplete="current-password"
          onChangeText={(current) => setPw({ ...pw, current })} />
        <Field label="New password" value={pw.next} secureTextEntry autoComplete="new-password"
          onChangeText={(next) => setPw({ ...pw, next })} hint="At least 8 characters, with a letter and a number." />
        <Button title="Change password" variant="soft" small loading={busy === 'password'} disabled={!pw.current || !pw.next}
          onPress={async () => {
            if (await run('password', () => api('/me/password', { body: { current_password: pw.current, new_password: pw.next } }))) {
              setPw({ current: '', next: '' });
            }
          }} />
        <Muted>Changing your password keeps this phone signed in and signs out every other device.</Muted>
      </Card>

      <Card>
        <H2>Your data</H2>
        <Row>
          <Button title="Transactions CSV" icon="download" variant="ghost" small style={{ flex: 1 }}
            loading={busy === 'export-csv'} onPress={() => exportFile('csv')} />
          <Button title="Full backup" icon="download" variant="ghost" small style={{ flex: 1 }}
            loading={busy === 'export-json'} onPress={() => exportFile('json')} />
        </Row>
        <Row>
          <Button title="Privacy" variant="ghost" small style={{ flex: 1 }} onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/privacy`)} />
          <Button title="Terms" variant="ghost" small style={{ flex: 1 }} onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/terms`)} />
        </Row>
      </Card>

      <Card style={{ borderColor: colors.danger }}>
        <H2>Delete account</H2>
        <Muted>Permanently deletes your account and all its data. This can’t be undone.</Muted>
        <Field label="Confirm with your password" value={deletePw} onChangeText={setDeletePw} secureTextEntry />
        <Button title="Delete my account" variant="danger" small disabled={!deletePw} loading={busy === 'delete'} onPress={confirmDelete} />
      </Card>

      <Muted style={{ textAlign: 'center' }}>
        Paylog {Application.nativeApplicationVersion ?? ''} · {API_URL.replace(/^https?:\/\//, '')}
      </Muted>
    </Screen>
  );
}
