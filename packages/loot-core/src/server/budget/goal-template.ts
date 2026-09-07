import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
// @ts-strict-ignore
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import type { CategoryEntity, CategoryGroupEntity } from '#types/models';
import type { CleanupTemplate } from '#types/models/cleanup-templates';
import type {
  CategoryTargetProjection,
  MonthTargetProjection,
} from '#types/models/targets';
import type { Template } from '#types/models/templates';

import { getSheetValue, isTrackingBudget, setBudget, setGoal } from './actions';
import { CategoryTemplateContext } from './category-template-context';
import { tombstoneOrphanCleanupGroups } from './cleanup-groups';
import { checkTemplateNotes, storeNoteTemplates } from './template-notes';
import type { TemplateNotification } from './template-notification';

export function distributeRemainder(
  templateContexts: CategoryTemplateContext[],
  availBudget: number,
): number {
  let remainderContexts = templateContexts.filter(c => c.hasRemainder());
  while (availBudget > 0 && remainderContexts.length > 0) {
    let remainderWeight = 0;
    remainderContexts.forEach(
      context => (remainderWeight += context.getRemainderWeight()),
    );
    const perWeight = availBudget / remainderWeight;
    const beforePass = availBudget;
    remainderContexts.forEach(context => {
      availBudget -= context.runRemainder(availBudget, perWeight);
    });
    if (availBudget === beforePass) break;
    remainderContexts = templateContexts.filter(c => c.hasRemainder());
  }
  return availBudget;
}

export async function storeTemplates({
  categoriesWithTemplates,
  source,
}: {
  categoriesWithTemplates: {
    id: string;
    templates: Template[];
    cleanup?: CleanupTemplate[];
  }[];
  source: 'notes' | 'ui';
}): Promise<void> {
  let touchedCleanup = false;
  await batchMessages(async () => {
    for (const { id, templates, cleanup } of categoriesWithTemplates) {
      const goalDefs = templates.length > 0 ? JSON.stringify(templates) : null;
      const update: Record<string, unknown> = {
        id,
        goal_def: goalDefs,
        template_settings: { source },
      };
      if (cleanup !== undefined) {
        update.cleanup_def =
          cleanup.length > 0 ? JSON.stringify(cleanup) : null;
        touchedCleanup = true;
      }
      await db.updateWithSchema('categories', update);
    }
  });
  if (touchedCleanup) {
    await tombstoneOrphanCleanupGroups();
  }
}

export async function applyTemplate({
  month,
}: {
  month: string;
}): Promise<TemplateNotification> {
  await storeNoteTemplates();
  const categoryTemplates = await getTemplates();
  const ret = await processTemplate(month, false, categoryTemplates, []);
  return ret;
}

export async function overwriteTemplate({
  month,
}: {
  month: string;
}): Promise<TemplateNotification> {
  await storeNoteTemplates();
  const categoryTemplates = await getTemplates();
  const ret = await processTemplate(month, true, categoryTemplates, []);
  return ret;
}

export async function applyMultipleCategoryTemplates({
  month,
  categoryIds,
}: {
  month: string;
  categoryIds: Array<CategoryEntity['id']>;
}) {
  const { data: categoryData }: { data: CategoryEntity[] } = await aqlQuery(
    q('categories')
      .filter({ id: { $oneof: categoryIds } })
      .select('*'),
  );
  await storeNoteTemplates();
  const categoryTemplates = await getTemplates(c => categoryIds.includes(c.id));
  const ret = await processTemplate(
    month,
    true,
    categoryTemplates,
    categoryData,
  );
  return ret;
}

export async function applySingleCategoryTemplate({
  month,
  category,
}: {
  month: string;
  category: CategoryEntity['id'];
}) {
  const { data: categoryData }: { data: CategoryEntity[] } = await aqlQuery(
    q('categories').filter({ id: category }).select('*'),
  );
  await storeNoteTemplates();
  const categoryTemplates = await getTemplates(c => c.id === category);
  const ret = await processTemplate(
    month,
    true,
    categoryTemplates,
    categoryData,
  );
  return ret;
}

