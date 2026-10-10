import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { TransactionForm, type Duplicate, type TxDraft } from '@/components/TransactionForm';
import { Screen } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { todayISO } from '@/lib/dates';
import { CATEGORIES, formatMoney } from '@/lib/money';
import { lastCategory, rememberCategory } from '@/lib/prefs';
import { useToast } from '@/lib/toast';
import type { Kind, Transaction } from '@/lib/types';
import { refreshWidgets } from '@/lib/widget';

// Params pre-fill the form (the receipt scanner's "Edit"). `unsure` lists fields the scan
// wasn't sure about ("amount,direction"), highlighted for the user to check.
type Params = {
  kind?: Kind; amount?: string; category?: string; date?: string; description?: string; reference?: string;
  time?: string; method?: string; unsure?: string;
};

export default function NewTransaction() {
  const user = useUser();
  const toast = useToast();
  const params = useLocalSearchParams<Params>();
  const kind: Kind = params.kind === 'income' ? 'income' : 'expense';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const unsure = (params.unsure || '').split(',');

  const remembered = lastCategory(kind);
  const initial: TxDraft = {
    kind,
    amount: params.amount || '',
    category: params.category && params.category !== 'Other' && CATEGORIES[kind].includes(params.category)
      ? params.category
      : remembered && CATEGORIES[kind].includes(remembered) ? remembered : params.category || CATEGORIES[kind][0],
    date: params.date || todayISO(),
    description: params.description || '',
    reference: params.reference || undefined,
    time: params.time || '',
    method: params.method || '',
  };

  async function save(draft: TxDraft, allowDuplicate = false) {
    setBusy(true);
    setError(null);
    try {
      const { transaction: tx } = await api<{ transaction: Transaction }>('/transactions',
        { body: { ...draft, allow_duplicate: allowDuplicate } });
      rememberCategory(tx.kind, tx.category);
      refreshWidgets(user.currency);
      toast({
        text: `Saved ${tx.kind === 'income' ? '+' : '−'}${formatMoney(tx.amount_cents, user.currency)} · ${tx.description || tx.category}`,
        action: {
          label: 'Undo',
          onPress: () => {
            api(`/transactions/${tx.id}`, { method: 'DELETE' })
              .then(() => { refreshWidgets(user.currency); toast({ text: 'Removed.', tone: 'info' }); })
              .catch((err) => toast({ text: errorMessage(err), tone: 'info' }));
          },
        },
      });
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
        duplicate={duplicate} onSubmit={(d) => save(d)} onConfirmDuplicate={(d) => save(d, true)}
        unsure={{ amount: unsure.includes('amount'), direction: unsure.includes('direction') }} />
    </Screen>
  );
}
