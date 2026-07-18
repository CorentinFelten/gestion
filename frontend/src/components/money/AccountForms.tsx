import { useMemo, useState } from 'react';
import {
  countryDefaultCurrency,
  ACCOUNT_TYPE_OPTIONS,
  COUNTRY_OPTIONS,
  CURRENCIES,
  useT,
} from '@/i18n';
import { usePinnedCurrencyOptions } from '@/hooks/usePinnedCurrencies';
import type { CreateAccountInput, UpdateAccountInput } from '@/hooks/useAccounts';
import { Button, Card, Field, Select, TextInput } from '@/components/money/ui';
import type { Account, AccountType, Country } from '@/types';

export function CreateAccountForm({
  defaultCurrency,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  defaultCurrency: string;
  onSubmit: (input: CreateAccountInput) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [country, setCountry] = useState<Country>(defaultCurrency === 'CAD' ? 'CA' : 'FR');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('0');
  const [interestRate, setInterestRate] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [minPayment, setMinPayment] = useState('');

  const isCredit = type === 'credit_card';

  // Guarantee the selected currency is present, then order pinned-first.
  const currencyBase = useMemo(() => [currency, ...CURRENCIES], [currency]);
  const { options: currencyOptions } = usePinnedCurrencyOptions(currencyBase);

  return (
    <Card className="mb-6 p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSubmit({
            name: name.trim(),
            type,
            currency,
            country,
            openingBalance: openingBalance.trim() || '0',
            // Credit-card-only fields; omit when empty or not a card.
            ...(isCredit && interestRate.trim() ? { interestRate: interestRate.trim() } : {}),
            ...(isCredit && creditLimit.trim() ? { creditLimit: creditLimit.trim() } : {}),
            ...(isCredit && minPayment.trim() ? { minPayment: minPayment.trim() } : {}),
          });
        }}
      >
        <p className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('accounts.newAccountTitle')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label={t('accounts.accountName')} htmlFor="acc-name">
              <TextInput
                id="acc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('accounts.accountNamePlaceholder')}
                autoFocus
                required
              />
            </Field>
          </div>
          <Field label={t('accounts.accountType')} htmlFor="acc-type">
            <Select
              id="acc-type"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              {ACCOUNT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.country')} htmlFor="acc-country">
            <Select
              id="acc-country"
              value={country}
              onChange={(e) => {
                const next = e.target.value as Country;
                setCountry(next);
                // Default the currency to the country's currency until the user
                // overrides it explicitly.
                if (!currencyTouched) setCurrency(countryDefaultCurrency(next));
              }}
            >
              {COUNTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.currency')} htmlFor="acc-ccy">
            <Select
              id="acc-ccy"
              value={currency}
              onChange={(e) => {
                setCurrencyTouched(true);
                setCurrency(e.target.value);
              }}
            >
              {currencyOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field
              label={t('accounts.openingBalance')}
              htmlFor="acc-open"
              hint={t('accounts.openingBalanceHint')}
            >
              <TextInput
                id="acc-open"
                type="number"
                inputMode="decimal"
                step="any"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {isCredit ? (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-800 dark:bg-gray-950/40">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
              {t('accounts.creditCardDetails')}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label={t('accounts.interestRate')}
                htmlFor="acc-apr"
                hint={t('accounts.interestRateHint')}
              >
                <TextInput
                  id="acc-apr"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  placeholder="19,99"
                />
              </Field>
              <Field label={t('accounts.creditLimit')} htmlFor="acc-limit">
                <TextInput
                  id="acc-limit"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                />
              </Field>
              <Field label={t('accounts.minPayment')} htmlFor="acc-minpay">
                <TextInput
                  id="acc-minpay"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={minPayment}
                  onChange={(e) => setMinPayment(e.target.value)}
                />
              </Field>
            </div>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

        <div className="mt-5 flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? t('accounts.creating') : t('accounts.createAccount')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Inline account editor: renames the account and, for credit cards, edits the
 * APR / limit / minimum-payment. Emptying a credit field clears it (sends null).
 */
export function EditAccountForm({
  account,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  account: Account;
  onSubmit: (input: UpdateAccountInput) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useT();
  const [name, setName] = useState(account.name);
  const [interestRate, setInterestRate] = useState(account.interestRate ?? '');
  const [creditLimit, setCreditLimit] = useState(account.creditLimit ?? '');
  const [minPayment, setMinPayment] = useState(account.minPayment ?? '');

  const isCredit = account.type === 'credit_card';
  // Empty string clears the field (null); a value is trimmed and sent as-is.
  const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

  return (
    <div className="border-t border-gray-100 p-4 dark:border-gray-800">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSubmit({
            name: name.trim(),
            ...(isCredit
              ? {
                  interestRate: orNull(interestRate),
                  creditLimit: orNull(creditLimit),
                  minPayment: orNull(minPayment),
                }
              : {}),
          });
        }}
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {t('accounts.editAccount')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={isCredit ? '' : 'sm:col-span-2'}>
            <Field label={t('accounts.accountName')} htmlFor={`edit-name-${account.id}`}>
              <TextInput
                id={`edit-name-${account.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
          </div>
          {isCredit ? (
            <>
              <Field
                label={t('accounts.interestRate')}
                htmlFor={`edit-apr-${account.id}`}
                hint={t('accounts.interestRateHint')}
              >
                <TextInput
                  id={`edit-apr-${account.id}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  placeholder="19,99"
                />
              </Field>
              <Field label={t('accounts.creditLimit')} htmlFor={`edit-limit-${account.id}`}>
                <TextInput
                  id={`edit-limit-${account.id}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                />
              </Field>
              <Field label={t('accounts.minPayment')} htmlFor={`edit-minpay-${account.id}`}>
                <TextInput
                  id={`edit-minpay-${account.id}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={minPayment}
                  onChange={(e) => setMinPayment(e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

        <div className="mt-4 flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? t('common.saving') : t('common.save')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </div>
  );
}
