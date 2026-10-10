import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { TransactionForm, type TxDraft } from '@/components/TransactionForm';
import { ErrorState, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { centsToInput, formatMoney } from '@/lib/money';
import { useToast } from '@/lib/toast';
import type { Transaction } from '@/lib/types';
import { useData } from '@/lib/useData';
import { refreshWidgets } from '@/lib/widget';

export default function EditTransaction() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUser();
  const toast = useToast();
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
    reference: tx.reference || undefined,
    time: tx.time || '',
    method: tx.method || '',
  };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      refreshWidgets(user.currency);
      router.back();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return false;
    }
  }

  // Deleting keeps a copy for a few seconds, so Undo can put it back.
  async function remove() {
    if (!(await run(() => api(`/transactions/${tx.id}`, { method: 'DELETE' })))) return;
    toast({
      text: `Deleted ${formatMoney(tx.amount_cents, user.currency)} · ${tx.description || tx.category}`,
      action: {
        label: 'Undo',
        onPress: () => {
          api('/transactions', { body: { ...initial, allow_duplicate: true } })
            .then(() => { refreshWidgets(user.currency); toast({ text: 'Restored.' }); })
            .catch((err) => toast({ text: errorMessage(err), tone: 'info' }));
        },
      },
    });
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
        onDelete={remove}
      />
    </Screen>
  );
}