export function runCheckTemplates() {
  return checkTemplateNotes();
}

async function getCategories(): Promise<CategoryEntity[]> {
  const { data: categoryGroups }: { data: CategoryGroupEntity[] } =
    await aqlQuery(q('category_groups').filter({ hidden: false }).select('*'));

  return categoryGroups.flatMap(g => g.categories || []).filter(c => !c.hidden);
}

async function getTemplates(
  filter: (category: CategoryEntity) => boolean = () => true,
): Promise<Record<CategoryEntity['id'], Template[]>> {
  //retrieves template definitions from the database
  const { data: categoriesWithGoalDef }: { data: CategoryEntity[] } =
    await aqlQuery(
      q('categories')
        .filter({ goal_def: { $ne: null } })
        .select('*'),
    );

  const categoryTemplates: Record<CategoryEntity['id'], Template[]> = {};
  for (const categoryWithGoalDef of categoriesWithGoalDef.filter(filter)) {
    if (!categoryWithGoalDef.goal_def) continue;
    categoryTemplates[categoryWithGoalDef.id] = JSON.parse(
      categoryWithGoalDef.goal_def,
    );
  }
  return categoryTemplates;
}

export async function getTemplatesForCategory(
  categoryId: CategoryEntity['id'],
): Promise<Record<CategoryEntity['id'], Template[]>> {
  return getTemplates(c => c.id === categoryId);
}

type TemplateBudget = {
  category: CategoryEntity['id'];
  budgeted: number;
};

async function setBudgets(month: string, templateBudget: TemplateBudget[]) {
  await batchMessages(async () => {
    templateBudget.forEach(element => {
      void setBudget({
        category: element.category,
        month,
        amount: element.budgeted,
      });
    });
  });
}

type TemplateGoal = {
  category: CategoryEntity['id'];
  goal: number | null;
  longGoal: number | null;
};

async function setGoals(month: string, templateGoal: TemplateGoal[]) {
  await batchMessages(async () => {
    templateGoal.forEach(element => {
      void setGoal({
        month,
        category: element.category,
        goal: element.goal,
        long_goal: element.longGoal,
      });
    });
  });
}

type ComputedTemplates = {
  contexts: CategoryTemplateContext[];
  errors: string[];
  // Same failures as `errors`, keyed by category so a projection can attribute
  // them. `errors` stays a flat list for the user-facing notification.
  categoryErrors: Record<CategoryEntity['id'], string>;
  orphanGoals: TemplateGoal[];
};

