import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  useRequireAuth,
  useHousehold,
  useMembers,
  useCurrencies,
} from '@/hooks/useHousehold';
import {
  useUpdateProfile,
  useUpdateHousehold,
  useRemoveMember,
} from '@/hooks/useSettings';
import {
  useCreateInvite,
  useInvitableUsers,
  useSentInvites,
  useRevokeInvite,
} from '@/hooks/useInvites';
import { useLogout } from '@/hooks/useAuthActions';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Eyebrow,
  Field,
  Input,
  PageHeader,
  Select,
  StateBlock,
} from '@/components/household/ui';
import {
  PersonalCategoriesSection,
  HouseholdCategoriesSection,
} from '@/components/household/CategorySettings';
import { ReceivedInvitesList } from '@/components/household/ReceivedInvites';
import { COMMON_CURRENCIES } from '@/components/household/format';
import { useT, useLocale, roleLabel, currencyLabel } from '@/i18n';
import { usePinnedCurrencyOptions } from '@/hooks/usePinnedCurrencies';
import type { Locale, Role, User } from '@/types';

/** Max currencies a user may pin (mirrors the backend cap). */
const MAX_PINNED_CURRENCIES = 12;

export default function SettingsPage() {
  const { t } = useT();
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const navigate = useNavigate();
  const household = useHousehold();
  const householdId = household.data?.id;
  const currencies = useCurrencies();
  const logout = useLogout();

  const isAdmin = household.data?.role === 'owner' || household.data?.role === 'admin';
  const currencyList = currencies.data ?? COMMON_CURRENCIES;

  if (!ready || household.isLoading || !user) return <StateBlock state="loading" />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow={t('settings.account')}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        actions={
          <Button
            variant="secondary"
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
            disabled={logout.isPending}
          >
            {logout.isPending ? t('auth.signingOut') : t('auth.signOut')}
          </Button>
        }
      />

      {/* ── You: profile & personal preferences ─────────────────────────── */}
      <ProfileSection user={user} currencyList={currencyList} />

      <PinnedCurrenciesSection user={user} currencyList={currencyList} />

      {/* ── Household & people ───────────────────────────────────────────── */}
      {household.data ? (
        <HouseholdSection
          householdId={household.data.id}
          name={household.data.name}
          baseCurrency={household.data.baseCurrency}
          currencyList={currencyList}
        />
      ) : (
        <Card className="p-6">
          <Eyebrow>{t('settings.household')}</Eyebrow>
          <p className="mt-2 text-sm text-gray-500">
            {t('settings.noHouseholdMessage')}
          </p>
        </Card>
      )}

      {household.data && householdId ? (
        <MembersSection householdId={householdId} isAdmin={isAdmin} currentUserId={user.id} />
      ) : null}

      <InvitationsSection householdId={householdId} isAdmin={isAdmin} />

      {/* ── Categories (personal + household, grouped) ───────────────────── */}
      <PersonalCategoriesSection userId={user.id} />

      {household.data && householdId ? (
        <HouseholdCategoriesSection householdId={householdId} />
      ) : null}
    </div>
  );
}

