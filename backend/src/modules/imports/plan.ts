// What an upload would do, row by row. A "plan" is computed (never saved) for the preview and recomputed at commit time
// against the data as it is then, so a preview can never go stale.

export type PlanAction = "CREATE" | "UPDATE" | "UNCHANGED" | "SKIP" | "ERROR";

export interface PlanChange {
  field: string;
  /** What is stored now (null = empty). */
  current: string | null;
  /** What the file says. */
  uploaded: string | null;
}

export interface PreviewItem {
  /** Row number in the file, as the person sees it. */
  line: number;
  action: PlanAction;
  /** Short name of the thing, e.g. "Altai State Medical University (Russia)". */
  label: string;
  /** A one-line summary of the row, e.g. "Barnaul, Government" or "USD 6,500 a year". */
  detail: string | null;
  slug: string | null;
  /** The college that already exists (UPDATE / UNCHANGED / SKIP and all fee rows). */
  targetId: string | null;
  /** Plain-words explanation, always set for ERROR, SKIP and UPDATE. */
  message: string | null;
  changes: PlanChange[];
  /** Things that do not block the row but are worth a look. */
  warnings: string[];
}

export type PlanItem<Apply> = PreviewItem & { apply: Apply | null };

export interface Plan<Apply> {
  items: Array<PlanItem<Apply>>;
  counts: Record<PlanAction, number>;
  /** Grouped counts of what would be created, e.g. per country. */
  groups: Record<string, number>;
}

export const emptyCounts = (): Record<PlanAction, number> => ({ CREATE: 0, UPDATE: 0, UNCHANGED: 0, SKIP: 0, ERROR: 0 });

export function buildPlan<Apply>(items: Array<PlanItem<Apply>>, groupOf: (i: PlanItem<Apply>) => string | null): Plan<Apply> {
  const counts = emptyCounts();
  const groups: Record<string, number> = {};
  for (const i of items) {
    counts[i.action]++;
    const g = i.action === "CREATE" ? groupOf(i) : null;
    if (g) groups[g] = (groups[g] ?? 0) + 1;
  }
  return { items, counts, groups };
}

export const toPreview = <A>(i: PlanItem<A>): PreviewItem => {
  const { apply: _apply, ...rest } = i;
  return rest;
};

/** Action order used to show what needs attention first. */
export const ACTION_PRIORITY: Record<PlanAction, number> = { ERROR: 0, SKIP: 1, UPDATE: 2, CREATE: 3, UNCHANGED: 4 };

export const blankItem = (line: number, label: string): PlanItem<never> => ({
  line, action: "ERROR", label, detail: null, slug: null, targetId: null, message: null, changes: [], warnings: [], apply: null,
});
