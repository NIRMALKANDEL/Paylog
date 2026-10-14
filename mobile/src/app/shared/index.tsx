// Shared expenses: groups of friends who split bills. Same data as the website's
// "Shared" page; balances are worked out on the server.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Button, Card, Divider, Empty, ErrorState, Field, H2, Loading, Muted, Notice, Row, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { netLabel } from '@/lib/split';
import { useTheme } from '@/lib/theme';
import type { SplitGroup, SplitGroupSummary } from '@/lib/types';
import { useData } from '@/lib/useData';

export default function SharedGroups() {
  const user = useUser();
  const { colors } = useTheme();
  const { data, error, refreshing, refresh, reload } = useData<{ groups: SplitGroupSummary[] }>('/shared/groups');
  const [name, setName] = useState('');
  const [people, setPeople] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (error && !data) return <Screen><ErrorState message={error} onRetry={reload} /></Screen>;
  if (!data) return <Loading />;

  const owed = data.groups.reduce((sum, g) => sum + Math.max(g.my_net_cents, 0), 0);
  const owe = data.groups.reduce((sum, g) => sum + Math.max(-g.my_net_cents, 0), 0);

  async function create() {
    setBusy(true);
    setFormError(null);
    try {
      const members = people.split(',').map((p) => p.trim()).filter(Boolean);
      const res = await api<{ group: SplitGroup }>('/shared/groups', { body: { name, members } });
      setName('');
      setPeople('');
      router.push({ pathname: '/shared/[id]', params: { id: String(res.group.id) } });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {data.groups.length ? (
        <>
          <Card>
            <Row>
              <View style={{ flex: 1, gap: 4 }}>
                <Muted>You’re owed</Muted>
                <Text style={{ fontSize: 18, fontWeight: '800', color: colors.good }} numberOfLines={1} adjustsFontSizeToFit>
                  {formatMoney(owed, user.currency)}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Muted>You owe</Muted>
                <Text style={{ fontSize: 18, fontWeight: '800', color: owe ? colors.danger : colors.ink }} numberOfLines={1}
                  adjustsFontSizeToFit>
                  {formatMoney(owe, user.currency)}
                </Text>
              </View>
            </Row>
          </Card>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {data.groups.map((g, i) => {
              const net = netLabel(g.my_net_cents, user.currency);
              return (
                <View key={g.id}>
                  {i ? <Divider /> : null}
                  <Pressable onPress={() => router.push({ pathname: '/shared/[id]', params: { id: String(g.id) } })}
                    accessibilityRole="button" accessibilityLabel={`${g.name}. ${net.text}`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13,
                      opacity: pressed ? 0.6 : 1 })}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{g.name}</Text>
                      <Text style={{ fontSize: 13, color: net.tone === 'good' ? colors.good : net.tone === 'critical' ? colors.danger : colors.muted }}
                        numberOfLines={1}>
                        {g.member_count} people · {net.text}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={18} color={colors.faint} />
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </>
      ) : (
        <Card>
          <Empty icon="users" title="Split bills with friends"
            text="Make a group for a trip, flat or dinner. Add what each person paid and Paylog works out who owes whom. Kept apart from your own transactions." />
        </Card>
      )}

      <Card strong>
        <H2>New group</H2>
        <Field label="Group name" value={name} onChangeText={setName} placeholder="e.g. Goa trip" maxLength={40} />
        <Field label="People" value={people} onChangeText={setPeople} placeholder="Rahul, Priya, Sam"
          hint="Separate names with commas. You're added automatically." autoCapitalize="words" />
        {formError ? <Notice tone="critical">{formError}</Notice> : null}
        <Button title="Create group" icon="plus" onPress={create} loading={busy} disabled={!name.trim()} />
      </Card>
    </Screen>
  );
}