function ProfileSection({ user, currencyList }: { user: User; currencyList: string[] }) {
  const { t } = useT();
  const { setLocale: setActiveLocale, supportedLocales } = useLocale();
  const update = useUpdateProfile();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [preferredCurrency, setPreferredCurrency] = useState(user.preferredCurrency);
  const { codes: orderedCurrencies } = usePinnedCurrencyOptions([
    preferredCurrency,
    ...currencyList,
  ]);
  const [locale, setLocale] = useState<Locale>(
    supportedLocales.includes(user.locale as Locale) ? (user.locale as Locale) : supportedLocales[0],
  );
  const [saved, setSaved] = useState(false);

  // The locale dropdown previews app-wide instantly via `setActiveLocale`. If the
  // user leaves this page without saving, revert the session override to their
  // persisted locale so an abandoned preview doesn't stick for the whole session.
  const persistedLocaleRef = useRef<Locale>(locale);
  useEffect(() => {
    return () => setActiveLocale(persistedLocaleRef.current);
  }, [setActiveLocale]);

  const localeLabel: Record<Locale, string> = {
    'fr-FR': t('settings.regionFrance'),
    'fr-CA': t('settings.regionCanada'),
  };

  function onLocaleChange(next: Locale) {
    setLocale(next);
    setActiveLocale(next); // instant preview; persisted on submit
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    update.mutate(
      {
        displayName: displayName.trim(),
        avatarUrl: avatarUrl.trim() || null,
        preferredCurrency,
        locale,
      },
      {
        onSuccess: () => {
          setSaved(true);
          persistedLocaleRef.current = locale; // saved: keep the preview on unmount
        },
      },
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit}>
        <Eyebrow>{t('settings.profile')}</Eyebrow>
        <div className="mt-4 flex items-center gap-4">
          <Avatar name={displayName || '?'} id={user.id} size="lg" />
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label={t('auth.displayName')} htmlFor="p-name">
            <Input id="p-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </Field>
          <Field label={t('settings.avatarUrl')} htmlFor="p-avatar">
            <Input
              id="p-avatar"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>
          <Field label={t('auth.preferredCurrency')} htmlFor="p-cur" hint={t('settings.preferredCurrencyHint')}>
            <Select id="p-cur" value={preferredCurrency} onChange={(e) => setPreferredCurrency(e.target.value)}>
              {orderedCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('settings.regionFormat')} htmlFor="p-locale" hint={t('settings.regionFormatHint')}>
            <Select
              id="p-locale"
              value={locale}
              onChange={(e) => onLocaleChange(e.target.value as Locale)}
            >
              {supportedLocales.map((l) => (
                <option key={l} value={l}>
                  {localeLabel[l]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {update.isError ? (
          <div className="mt-4">
            <Banner tone="error">{t('settings.profileSaveError')}</Banner>
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-3">
          {saved && !update.isPending ? (
            <span className="text-sm font-medium text-emerald-600">{t('common.saved')}</span>
          ) : null}
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('settings.saveProfile')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PinnedCurrenciesSection({
  user,
  currencyList,
}: {
  user: User;
  currencyList: string[];
}) {
  const { t } = useT();
  const update = useUpdateProfile();
  const [pinned, setPinned] = useState<string[]>(user.pinnedCurrencies ?? []);
  const [toAdd, setToAdd] = useState('');
  const [saved, setSaved] = useState(false);

  // Reset local edits if the user's pins change elsewhere (e.g. after a save).
  useEffect(() => {
    setPinned(user.pinnedCurrencies ?? []);
  }, [user.pinnedCurrencies]);

  const atCap = pinned.length >= MAX_PINNED_CURRENCIES;
  const available = currencyList.filter((c) => !pinned.includes(c));

  function add(code: string) {
    const value = code.trim().toUpperCase();
    if (!value || pinned.includes(value) || atCap) return;
    setSaved(false);
    setPinned((prev) => [...prev, value]);
    setToAdd('');
  }

  function remove(code: string) {
    setSaved(false);
    setPinned((prev) => prev.filter((c) => c !== code));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    update.mutate({ pinnedCurrencies: pinned }, { onSuccess: () => setSaved(true) });
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit}>
        <Eyebrow>{t('settings.pinnedCurrencies')}</Eyebrow>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {t('settings.pinnedCurrenciesHint')}
        </p>

        <div className="mt-4">
          {pinned.length === 0 ? (
            <p className="text-sm text-gray-400">{t('settings.pinnedCurrenciesEmpty')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {pinned.map((code) => (
                <li
                  key={code}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-1.5 text-sm dark:border-gray-800 dark:bg-gray-900"
                >
                  <span className="font-medium">{code}</span>
                  <span className="text-gray-400">{currencyLabel(code)}</span>
                  <button
                    type="button"
                    onClick={() => remove(code)}
                    aria-label={t('settings.pinnedCurrenciesRemove', { code })}
                    className="grid h-6 w-6 place-items-center rounded-full text-gray-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field
            label={t('settings.pinnedCurrenciesAdd')}
            htmlFor="pin-add"
            className="min-w-56 flex-1"
          >
            <Select
              id="pin-add"
              value={toAdd}
              disabled={atCap || available.length === 0}
              onChange={(e) => add(e.target.value)}
            >
              <option value="">{t('settings.pinnedCurrenciesAddPlaceholder')}</option>
              {available.map((c) => (
                <option key={c} value={c}>
                  {c}, {currencyLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {atCap ? (
          <p className="mt-2 text-xs text-gray-400">
            {t('settings.pinnedCurrenciesCap', { max: MAX_PINNED_CURRENCIES })}
          </p>
        ) : null}

        {update.isError ? (
          <div className="mt-4">
            <Banner tone="error">{t('settings.profileSaveError')}</Banner>
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-3">
          {saved && !update.isPending ? (
            <span className="text-sm font-medium text-emerald-600">{t('common.saved')}</span>
          ) : null}
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('settings.savePinnedCurrencies')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function HouseholdSection({
  householdId,
  name: initialName,
  baseCurrency: initialBase,
  currencyList,
}: {
  householdId: string;
  name: string;
  baseCurrency: string;
  currencyList: string[];
}) {
  const { t } = useT();
  const update = useUpdateHousehold(householdId);
  const [name, setName] = useState(initialName);
  const [baseCurrency, setBaseCurrency] = useState(initialBase);
  const [saved, setSaved] = useState(false);
  const baseChanged = baseCurrency !== initialBase;
  const { codes: orderedCurrencies } = usePinnedCurrencyOptions([baseCurrency, ...currencyList]);

  useEffect(() => {
    setName(initialName);
    setBaseCurrency(initialBase);
  }, [initialName, initialBase]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (baseChanged) {
      const ok = window.confirm(t('settings.baseCurrencyConfirm', { currency: baseCurrency }));
      if (!ok) return;
    }
    setSaved(false);
    update.mutate({ name: name.trim(), baseCurrency }, { onSuccess: () => setSaved(true) });
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit}>
        <Eyebrow>{t('settings.household')}</Eyebrow>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.householdName')} htmlFor="h-name">
            <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('settings.baseCurrency')} htmlFor="h-cur" hint={t('settings.baseCurrencyHint')}>
            <Select
              id="h-cur"
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
            >
              {orderedCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {baseChanged ? (
          <div className="mt-4">
            <Banner tone="warn">{t('settings.baseCurrencyWarning')}</Banner>
          </div>
        ) : null}
        {update.isError ? (
          <div className="mt-4">
            <Banner tone="error">{t('settings.householdSaveError')}</Banner>
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-3">
          {saved && !update.isPending ? (
            <span className="text-sm font-medium text-emerald-600">{t('common.saved')}</span>
          ) : null}
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('settings.saveHousehold')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MembersSection({
  householdId,
  isAdmin,
  currentUserId,
}: {
  householdId: string;
  isAdmin: boolean;
  currentUserId: string;
}) {
  const { t } = useT();
  const members = useMembers(householdId);
  const remove = useRemoveMember(householdId);

  return (
    <Card className="p-6">
      <Eyebrow>{t('settings.members')}</Eyebrow>
      <div className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {members.isLoading ? (
          <StateBlock state="loading" />
        ) : members.isError ? (
          <StateBlock state="error" message={t('settings.membersLoadError')} />
        ) : (
          (members.data ?? []).map((m) => (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={m.displayName} id={m.userId} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.displayName}
                  {m.userId === currentUserId ? (
                    <span className="ml-2 text-xs text-gray-400">{t('settings.you')}</span>
                  ) : null}
                </p>
              </div>
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500 dark:bg-gray-800">
                {roleLabel(m.role)}
              </span>
              {isAdmin && m.userId !== currentUserId && m.role !== 'owner' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  onClick={() => {
                    if (window.confirm(t('settings.removeConfirm', { name: m.displayName }))) {
                      remove.mutate(m.userId);
                    }
                  }}
                >
                  {t('settings.remove')}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

/**
 * Unified invitations hub. Groups every invite-related control in one place:
 *   • "Reçues", the current user's own pending invitations (accept / refuse),
 *     always shown (also the entry point when the user has no household yet);
 *   • for owners/admins of a household, the invite-a-user form and the pending
 *     SENT invitations (revoke), previously buried inside the Members card.
 */
function InvitationsSection({
  householdId,
  isAdmin,
}: {
  householdId?: string;
  isAdmin: boolean;
}) {
  const { t } = useT();

  return (
    <Card className="p-6">
      <Eyebrow>{t('settings.invitations')}</Eyebrow>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {t('settings.invitationsHint')}
      </p>

      <div className="mt-5">
        <Eyebrow>{t('settings.invitationsReceived')}</Eyebrow>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {t('settings.invitationsReceivedHint')}
        </p>
        <div className="mt-4">
          <ReceivedInvitesList />
        </div>
      </div>

      {householdId && isAdmin ? (
        <div className="mt-6 border-t border-gray-100 pt-6 dark:border-gray-800">
          <InviteMemberForm householdId={householdId} />
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Owner/admin control: invite an EXISTING registered user (chosen from a list of
 * users with no household and no pending invite here) with a role, then manage
 * the pending sent invites (revoke).
 */
function InviteMemberForm({ householdId }: { householdId: string }) {
  const { t } = useT();
  const invitable = useInvitableUsers(householdId);
  const sent = useSentInvites(householdId);
  const invite = useCreateInvite(householdId);
  const revoke = useRevokeInvite(householdId);
  const [invitedUserId, setInvitedUserId] = useState('');
  const [role, setRole] = useState<Role>('member');

  const users = invitable.data ?? [];
  const pending = sent.data ?? [];

  function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!invitedUserId) return;
    invite.mutate(
      { invitedUserId, role },
      { onSuccess: () => setInvitedUserId('') },
    );
  }

  return (
    <div>
      <Eyebrow>{t('settings.inviteSomeone')}</Eyebrow>
      <form onSubmit={submitInvite} className="mt-3 flex flex-wrap items-end gap-3">
        <Field label={t('settings.chooseUser')} htmlFor="i-user" className="min-w-56 flex-1">
          <Select
            id="i-user"
            value={invitedUserId}
            disabled={users.length === 0}
            onChange={(e) => setInvitedUserId(e.target.value)}
          >
            <option value="">{t('settings.chooseUserPlaceholder')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}, {u.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('settings.role')} htmlFor="i-role" className="w-36">
          <Select id="i-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">{roleLabel('member')}</option>
            <option value="admin">{roleLabel('admin')}</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={!invitedUserId || invite.isPending}>
          {invite.isPending ? t('settings.inviting') : t('settings.sendInvite')}
        </Button>
      </form>
      {users.length === 0 && !invitable.isLoading ? (
        <p className="mt-2 text-xs text-gray-400">{t('settings.noInvitableUsers')}</p>
      ) : null}
      {invite.isError ? (
        <div className="mt-3">
          <Banner tone="error">{t('settings.inviteError')}</Banner>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="mt-5">
          <Eyebrow>{t('settings.pendingInvites')}</Eyebrow>
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.invitedUser.displayName}</p>
                  <p className="truncate text-xs text-gray-400">
                    {inv.invitedUser.email} · {roleLabel(inv.role)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(inv.id)}
                >
                  {t('settings.revokeInvite')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
