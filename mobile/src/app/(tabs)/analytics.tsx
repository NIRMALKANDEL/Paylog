import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CategoryBars, MonthBars, SimpleBars } from '@/components/Charts';
import { Card, Chips, Divider, Empty, ErrorState, H2, Loading, Muted, Notice, Row, Screen, Stat, TxRow } from '@/components/ui';
import { useUser } from '@/lib/auth';
import { shortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { CategoryTotal, Insight, MonthPoint, Totals, Transaction } from '@/lib/types';
import { useData } from '@/lib/useData';

type Range = '3m' | '6m' | '12m' | 'ytd' | 'all';
type Analytics = {
  range: Range; start: string; end: string; summary: Totals; monthly: MonthPoint[]; categories: CategoryTotal[];
  income_categories: CategoryTotal[]; weekdays: { day: string; total: number; average: number }[];
  top: Transaction[]; insights: Insight[]; avg_month: number;
};

const RANGES: { value: Range; label: string }[] = [
  { value: '3m', label: '3 months' }, { value: '6m', label: '6 months' }, { value: '12m', label: '12 months' },
  { value: 'ytd', label: 'This year' }, { value: 'all', label: 'All time' },
];

export default function AnalyticsScreen() {
  const user = useUser();
  const { colors } = useTheme();
  const [range, setRange] = useState<Range>('6m');
  const { data, error, refreshing, refresh, reload } = useData<Analytics>(`/analytics?range=${range}`);
  const cur = user.currency;
  const fmt = (c: number) => formatMoney(c, cur);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Chips<Range> options={RANGES} value={range} onChange={setRange} />
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {!data && !error ? <Loading /> : null}
      {data && data.range === range ? (
        !data.summary.expense && !data.summary.income ? (
          <Card><Empty icon="chart" title="No transactions in this period" text="Pick a longer range, or add some transactions." /></Card>
        ) : (
          <>
            <Muted>{shortDate(data.start)} – {shortDate(data.end)}</Muted>
            <Card>
              <Row>
                <Stat label="Spent" value={fmt(data.summary.expense)} />
                <Stat label="Earned" value={fmt(data.summary.income)} tone={colors.good} />
              </Row>
              <Row>
                <Stat label="Net" value={fmt(data.summary.net)} tone={data.summary.net < 0 ? colors.danger : colors.ink} />
                <Stat label="Avg / month" value={fmt(Math.round(data.avg_month))} />
              </Row>
            </Card>

            {data.insights.length ? (
              <View style={{ gap: 8 }}>{data.insights.map((i) => <Notice key={i.text} tone={i.tone}>{i.text}</Notice>)}</View>
            ) : null}

            <Card>
              <H2>Month by month</H2>
              <MonthBars months={data.monthly.slice(-12)} currency={cur} />
            </Card>

            {data.categories.length ? (
              <Card>
                <H2>Spending by category</H2>
                <CategoryBars items={data.categories} currency={cur} limit={11} />
              </Card>
            ) : null}

            {data.income_categories.length ? (
              <Card>
                <H2>Income sources</H2>
                <CategoryBars items={data.income_categories} currency={cur} />
              </Card>
            ) : null}

            <Card>
              <H2>Average spend by weekday</H2>
              <SimpleBars labels={data.weekdays.map((d) => d.day)} values={data.weekdays.map((d) => Math.round(d.average))} currency={cur} />
            </Card>

            {data.top.length ? (
              <Card style={{ gap: 0 }}>
                <H2>Biggest expenses</H2>
                {data.top.map((tx, i) => (
                  <View key={tx.id}>
                    {i ? <Divider /> : null}
                    <TxRow tx={tx} currency={cur}
                      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(tx.id) } })} />
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        )
      ) : null}
    </Screen>
  );
}
