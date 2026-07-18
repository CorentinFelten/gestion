import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useT } from '@/i18n';

type NavItem = { to: string; labelKey: string; end?: boolean };

const householdNav: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', end: true },
  { to: '/transactions', labelKey: 'nav.transactions' },
  { to: '/tally', labelKey: 'nav.tally' },
  { to: '/settle-up', labelKey: 'nav.settleUp' },
  { to: '/reports', labelKey: 'nav.reports' },
];

const moneyNav: NavItem[] = [
  { to: '/money', labelKey: 'nav.overview', end: true },
  { to: '/money/accounts', labelKey: 'nav.accounts' },
  { to: '/money/transactions', labelKey: 'nav.moneyTransactions' },
  { to: '/money/stats', labelKey: 'nav.statistics' },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex min-h-11 items-center rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
    isActive
      ? 'bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-white'
      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900',
  ].join(' ');
}

// The `dark` class on <html> is the single source of truth; index.html sets it
// pre-hydration from localStorage (or the OS preference). Here we initialise from
// that class, and the toggle persists the choice so it survives reloads. Charts
// observe the class via `useIsDark`.
function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* storage unavailable (private mode) — theme just won't persist */
    }
  }, [dark]);
  return [dark, () => setDark((d) => !d)];
}

/** The nav body (section groups + settings), shared by the desktop sidebar and
 * the mobile drawer so both stay in sync. `onNavigate` closes the drawer. */
function NavBody({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  const section = (labelKey: string, items: NavItem[], topPad = false) => (
    <>
      <p
        className={`px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400 ${
          topPad ? 'pt-4' : ''
        }`}
      >
        {t(labelKey)}
      </p>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={navClass}
          onClick={onNavigate}
        >
          {t(item.labelKey)}
        </NavLink>
      ))}
    </>
  );

  return (
    <nav className="flex flex-1 flex-col space-y-1 overflow-y-auto">
      {section('nav.household', householdNav)}
      {section('nav.myMoney', moneyNav, true)}
      <div className="mt-auto pt-4">
        <NavLink to="/settings" className={navClass} onClick={onNavigate}>
          {t('nav.settings')}
        </NavLink>
      </div>
    </nav>
  );
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-11 w-11 items-center justify-center rounded-md text-lg hover:bg-gray-200 dark:hover:bg-gray-800"
      aria-label={t('nav.toggleTheme')}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}

/**
 * App shell. Desktop (lg+): a fixed sidebar with Household + « Mon argent »
 * navigation. Mobile: a top bar with a hamburger that opens a slide-in drawer
 * holding the same nav. The drawer closes on route change and on Échap, traps
 * initial focus, restores focus to the toggle, and respects safe-area insets.
 */
export default function Layout() {
  const { t } = useT();
  const [dark, toggleDark] = useDarkMode();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Escape to close + lock body scroll + move focus into the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  function closeDrawer() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Mobile top bar */}
      <header
        className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900 lg:hidden"
        style={{
          paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
        }}
      >
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-md text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-800"
          aria-label="Ouvrir le menu de navigation"
          aria-expanded={open}
          aria-controls="app-mobile-nav"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span className="text-lg font-bold">Gestion</span>
        <div className="ml-auto">
          <ThemeToggle dark={dark} onToggle={toggleDark} />
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside
        className="hidden w-60 flex-col border-r border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900 lg:flex"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        }}
      >
        <div className="mb-6 flex items-center justify-between">
          <span className="text-lg font-bold">Gestion</span>
          <ThemeToggle dark={dark} onToggle={toggleDark} />
        </div>
        <NavBody />
      </aside>

      {/* Mobile drawer + backdrop */}
      {open ? (
        <div className="lg:hidden">
          <div
            className="animate-shell-fade-in fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-xs"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <aside
            id="app-mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navigation"
            className="animate-shell-drawer-in fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col border-r border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900"
            style={{
              paddingTop: 'max(1rem, env(safe-area-inset-top))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            }}
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="text-lg font-bold">Gestion</span>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDrawer}
                className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800"
                aria-label={t('common.close')}
              >
                ✕
              </button>
            </div>
            <NavBody onNavigate={closeDrawer} />
          </aside>
        </div>
      ) : null}

      <main
        className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
