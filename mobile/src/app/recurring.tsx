import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { TransactionForm, type TxDraft } from '@/components/TransactionForm';
import {
  Button, Card, Divider, Empty, ErrorState, IconButton, Label, Loading, Muted, Notice, Row, Screen, Segmented, Stat,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { friendlyDate, todayISO } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Rule } from '@/lib/types';
import { useData } from '@/lib/useData';

type Recurring = { rules: Rule[]; monthly: { expense: number; income: number } };
type Frequency = Rule['frequency'];

export default function RecurringScreen() {
  const user = useUser();
  const { colors } = useTheme();
  const { data, setData, error, refreshing, refresh, reload } = useData<Recurring>('/recurring');
  const [adding, setAdding] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);
  const fmt = (c: number) => formatMoney(c, user.currency);

  if (error && !data) return <Screen><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!data) return <Loading />;

  async function run(action: () => Promise<Recurring & { backfilled?: number }>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setData(result);
      const extra = result.backfilled ? ` ${result.backfilled} past occurrence${result.backfilled === 1 ? '' : 's'} added to your transactions.` : '';
      setMessage({ tone: 'good', text: success + extra });
      return true;
    } catch (err) {
      setMessage({ tone: 'critical', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(draft: TxDraft) {
    if (await run(() => api('/recurring', { body: { ...draft, frequency } }), 'Recurring item saved.')) setAdding(false);
  }

  function remove(rule: Rule) {
    Alert.alert('Delete this recurring item?', 'Transactions it already created are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => api(`/recurring/${rule.id}`, { method: 'DELETE' }), 'Recurring item deleted.') },
    ]);
  }

  if (adding) {
    return (
      <Screen>
        <Muted>The first date is when it starts. Paylog adds each occurrence to your transactions on its date.</Muted>
        <View style={{ gap: 8 }}>
          <Label>Repeats</Label>
          <Segmented<Frequency> value={frequency} onChange={setFrequency} options={[
            { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
        </View>
        <TransactionForm
          initial={{ kind: 'expense', amount: '', category: 'Rent', date: todayISO(), description: '' }}
          currency={user.currency} submitLabel="Save recurring item" busy={busy}
          error={message?.tone === 'critical' ? message.text : null} onSubmit={create} />
        <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} />
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Card>
        <Row>
          <Stat label="Bills / month" value={fmt(data.monthly.expense)} />
          <Stat label="Credit / month" value={fmt(data.monthly.income)} tone={colors.good} />
        </Row>
      </Card>
      {data.rules.length ? (
        <Card style={{ gap: 0 }}>
          {data.rules.map((rule, i) => (
            <View key={rule.id}>
              {i ? <Divider /> : null}
              <Row style={{ paddingVertical: 10, opacity: rule.active ? 1 : 0.55 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
                    {rule.description || rule.category}
                  </Text>
                  <Muted>
                    {rule.frequency[0].toUpperCase() + rule.frequency.slice(1)} · {rule.category} ·{' '}
                    {rule.active ? `next ${friendlyDate(rule.next_date)}` : 'paused'}
                  </Muted>
                </View>
                <Text style={{ fontWeight: '700', color: rule.kind === 'income' ? colors.good : colors.ink }}>
                  {rule.kind === 'income' ? '+' : '−'}{fmt(rule.amount_cents)}
                </Text>
                <IconButton icon={rule.active ? 'pause' : 'play'} label={rule.active ? 'Pause' : 'Resume'}
                  onPress={() => run(() => api(`/recurring/${rule.id}/toggle`, { method: 'POST' }), rule.active ? 'Paused.' : 'Resumed.')} />
                <IconButton icon="trash" label="Delete" onPress={() => remove(rule)} />
              </Row>
            </View>
          ))}
        </Card>
      ) : (
        <Card><Empty icon="repeat" title="Nothing recurring yet" text="Add rent, salary or subscriptions once and Paylog records them for you every time." /></Card>
      )}
      <Button title="Add recurring item" icon="plus" onPress={() => { setMessage(null); setAdding(true); }} />
    </Screen>
  );
}
