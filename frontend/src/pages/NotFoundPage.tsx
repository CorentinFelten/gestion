import { Link } from 'react-router-dom';
import { useT } from '@/i18n';

export default function NotFoundPage() {
  const { t } = useT();
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-bold text-gray-300 dark:text-gray-700">404</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
        {t('common.notFoundTitle')}
      </h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('common.notFoundBody')}</p>
      <Link
        to="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-md bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
      >
        {t('common.backHome')}
      </Link>
    </section>
  );
}
