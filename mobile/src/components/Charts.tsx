import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { formatMoney } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { CategoryTotal, MonthPoint } from '@/lib/types';
import { Muted, Row } from './ui';

function useWidth() {
  const [width, setWidth] = useState(0);
  return { width, onLayout: (e: { nativeEvent: { layout: { width: number } } }) => setWidth(e.nativeEvent.layout.width) };
}

function compact(cents: number, currency: string) {
  const units = cents / 100;
  const symbol = formatMoney(0, currency).replace(/[\d.,]/g, '');
  if (units >= 1e7 && currency === 'INR') return `${symbol}${(units / 1e7).toFixed(1)}Cr`;
  if (units >= 1e5 && currency === 'INR') return `${symbol}${(units / 1e5).toFixed(1)}L`;
  if (units >= 1e6) return `${symbol}${(units / 1e6).toFixed(1)}M`;
  if (units >= 1e3) return `${symbol}${(units / 1e3).toFixed(units >= 1e4 ? 0 : 1)}k`;
  return `${symbol}${Math.round(units)}`;
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <Row gap={14}>
      {items.map((i) => (
        <Row key={i.label} gap={6}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: i.color }} />
          <Muted>{i.label}</Muted>
        </Row>
      ))}
    </Row>
  );
}

/** Credit vs debit per month, as paired bars. */
export function MonthBars({ months, currency, height = 170 }: { months: MonthPoint[]; currency: string; height?: number }) {
  const { colors } = useTheme();
  const { width, onLayout } = useWidth();
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const top = 14, bottom = 22;
  const plot = height - top - bottom;
  const slot = months.length ? width / months.length : 0;
  const bar = Math.min(14, slot / 3.2);
  const summary = months.map((m) => `${m.label}: spent ${formatMoney(m.expense, currency)}, earned ${formatMoney(m.income, currency)}`).join('. ');
  return (
    <View style={{ gap: 8 }}>
      <View onLayout={onLayout} accessible accessibilityLabel={summary}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Line x1={0} x2={width} y1={top + plot} y2={top + plot} stroke={colors.border} />
            <SvgText x={0} y={10} fontSize={10} fill={colors.faint}>{compact(max, currency)}</SvgText>
            {months.map((m, i) => {
              const x = slot * i + slot / 2;
              const hi = (m.income / max) * plot;
              const he = (m.expense / max) * plot;
              return (
                <G key={m.key}>
                  <Rect x={x - bar - 1} y={top + plot - hi} width={bar} height={Math.max(hi, m.income ? 2 : 0)} rx={3} fill={colors.income} />
                  <Rect x={x + 1} y={top + plot - he} width={bar} height={Math.max(he, m.expense ? 2 : 0)} rx={3} fill={colors.expense} />
                  <SvgText x={x} y={height - 6} fontSize={10.5} fill={colors.muted} textAnchor="middle">{m.label.split(' ')[0]}</SvgText>
                </G>
              );
            })}
          </Svg>
        ) : <View style={{ height }} />}
      </View>
      <Legend items={[{ color: colors.income, label: 'Credit' }, { color: colors.expense, label: 'Debit' }]} />
    </View>
  );
}

/** Cumulative spending this month vs last month, with the budget as a dashed line. */
export function PaceChart({ thisMonth, lastMonth, days, budget, currency, height = 150 }: {
  thisMonth: number[]; lastMonth: number[]; days: number; budget: number; currency: string; height?: number;
}) {
  const { colors } = useTheme();
  const { width, onLayout } = useWidth();
  const max = Math.max(1, budget, ...thisMonth, ...lastMonth);
  const top = 10, bottom = 18;
  const plot = height - top - bottom;
  const x = (day: number) => (days > 1 ? (day / (days - 1)) * (width - 4) + 2 : 0);
  const y = (v: number) => top + plot - (v / max) * plot;
  const pts = (series: number[]) => series.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const spent = thisMonth[thisMonth.length - 1] || 0;
  return (
    <View style={{ gap: 8 }}>
      <View onLayout={onLayout} accessible
        accessibilityLabel={`Spent ${formatMoney(spent, currency)} so far this month${budget ? ` of a ${formatMoney(budget, currency)} budget` : ''}.`}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Line x1={0} x2={width} y1={top + plot} y2={top + plot} stroke={colors.border} />
            {budget ? <Line x1={0} x2={width} y1={y(budget)} y2={y(budget)} stroke={colors.warning} strokeDasharray="5 4" /> : null}
            {lastMonth.length > 1 ? <Polyline points={pts(lastMonth)} fill="none" stroke={colors.faint} strokeWidth={2} /> : null}
            {thisMonth.length > 1 ? <Polyline points={pts(thisMonth)} fill="none" stroke={colors.accent} strokeWidth={3} strokeLinejoin="round" /> : null}
            <SvgText x={0} y={height - 4} fontSize={10} fill={colors.faint}>1</SvgText>
            <SvgText x={width} y={height - 4} fontSize={10} fill={colors.faint} textAnchor="end">{days}</SvgText>
          </Svg>
        ) : <View style={{ height }} />}
      </View>
      <Legend items={[
        { color: colors.accent, label: 'This month' },
        { color: colors.faint, label: 'Last month' },
        ...(budget ? [{ color: colors.warning, label: 'Budget' }] : []),
      ]} />
    </View>
  );
}

/** Horizontal bars for category totals. */
export function CategoryBars({ items, currency, limit = 8 }: { items: CategoryTotal[]; currency: string; limit?: number }) {
  const { colors } = useTheme();
  const top = items.slice(0, limit);
  const max = Math.max(1, ...top.map((c) => c.total));
  return (
    <View style={{ gap: 12 }}>
      {top.map((c) => (
        <View key={c.category} style={{ gap: 5 }} accessible
          accessibilityLabel={`${c.category}: ${formatMoney(c.total, currency)}, ${Math.round(c.share)} percent`}>
          <Row>
            <Text style={{ flex: 1, color: colors.ink, fontWeight: '600' }}>{c.category}</Text>
            <Muted>{Math.round(c.share)}%</Muted>
            <Text style={{ color: colors.ink, fontWeight: '700', minWidth: 80, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {formatMoney(c.total, currency)}
            </Text>
          </Row>
          <View style={{ height: 7, borderRadius: 4, backgroundColor: colors.cardAlt }}>
            <View style={{ width: `${(c.total / max) * 100}%`, height: 7, borderRadius: 4, backgroundColor: colors.accent }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Small vertical bars, e.g. average spend per weekday. */
export function SimpleBars({ labels, values, currency, height = 120 }: {
  labels: string[]; values: number[]; currency: string; height?: number;
}) {
  const { colors } = useTheme();
  const { width, onLayout } = useWidth();
  const max = Math.max(1, ...values);
  const slot = labels.length ? width / labels.length : 0;
  const plot = height - 20;
  return (
    <View onLayout={onLayout} accessible
      accessibilityLabel={labels.map((l, i) => `${l}: ${formatMoney(values[i], currency)}`).join(', ')}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {values.map((v, i) => {
            const h = (v / max) * (plot - 4);
            return (
              <G key={labels[i]}>
                <Rect x={slot * i + slot * 0.2} y={plot - h} width={slot * 0.6} height={Math.max(h, v ? 2 : 0)} rx={4}
                  fill={v === max ? colors.expense : colors.accent} />
                <SvgText x={slot * i + slot / 2} y={height - 4} fontSize={11} fill={colors.muted} textAnchor="middle">{labels[i]}</SvgText>
              </G>
            );
          })}
        </Svg>
      ) : <View style={{ height }} />}
    </View>
  );
}