async function computeTemplates(
  month: string,
  force: boolean,
  categoryTemplates: Record<CategoryEntity['id'], Template[]>,
  categories: CategoryEntity[] = [],
  skipAvailableClamp: boolean = false,
  // When true, a category whose templates fail to construct is skipped instead
  // of aborting the whole run. Applying budgets must stay all-or-nothing (a
  // typo should never write a partial budget), but a read-only projection must
  // not let one broken category blank every other category's target.
  continueOnError: boolean = false,
): Promise<ComputedTemplates> {
  // setup categories
  const isTracking = isTrackingBudget();
  if (!categories.length) {
    categories = (await getCategories()).filter(
      c => isTracking || !c.is_income,
    );
  }

  // setup categories to process
  const templateContexts: CategoryTemplateContext[] = [];
  let availBudget = await getSheetValue(
    monthUtils.sheetForMonth(month),
    isTracking ? `total-saved` : `to-budget`,
  );
  const prioritiesSet = new Set<number>();
  const errors: string[] = [];
  const categoryErrors: Record<CategoryEntity['id'], string> = {};
  const orphanGoals: TemplateGoal[] = [];
  for (const category of categories) {
    const { id } = category;
    const sheetName = monthUtils.sheetForMonth(month);
    const templates = categoryTemplates[id];
    const budgeted = await getSheetValue(sheetName, `budget-${id}`);
    const existingGoal = await getSheetValue(sheetName, `goal-${id}`);

    // only run categories that are unbudgeted or if we are forcing it
    if ((budgeted === 0 || force) && templates) {
      try {
        const templateContext = await CategoryTemplateContext.init(
          templates,
          category,
          month,
          budgeted,
          skipAvailableClamp,
        );
        // don't use the funds that are not from templates
        if (!templateContext.isGoalOnly()) {
          availBudget += budgeted;
        }
        availBudget += templateContext.getLimitExcess();
        templateContext.getPriorities().forEach(p => prioritiesSet.add(p));
        templateContexts.push(templateContext);
      } catch (e) {
        errors.push(`${category.name}: ${e.message}`);
        categoryErrors[id] = e.message;
      }

      // do a reset of the goals that are orphaned
    } else if (existingGoal !== null && !templates) {
      orphanGoals.push({
        category: id,
        goal: null,
        longGoal: null,
      });
    }
  }

  if (errors.length > 0 && !continueOnError) {
    return { contexts: templateContexts, errors, categoryErrors, orphanGoals };
  }

  const priorities = new Int32Array([...prioritiesSet]).sort((a, b) => a - b);
  // run each priority level
  for (const priority of priorities) {
    const availStart = availBudget;
    for (const templateContext of templateContexts) {
      const budget = await templateContext.runTemplatesForPriority(
        priority,
        availBudget,
        availStart,
      );
      availBudget -= budget;
    }
  }

  distributeRemainder(templateContexts, availBudget);

  return { contexts: templateContexts, errors, categoryErrors, orphanGoals };
}

async function processTemplate(
  month: string,
  force: boolean,
  categoryTemplates: Record<CategoryEntity['id'], Template[]>,
  categories: CategoryEntity[] = [],
): Promise<TemplateNotification> {
  const { contexts, errors, orphanGoals } = await computeTemplates(
    month,
    force,
    categoryTemplates,
    categories,
  );

  if (contexts.length === 0 && errors.length === 0) {
    if (orphanGoals.length > 0) {
      await setGoals(month, orphanGoals);
    }
    return {
      type: 'message',
      message: 'templates-up-to-date',
    };
  }
  if (errors.length > 0) {
    return {
      sticky: true,
      message: 'template-errors',
      pre: errors.join(`\n\n`),
    };
  }

  const budgetList: TemplateBudget[] = [];
  const goalList: TemplateGoal[] = [...orphanGoals];
  contexts.forEach(context => {
    const values = context.getValues();
    budgetList.push({
      category: context.category.id,
      budgeted: values.budgeted,
    });
    goalList.push({
      category: context.category.id,
      goal: values.goal,
      longGoal: values.longGoal ? 1 : null,
    });
  });
  await setBudgets(month, budgetList);
  await setGoals(month, goalList);

  return {
    type: 'message',
    message: 'templates-applied',
    count: contexts.length,
  };
}

/**
 * True when the templates express "whatever is left" rather than a fixed
 * amount, so there is no number to be under- or over-funded against.
 */
function hasElasticTemplate(templates: Template[]): boolean {
  return templates.some(
    t =>
      t.type === 'remainder' ||
      (t.type === 'percentage' &&
        t.category.toLocaleLowerCase() === 'available funds'),
  );
}

function projectCategory(
  context: CategoryTemplateContext,
  templates: Template[],
  error: string | null,
): CategoryTargetProjection {
  const values = context.getValues();
  const meta = context.getTargetMeta();

  return {
    categoryId: context.category.id,
    budgeted: values.budgeted,
    goal: values.goal,
    longGoal: Boolean(values.longGoal),
    perTemplate: templates.map(t => values.perTemplateContribution.get(t) ?? 0),
    templateTypes: meta.templateTypes,
    targetMonth: meta.targetMonth,
    monthsRemaining: meta.monthsRemaining,
    totalTargetAmount: meta.totalTargetAmount,
    savedTowardTarget: meta.savedTowardTarget,
    limit: meta.limit,
    isElastic: hasElasticTemplate(templates),
    error,
  };
}

