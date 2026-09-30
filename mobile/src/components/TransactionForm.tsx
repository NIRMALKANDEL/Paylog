import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { addDays, friendlyDate, fromISO, toISO, todayISO } from '@/lib/dates';
import { CATEGORIES, formatMoney, symbolFor } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Kind } from '@/lib/types';
import { Icon } from './Icon';
import { Button, Card, Chip, Field, Label, Muted, Notice, Row, Segmented } from './ui';

export type TxDraft = {
  kind: Kind;
  amount: string;
  category: string;
  date: string;
  description: string;
  reference?: string;
};

export type Duplicate = { date: string; amount_cents: number; description: string; category: string };

export function TransactionForm({ initial, currency, submitLabel, onSubmit, onDelete, busy, error, duplicate, onConfirmDuplicate }: {
  initial: TxDraft;
  currency: string;
  submitLabel: string;
  onSubmit: (draft: TxDraft) => void;
  onDelete?: () => void;
  busy?: boolean;
  error?: string | null;
  duplicate?: Duplicate | null;
  onConfirmDuplicate?: (draft: TxDraft) => void;
}) {
  const { colors, dark } = useTheme();
  const [draft, setDraft] = useState<TxDraft>(initial);
  const [pickDate, setPickDate] = useState(false);
  const set = (patch: Partial<TxDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const categories = CATEGORIES[draft.kind];
  const today = todayISO();

  function changeKind(kind: Kind) {
    set({ kind, category: CATEGORIES[kind].includes(draft.category) ? draft.category : CATEGORIES[kind][0] });
  }

  function confirmDelete() {
    Alert.alert('Delete this transaction?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  return (
    <View style={{ gap: 14 }}>
      {error ? <Notice tone="critical">{error}</Notice> : null}
      {duplicate ? (
        <Card style={{ borderColor: colors.warning }}>
          <Notice tone="warning">
            {`Already saved on ${friendlyDate(duplicate.date)}: ${formatMoney(duplicate.amount_cents, currency)} · ${duplicate.description || duplicate.category}.`}
          </Notice>
          <Button title="Save it again anyway" variant="ghost" small onPress={() => onConfirmDuplicate?.(draft)} />
        </Card>
      ) : null}

      <Segmented<Kind> value={draft.kind} onChange={changeKind}
        options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />

      <Card>
        <Label>Amount</Label>
        <Row gap={6}>
          <Text style={{ fontSize: 30, fontWeight: '700', color: colors.muted }}>{symbolFor(currency)}</Text>
          <TextInput
            value={draft.amount}
            onChangeText={(amount) => set({ amount: amount.replace(/[^\d.,]/g, '') })}
            placeholder="0"
            placeholderTextColor={colors.faint}
            keyboardType="decimal-pad"
            autoFocus={!initial.amount}
            accessibilityLabel="Amount"
            style={{ flex: 1, fontSize: 34, fontWeight: '800', color: colors.ink, paddingVertical: 4 }}
          />
        </Row>
      </Card>

      <View style={{ gap: 8 }}>
        <Label>Category</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {categories.map((c) => <Chip key={c} label={c} active={draft.category === c} onPress={() => set({ category: c })} />)}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Label>Date</Label>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="Today" active={draft.date === today} onPress={() => set({ date: today })} />
          <Chip label="Yesterday" active={draft.date === addDays(today, -1)} onPress={() => set({ date: addDays(today, -1) })} />
          <Pressable onPress={() => setPickDate(true)} accessibilityRole="button" accessibilityLabel="Choose a date"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7,
              borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
            <Icon name="edit" size={14} color={colors.muted} />
            <Text style={{ color: colors.inkSoft, fontWeight: '600' }}>{friendlyDate(draft.date)}</Text>
          </Pressable>
        </Row>
        {pickDate ? (
          <DateTimePicker
            value={fromISO(draft.date)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            themeVariant={dark ? 'dark' : 'light'}
            maximumDate={new Date(new Date().getFullYear() + 1, 11, 31)}
            minimumDate={new Date(2000, 0, 1)}
            onChange={(event, value) => {
              if (Platform.OS !== 'ios') setPickDate(false);
              if (event.type === 'set' && value) set({ date: toISO(value) });
            }}
          />
        ) : null}
        {pickDate && Platform.OS === 'ios' ? <Button title="Done" variant="ghost" small onPress={() => setPickDate(false)} /> : null}
      </View>

      <Field label="Note (optional)" value={draft.description} onChangeText={(description) => set({ description })}
        placeholder={draft.kind === 'income' ? 'e.g. September salary' : 'e.g. Lunch with team'} maxLength={200} />
      {draft.reference ? <Muted>UPI reference {draft.reference}</Muted> : null}

      <Button title={submitLabel} icon="check" onPress={() => onSubmit(draft)} loading={busy} disabled={!draft.amount} />
      {onDelete ? <Button title="Delete" icon="trash" variant="ghost" onPress={confirmDelete} /> : null}
    </View>
  );
}
