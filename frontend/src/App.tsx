import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useT } from '@/i18n';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import TransactionsPage from '@/pages/TransactionsPage';
import TallyPage from '@/pages/TallyPage';
import SettleUpPage from '@/pages/SettleUpPage';
import MoneyOverviewPage from '@/pages/MoneyOverviewPage';
import MoneyAccountsPage from '@/pages/MoneyAccountsPage';
import MoneyTransactionsPage from '@/pages/MoneyTransactionsPage';
import MoneyAddPage from '@/pages/MoneyAddPage';
import { MoneyTxModalProvider } from '@/components/money/MoneyTxModal';
import SettingsPage from '@/pages/SettingsPage';
import NotFoundPage from '@/pages/NotFoundPage';

// Chart-heavy pages are code-split so the ~500 kB recharts chunk stays out of the
// initial bundle (incl. /login) and only loads when one of these routes renders.
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const MoneyStatsPage = lazy(() => import('@/pages/MoneyStatsPage'));

/** Localized spinner shown while a lazy route chunk loads. */
function RouteFallback() {
  const { t } = useT();
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-gray-400" role="status">
      {t('common.loading')}
    </div>
  );
}

/**
 * Guard for the authenticated app shell: while the session is still loading we
 * render nothing (avoids a flash of the login redirect), then either redirect to
 * /login (preserving the attempted path) or render the protected routes.
 */
function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/**
 * Route table (PLAN.md §7). Auth pages are standalone; everything else renders
 * inside the app shell behind `RequireAuth` (redirect to /login when
 * unauthenticated).
 */
export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/tally" element={<TallyPage />} />
            <Route path="/settle-up" element={<SettleUpPage />} />
            <Route path="/reports" element={<ReportsPage />} />

            {/* All "My Money" routes share one transaction Add/Edit overlay. */}
            <Route element={<MoneyTxModalProvider />}>
              <Route path="/money" element={<MoneyOverviewPage />} />
              <Route path="/money/accounts" element={<MoneyAccountsPage />} />
              <Route path="/money/transactions" element={<MoneyTransactionsPage />} />
              <Route path="/money/add" element={<MoneyAddPage />} />
              <Route path="/money/stats" element={<MoneyStatsPage />} />
            </Route>

            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
