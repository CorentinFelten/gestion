import type { CategoryFlow, CategoryScope } from '@prisma/client';

/** Seed shape for a default category (no ids, persisted per household/global). */
export interface DefaultCategorySeed {
  name: string;
  scope: CategoryScope;
  flow: CategoryFlow;
  icon?: string;
  color?: string;
}

/**
 * Default SHARED categories seeded onto every household at creation (PLAN.md §1).
 * These are the household spending buckets the tally is computed per-category on.
 */
export const DEFAULT_SHARED_CATEGORIES: DefaultCategorySeed[] = [
  { name: 'Alimentation', scope: 'shared', flow: 'expense', icon: '🛒', color: '#16a34a' },
  { name: 'Électricité', scope: 'shared', flow: 'expense', icon: '⚡', color: '#f59e0b' },
  { name: 'Internet', scope: 'shared', flow: 'expense', icon: '🌐', color: '#3b82f6' },
  { name: 'Eau', scope: 'shared', flow: 'expense', icon: '💧', color: '#06b6d4' },
  { name: 'Gaz', scope: 'shared', flow: 'expense', icon: '🔥', color: '#ef4444' },
  { name: 'Loyer', scope: 'shared', flow: 'expense', icon: '🏠', color: '#8b5cf6' },
  { name: 'Voyages', scope: 'shared', flow: 'expense', icon: '✈️', color: '#ec4899' },
  { name: 'Restaurants', scope: 'shared', flow: 'expense', icon: '🍽️', color: '#f97316' },
  { name: 'Transport', scope: 'shared', flow: 'expense', icon: '🚆', color: '#14b8a6' },
  { name: 'Divers', scope: 'shared', flow: 'expense', icon: '📦', color: '#64748b' },
];

/**
 * Default PERSONAL categories (global, householdId=null, userId=null) available
 * to every user's personal ledger. A small income/expense starter set (PLAN.md §1).
 */
export const DEFAULT_PERSONAL_CATEGORIES: DefaultCategorySeed[] = [
  { name: 'Salaire', scope: 'personal', flow: 'income', icon: '💼', color: '#16a34a' },
  { name: 'Remboursement', scope: 'personal', flow: 'income', icon: '↩️', color: '#22c55e' },
  { name: 'Intérêts', scope: 'personal', flow: 'income', icon: '📈', color: '#10b981' },
  { name: 'Alimentation', scope: 'personal', flow: 'expense', icon: '🛒', color: '#16a34a' },
  { name: 'Loyer', scope: 'personal', flow: 'expense', icon: '🏠', color: '#8b5cf6' },
  { name: 'Charges', scope: 'personal', flow: 'expense', icon: '💡', color: '#f59e0b' },
  { name: 'Restaurants', scope: 'personal', flow: 'expense', icon: '🍽️', color: '#f97316' },
  { name: 'Transport', scope: 'personal', flow: 'expense', icon: '🚆', color: '#14b8a6' },
  { name: 'Achats', scope: 'personal', flow: 'expense', icon: '🛍️', color: '#ec4899' },
  { name: 'Divers', scope: 'personal', flow: 'expense', icon: '📦', color: '#64748b' },
];
