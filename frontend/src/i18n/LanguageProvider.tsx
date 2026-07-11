/**
 * Language layer: holds the active UI language (only `fr` today) and its
 * dictionary, and exposes the `useT()` translation hook. Kept separate from the
 * LOCALE layer (Intl formatting) so a second language can be added later without
 * touching number/date formatting.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { fr, type Dictionary } from './dictionaries/fr';
import { plural, translate, type PluralForms, type TKey, type TParams } from './translate';

/** UI languages. Only French exists now; the union is the extension point. */
export type Language = 'fr';

/** The default (and currently only) UI language. */
export const DEFAULT_LANGUAGE: Language = 'fr';

const DICTIONARIES: Record<Language, Dictionary> = { fr };

/** Bound translation function: `t('common.save')`, `t('validation.minLength', { n: 8 })`. */
export type TFunction = (key: TKey, params?: TParams) => string;

interface LanguageContextValue {
  language: Language;
  dictionary: Dictionary;
  t: TFunction;
  /** Pluralize between form strings (French: 0–1 singular, else plural). */
  plural: (count: number, forms: PluralForms, params?: TParams) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({
  children,
  language = DEFAULT_LANGUAGE,
}: {
  children: ReactNode;
  language?: Language;
}) {
  const value = useMemo<LanguageContextValue>(() => {
    const dictionary = DICTIONARIES[language] ?? fr;
    return {
      language,
      dictionary,
      t: (key, params) => translate(dictionary, key, params),
      plural,
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

function useLanguageContext(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useT / useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}

/**
 * Primary translation hook. Returns `{ t, plural, language }`.
 * `const { t } = useT(); t('common.save')`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useT(): { t: TFunction; plural: LanguageContextValue['plural']; language: Language } {
  const { t, plural: pl, language } = useLanguageContext();
  return { t, plural: pl, language };
}

/** Access the active language + raw dictionary (rarely needed directly). */
// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage(): { language: Language; dictionary: Dictionary } {
  const { language, dictionary } = useLanguageContext();
  return { language, dictionary };
}
