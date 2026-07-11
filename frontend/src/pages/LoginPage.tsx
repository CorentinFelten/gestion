import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useLogin } from '@/hooks/useAuthActions';
import { AuthShell } from '@/components/household/AuthShell';
import { Button, Field, Input, Banner } from '@/components/household/ui';
import { isApiError } from '@/lib/api';
import { useT } from '@/i18n';

export default function LoginPage() {
  const { t } = useT();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [loading, user, navigate]);

  const errorMsg = login.isError
    ? isApiError(login.error)
      ? String(
          Array.isArray(login.error.response.data.message)
            ? login.error.response.data.message.join(', ')
            : login.error.response.data.message,
        )
      : t('auth.wrongCredentials')
    : null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <AuthShell
      eyebrow={t('auth.welcomeBack')}
      title={t('auth.signIn')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="font-semibold text-teal-600 hover:text-teal-700">
            {t('auth.createAccount')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {errorMsg ? <Banner tone="error">{errorMsg}</Banner> : null}
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
        <Field label={t('auth.password')} htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" disabled={login.isPending}>
          {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </AuthShell>
  );
}
