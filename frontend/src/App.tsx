import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import DashboardPage from '@/pages/DashboardPage';
import TransactionsPage from '@/pages/TransactionsPage';
import TallyPage from '@/pages/TallyPage';
import SettleUpPage from '@/pages/SettleUpPage';
import ReportsPage from '@/pages/ReportsPage';
import MoneyOverviewPage from '@/pages/MoneyOverviewPage';
import MoneyAccountsPage from '@/pages/MoneyAccountsPage';
import MoneyAddPage from '@/pages/MoneyAddPage';
import MoneyStatsPage from '@/pages/MoneyStatsPage';
import SettingsPage from '@/pages/SettingsPage';
import NotFoundPage from '@/pages/NotFoundPage';

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

          <Route path="/money" element={<MoneyOverviewPage />} />
          <Route path="/money/accounts" element={<MoneyAccountsPage />} />
          <Route path="/money/add" element={<MoneyAddPage />} />
          <Route path="/money/stats" element={<MoneyStatsPage />} />

          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
