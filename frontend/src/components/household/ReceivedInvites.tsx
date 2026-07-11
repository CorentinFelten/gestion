/**
 * The current user's pending RECEIVED invitations, with Accepter / Refuser
 * actions. Reused in Settings (always shown, with empty state) and in the
 * no-household dashboard onboarding (shown alongside "create a household").
 */
import { useReceivedInvites, useAcceptInvite, useDeclineInvite } from '@/hooks/useInvites';
import { useHousehold } from '@/hooks/useHousehold';
import { useT, roleLabel } from '@/i18n';
import { Banner, Button, StateBlock } from './ui';

export function ReceivedInvitesList({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const { t } = useT();
  const received = useReceivedInvites();
  const household = useHousehold();
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();

  // Single-household invariant: if the user already belongs to a household they
  // cannot accept another invite, surface a clear message.
  const alreadyInHousehold = !!household.data;
  const invites = received.data ?? [];

  if (received.isLoading) return <StateBlock state="loading" />;
  if (received.isError) {
    return <StateBlock state="error" message={t('settings.receivedInvitesError')} />;
  }
  if (invites.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <StateBlock state="empty" title={t('settings.noReceivedInvites')} />
    );
  }

  return (
    <div className="space-y-3">
      {alreadyInHousehold ? (
        <Banner tone="info">{t('settings.alreadyInHousehold')}</Banner>
      ) : null}
      {accept.isError ? <Banner tone="error">{t('settings.acceptInviteError')}</Banner> : null}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {invites.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {t('settings.invitedToJoin', { household: inv.household.name })}
              </p>
              <p className="text-xs text-gray-400">
                {t('settings.invitedBy', { name: inv.invitedByName })} · {roleLabel(inv.role)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={alreadyInHousehold || accept.isPending || decline.isPending}
                onClick={() => accept.mutate(inv.id)}
              >
                {t('settings.acceptInvite')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                disabled={accept.isPending || decline.isPending}
                onClick={() => decline.mutate(inv.id)}
              >
                {t('settings.declineInvite')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
