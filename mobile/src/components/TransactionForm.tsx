import DateTimePicker from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import { Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { addDays, friendlyDate, fromISO, toISO, todayISO } from '@/lib/dates';
import { CATEGORIES, formatMoney, symbolFor } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Kind } from '@/lib/types';
import { Icon } from './Icon';
import { Button, Card, Chip, DirectionSwitch, Field, Label, Muted, Notice, Row } from './ui';

export type TxDraft = {
  kind: Kind;
  amount: string;
  category: string;
  date: string;
  description: string;
  reference?: string;
  time?: string;
  method?: string;
};

export type Duplicate = { date: string; amount_cents: number; description: string; category: string };

/** Fields a receipt scan wasn't sure about; they're highlighted until the user touches them. */
export type Unsure = { amount?: boolean; direction?: boolean };

const METHODS = ['Google Pay', 'PhonePe', 'Paytm', 'Cash', 'Card', 'Bank transfer'];

export function TransactionForm({ initial, currency, submitLabel, onSubmit, onDelete, busy, error, duplicate,
  onConfirmDuplicate, unsure }: {
  initial: TxDraft;
  currency: string;
  submitLabel: string;
  onSubmit: (draft: TxDraft) => void;
  onDelete?: () => void;
  busy?: boolean;
  error?: string | null;
  duplicate?: Duplicate | null;
  onConfirmDuplicate?: (draft: TxDraft) => void;
  unsure?: Unsure;
}) {
  const { colors, dark } = useTheme();
  const [draft, setDraft] = useState<TxDraft>(initial);
  const [pickDate, setPickDate] = useState(false);
  const [more, setMore] = useState(!!(initial.time || initial.method || initial.reference));
  const [checked, setChecked] = useState<Unsure>({});
  const submitted = useRef(0);
  const set = (patch: Partial<TxDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const categories = CATEGORIES[draft.kind];
  const today = todayISO();
  const income = draft.kind === 'income';
  const flagAmount = unsure?.amount && !checked.amount;
  const flagDirection = unsure?.direction && !checked.direction;

  function changeKind(kind: Kind) {
    setChecked((c) => ({ ...c, direction: true }));
    set({ kind, category: CATEGORIES[kind].includes(draft.category) ? draft.category : CATEGORIES[kind][0] });
  }

  // Taps that land while a save is already on its way are ignored (no double entries).
  function submit(handler: (d: TxDraft) => void) {
    const now = Date.now();
    if (busy || now - submitted.current < 1500) return;
    submitted.current = now;
    handler({ ...draft, time: draft.time?.trim() || '', method: draft.method?.trim() || '' });
  }

  function confirmDelete() {
    Alert.alert('Delete this transaction?', 'You can undo this for a few seconds afterwards.', [
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
          <Button title="Save it again anyway" variant="ghost" small onPress={() => submit((d) => onConfirmDuplicate?.(d))} />
        </Card>
      ) : null}

      <View style={{ gap: 6 }}>
        <DirectionSwitch value={draft.kind} onChange={changeKind} />
        {flagDirection ? <Muted style={{ color: colors.warning }}>Check this: money paid (−) or received (+)?</Muted> : null}
      </View>

      <Card strong style={flagAmount ? { borderColor: colors.warning, borderWidth: 2 } : undefined}>
        <Label>{income ? 'Amount received' : 'Amount paid'}</Label>
        <Row gap={6}>
          <Text style={{ fontSize: 30, fontWeight: '800', color: income ? colors.credit : colors.debit }}>
            {income ? '+' : '−'}{symbolFor(currency)}
          </Text>
          <TextInput
            value={draft.amount}
            onChangeText={(amount) => {
              setChecked((c) => ({ ...c, amount: true }));
              set({ amount: amount.replace(/[^\d.,]/g, '') });
            }}
            placeholder="0"
            placeholderTextColor={colors.faint}
            keyboardType="decimal-pad"
            inputMode="decimal"
            autoFocus={!initial.amount}
            accessibilityLabel="Amount"
            style={{ flex: 1, fontSize: 38, fontWeight: '800', color: colors.ink, paddingVertical: 4,
              fontVariant: ['tabular-nums'] }}
          />
        </Row>
        {flagAmount ? <Muted style={{ color: colors.warning }}>Check this amount against the screenshot.</Muted> : null}
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
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: 999, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glass }}>
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

      <Field label={income ? 'Received from / note' : 'Paid to / note'} value={draft.description}
        onChangeText={(description) => set({ description })}
        placeholder={income ? 'e.g. Rahul, September salary' : 'e.g. Swiggy, lunch with team'} maxLength={200} />

      {more ? (
        <Card style={{ gap: 12 }}>
          <View style={{ gap: 8 }}>
            <Label>Paid with (optional)</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {METHODS.map((m) => (
                <Chip key={m} label={m} active={draft.method === m} onPress={() => set({ method: draft.method === m ? '' : m })} />
              ))}
            </View>
          </View>
          <Field label="Time (optional)" value={draft.time || ''} placeholder="14:30" keyboardType="numbers-and-punctuation"
            maxLength={5} onChangeText={(time) => set({ time: time.replace(/[^\d:]/g, '') })} />
          {draft.reference ? <Muted selectable>UPI reference {draft.reference}</Muted> : null}
        </Card>
      ) : (
        <Pressable onPress={() => setMore(true)} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: colors.accentText, fontWeight: '700' }}>+ More details (time, paid with)</Text>
        </Pressable>
      )}

      <Button title={submitLabel} icon="check" onPress={() => submit(onSubmit)} loading={busy} disabled={!draft.amount} />
      {onDelete ? <Button title="Delete" icon="trash" variant="ghost" onPress={confirmDelete} /> : null}
    </View>
  );
}
