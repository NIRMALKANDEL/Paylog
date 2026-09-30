import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryBars, MonthBars, PaceChart } from '@/components/Charts';
import { QuickBar } from '@/components/QuickBar';
import {
  Body, Button, Card, Empty, ErrorState, H2, IconButton, Loading, Logo, Muted, Notice, Progress, Row, Screen, Stat,
  TxRow,
} from '@/components/ui';
import { useUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Dashboard } from '@/lib/types';
import { useData } from '@/lib/useData';
import { updateWidgets } from '@/lib/widget';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const user = useUser();
  const { colors } = useTheme();
  const { data, error, refreshing, refresh, reload } = useData<Dashboard>('/dashboard');
  const cur = user.currency;

  useEffect(() => {
    if (data) {
      const month = new Date().toLocaleString('en', { month: 'long' });
      updateWidgets({ spent: formatMoney(data.this_month.expense, cur), month });
    }
  }, [data, cur]);

  if (!data && !error) return <Loading />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <Screen refreshing={refreshing} onRefresh={refresh} bottomInset={false}>
        <Row>
          <Logo size={34} />
          <View style={{ flex: 1 }}>
            <Muted>{greeting()},</Muted>
            <H2>{user.first_name}</H2>
          </View>
          <IconButton icon="settings" label="Settings" onPress={() => router.push('/settings')} />
        </Row>

        <QuickBar />
        {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
        {data ? <DashboardBody data={data} currency={cur} /> : null}
      </Screen>
    </SafeAreaView>
  );
}

function DashboardBody({ data, currency }: { data: Dashboard; currency: string }) {
  const { colors } = useTheme();
  const m = data.this_month;
  const fmt = (c: number) => formatMoney(c, currency);
  const overall = data.budget.overall;

  if (!data.has_any) {
    return (
      <Card>
        <Empty icon="note" title="Add your first transaction"
          text="Type something like “250 lunch” in the box above, scan a payment screenshot, or add a home-screen widget to jot expenses without opening the app."
          action={<Button title="Add a transaction" icon="plus" onPress={() => router.push('/transaction/new')} />} />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>{data.month_name}</Muted>
          {m.savings_rate !== null ? <Muted>Saved {Math.round(m.savings_rate)}%</Muted> : null}
        </Row>
        <Text style={{ fontSize: 34, fontWeight: '800', color: colors.ink, letterSpacing: -0.8, fontVariant: ['tabular-nums'] }}
          accessibilityLabel={`Spent ${fmt(m.expense)} this month`}>{fmt(m.expense)}</Text>
        <Muted>spent this month</Muted>
        <Row style={{ marginTop: 6 }}>
          <Stat label="Income" value={fmt(m.income)} tone={colors.good} />
          <Stat label="Net" value={fmt(m.net)} tone={m.net < 0 ? colors.danger : colors.ink} />
          <Stat label="Last month" value={fmt(data.last_month.expense)} />
        </Row>
      </Card>

      {overall ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>Monthly budget</H2>
            <Muted>{Math.round(overall.percent)}%</Muted>
          </Row>
          <Progress percent={overall.percent} status={overall.status} />
          <Muted>
            {overall.remaining >= 0 ? `${fmt(overall.remaining)} left of ${fmt(overall.budget)}` : `${fmt(-overall.remaining)} over your ${fmt(overall.budget)} budget`}
          </Muted>
        </Card>
      ) : (
        <Pressable onPress={() => router.push('/budgets')} accessibilityRole="button">
          <Notice tone="info">Set a monthly budget to see how you’re pacing. Tap to set one.</Notice>
        </Pressable>
      )}

      <Card>
        <H2>Spending pace</H2>
        <PaceChart thisMonth={data.pace.this_month} lastMonth={data.pace.last_month} days={data.pace.days_in_month}
          budget={data.pace.budget} currency={currency} />
      </Card>

      {data.insights.length ? (
        <View style={{ gap: 8 }}>
          {data.insights.map((i) => <Notice key={i.text} tone={i.tone}>{i.text}</Notice>)}
        </View>
      ) : null}

      {data.categories.length ? (
        <Card>
          <H2>Where it went</H2>
          <CategoryBars items={data.categories} currency={currency} limit={5} />
        </Card>
      ) : null}

      <Card style={{ gap: 0 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <H2>Recent</H2>
          <Pressable onPress={() => router.push('/transactions')} hitSlop={8} accessibilityRole="link">
            <Text style={{ color: colors.accentText, fontWeight: '600' }}>See all</Text>
          </Pressable>
        </Row>
        {data.recent.map((tx) => (
          <TxRow key={tx.id} tx={tx} currency={currency}
            onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(tx.id) } })} />
        ))}
      </Card>

      {data.goals.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>Goals</H2>
            <Pressable onPress={() => router.push('/goals')} hitSlop={8} accessibilityRole="link">
              <Text style={{ color: colors.accentText, fontWeight: '600' }}>Manage</Text>
            </Pressable>
          </Row>
          {data.goals.map((g) => (
            <View key={g.id} style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Body style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>{g.name}</Body>
                <Muted>{fmt(g.saved_cents)} / {fmt(g.target_cents)}</Muted>
              </Row>
              <Progress percent={g.percent} status="good" />
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <H2>Last 6 months</H2>
        <MonthBars months={data.trend} currency={currency} />
      </Card>
    </>
  );
}
