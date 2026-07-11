/**
 * i18n public surface. Import from `@/i18n` (barrel) or the specific module.
 *
 *   import { useT, useLocale, useFormat, formatMoney, accountTypeLabel } from '@/i18n';
 *
 * Layers:
 *   - LANGUAGE (UI strings)  → LanguageProvider / useT / dictionaries/fr.ts
 *   - LOCALE   (Intl format) → LocaleProvider / useLocale / useFormat / format.ts
 *   - VOCABULARY (enum→label) → terms.ts
 */
export {
  LanguageProvider,
  useT,
  useLanguage,
  DEFAULT_LANGUAGE,
  type Language,
  type TFunction,
} from './LanguageProvider';

export {
  LocaleProvider,
  useLocale,
  useFormat,
  normalizeLocale,
} from './LocaleProvider';

export {
  translate,
  interpolate,
  plural,
  fr,
  type Dictionary,
  type TranslationKey,
  type TKey,
  type TParams,
  type PluralForms,
} from './translate';

export * from './format';
export * from './terms';
