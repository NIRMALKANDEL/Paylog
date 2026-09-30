import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import {
  Body, Button, Card, Divider, ErrorState, H2, IconButton, Loading, Muted, Notice, Progress, Row, Screen,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { centsToInput, formatMoney, symbolFor } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { BudgetStatus } from '@/lib/types';
import { useData } from '@/lib/useData';

type Budgets = {
  month: string; month_label: string; is_current: boolean; prev_month: string; next_month: string | null;
  overall_cents: number; limits: Record<string, number>; spent: Record<string, number>; categories: string[];
  status: BudgetStatus;
};

export default function BudgetsScreen() {
  const user = useUser();
  const { refreshUser } = useAuth();
  const { colors } = useTheme();
  const [month, setMonth] = useState<string | null>(null);
  const { data, setData, error, refreshing, refresh, reload } = useData<Budgets>(`/budgets${month ? `?month=${month}` : ''}`);
  const [editing, setEditing] = useState(false);
  const [overall, setOverall] = useState('');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cur = user.currency;
  const fmt = (c: number) => formatMoney(c, cur);

  if (error && !data) return <Screen><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!data) return <Loading />;

  function startEditing() {
    if (!data) return;
    setOverall(data.overall_cents ? centsToInput(data.overall_cents) : '');
    setLimits(Object.fromEntries(data.categories.map((c) => [c, data.limits[c] ? centsToInput(data.limits[c]) : ''])));
    setSaveError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api<Budgets>('/budgets', { method: 'PUT', body: { overall, limits } });
      setData(result);
      setMonth(result.month);
      setEditing(false);
      refreshUser().catch(() => {});
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const input = (value: string, onChange: (v: string) => void, label: string) => (
    <Row gap={4} style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
      paddingHorizontal: 10, width: 130 }}>
      <Text style={{ color: colors.muted }}>{symbolFor(cur)}</Text>
      <TextInput value={value} onChangeText={(v) => onChange(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad"
        placeholder="No limit" placeholderTextColor={colors.faint} accessibilityLabel={`${label} budget`}
        style={{ flex: 1, color: colors.ink, paddingVertical: 8, fontSize: 15 }} />
    </Row>
  );

  if (editing) {
    return (
      <Screen>
        <Body>Leave a box empty for no limit. Limits apply to every month.</Body>
        {saveError ? <Notice tone="critical">{saveError}</Notice> : null}
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>Overall monthly</H2>
            {input(overall, setOverall, 'Overall')}
          </Row>
        </Card>
        <Card style={{ gap: 0 }}>
          {data.categories.map((c, i) => (
            <View key={c}>
              {i ? <Divider /> : null}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 15 }}>{c}</Text>
                  <Muted>{fmt(data.spent[c] || 0)} spent in {data.month_label}</Muted>
                </View>
                {input(limits[c] ?? '', (v) => setLimits((l) => ({ ...l, [c]: v })), c)}
              </Row>
            </View>
          ))}
        </Card>
        <Row>
          <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={{ flex: 1 }} />
          <Button title="Save budgets" onPress={save} loading={saving} style={{ flex: 2 }} />
        </Row>
      </Screen>
    );
  }

  const status = data.status;
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-left" label="Previous month" onPress={() => setMonth(data.prev_month)} />
        <H2>{data.month_label}</H2>
        {data.next_month ? <IconButton icon="chevron-right" label="Next month" onPress={() => setMonth(data.next_month)} />
          : <View style={{ width: 36 }} />}
      </Row>

      <Card>
        <H2>Overall</H2>
        {status.overall ? (
          <>
            <Progress percent={status.overall.percent} status={status.overall.status} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Muted>{fmt(status.overall.spent)} of {fmt(status.overall.budget)}</Muted>
              <Text style={{ fontWeight: '700', color: status.overall.remaining < 0 ? colors.danger : colors.good }}>
                {status.overall.remaining < 0 ? `${fmt(-status.overall.remaining)} over` : `${fmt(status.overall.remaining)} left`}
              </Text>
            </Row>
          </>
        ) : <Muted>No overall budget yet. Spent {fmt(status.total_spent)} in {data.month_label}.</Muted>}
      </Card>

      {status.categories.length ? (
        <Card>
          <H2>By category</H2>
          {status.categories.map((b) => (
            <View key={b.category} style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: colors.ink, fontWeight: '600' }}>{b.category}</Text>
                <Muted>{fmt(b.spent)} / {fmt(b.budget)}</Muted>
              </Row>
              <Progress percent={b.percent} status={b.status} />
            </View>
          ))}
        </Card>
      ) : null}

      {data.is_current ? <Button title="Edit budgets" icon="edit" onPress={startEditing} /> : (
        <Muted style={{ textAlign: 'center' }}>Budgets are edited from the current month.</Muted>
      )}
    </Screen>
  );
}
