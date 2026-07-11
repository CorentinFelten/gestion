/**
 * Core translation primitives: dot-path lookup, `{{param}}` interpolation, a
 * missing-key fallback, and a simple pluralization helper. The React-facing
 * `useT()` hook lives in `LanguageProvider.tsx` and wraps `translate()`.
 */
import { fr, type Dictionary } from './dictionaries/fr';

/** Values accepted for interpolation params. */
export type TParams = Record<string, string | number>;

/**
 * Dot-path union of every leaf key in the dictionary (editor autocomplete).
 * Unknown strings are still accepted by `t` via the `(string & {})` fallback so
 * translators can reference keys they are about to add.
 */
export type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
}[keyof T & string];

export type TranslationKey = DotPaths<Dictionary>;

/** A key argument: a known key (autocompleted) or any string (not yet added). */
export type TKey = TranslationKey | (string & {});

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/** Walk a nested dictionary by dot-path; returns the string leaf or undefined. */
function resolve(dict: unknown, key: string): string | undefined {
  const parts = key.split('.');
  let node: unknown = dict;
  for (const part of parts) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

/** Replace every `{{name}}` occurrence with the matching param (stringified). */
export function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Look up `key` in `dict` and interpolate `params`. Missing key → returns the
 * key itself and `console.warn`s in dev so gaps are visible but never crash.
 */
export function translate(dict: Dictionary, key: string, params?: TParams): string {
  const raw = resolve(dict, key);
  if (raw === undefined) {
    if (isDev()) {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] Missing translation key: "${key}"`);
    }
    return key;
  }
  return interpolate(raw, params);
}

/** Plural form selector: literal strings or dictionary keys resolved by caller. */
export interface PluralForms {
  one: string;
  other: string;
  /** Optional exact-zero form; falls back to `other` when omitted. */
  zero?: string;
}

/**
 * French pluralization: 0 and 1 are singular ("one"), everything else plural.
 * Returns the chosen FORM STRING (already-resolved text or a literal). Use with
 * `t` when the forms are dictionary keys: `plural(n, { one: t('x.one'), ... })`.
 * `{{count}}` inside a form is interpolated with the count automatically.
 */
export function plural(count: number, forms: PluralForms, params?: TParams): string {
  const abs = Math.abs(count);
  const chosen =
    abs === 0 && forms.zero !== undefined ? forms.zero : abs < 2 ? forms.one : forms.other;
  return interpolate(chosen, { count, ...params });
}

export { fr };
export type { Dictionary };