/**
 * Compute what every category's automations are aiming at, for one or more
 * months, **without writing anything** — no budgets, no goals, no sync
 * messages. This is what lets the budget table colour and chart a target the
 * user has not applied yet.
 *
 * All categories go through a single `computeTemplates` call per month, because
 * `remainder` and `percentage` templates depend on each other across
 * categories; running them one at a time gives different (wrong) answers.
 *
 * The priority clamp is skipped, so the result is what the templates *demand*,
 * not what applying them would assign when To Budget runs dry. Present it as a
 * target, never as "will assign".
 */
export async function projectTargets({
  months,
  categoryIds,
  templateOverrides,
}: {
  months: string[];
  categoryIds?: CategoryEntity['id'][];
  templateOverrides?: Record<CategoryEntity['id'], Template[]>;
}): Promise<MonthTargetProjection[]> {
  const isTracking = isTrackingBudget();
  let categories = (await getCategories()).filter(
    c => isTracking || !c.is_income,
  );
  if (categoryIds) {
    const wanted = new Set(categoryIds);
    categories = categories.filter(c => wanted.has(c.id));
  }
  if (categories.length === 0) {
    return months.map(month => ({ month, categories: [] }));
  }

  const stored = await getTemplates(c =>
    categories.some(cat => cat.id === c.id),
  );
  const templatesByCategory: Record<CategoryEntity['id'], Template[]> = {
    ...stored,
    ...templateOverrides,
  };

  const projections: MonthTargetProjection[] = [];
  for (const month of months) {
    const { contexts, categoryErrors } = await computeTemplates(
      month,
      /* force */ true,
      templatesByCategory,
      categories,
      /* skipAvailableClamp */ true,
      /* continueOnError */ true,
    );

    const projected = contexts.map(context =>
      projectCategory(
        context,
        templatesByCategory[context.category.id] ?? [],
        categoryErrors[context.category.id] ?? null,
      ),
    );

    // A category whose templates threw has no context at all, so surface the
    // error on its own rather than dropping the category silently.
    for (const [categoryId, error] of Object.entries(categoryErrors)) {
      if (!projected.some(p => p.categoryId === categoryId)) {
        projected.push({
          categoryId,
          budgeted: 0,
          goal: null,
          longGoal: false,
          perTemplate: [],
          templateTypes: [],
          targetMonth: null,
          monthsRemaining: null,
          totalTargetAmount: null,
          savedTowardTarget: 0,
          limit: null,
          isElastic: false,
          error,
        });
      }
    }

    projections.push({ month, categories: projected });
  }

  return projections;
}

export type DryRunCategoryResult = {
  budgeted: number;
  perTemplate: number[];
};

/**
 * Projection for a single category's *unsaved* templates, used by the budget
 * automations editor to preview an edit. Same engine as `projectTargets`, which
 * answers the different question of "what do the saved templates want".
 */
export async function dryRunCategoryTemplate({
  month,
  categoryId,
  templates,
}: {
  month: string;
  categoryId: CategoryEntity['id'];
  templates: Template[];
}): Promise<DryRunCategoryResult> {
  const [projection] = await projectTargets({
    months: [month],
    categoryIds: [categoryId],
    templateOverrides: { [categoryId]: templates },
  });
  const projected = projection?.categories.find(
    c => c.categoryId === categoryId,
  );
  if (!projected || projected.error) {
    return { budgeted: 0, perTemplate: templates.map(() => 0) };
  }
  return {
    budgeted: projected.budgeted,
    perTemplate: projected.perTemplate,
  };
}
