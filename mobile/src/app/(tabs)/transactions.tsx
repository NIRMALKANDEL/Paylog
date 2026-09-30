import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Chips, Divider, Empty, Muted, Notice, Row, Stat, TxRow } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { addDays, todayISO } from '@/lib/dates';
import { EXPENSE_CATEGORIES, formatMoney, INCOME_CATEGORIES } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import type { Transaction } from '@/lib/types';

type Page = { items: Transaction[]; page: number; pages: number; summary: { count: number; income: number; expense: number } };
type KindFilter = '' | 'expense' | 'income';
type Period = 'all' | 'month' | '30d' | 'year';
type Sort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

function periodRange(period: Period) {
  const today = todayISO();
  if (period === 'month') return { start: `${today.slice(0, 8)}01`, end: '' };
  if (period === '30d') return { start: addDays(today, -29), end: '' };
  if (period === 'year') return { start: `${today.slice(0, 4)}-01-01`, end: '' };
  return { start: '', end: '' };
}

export default function Transactions() {
  const user = useUser();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('');
  const [category, setCategory] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [sort, setSort] = useState<Sort>('date_desc');
  const [items, setItems] = useState<Transaction[]>([]);
  const [meta, setMeta] = useState<Omit<Page, 'items'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const requestId = useRef(0);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const buildPath = useCallback((page: number) => {
    const { start, end } = periodRange(period);
    const params = new URLSearchParams({ page: String(page), sort });
    if (query) params.set('q', query);
    if (kind) params.set('kind', kind);
    if (category) params.set('category', category);
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    return `/transactions?${params.toString()}`;
  }, [query, kind, category, period, sort]);

  const loadFirst = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const data = await api<Page>(buildPath(1));
      if (id !== requestId.current) return;
      setItems(data.items);
      setMeta({ page: data.page, pages: data.pages, summary: data.summary });
      setError(null);
    } catch (err) {
      if (id === requestId.current) setError(errorMessage(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [buildPath]);

  useFocusEffect(useCallback(() => {
    loadFirst();
  }, [loadFirst]));

  async function loadMore() {
    if (!meta || meta.page >= meta.pages || more || loading) return;
    setMore(true);
    const id = requestId.current;
    try {
      const data = await api<Page>(buildPath(meta.page + 1));
      if (id !== requestId.current) return;
      setItems((prev) => [...prev, ...data.items.filter((t) => !prev.some((p) => p.id === t.id))]);
      setMeta({ page: data.page, pages: data.pages, summary: data.summary });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMore(false);
    }
  }

  const categories = kind === 'income' ? INCOME_CATEGORIES : kind === 'expense' ? EXPENSE_CATEGORIES
    : [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];
  const filtered = !!(kind || category || period !== 'all' || sort !== 'date_desc');

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      <Row gap={8}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card,
          borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12 }}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search notes or categories" placeholderTextColor={colors.faint}
            style={{ flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 10 }} returnKeyType="search"
            accessibilityLabel="Search transactions" />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear search"><Icon name="close" size={16} color={colors.muted} /></Pressable> : null}
        </View>
        <Pressable onPress={() => setShowFilters(!showFilters)} accessibilityRole="button" accessibilityLabel="Filters"
          style={{ padding: 11, borderRadius: 12, borderWidth: 1, borderColor: filtered ? colors.accent : colors.border,
            backgroundColor: filtered ? colors.accentSoft : colors.card }}>
          <Icon name="filter" size={18} color={filtered ? colors.accentText : colors.muted} />
        </Pressable>
      </Row>

      <Chips<KindFilter> value={kind} onChange={(k) => { setKind(k); setCategory(''); }}
        options={[{ value: '', label: 'All' }, { value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />

      {showFilters ? (
        <View style={{ gap: 10 }}>
          <Chips<Period> value={period} onChange={setPeriod} options={[
            { value: 'all', label: 'All time' }, { value: 'month', label: 'This month' },
            { value: '30d', label: 'Last 30 days' }, { value: 'year', label: 'This year' }]} />
          <Chips<string> value={category} onChange={setCategory}
            options={[{ value: '', label: 'Any category' }, ...categories.map((c) => ({ value: c, label: c }))]} />
          <Chips<Sort> value={sort} onChange={setSort} options={[
            { value: 'date_desc', label: 'Newest' }, { value: 'date_asc', label: 'Oldest' },
            { value: 'amount_desc', label: 'Largest' }, { value: 'amount_asc', label: 'Smallest' }]} />
        </View>
      ) : null}

      {meta ? (
        <Row style={{ backgroundColor: colors.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border }}>
          <Stat label="Items" value={String(meta.summary.count)} />
          <Stat label="Spent" value={formatMoney(meta.summary.expense, user.currency)} />
          <Stat label="Income" value={formatMoney(meta.summary.income, user.currency)} tone={colors.good} />
        </Row>
      ) : null}
      {error ? <Notice tone="critical">{error}</Notice> : null}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      data={items}
      keyExtractor={(t) => String(t.id)}
      ListHeaderComponent={header}
      ItemSeparatorComponent={Divider}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <TxRow tx={item} currency={user.currency}
          onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(item.id) } })} />
      )}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={loadFirst}
        tintColor={colors.accent} colors={[colors.accent]} />}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} /> : (
        <Empty icon="list" title={query || filtered ? 'Nothing matches' : 'No transactions yet'}
          text={query || filtered ? 'Try a different search or filter.' : 'Tap + to add your first one.'} />
      )}
      ListFooterComponent={more ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} />
        : meta && meta.pages > 1 && meta.page >= meta.pages ? <Muted style={{ textAlign: 'center', marginTop: 12 }}>That’s everything.</Muted>
        : <Text> </Text>}
    />
  );
}
