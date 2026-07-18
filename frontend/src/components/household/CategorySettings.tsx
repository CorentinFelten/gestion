import { useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { useCategories } from '@/hooks/useHousehold';
import { usePersonalCategories } from '@/hooks/usePersonalMeta';
import {
  useCreateHouseholdCategory,
  useDeleteHouseholdCategory,
  useCreatePersonalCategory,
  useDeletePersonalCategory,
  type NewCategory,
} from '@/hooks/useCategorySettings';
import { Banner, Button, Card, Eyebrow, Field, Input, Select } from '@/components/household/ui';
import { useT, categoryLabel } from '@/i18n';
import type { Category } from '@/types';

export function PersonalCategoriesSection({ userId }: { userId: string }) {
  const { t } = useT();
  const categories = usePersonalCategories();
  const create = useCreatePersonalCategory();
  const remove = useDeletePersonalCategory();

  return (
    <CategoryManager
      eyebrow={t('settings.personalCategories')}
      hint={t('settings.personalCategoriesHint')}
      categories={categories.data ?? []}
      // A user's own private categories carry their userId; global defaults don't.
      isOwn={(c) => c.userId === userId}
      create={create}
      remove={remove}
    />
  );
}

export function HouseholdCategoriesSection({ householdId }: { householdId: string }) {
  const { t } = useT();
  const categories = useCategories(householdId);
  const create = useCreateHouseholdCategory(householdId);
  const remove = useDeleteHouseholdCategory(householdId);

  return (
    <CategoryManager
      eyebrow={t('settings.householdCategories')}
      hint={t('settings.householdCategoriesHint')}
      categories={categories.data ?? []}
      // The household's own buckets carry its id; seeded globals have householdId=null.
      isOwn={(c) => c.householdId === householdId}
      create={create}
      remove={remove}
    />
  );
}

/**
 * Shared UI for managing a set of categories: lists them (own ones deletable,
 * defaults badged) and an add form (name + flow + optional emoji/colour). The
 * scope (household vs personal) is entirely decided by which mutations are
 * passed in, so this component stays scope-agnostic.
 */
function CategoryManager({
  eyebrow,
  hint,
  categories,
  isOwn,
  create,
  remove,
}: {
  eyebrow: string;
  hint: string;
  categories: Category[];
  isOwn: (c: Category) => boolean;
  create: UseMutationResult<Category, unknown, NewCategory>;
  remove: UseMutationResult<void, unknown, string>;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [flow, setFlow] = useState<'expense' | 'income'>('expense');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#64748b');

  const own = categories.filter(isOwn);
  const defaults = categories.filter((c) => !isOwn(c));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, flow, icon: icon.trim() || undefined, color },
      { onSuccess: () => setName('') },
    );
  }

  function renderChip(c: Category, deletable: boolean) {
    return (
      <li
        key={c.id}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-1.5 text-sm dark:border-gray-800 dark:bg-gray-900"
      >
        {c.color ? (
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: c.color }}
          />
        ) : null}
        {c.icon ? <span aria-hidden>{c.icon}</span> : null}
        <span className="font-medium">{categoryLabel(c.name)}</span>
        <span className="text-xs text-gray-400">
          {c.flow === 'income' ? t('settings.categoryFlowIncome') : t('settings.categoryFlowExpense')}
        </span>
        {deletable ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('settings.deleteCategoryConfirm', { name: categoryLabel(c.name) }))) {
                remove.mutate(c.id);
              }
            }}
            aria-label={t('settings.deleteCategory', { name: categoryLabel(c.name) })}
            className="grid h-6 w-6 place-items-center rounded-full text-gray-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
          >
            ✕
          </button>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-gray-800">
            {t('settings.categoryDefaultBadge')}
          </span>
        )}
      </li>
    );
  }

  return (
    <Card className="p-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{hint}</p>

      <div className="mt-4">
        {own.length === 0 ? (
          <p className="text-sm text-gray-400">{t('settings.categoriesEmpty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">{own.map((c) => renderChip(c, true))}</ul>
        )}
      </div>

      {defaults.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">{defaults.map((c) => renderChip(c, false))}</ul>
      ) : null}

      <form onSubmit={submit} className="mt-5 flex flex-wrap items-end gap-3">
        <Field label={t('settings.categoryName')} htmlFor="cat-name" className="min-w-48 flex-1">
          <Input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.categoryNamePlaceholder')}
            maxLength={40}
          />
        </Field>
        <Field label={t('settings.categoryFlow')} htmlFor="cat-flow" className="w-32">
          <Select
            id="cat-flow"
            value={flow}
            onChange={(e) => setFlow(e.target.value as 'expense' | 'income')}
          >
            <option value="expense">{t('settings.categoryFlowExpense')}</option>
            <option value="income">{t('settings.categoryFlowIncome')}</option>
          </Select>
        </Field>
        <Field label={t('settings.categoryIcon')} htmlFor="cat-icon" className="w-20">
          <Input
            id="cat-icon"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder={t('settings.categoryIconPlaceholder')}
            maxLength={8}
          />
        </Field>
        <Field label={t('settings.categoryColor')} htmlFor="cat-color" className="w-20">
          <input
            id="cat-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-11 w-full cursor-pointer rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-950"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
          {create.isPending ? t('settings.addingCategory') : t('settings.addCategory')}
        </Button>
      </form>

      {create.isError ? (
        <div className="mt-3">
          <Banner tone="error">{t('settings.categoryCreateError')}</Banner>
        </div>
      ) : null}
      {remove.isError ? (
        <div className="mt-3">
          <Banner tone="error">{t('settings.categoryDeleteError')}</Banner>
        </div>
      ) : null}
    </Card>
  );
}
