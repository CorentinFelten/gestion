import { createContext, useCallback, useContext, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useT } from '@/i18n';
import { Modal } from '@/components/money/ui';
import { MoneyTransactionForm } from '@/components/money/MoneyTransactionForm';
import type { PersonalTransaction } from '@/types';

/**
 * Overlay-based Add / Edit transaction, shared across the "My Money" area. Any
 * page under the provider can call `useMoneyTxModal().open()` (create) or
 * `open(tx)` (edit) to record or correct a transaction in place — no redirect —
 * for a smoother flow. Editing is how a saved transaction gets linked to a
 * shared expense (the form's "Lier à une dépense partagée" section).
 */

type MoneyTxModalApi = {
  /**
   * Open the overlay. Pass a transaction to edit it, or nothing to add a new
   * one; `opts.accountId` preselects the source account for a new transaction.
   */
  open: (editing?: PersonalTransaction | null, opts?: { accountId?: string }) => void;
};

const MoneyTxModalContext = createContext<MoneyTxModalApi | null>(null);

export function useMoneyTxModal(): MoneyTxModalApi {
  const ctx = useContext(MoneyTxModalContext);
  if (!ctx) throw new Error('useMoneyTxModal must be used within MoneyTxModalProvider');
  return ctx;
}

/**
 * Router layout element: renders the money routes (`<Outlet />`) and mounts the
 * shared transaction overlay once for all of them.
 */
export function MoneyTxModalProvider() {
  const { t } = useT();
  const [state, setState] = useState<{
    open: boolean;
    editing: PersonalTransaction | null;
    defaultAccountId?: string;
  }>({ open: false, editing: null });

  const open = useCallback(
    (editing: PersonalTransaction | null = null, opts?: { accountId?: string }) => {
      setState({ open: true, editing, defaultAccountId: opts?.accountId });
    },
    [],
  );

  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  return (
    <MoneyTxModalContext.Provider value={{ open }}>
      <Outlet />
      <Modal
        open={state.open}
        onClose={close}
        title={state.editing ? t('money.editTitle') : t('nav.addTransaction')}
        wide
      >
        {/* Keyed so the form resets cleanly each time the overlay opens. */}
        {state.open ? (
          <MoneyTransactionForm
            key={state.editing?.id ?? state.defaultAccountId ?? 'new'}
            editing={state.editing}
            defaultAccountId={state.defaultAccountId}
            mode="modal"
            onDone={close}
          />
        ) : null}
      </Modal>
    </MoneyTxModalContext.Provider>
  );
}
