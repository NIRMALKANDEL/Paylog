import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryBars, MonthBars, PaceChart } from '@/components/Charts';
import { Icon } from '@/components/Icon';
import { QuickBar } from '@/components/QuickBar';
import {
  Body, Button, Card, Empty, ErrorState, H2, IconButton, Loading, Logo, Muted, Notice, Progress, Row, Screen, TxRow,
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

/** Cards slide in one after another the first time the screen draws. */
function Appear({ index, children }: { index: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <Animated.View entering={reduced ? undefined : FadeInDown.delay(60 * index).duration(380).springify().damping(20)}>
      {children}
    </Animated.View>
  );
}

export default function Home() {
  const user = useUser();
  const { colors } = useTheme();
  const [month, setMonth] = useState<string | null>(null); // null = this month
  const { data, error, refreshing, refresh, reload } = useData<Dashboard>(`/dashboard${month ? `?month=${month}` : ''}`);
  const cur = user.currency;

  useEffect(() => {
    if (data?.is_current) {
      const name = new Date().toLocaleString('en', { month: 'long' });
      updateWidgets({ spent: formatMoney(data.this_month.expense, cur), month: name });
    }
  }, [data, cur]);

  if (!data && !error) return <Loading />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <Screen refreshing={refreshing} onRefresh={refresh} tabBar drift>
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
        {data ? (
          <DashboardBody data={data} currency={cur}
            onMonth={(m) => setMonth(m && data.is_current && m === data.month ? null : m)} />
        ) : null}
      </Screen>
    </SafeAreaView>
  );
}

function MonthSwitcher({ data, onMonth }: { data: Dashboard; onMonth: (month: string | null) => void }) {
  const { colors } = useTheme();
  const arrow = (icon: 'chevron-left' | 'chevron-right', label: string, target: string | null, enabled: boolean) => (
    <Pressable onPress={enabled ? () => onMonth(target) : undefined} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }} hitSlop={10}
      style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: enabled ? colors.glassStrong : 'transparent', opacity: enabled ? 1 : 0.3 }}>
      <Icon name={icon} size={18} color={colors.ink} />
    </Pressable>
  );
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      {arrow('chevron-left', 'Previous month', data.prev_month, true)}
      <Pressable onPress={data.is_current ? undefined : () => onMonth(null)} accessibilityRole="button"
        accessibilityLabel={data.is_current ? data.month_name : `${data.month_name}. Tap to go back to this month.`}>
        <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>{data.month_name}</Text>
        {!data.is_current ? <Text style={{ color: colors.accentText, fontSize: 12, textAlign: 'center' }}>Back to this month</Text> : null}
      </Pressable>
      {arrow('chevron-right', 'Next month', data.next_month, !!data.next_month)}
    </Row>
  );
}

function Total({ sign, label, cents, currency, color, tint }: {
  sign: string; label: string; cents: number; currency: string; color: string; tint: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, gap: 6, padding: 14, borderRadius: 16, backgroundColor: tint, borderWidth: 1,
      borderColor: colors.glassBorder }}>
      <Row gap={6}>
        <View style={{ width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center',
          backgroundColor: color }}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14, lineHeight: 16 }}>{sign}</Text>
        </View>
        <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13 }}>{label}</Text>
      </Row>
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}
        numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={`${label} ${formatMoney(cents, currency)}`}>
        {formatMoney(cents, currency)}
      </Text>
    </View>
  );
}

function DashboardBody({ data, currency, onMonth }: { data: Dashboard; currency: string; onMonth: (m: string | null) => void }) {
  const { colors } = useTheme();
  const m = data.this_month;
  const fmt = (c: number) => formatMoney(c, currency);
  const overall = data.budget.overall;

  if (!data.has_any) {
    return (
      <Card>
        <Empty icon="note" title="Add your first transaction"
          text="Type something like “250 lunch” in the box above, scan a payment screenshot, or add a home-screen widget to jot payments without opening the app."
          action={<Button title="Add a transaction" icon="plus" onPress={() => router.push('/transaction/new')} />} />
      </Card>
    );
  }

  const net = m.income - m.expense;
  let i = 0;
  return (
    <>
      <Appear index={i++}>
        <Card strong style={{ gap: 14 }}>
          <MonthSwitcher data={data} onMonth={onMonth} />
          <Row gap={10}>
            <Total sign="+" label="Credit" cents={m.income} currency={currency} color={colors.credit} tint={colors.goodBg} />
            <Total sign="−" label="Debit" cents={m.expense} currency={currency} color={colors.debit} tint={colors.dangerBg} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Muted>Net (credit − debit)</Muted>
            <Text style={{ fontWeight: '800', fontSize: 16, color: net < 0 ? colors.debit : colors.credit,
              fontVariant: ['tabular-nums'] }}>
              {net < 0 ? '−' : '+'}{fmt(Math.abs(net))}
            </Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Muted>Debit last month</Muted>
            <Muted>{fmt(data.last_month.expense)}</Muted>
          </Row>
        </Card>
      </Appear>

      {data.is_current ? (
        <Appear index={i++}>
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
              <Notice tone="info">Optional: set a monthly spending limit to see how you’re pacing. Tap to set one.</Notice>
            </Pressable>
          )}
        </Appear>
      ) : null}

      <Appear index={i++}>
        <Card style={{ gap: 0 }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <H2>{data.is_current ? 'Recent' : `In ${data.month_name}`}</H2>
            <Pressable onPress={() => router.push('/transactions')} hitSlop={8} accessibilityRole="link">
              <Text style={{ color: colors.accentText, fontWeight: '600' }}>See all</Text>
            </Pressable>
          </Row>
          {data.recent.length ? data.recent.map((tx) => (
            <TxRow key={tx.id} tx={tx} currency={currency}
              onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(tx.id) } })} />
          )) : <Muted>No transactions this month.</Muted>}
        </Card>
      </Appear>

      {data.categories.length ? (
        <Appear index={i++}>
          <Card>
            <H2>Where the debits went</H2>
            <CategoryBars items={data.categories} currency={currency} limit={5} />
          </Card>
        </Appear>
      ) : null}

      <Appear index={i++}>
        <Card>
          <H2>Spending pace</H2>
          <PaceChart thisMonth={data.pace.this_month} lastMonth={data.pace.last_month} days={data.pace.days_in_month}
            budget={data.pace.budget} currency={currency} />
        </Card>
      </Appear>

      {data.insights.length ? (
        <View style={{ gap: 8 }}>
          {data.insights.map((n) => <Notice key={n.text} tone={n.tone}>{n.text}</Notice>)}
        </View>
      ) : null}

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
