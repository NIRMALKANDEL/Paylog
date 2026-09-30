import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Body, Button, Card, H2, Muted, Notice, Screen } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { refreshWidgets } from '@/lib/widget';

export default function ImportCsv() {
  const user = useUser();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'good' | 'critical'; text: string; errors?: string[] } | null>(null);

  async function pick() {
    setResult(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    const form = new FormData();
    // React Native's FormData takes a { uri, name, type } file descriptor.
    form.append('file', { uri: asset.uri, name: asset.name || 'import.csv', type: asset.mimeType || 'text/csv' } as any);
    setBusy(true);
    try {
      const data = await api<{ imported: number }>('/transactions/import', { form });
      setResult({ tone: 'good', text: `Imported ${data.imported} transactions.` });
      refreshWidgets(user.currency);
    } catch (err) {
      setResult({ tone: 'critical', text: errorMessage(err), errors: err instanceof ApiError ? err.data?.errors : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Body>Import transactions from a CSV file, for example one exported from Paylog or a spreadsheet.</Body>
      <Card>
        <H2>Columns</H2>
        <Muted>Required: date, category, amount. Optional: type (expense or income), description.</Muted>
        <View style={{ backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12 }}>
          <Text style={{ fontFamily: 'monospace', color: colors.inkSoft, fontSize: 13 }}>
            {'date,type,category,amount,description\n2026-09-01,expense,Food,250,Lunch\n2026-09-01,income,Salary,65000,'}
          </Text>
        </View>
        <Muted>Dates as YYYY-MM-DD. Categories must match Paylog’s list. Nothing is imported if any row has a problem.</Muted>
      </Card>
      {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}
      {result?.errors?.length ? (
        <Card>{result.errors.map((e) => <Muted key={e}>{e}</Muted>)}</Card>
      ) : null}
      <Button title="Choose CSV file" icon="upload" onPress={pick} loading={busy} />
    </Screen>
  );
}
