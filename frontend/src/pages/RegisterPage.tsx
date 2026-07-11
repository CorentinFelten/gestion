import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useRegister } from '@/hooks/useAuthActions';
import { AuthShell } from '@/components/household/AuthShell';
import { Button, Field, Input, Select, Banner } from '@/components/household/ui';
import { isApiError } from '@/lib/api';
import { useT, normalizeLocale } from '@/i18n';
import { usePinnedCurrencyOptions } from '@/hooks/usePinnedCurrencies';

export default function RegisterPage() {
  const { t } = useT();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const register = useRegister();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [preferredCurrency, setPreferredCurrency] = useState('EUR');
  const { options: currencyOptions } = usePinnedCurrencyOptions();

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [loading, user, navigate]);

  const errorMsg = register.isError
    ? isApiError(register.error)
      ? String(
          Array.isArray(register.error.response.data.message)
            ? register.error.response.data.message.join(', ')
            : register.error.response.data.message,
        )
      : t('auth.registerError')
    : null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    register.mutate({
      displayName,
      email,
      password,
      preferredCurrency,
      locale: normalizeLocale(navigator.language),
    });
  }

  return (
    <AuthShell
      eyebrow={t('auth.getStarted')}
      title={t('auth.createAccountTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-teal-600 hover:text-teal-700">
            {t('auth.signIn')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {errorMsg ? <Banner tone="error">{errorMsg}</Banner> : null}
        <Field label={t('auth.displayName')} htmlFor="name">
          <Input
            id="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('auth.displayNamePlaceholder')}
          />
        </Field>
        <Field label={t('auth.email')} htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPlaceholder')}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('auth.password')} htmlFor="password" className="col-span-2">
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
            />
          </Field>
          <Field label={t('common.currency')} htmlFor="currency">
            <Select
              id="currency"
              value={preferredCurrency}
              onChange={(e) => setPreferredCurrency(e.target.value)}
            >
              {currencyOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={register.isPending}>
          {register.isPending ? t('auth.creating') : t('auth.createAccount')}
        </Button>
      </form>
    </AuthShell>
  );
}
