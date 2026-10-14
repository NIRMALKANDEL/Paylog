// One shared-expense group: who owes whom, the fewest payments to settle up,
// adding an expense (split equally or by exact amounts), and the people in it.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import {
  Button, Card, Chip, Divider, ErrorState, Field, H2, IconButton, Label, Loading, Muted, Notice, Row, Screen, Segmented,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { friendlyDate, todayISO } from '@/lib/dates';
import { centsToInput, formatMoney } from '@/lib/money';
import { netLabel } from '@/lib/split';
import { useTheme } from '@/lib/theme';
import type { SplitGroup } from '@/lib/types';
import { useData } from '@/lib/useData';

type Split = 'equal' | 'exact';
type Message = { tone: 'good' | 'critical'; text: string } | null;

export default function SharedGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUser();
  const { colors } = useTheme();
  const { data, setData, error, refreshing, refresh, reload } = useData<{ group: SplitGroup }>(`/shared/groups/${id}`);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paidBy, setPaidBy] = useState<number | null>(null); // null = you
  const [split, setSplit] = useState<Split>('equal');
  const [excluded, setExcluded] = useState<number[]>([]); // left out of an equal split
  const [shares, setShares] = useState<Record<number, string>>({});
  const [person, setPerson] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const fmt = (c: number) => formatMoney(c, user.currency);

  if (error && !data) return <Screen><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!data) return <Loading />;

  const group = data.group;
  const names = Object.fromEntries(group.members.map((m) => [m.id, m.name]));
  const me = group.members.find((m) => m.is_me);
  const payer = paidBy ?? me?.id ?? group.members[0]?.id;
  const between = group.members.filter((m) => !excluded.includes(m.id));
  const net = netLabel(group.my_net_cents, user.currency);

  /** Runs a change on the server and shows the group it sends back. */
  async function run(key: string, action: () => Promise<{ group: SplitGroup }>, success: string) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await action();
      setData(res);
      setMessage({ tone: 'good', text: success });
      return true;
    } catch (err) {
      setMessage({ tone: 'critical', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const path = `/shared/groups/${group.id}`;

  async function addExpense() {
    const body = split === 'equal'
      ? { amount, description, paid_by: payer, split, date: todayISO(), members: between.map((m) => m.id) }
      : { amount, description, paid_by: payer, split, date: todayISO(), shares };
    if (await run('expense', () => api(`${path}/expenses`, { body }), 'Expense added.')) {
      setAmount('');
      setDescription('');
      setShares({});
    }
  }

  function settle(from: number, to: number, cents: number) {
    Alert.alert('Mark as paid?', `${names[from]} paid ${names[to]} ${fmt(cents)}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark paid', onPress: () => run('settle', () => api(`${path}/settlements`, {
        body: { from_member: from, to_member: to, amount: centsToInput(cents), date: todayISO() },
      }), 'Payment recorded.') },
    ]);
  }

  function confirm(title: string, text: string, label: string, action: () => void) {
    Alert.alert(title, text, [{ text: 'Cancel', style: 'cancel' }, { text: label, style: 'destructive', onPress: action }]);
  }

  function deleteGroup() {
    confirm(`Delete “${group.name}”?`, 'Its expenses and payments are deleted too. Your own transactions are not affected.',
      'Delete', async () => {
        try {
          await api(path, { method: 'DELETE' });
          router.back();
        } catch (err) {
          setMessage({ tone: 'critical', text: errorMessage(err) });
        }
      });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: group.name }} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Card>
        <Row>
          <View style={{ flex: 1, gap: 4 }}>
            <Muted>Group spending</Muted>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }} numberOfLines={1} adjustsFontSizeToFit>
              {fmt(group.total_spent_cents)}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Muted>{group.members.length} people</Muted>
            <Text style={{ fontSize: 16, fontWeight: '800',
              color: net.tone === 'good' ? colors.good : net.tone === 'critical' ? colors.danger : colors.ink }}
              numberOfLines={1} adjustsFontSizeToFit>
              {net.text}
            </Text>
          </View>
        </Row>
      </Card>

      {group.suggested.length ? (
        <Card style={{ gap: 0 }}>
          <H2>Settle up</H2>
          <Muted style={{ marginTop: 4, marginBottom: 4 }}>The fewest payments that settle everyone:</Muted>
          {group.suggested.map((p) => (
            <Row key={`${p.from_member}-${p.to_member}`} style={{ paddingVertical: 8 }}>
              <Text style={{ flex: 1, color: colors.ink, fontSize: 15 }} numberOfLines={2}>
                {names[p.from_member]} → {names[p.to_member]}{'  '}
                <Text style={{ fontWeight: '800' }}>{fmt(p.amount_cents)}</Text>
              </Text>
              <Button title="Mark paid" variant="ghost" small loading={busy === 'settle'}
                onPress={() => settle(p.from_member, p.to_member, p.amount_cents)} />
            </Row>
          ))}
        </Card>
      ) : null}

      <Card style={{ gap: 6 }}>
        <H2>Balances</H2>
        {group.members.map((m) => (
          <Row key={m.id} style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: colors.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>{m.name}</Text>
            <Text style={{ fontSize: 14, color: m.net_cents > 0 ? colors.good : m.net_cents < 0 ? colors.danger : colors.muted }}>
              {m.net_cents > 0 ? `${m.is_me ? 'are' : 'is'} owed ${fmt(m.net_cents)}`
                : m.net_cents < 0 ? `${m.is_me ? 'owe' : 'owes'} ${fmt(-m.net_cents)}` : 'settled'}
            </Text>
          </Row>
        ))}
      </Card>

      <Card strong>
        <H2>Add an expense</H2>
        <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />
        <Field label="Description" value={description} onChangeText={setDescription} placeholder="e.g. Dinner" maxLength={200} />
        <Label>Paid by</Label>
        <Row style={{ flexWrap: 'wrap' }}>
          {group.members.map((m) => (
            <Chip key={m.id} label={m.name} active={m.id === payer} onPress={() => setPaidBy(m.id)} />
          ))}
        </Row>
        <Segmented<Split> value={split} onChange={setSplit} options={[
          { value: 'equal', label: 'Split equally' }, { value: 'exact', label: 'Exact amounts' }]} />
        {split === 'equal' ? (
          <View style={{ gap: 8 }}>
            <Label>Between (tap to leave someone out)</Label>
            <Row style={{ flexWrap: 'wrap' }}>
              {group.members.map((m) => {
                const inSplit = !excluded.includes(m.id);
                return (
                  <Chip key={m.id} label={m.name} active={inSplit}
                    onPress={() => setExcluded(inSplit ? [...excluded, m.id] : excluded.filter((x) => x !== m.id))} />
                );
              })}
            </Row>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Muted>Each person’s share. They must add up to the amount.</Muted>
            {group.members.map((m) => (
              <Row key={m.id}>
                <Text style={{ flex: 1, color: colors.ink, fontSize: 15 }} numberOfLines={1}>{m.name}</Text>
                <View style={{ width: 130 }}>
                  <Field value={shares[m.id] ?? ''} onChangeText={(v) => setShares({ ...shares, [m.id]: v })}
                    placeholder="0" keyboardType="decimal-pad" accessibilityLabel={`${m.name}'s share`} />
                </View>
              </Row>
            ))}
          </View>
        )}
        <Button title="Add expense" icon="plus" onPress={addExpense} loading={busy === 'expense'}
          disabled={!amount.trim() || (split === 'equal' && !between.length)} />
      </Card>

      {group.expenses.length ? (
        <Card style={{ gap: 0 }}>
          <H2>Expenses</H2>
          {group.expenses.map((e, i) => (
            <View key={e.id}>
              {i ? <Divider /> : null}
              <Row style={{ paddingVertical: 10 }} gap={10}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
                    {e.description || 'Shared expense'}
                  </Text>
                  <Muted numberOfLines={2}>
                    {names[e.paid_by]} paid · {friendlyDate(e.date)}{me ? ` · your share ${fmt(e.my_share_cents)}` : ''}
                  </Muted>
                </View>
                <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }}>{fmt(e.amount_cents)}</Text>
                <IconButton icon="trash" label="Delete expense" onPress={() => confirm('Delete this expense?',
                  'Balances will be worked out again.', 'Delete',
                  () => run('delete', () => api(`${path}/expenses/${e.id}`, { method: 'DELETE' }), 'Expense deleted.'))} />
              </Row>
            </View>
          ))}
        </Card>
      ) : null}

      {group.settlements.length ? (
        <Card style={{ gap: 0 }}>
          <H2>Payments</H2>
          {group.settlements.map((s, i) => (
            <View key={s.id}>
              {i ? <Divider /> : null}
              <Row style={{ paddingVertical: 8 }} gap={10}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.ink, fontSize: 15 }} numberOfLines={1}>
                    {names[s.from_member]} paid {names[s.to_member]}
                  </Text>
                  <Muted>{friendlyDate(s.date)}</Muted>
                </View>
                <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }}>{fmt(s.amount_cents)}</Text>
                <IconButton icon="trash" label="Delete payment" onPress={() => confirm('Delete this payment?',
                  'Balances will be worked out again.', 'Delete',
                  () => run('delete', () => api(`${path}/settlements/${s.id}`, { method: 'DELETE' }), 'Payment deleted.'))} />
              </Row>
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <H2>People</H2>
        {group.members.map((m) => (
          <Row key={m.id} style={{ justifyContent: 'space-between', minHeight: 32 }}>
            <Text style={{ color: colors.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>{m.name}</Text>
            {m.is_me ? null : (
              <IconButton icon="trash" label={`Remove ${m.name}`} onPress={() => confirm(`Remove ${m.name}?`,
                'Only people with no expenses or payments in this group can be removed.', 'Remove',
                () => run('member', () => api(`${path}/members/${m.id}`, { method: 'DELETE' }), `${m.name} removed.`))} />
            )}
          </Row>
        ))}
        <Row>
          <View style={{ flex: 1 }}>
            <Field value={person} onChangeText={setPerson} placeholder="Add a person" maxLength={40}
              autoCapitalize="words" accessibilityLabel="Name of the person to add" />
          </View>
          <Button title="Add" small loading={busy === 'member'} disabled={!person.trim()}
            onPress={async () => {
              if (await run('member', () => api(`${path}/members`, { body: { name: person } }), `${person.trim()} added.`)) setPerson('');
            }} />
        </Row>
        <Row>
          <View style={{ flex: 1 }}>
            <Field value={rename ?? group.name} onChangeText={setRename} maxLength={40} accessibilityLabel="Group name" />
          </View>
          <Button title="Rename" variant="ghost" small loading={busy === 'rename'}
            disabled={rename === null || !rename.trim() || rename.trim() === group.name}
            onPress={async () => {
              if (await run('rename', () => api(path, { method: 'PATCH', body: { name: rename } }), 'Group renamed.')) setRename(null);
            }} />
        </Row>
        <Divider />
        <Button title="Delete group" icon="trash" variant="ghost" small onPress={deleteGroup}
          style={{ alignSelf: 'flex-start' }} />
      </Card>
    </Screen>
  );
}
