import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { MoneyTransactionForm } from '@/components/money/MoneyTransactionForm';
import { Card, PageHeader } from '@/components/money/ui';
import type { PersonalTransaction } from '@/types';

/**
 * Standalone Add / Edit transaction page. The form itself lives in
 * `MoneyTransactionForm` so the identical UX can also render inside an overlay
 * (see `MoneyTxModal`); this page is the deep-linkable / nav fallback.
 */
export default function MoneyAddPage() {
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();

  // Edit mode: the row to correct is passed via router state from the ledger.
  const editing = useMemo(
    () => (location.state as { editing?: PersonalTransaction } | null)?.editing ?? null,
    [location.state],
  );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={t('money.eyebrow')}
        title={editing ? t('money.editTitle') : t('nav.addTransaction')}
        subtitle={editing ? t('money.editSubtitle') : t('money.addSubtitle')}
      />
      <Card className="p-6">
        <MoneyTransactionForm
          key={editing?.id ?? 'new'}
          editing={editing}
          mode="page"
          onDone={() => navigate('/money/accounts')}
        />
      </Card>
    </div>
  );
}
