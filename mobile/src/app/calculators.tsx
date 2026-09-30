import { useState } from 'react';
import { Text, View } from 'react-native';

import { Card, Chips, Field, H2, Muted, Row, Screen } from '@/components/ui';
import { useUser } from '@/lib/auth';
import { duration, emi, futureValue, monthsToGoal, requiredMonthly } from '@/lib/finance';
import { formatUnits } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useData } from '@/lib/useData';

type Calc = 'savings' | 'goal' | 'time' | 'emergency' | 'loan';

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function Result({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Muted>{label}</Muted>
      <Text style={{ fontSize: big ? 28 : 18, fontWeight: '800', color: big ? colors.accentText : colors.ink }}>{value}</Text>
    </View>
  );
}

function Input({ label, value, onChange, suffix }: { label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Field label={suffix ? `${label} (${suffix})` : label} value={value} keyboardType="decimal-pad"
        onChangeText={(v) => onChange(v.replace(/[^\d.]/g, ''))} />
    </View>
  );
}

export default function Calculators() {
  const user = useUser();
  const { data } = useData<{ avg_monthly_expense: number | null }>('/calculators');
  const [calc, setCalc] = useState<Calc>('savings');
  const cur = user.currency;
  const money = (v: number) => formatUnits(v, cur);

  // Every calculator keeps its own inputs while you switch between them.
  const [s, setS] = useState({ principal: '10000', monthly: '5000', rate: '7', years: '10' });
  const [g, setG] = useState({ target: '100000', current: '10000', rate: '6', months: '12' });
  const [t, setT] = useState({ target: '100000', current: '10000', monthly: '5000', rate: '6' });
  const [e, setE] = useState({ expenses: '', months: '6', current: '0' });
  const [l, setL] = useState({ principal: '500000', rate: '9', months: '60' });
  const avg = data?.avg_monthly_expense;
  const expenses = e.expenses || (avg ? String(avg) : '30000');

  let body: React.ReactNode = null;
  if (calc === 'savings') {
    const years = Math.min(Math.max(Math.round(num(s.years)), 1), 60);
    const fv = futureValue(num(s.principal), num(s.monthly), num(s.rate), years * 12);
    const contributed = num(s.principal) + num(s.monthly) * years * 12;
    body = (
      <>
        <Row><Input label="Start with" value={s.principal} onChange={(v) => setS({ ...s, principal: v })} />
          <Input label="Add monthly" value={s.monthly} onChange={(v) => setS({ ...s, monthly: v })} /></Row>
        <Row><Input label="Return" suffix="% a year" value={s.rate} onChange={(v) => setS({ ...s, rate: v })} />
          <Input label="Years" value={s.years} onChange={(v) => setS({ ...s, years: v })} /></Row>
        <Result big label={`In ${years} years you'd have`} value={money(fv)} />
        <Row><Result label="You put in" value={money(contributed)} /><View style={{ width: 24 }} /><Result label="Growth" value={money(fv - contributed)} /></Row>
      </>
    );
  } else if (calc === 'goal') {
    const months = Math.max(Math.round(num(g.months)), 1);
    const monthly = requiredMonthly(num(g.target), num(g.current), num(g.rate), months);
    body = (
      <>
        <Row><Input label="Goal amount" value={g.target} onChange={(v) => setG({ ...g, target: v })} />
          <Input label="Saved so far" value={g.current} onChange={(v) => setG({ ...g, current: v })} /></Row>
        <Row><Input label="Months" value={g.months} onChange={(v) => setG({ ...g, months: v })} />
          <Input label="Return" suffix="% a year" value={g.rate} onChange={(v) => setG({ ...g, rate: v })} /></Row>
        <Result big label="Save each month" value={num(g.current) >= num(g.target) ? 'Already there 🎉' : money(monthly)} />
        <Result label="Total you'll put in" value={money(monthly * months)} />
      </>
    );
  } else if (calc === 'time') {
    const n = monthsToGoal(num(t.target), num(t.current), num(t.monthly), num(t.rate));
    const when = new Date();
    if (n !== null) when.setMonth(when.getMonth() + n);
    body = (
      <>
        <Row><Input label="Goal amount" value={t.target} onChange={(v) => setT({ ...t, target: v })} />
          <Input label="Saved so far" value={t.current} onChange={(v) => setT({ ...t, current: v })} /></Row>
        <Row><Input label="Save monthly" value={t.monthly} onChange={(v) => setT({ ...t, monthly: v })} />
          <Input label="Return" suffix="% a year" value={t.rate} onChange={(v) => setT({ ...t, rate: v })} /></Row>
        <Result big label="Time to reach it" value={n === null ? 'Never at this rate' : n === 0 ? 'Already there 🎉' : duration(n)} />
        <Result label="Around" value={n === null ? 'Increase your monthly saving' : when.toLocaleDateString('en', { month: 'long', year: 'numeric' })} />
      </>
    );
  } else if (calc === 'emergency') {
    const target = num(expenses) * Math.round(num(e.months));
    body = (
      <>
        <Row><Input label="Monthly expenses" value={expenses} onChange={(v) => setE({ ...e, expenses: v })} />
          <Input label="Months covered" value={e.months} onChange={(v) => setE({ ...e, months: v })} /></Row>
        <Input label="Already set aside" value={e.current} onChange={(v) => setE({ ...e, current: v })} />
        {avg && !e.expenses ? <Muted>Filled in from your average spending over the last 3 months.</Muted> : null}
        <Result big label="Emergency fund target" value={money(target)} />
        <Result label="Still to save" value={money(Math.max(target - num(e.current), 0))} />
      </>
    );
  } else {
    const months = Math.round(num(l.months));
    const payment = emi(num(l.principal), num(l.rate), months);
    body = (
      <>
        <Input label="Loan amount" value={l.principal} onChange={(v) => setL({ ...l, principal: v })} />
        <Row><Input label="Interest" suffix="% a year" value={l.rate} onChange={(v) => setL({ ...l, rate: v })} />
          <Input label="Months" value={l.months} onChange={(v) => setL({ ...l, months: v })} /></Row>
        <Result big label="Monthly EMI" value={money(payment)} />
        <Row><Result label="Total paid" value={money(payment * months)} /><View style={{ width: 24 }} />
          <Result label="Interest" value={money(payment * months - num(l.principal))} /></Row>
      </>
    );
  }

  return (
    <Screen>
      <Chips<Calc> value={calc} onChange={setCalc} options={[
        { value: 'savings', label: 'Savings growth' }, { value: 'goal', label: 'Goal planner' },
        { value: 'time', label: 'Time to goal' }, { value: 'emergency', label: 'Emergency fund' },
        { value: 'loan', label: 'Loan EMI' }]} />
      <Card style={{ gap: 14 }}>
        <H2>{{ savings: 'How your savings grow', goal: 'How much to save each month', time: 'When you will reach a goal',
          emergency: 'Emergency fund', loan: 'Loan EMI' }[calc]}</H2>
        {body}
      </Card>
      <Muted>Estimates only. Returns are compounded monthly and aren’t guaranteed.</Muted>
    </Screen>
  );
}
