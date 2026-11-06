import { env, isProduction } from "../../config/env";
import { audit } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { randomToken, sha256 } from "../../lib/hash";
import { prisma } from "../../lib/prisma";
import { normalizeEmail } from "../staff/staff.schemas";
import { assertAcceptablePassword, hashPassword, verifyAgainstDummy, verifyPassword } from "./password";

export const SESSION_COOKIE = "bp_session";
export const sessionMaxAgeSec = env.SESSION_TTL_DAYS * 86_400;
export const cookieSecure = isProduction;

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const TOUCH_EVERY_MS = 5 * 60_000;

const INVALID_CREDENTIALS = () => AppError.unauthenticated("Email or password is incorrect.");

export interface ClientInfo {
  ipHash: string | null;
  userAgent: string | null;
}

export interface SessionStaff {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "EDITOR" | "COUNSELLOR";
  mustChangePassword: boolean;
  sessionId: string;
  ipHash: string | null;
}

export async function login(emailInput: string, password: string, client: ClientInfo) {
  const email = normalizeEmail(emailInput);
  const user = await prisma.staffUser.findUnique({ where: { email } });

  if (!user) {
    await verifyAgainstDummy(password); // same cost as a real check
    throw INVALID_CREDENTIALS();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    throw new AppError(429, "RATE_LIMITED", `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, undefined, {
      "retry-after": String(minutes * 60),
    });
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || !user.isActive) {
    if (!passwordOk) {
      const updated = await prisma.staffUser.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
      if (updated.failedLogins >= MAX_FAILED_LOGINS) {
        await prisma.staffUser.update({
          where: { id: user.id },
          data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
        });
        await audit(prisma, { actor: { id: user.id, email: user.email, ipHash: client.ipHash }, action: "auth.locked", entityType: "StaffUser", entityId: user.id });
      }
    }
    throw INVALID_CREDENTIALS(); // inactive accounts get the same answer as a wrong password
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + sessionMaxAgeSec * 1000);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.staffUser.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await tx.staffSession.create({
      data: { staffUserId: user.id, tokenHash: sha256(token), expiresAt, ipHash: client.ipHash, userAgent: client.userAgent?.slice(0, 200) ?? null },
    });
    await audit(tx, { actor: { id: user.id, email: user.email, ipHash: client.ipHash }, action: "auth.login", entityType: "StaffUser", entityId: user.id });
    return u;
  });

  // Housekeeping: drop expired sessions. Cheap, indexed, and keeps the table small without a cron.
  void prisma.staffSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});

  return { token, user: updated };
}

/** Resolve a cookie token to the logged-in staff member, or null if missing/expired/inactive. */
export async function resolveSession(token: string | undefined): Promise<SessionStaff | null> {
  if (!token) return null;
  const session = await prisma.staffSession.findUnique({ where: { tokenHash: sha256(token) }, include: { staffUser: true } });
  if (!session || session.expiresAt <= new Date() || !session.staffUser.isActive) return null;

  if (Date.now() - session.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    void prisma.staffSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  const u = session.staffUser;
  return { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword, sessionId: session.id, ipHash: session.ipHash };
}

export async function logout(sessionId: string, actor: SessionStaff) {
  await prisma.$transaction(async (tx) => {
    await tx.staffSession.deleteMany({ where: { id: sessionId } });
    await audit(tx, { actor, action: "auth.logout", entityType: "StaffUser", entityId: actor.id });
  });
}

export async function revokeAllSessions(staffUserId: string, exceptSessionId?: string) {
  await prisma.staffSession.deleteMany({ where: { staffUserId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}

export async function changePassword(actor: SessionStaff, current: string, next: string) {
  const user = await prisma.staffUser.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw AppError.invalid("Please fix 1 thing below.", [{ path: "currentPassword", message: "That is not your current password." }]);
  }
  assertAcceptablePassword(next, user.email, "newPassword");
  if (await verifyPassword(next, user.passwordHash)) {
    throw AppError.invalid("Please fix 1 thing below.", [{ path: "newPassword", message: "Choose a password you have not used just now." }]);
  }
  const passwordHash = await hashPassword(next);
  await prisma.$transaction(async (tx) => {
    await tx.staffUser.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.staffSession.deleteMany({ where: { staffUserId: user.id, id: { not: actor.sessionId } } });
    await audit(tx, { actor, action: "auth.change_password", entityType: "StaffUser", entityId: user.id });
  });
}
