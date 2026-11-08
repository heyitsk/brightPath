import { Value } from "@sinclair/typebox/value";
import { audit, type AuditActor } from "../../lib/audit";
import { cached, invalidate } from "../../lib/cache";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { DISCLAIMER_DEFS, DISCLAIMER_DEFS_BY_KEY } from "./disclaimers";
import { SETTINGS, SETTINGS_BY_KEY, describeExpectedValue } from "./settings.registry";

const NS = "site";

// ---- settings --------------------------------------------------------------------------

export async function getAllSettings() {
  const rows = await prisma.siteSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTINGS.map((def) => {
    const row = byKey.get(def.key);
    return {
      key: def.key,
      description: def.description,
      isPublic: def.isPublic,
      value: row ? row.value : def.default,
      default: def.default,
      isDefault: !row,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

/** Typed read for other modules (finder, enquiries, ...). Falls back to the registry default. */
export async function getSetting<T>(key: string): Promise<T> {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  return (row ? row.value : def.default) as T;
}

export async function updateSetting(actor: AuditActor, key: string, value: unknown) {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw AppError.notFound(`There is no setting called "${key}".`);
  if (!Value.Check(def.schema, value)) {
    throw AppError.invalid("Please fix 1 thing below.", [{ path: "value", message: describeExpectedValue(def) }]);
  }
  const before = await prisma.siteSetting.findUnique({ where: { key } });
  await prisma.$transaction(async (tx) => {
    await tx.siteSetting.upsert({ where: { key }, create: { key, value: value as never, updatedById: actor.id }, update: { value: value as never, updatedById: actor.id } });
    await audit(tx, { actor, action: "setting.update", entityType: "SiteSetting", entityId: key, before: { value: before ? before.value : def.default }, after: { value } });
  });
  await invalidate(NS);
  return (await getAllSettings()).find((s) => s.key === key)!;
}

// ---- disclaimers -----------------------------------------------------------------------

export interface ActiveDisclaimer {
  key: string;
  version: number;
  text: string;
}

export async function getActiveDisclaimers(): Promise<Record<string, ActiveDisclaimer>> {
  const rows = await prisma.disclaimer.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
  const out: Record<string, ActiveDisclaimer> = {};
  for (const d of DISCLAIMER_DEFS) out[d.key] = { key: d.key, version: 0, text: d.text }; // version 0 = built-in fallback
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key)) continue; // rows are newest-first, first seen = active
    seen.add(r.key);
    out[r.key] = { key: r.key, version: r.version, text: r.text };
  }
  return out;
}

export async function getDisclaimerAdminView() {
  const rows = await prisma.disclaimer.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
  return DISCLAIMER_DEFS.map((def) => {
    const history = rows.filter((r) => r.key === def.key).map((r) => ({ version: r.version, text: r.text, createdAt: r.createdAt.toISOString() }));
    const active = history[0];
    return {
      key: def.key,
      description: def.description,
      version: active?.version ?? 0,
      text: active?.text ?? def.text,
      isBuiltIn: !active,
      history,
    };
  });
}

/** Adds a new version (never edits an old one) so what students saw can always be reconstructed. */
export async function publishDisclaimer(actor: AuditActor, key: string, text: string) {
  const def = DISCLAIMER_DEFS_BY_KEY.get(key);
  if (!def) throw AppError.notFound(`There is no disclaimer called "${key}".`);
  const trimmed = text.trim();
  const before = (await getActiveDisclaimers())[key]!;
  if (trimmed === before.text) throw AppError.conflict("This is the same as the current text.");

  await prisma.$transaction(async (tx) => {
    const latest = await tx.disclaimer.findFirst({ where: { key }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;
    await tx.disclaimer.create({ data: { key, version, text: trimmed, createdById: actor.id } });
    await audit(tx, { actor, action: "disclaimer.publish", entityType: "Disclaimer", entityId: key, before: { version: before.version, text: before.text }, after: { version, text: trimmed } });
  });
  await invalidate(NS);
  return (await getDisclaimerAdminView()).find((d) => d.key === key)!;
}

// ---- public config ---------------------------------------------------------------------

export function getPublicSiteConfig() {
  return cached(NS, "config", 60, async () => {
    const [settings, disclaimers] = await Promise.all([getAllSettings(), getActiveDisclaimers()]);
    const v = (key: string) => settings.find((s) => s.key === key)!.value;
    return {
      brand: { name: v("brand.name") as string | null },
      contact: {
        phone: v("contact.phone") as string | null,
        whatsapp: v("contact.whatsapp") as string | null,
        email: v("contact.email") as string | null,
        officeAddress: v("contact.officeAddress") as string | null,
        callbackHours: v("contact.callbackHours") as string | null,
      },
      finder: { freeResultsPerGroup: v("finder.freeResultsPerGroup") as number },
      disclaimers: Object.fromEntries(Object.values(disclaimers).map((d) => [d.key, { version: d.version, text: d.text }])),
    };
  });
}
