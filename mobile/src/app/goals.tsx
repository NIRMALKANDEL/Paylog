import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import {
  Button, Card, Empty, ErrorState, Field, H2, IconButton, Label, Loading, Muted, Notice, Progress, Row, Screen, Stat,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { fromISO, shortDate, toISO } from '@/lib/dates';
import { centsToInput, formatMoney } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Goal } from '@/lib/types';
import { useData } from '@/lib/useData';

type Goals = { goals: Goal[]; totals: { target: number; saved: number; monthly: number } };
type Draft = { id?: number; name: string; target: string; saved: string; target_date: string };

const STATUS_TEXT: Record<Goal['status'], string> = {
  complete: 'Reached 🎉', overdue: 'Past its date', scheduled: '', open: 'No deadline',
};

export default function GoalsScreen() {
  const user = useUser();
  const { colors, dark } = useTheme();
  const { data, setData, error, refreshing, refresh, reload } = useData<Goals>('/goals');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickDate, setPickDate] = useState(false);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);
  const fmt = (c: number) => formatMoney(c, user.currency);

  if (error && !data) return <Screen><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!data) return <Loading />;

  async function run(action: () => Promise<Goals & { message?: string }>, success?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setData(result);
      if (result.message || success) setMessage({ tone: 'good', text: result.message || success! });
      return true;
    } catch (err) {
      setMessage({ tone: 'critical', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const body = { name: draft.name, target: draft.target, saved: draft.saved, target_date: draft.target_date };
    const ok = await run(() => draft.id
      ? api(`/goals/${draft.id}`, { method: 'PUT', body })
      : api('/goals', { body }), draft.id ? 'Goal updated.' : `Goal “${draft.name}” created.`);
    if (ok) setDraft(null);
  }

  function move(goal: Goal, action: 'add' | 'withdraw') {
    const amount = amounts[goal.id];
    if (!amount) return;
    run(() => api(`/goals/${goal.id}/contribute`, { body: { amount, action } })).then((ok) => {
      if (ok) setAmounts((a) => ({ ...a, [goal.id]: '' }));
    });
  }

  function remove(goal: Goal) {
    Alert.alert(`Delete “${goal.name}”?`, "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => api(`/goals/${goal.id}`, { method: 'DELETE' }), 'Goal deleted.') },
    ]);
  }

  if (draft) {
    return (
      <Screen>
        <H2>{draft.id ? 'Edit goal' : 'New goal'}</H2>
        {message?.tone === 'critical' ? <Notice tone="critical">{message.text}</Notice> : null}
        <Field label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="e.g. New laptop" maxLength={60} />
        <Field label="Target amount" value={draft.target} keyboardType="decimal-pad"
          onChangeText={(target) => setDraft({ ...draft, target: target.replace(/[^\d.]/g, '') })} placeholder="80000" />
        <Field label="Already saved" value={draft.saved} keyboardType="decimal-pad"
          onChangeText={(saved) => setDraft({ ...draft, saved: saved.replace(/[^\d.]/g, '') })} placeholder="0" />
        <View style={{ gap: 6 }}>
          <Label>Target date (optional)</Label>
          <Row>
            <Button title={draft.target_date ? shortDate(draft.target_date) : 'Choose a date'} variant="ghost" small
              onPress={() => setPickDate(true)} />
            {draft.target_date ? <Button title="Clear" variant="ghost" small onPress={() => setDraft({ ...draft, target_date: '' })} /> : null}
          </Row>
          {pickDate ? (
            <DateTimePicker value={draft.target_date ? fromISO(draft.target_date) : new Date()} mode="date"
              minimumDate={new Date()} themeVariant={dark ? 'dark' : 'light'}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(e, value) => {
                if (Platform.OS !== 'ios') setPickDate(false);
                if (e.type === 'set' && value) setDraft({ ...draft, target_date: toISO(value) });
              }} />
          ) : null}
        </View>
        <Row>
          <Button title="Cancel" variant="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} />
          <Button title="Save goal" onPress={saveDraft} loading={busy} style={{ flex: 2 }} disabled={!draft.name || !draft.target} />
        </Row>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {data.goals.length ? (
        <Card>
          <Row>
            <Stat label="Saved" value={fmt(data.totals.saved)} tone={colors.good} />
            <Stat label="Target" value={fmt(data.totals.target)} />
            <Stat label="Per month" value={fmt(data.totals.monthly)} />
          </Row>
        </Card>
      ) : (
        <Card><Empty icon="target" title="No goals yet" text="Saving for a trip, a laptop or an emergency fund? Add a goal and track it here." /></Card>
      )}

      {data.goals.map((goal) => (
        <Card key={goal.id}>
          <Row>
            <H2 style={{ flex: 1 }}>{goal.name}</H2>
            <IconButton icon="edit" label={`Edit ${goal.name}`} onPress={() => setDraft({
              id: goal.id, name: goal.name, target: centsToInput(goal.target_cents), saved: centsToInput(goal.saved_cents),
              target_date: goal.target_date || '',
            })} />
            <IconButton icon="trash" label={`Delete ${goal.name}`} onPress={() => remove(goal)} />
          </Row>
          <Progress percent={goal.percent} status={goal.status === 'overdue' ? 'warning' : 'good'} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Muted>{fmt(goal.saved_cents)} of {fmt(goal.target_cents)} · {Math.round(goal.percent)}%</Muted>
            {goal.target_date ? <Muted>by {shortDate(goal.target_date)}</Muted> : null}
          </Row>
          {goal.status === 'scheduled' && goal.monthly_needed_cents ? (
            <Text style={{ color: colors.accentText, fontWeight: '600' }}>
              Save {fmt(goal.monthly_needed_cents)} a month for {goal.months_left} month{goal.months_left === 1 ? '' : 's'}
            </Text>
          ) : STATUS_TEXT[goal.status] ? <Muted>{STATUS_TEXT[goal.status]}</Muted> : null}
          <Row>
            <Field value={amounts[goal.id] || ''} onChangeText={(v) => setAmounts((a) => ({ ...a, [goal.id]: v.replace(/[^\d.]/g, '') }))}
              placeholder="Amount" keyboardType="decimal-pad" style={{ width: 120 }} accessibilityLabel={`Amount for ${goal.name}`} />
            <Button title="Add" small onPress={() => move(goal, 'add')} disabled={!amounts[goal.id] || busy} />
            <Button title="Withdraw" small variant="ghost" onPress={() => move(goal, 'withdraw')} disabled={!amounts[goal.id] || busy} />
          </Row>
        </Card>
      ))}

      <Button title="New goal" icon="plus" onPress={() => { setMessage(null); setDraft({ name: '', target: '', saved: '', target_date: '' }); }} />
    </Screen>
  );
}
