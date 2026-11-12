import type { Prisma } from "../../generated/prisma/client";
import { audit, type AuditActor } from "../../lib/audit";
import { AppError, type FieldError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { parsePastDate, optionalText } from "../reference/reference.schemas";
import { fail, recalcCourseTotals } from "../college/college.service";

// Exchange rates (Phase 4c). One row per currency; INR is always 1 and never stored.
// Changing a rate re-prices every college that charges fees in that currency, in the same transaction (D-080).

type Db = Prisma.TransactionClient | typeof prisma;

/** A new rate that differs from the old one by more than this share must be confirmed (guards against a slipped decimal point). */
export const LARGE_CHANGE_SHARE = 0.2;

const num = (d: { toString(): string }) => Number(d.toString());
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

type RateRow = { currency: string; rateToInr: { toString(): string }; asOf: Date; sourceNote: string | null; updatedAt: Date };

const toRateDto = (r: RateRow) => ({ currency: r.currency, rateToInr: num(r.rateToInr), asOf: dateOnly(r.asOf), sourceNote: r.sourceNote, updatedAt: r.updatedAt.toISOString() });

/** For each currency used in any college's fees: how many colleges use it, and how many of those are live. */
async function usageByCurrency(db: Db) {
  const rows = await db.collegeFeeLine.findMany({ distinct: ["collegeId", "currency"], select: { currency: true, college: { select: { status: true } } } });
  const usage = new Map<string, { colleges: number; live: number }>();
  for (const r of rows) {
    const u = usage.get(r.currency) ?? { colleges: 0, live: 0 };
    u.colleges++;
    if (r.college.status === "READY") u.live++;
    usage.set(r.currency, u);
  }
  return usage;
}

/** Every currency that has a rate or is used by a fee row (INR excluded). Currencies that need a rate come first. */
export async function listRates() {
  const [rates, usage] = await Promise.all([prisma.fxRate.findMany(), usageByCurrency(prisma)]);
  const byCurrency = new Map(rates.map((r) => [r.currency, r]));
  const currencies = new Set([...byCurrency.keys(), ...[...usage.keys()].filter((c) => c !== "INR")]);
  const items = [...currencies].map((currency) => {
    const r = byCurrency.get(currency);
    const u = usage.get(currency) ?? { colleges: 0, live: 0 };
    return {
      currency,
      hasRate: Boolean(r),
      rateToInr: r ? num(r.rateToInr) : null,
      asOf: r ? dateOnly(r.asOf) : null,
      sourceNote: r?.sourceNote ?? null,
      updatedAt: r ? r.updatedAt.toISOString() : null,
      collegesUsing: u.colleges,
      liveCollegesUsing: u.live,
    };
  });
  items.sort((a, b) => Number(a.hasRate) - Number(b.hasRate) || a.currency.localeCompare(b.currency));
  return { items, missingCount: items.filter((i) => !i.hasRate && i.collegesUsing > 0).length };
}

export interface RateInput {
  currency: string;
  rateToInr: number;
  asOf: string;
  sourceNote?: string | null;
}

/** Up to 6 decimal places, as stored. */
const sixDecimals = (v: number) => Math.abs(Math.round(v * 1e6) / 1e6 - v) < 1e-9;

function validate(input: RateInput, prefix: string, old: number | undefined, confirm: boolean, errors: FieldError[]): { currency: string; asOf: Date } | null {
  const currency = input.currency.trim().toUpperCase();
  const before = errors.length;
  if (!/^[A-Z]{3}$/.test(currency)) errors.push({ path: `${prefix}currency`, message: "Use a 3-letter currency code such as USD." });
  else if (currency === "INR") errors.push({ path: `${prefix}currency`, message: "INR is always 1, so it has no exchange rate." });
  if (!sixDecimals(input.rateToInr)) errors.push({ path: `${prefix}rateToInr`, message: "Use at most 6 decimal places." });
  let asOf: Date | null = null;
  try {
    asOf = parsePastDate(`${prefix}asOf`, input.asOf);
  } catch (e) {
    errors.push(...((e as AppError).fields ?? []));
  }
  if (old !== undefined && !confirm && Math.abs(input.rateToInr - old) / old > LARGE_CHANGE_SHARE) {
    const pct = Math.round((Math.abs(input.rateToInr - old) / old) * 100);
    errors.push({
      path: `${prefix}rateToInr`,
      message: `This changes the ${currency} rate by ${pct}% (from ${old} to ${input.rateToInr}), which re-prices every college that uses it. If that is right, confirm the change.`,
    });
  }
  return errors.length === before && asOf ? { currency, asOf } : null;
}

/** Sets one or several rates in a single transaction, then re-prices the affected colleges. Nothing is saved if any rate is refused. */
export async function setRates(actor: AuditActor, inputs: RateInput[], confirmLargeChange = false) {
  const existing = await prisma.fxRate.findMany();
  const oldRate = new Map(existing.map((r) => [r.currency, num(r.rateToInr)]));
  const errors: FieldError[] = [];
  const seen = new Set<string>();
  const prepared: Array<{ input: RateInput; currency: string; asOf: Date }> = [];
  inputs.forEach((input, i) => {
    const prefix = inputs.length > 1 ? `items.${i}.` : "";
    const code = input.currency.trim().toUpperCase();
    if (seen.has(code)) {
      errors.push({ path: `${prefix}currency`, message: `${code} appears twice in this request.` });
      return;
    }
    seen.add(code);
    const ok = validate(input, prefix, oldRate.get(code), confirmLargeChange, errors);
    if (ok) prepared.push({ input, ...ok });
  });
  if (errors.length) fail(errors);

  return prisma.$transaction(async (tx) => {
    const results = [];
    const changedCurrencies: string[] = [];
    for (const p of prepared) {
      const data = { rateToInr: p.input.rateToInr, asOf: p.asOf, sourceNote: optionalText(p.input.sourceNote) ?? null, updatedById: actor.id };
      const before = existing.find((r) => r.currency === p.currency);
      const row = await tx.fxRate.upsert({ where: { currency: p.currency }, update: data, create: { currency: p.currency, ...data } });
      if (!before || num(before.rateToInr) !== p.input.rateToInr) changedCurrencies.push(p.currency);
      results.push({ row, before });
    }
    const affected = changedCurrencies.length
      ? (await tx.collegeFeeLine.findMany({ where: { currency: { in: changedCurrencies } }, distinct: ["collegeId"], select: { collegeId: true } })).map((l) => l.collegeId)
      : [];
    const recalculated = affected.length ? await recalcCourseTotals(tx, affected) : 0;
    for (const { row, before } of results) {
      await audit(tx, {
        actor, action: "fx_rate.set", entityType: "FxRate", entityId: row.currency,
        before: before ? toRateDto(before) : undefined, after: { ...toRateDto(row), collegesPriced: affected.length, collegesRecalculated: recalculated },
      });
    }
    return { rates: results.map((r) => toRateDto(r.row)), collegesUsing: affected.length, collegesRecalculated: recalculated };
  });
}

/**
 * Removes a rate. Refused while a live college prices fees in that currency (it would lose a required detail, D-094).
 * Draft colleges lose their rupee total until a rate is set again.
 */
export async function deleteRate(actor: AuditActor, currencyInput: string) {
  const currency = currencyInput.toUpperCase();
  const before = await prisma.fxRate.findUnique({ where: { currency } });
  if (!before) throw AppError.notFound(`There is no ${currency} exchange rate.`);
  const usage = (await usageByCurrency(prisma)).get(currency) ?? { colleges: 0, live: 0 };
  if (usage.live > 0) {
    throw AppError.conflict(
      `${usage.live} live ${usage.live === 1 ? "college prices" : "colleges price"} its fees in ${currency}, so the rate cannot be removed. Set a new rate instead, or move those colleges back to draft first.`,
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.fxRate.delete({ where: { currency } });
    const affected = (await tx.collegeFeeLine.findMany({ where: { currency }, distinct: ["collegeId"], select: { collegeId: true } })).map((l) => l.collegeId);
    const recalculated = affected.length ? await recalcCourseTotals(tx, affected) : 0;
    await audit(tx, { actor, action: "fx_rate.delete", entityType: "FxRate", entityId: currency, before: toRateDto(before), after: { collegesPriced: affected.length, collegesRecalculated: recalculated } });
    return { collegesUsing: affected.length, collegesRecalculated: recalculated };
  });
}
