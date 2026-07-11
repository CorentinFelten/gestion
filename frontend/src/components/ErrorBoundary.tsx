import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useT } from '@/i18n';

/**
 * Top-level React error boundary. Without it, any render-time throw unmounts the
 * whole tree and blanks the SPA. This catches the error, logs it, and shows a
 * localized fallback with a reload affordance. Mounted inside the language/locale
 * providers so the fallback can be translated.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}

/** Localized fallback UI, kept as a functional child so it can use `useT()`. */
function ErrorFallback() {
  const { t } = useT();
  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <div className="max-w-md">
        <h1 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {t('common.crashTitle')}
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('common.crashBody')}</p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
      >
        {t('common.reload')}
      </button>
    </div>
  );
}
