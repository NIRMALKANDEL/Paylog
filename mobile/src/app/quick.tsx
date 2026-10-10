// The notes-style quick add inside the app: the "+" tab, the dashboard box and
// the iOS widget (paylog://quick?from=widget). The Android widget uses the
// native quick note instead (modules/paylog-quicknote), which never opens the app.
// Each line is one entry: "250 lunch", "salary 65000", "2k rent yesterday".
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Chip, Muted, Notice, Row } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { toISO } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Kind, QuickPreview, Transaction } from '@/lib/types';
import { refreshWidgets, updateWidgets } from '@/lib/widget';

const MAX_LINES = 10;
const EXAMPLES = ['250 lunch', 'salary 65000', '2k rent', 'uber 180 yesterday', '900 on 12 sep'];

function linesOf(text: string) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINES);
}

export default function Quick() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromWidget = from === 'widget';
  const user = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [previews, setPreviews] = useState<Record<string, QuickPreview>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Transaction[] | null>(null);
  // − / + switch: null lets the words decide ("salary 65000" is a credit).
  const [kind, setKind] = useState<Kind | null>(null);

  const lines = linesOf(text);

  // Live preview of what each line will save (debounced, cached per line).
  useEffect(() => {
    const pending = lines.filter((l) => !previews[l]);
    if (!pending.length) return;
    const timer = setTimeout(async () => {
      const results = await Promise.all(pending.map(async (line) => {
        try {
          return [line, await api<QuickPreview>(`/transactions/quick/preview?q=${encodeURIComponent(line)}${kind ? `&kind=${kind}` : ''}`)] as const;
        } catch (err) {
          return [line, { ok: false, error: errorMessage(err) }] as const;
        }
      }));
      setPreviews((prev) => ({ ...prev, ...Object.fromEntries(results) }));
    }, 350);
    return () => clearTimeout(timer);
  }, [lines.join('\n'), kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Android can open this screen before the keyboard is ready; focus again shortly after.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  function close() {
    if (fromWidget && Platform.OS === 'android') {
      BackHandler.exitApp(); // back to the home screen, like closing a note
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  async function save() {
    if (!lines.length) {
      setError('Type something like “250 lunch”.');
      return;
    }
    const bad = lines.find((l) => previews[l] && !previews[l].ok);
    if (bad) {
      setError(`“${bad}”: ${previews[bad].error}`);
      return;
    }
    setSaving(true);
    setError(null);
    const done: Transaction[] = [];
    try {
      for (const line of lines) {
        // The phone's date, so "today" is right even when the server's clock (UTC) is still on yesterday.
        const res = await api<{ transaction: Transaction }>('/transactions/quick', { body: { q: line, written_on: toISO(new Date()), kind } });
        done.push(res.transaction);
      }
      const last = done[done.length - 1];
      updateWidgets({ last: `Saved ${formatMoney(last.amount_cents, user.currency)} · ${last.category}` });
      refreshWidgets(user.currency);
      setSaved(done);
      setText('');
      setPreviews({});
      if (fromWidget && Platform.OS === 'android') setTimeout(close, 900);
    } catch (err) {
      // Lines saved before the failure stay saved; show what's left.
      setText(lines.slice(done.length).join('\n'));
      setError(errorMessage(err));
      if (done.length) setSaved(done);
    } finally {
      setSaving(false);
    }
  }

  async function undo() {
    if (!saved) return;
    try {
      await Promise.all(saved.map((tx) => api(`/transactions/${tx.id}`, { method: 'DELETE' })));
      setSaved(null);
      refreshWidgets(user.currency);
      updateWidgets({ last: undefined });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        {saved ? (
          <View style={{ gap: 10 }}>
            <Notice tone="good">
              {saved.length === 1
                ? `Saved ${formatMoney(saved[0].amount_cents, user.currency)} · ${saved[0].category}${saved[0].description ? ` · ${saved[0].description}` : ''}`
                : `Saved ${saved.length} entries.`}
            </Notice>
            <Row>
              <Button title="Undo" variant="ghost" small onPress={undo} />
              {saved.length === 1 ? (
                <Button title="Edit" variant="ghost" small onPress={() =>
                  router.replace({ pathname: '/transaction/[id]', params: { id: String(saved[0].id) } })} />
              ) : null}
              <View style={{ flex: 1 }} />
              <Button title="Done" small onPress={close} />
            </Row>
          </View>
        ) : null}

        <Row>
          {(['expense', 'income'] as Kind[]).map((k) => (
            <Chip key={k} label={k === 'income' ? '+  Credit' : '−  Debit'} active={kind === k}
              onPress={() => { setKind(kind === k ? null : k); setPreviews({}); }} />
          ))}
          <Muted>{kind ? 'Tap again for auto' : 'Auto from your words'}</Muted>
        </Row>

        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(t) => {
            setText(t);
            setError(null);
          }}
          autoFocus
          multiline
          placeholder={'250 lunch\n+1200 from Rahul'}
          placeholderTextColor={colors.faint}
          accessibilityLabel="Quick entry. One transaction per line."
          style={{ fontSize: 22, lineHeight: 34, color: colors.ink, minHeight: 150, textAlignVertical: 'top', padding: 0 }}
        />

        <View style={{ gap: 6 }}>
          {lines.map((line) => {
            const p = previews[line];
            return (
              <Row key={line} gap={8}>
                <Icon name={p && !p.ok ? 'alert' : 'check'} size={15} color={p ? (p.ok ? colors.good : colors.warning) : colors.faint} />
                <Text style={{ color: p && !p.ok ? colors.warning : colors.inkSoft, flex: 1, fontSize: 14 }} numberOfLines={2}>
                  {!p ? `${line} …`
                    : p.ok ? `${p.kind === 'income' ? '+ Credit' : '− Debit'} ${p.amount} · ${p.category}${p.description ? ` · ${p.description}` : ''} · ${p.when}`
                    : p.error}
                </Text>
              </Row>
            );
          })}
        </View>

        {error ? <Notice tone="critical">{error}</Notice> : null}

        <Row>
          <Button title={lines.length > 1 ? `Save ${lines.length}` : 'Save'} icon="check" onPress={save} loading={saving}
            disabled={!lines.length} style={{ flex: 1 }} />
          <Button title="Full form" variant="ghost" onPress={() => router.replace('/transaction/new')} />
        </Row>

        {!lines.length && !saved ? (
          <View style={{ gap: 8 }}>
            <Muted>Try:</Muted>
            <Row style={{ flexWrap: 'wrap' }}>
              {EXAMPLES.map((e) => (
                <Pressable key={e} onPress={() => setText(e)} accessibilityRole="button"
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ color: colors.muted }}>{e}</Text>
                </Pressable>
              ))}
            </Row>
            <Muted>Start with + for money received (“+500 refund”), or use the switch above. Add “yesterday”, “monday” or “12 sep” for another day.</Muted>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
