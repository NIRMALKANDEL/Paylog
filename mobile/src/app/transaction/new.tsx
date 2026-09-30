import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { TransactionForm, type Duplicate, type TxDraft } from '@/components/TransactionForm';
import { Screen } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { todayISO } from '@/lib/dates';
import { CATEGORIES } from '@/lib/money';
import type { Kind } from '@/lib/types';
import { refreshWidgets } from '@/lib/widget';

// Params pre-fill the form (used by the receipt scanner when it needs a review).
type Params = { kind?: Kind; amount?: string; category?: string; date?: string; description?: string; reference?: string };

export default function NewTransaction() {
  const user = useUser();
  const params = useLocalSearchParams<Params>();
  const kind: Kind = params.kind === 'income' ? 'income' : 'expense';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);

  const initial: TxDraft = {
    kind,
    amount: params.amount || '',
    category: params.category && CATEGORIES[kind].includes(params.category) ? params.category : CATEGORIES[kind][0],
    date: params.date || todayISO(),
    description: params.description || '',
    reference: params.reference || undefined,
  };

  async function save(draft: TxDraft, allowDuplicate = false) {
    setBusy(true);
    setError(null);
    try {
      await api('/transactions', { body: { ...draft, allow_duplicate: allowDuplicate } });
      refreshWidgets(user.currency);
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setDuplicate(err.data?.duplicate || null);
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TransactionForm initial={initial} currency={user.currency} submitLabel="Save" busy={busy} error={error}
        duplicate={duplicate} onSubmit={(d) => save(d)} onConfirmDuplicate={(d) => save(d, true)} />
    </Screen>
  );
}
