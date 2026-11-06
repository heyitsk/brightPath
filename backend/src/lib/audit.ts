import type { Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditActor {
  id: string;
  email: string;
  ipHash?: string | null;
}

export interface AuditEntry {
  actor: AuditActor | null;
  /** `<entity>.<verb>`, e.g. `staff.create`, `setting.update`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Strip secrets before anything is written to the audit log. */
const SECRET_KEYS = new Set(["passwordHash", "password", "tokenHash", "token"]);
export function scrub<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEYS.has(k))
        .map(([k, v]) => [k, scrub(v)]),
    ) as T;
  }
  return value;
}

/**
 * Write one audit row. Pass the transaction client (`tx`) from the same transaction as the
 * change so the log and the data can never disagree (plan §3.3 rule 11).
 */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  const json = (v: unknown) => (v === undefined || v === null ? undefined : (scrub(JSON.parse(JSON.stringify(v))) as Prisma.InputJsonValue));
  await db.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorEmail: entry.actor?.email ?? null,
      ipHash: entry.actor?.ipHash ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: json(entry.before),
      after: json(entry.after),
    },
  });
}
