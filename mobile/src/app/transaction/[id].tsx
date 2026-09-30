import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { TransactionForm, type TxDraft } from '@/components/TransactionForm';
import { ErrorState, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { centsToInput } from '@/lib/money';
import type { Transaction } from '@/lib/types';
import { useData } from '@/lib/useData';
import { refreshWidgets } from '@/lib/widget';

export default function EditTransaction() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUser();
  const { data, error: loadError, reload } = useData<{ transaction: Transaction }>(`/transactions/${id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loadError && !data) return <Screen><ErrorState message={loadError} onRetry={reload} /></Screen>;
  if (!data) return <Loading />;
  const tx = data.transaction;

  const initial: TxDraft = {
    kind: tx.kind,
    amount: centsToInput(tx.amount_cents),
    category: tx.category,
    date: tx.date,
    description: tx.description,
  };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      refreshWidgets(user.currency);
      router.back();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TransactionForm
        key={tx.id}
        initial={initial}
        currency={user.currency}
        submitLabel="Save changes"
        busy={busy}
        error={error}
        onSubmit={(draft) => run(() => api(`/transactions/${tx.id}`, { method: 'PUT', body: draft }))}
        onDelete={() => run(() => api(`/transactions/${tx.id}`, { method: 'DELETE' }))}
      />
    </Screen>
  );
}
