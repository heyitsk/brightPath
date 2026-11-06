import { Elysia } from "elysia";
import { env } from "../config/env";
import { parseCookies } from "../lib/cookies";
import { AppError } from "../lib/errors";
import { SESSION_COOKIE, resolveSession, type SessionStaff } from "../modules/auth/auth.service";

type Role = SessionStaff["role"];

export interface GuardOptions {
  /** Roles allowed in addition to ADMIN (who is always allowed). Empty = any logged-in staff. */
  roles?: Role[];
  /** Only ADMIN may pass (ignores `roles`). */
  adminOnly?: boolean;
  /** Let users with `mustChangePassword` through (only the change-password/me/logout routes). */
  allowPasswordChangePending?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated writes: the custom `X-BP-Admin` header cannot be set by
 * a cross-site HTML form and forces a CORS preflight from other origins; if the browser sends an
 * `Origin`, it must be one of ours.
 */
export function assertWriteIntent(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  if (request.headers.get("x-bp-admin") !== "1") {
    throw AppError.forbidden("Missing X-BP-Admin: 1 header on this request.");
  }
  const origin = request.headers.get("origin");
  if (origin && !env.CORS_ORIGINS.includes(origin)) {
    throw AppError.forbidden("This origin is not allowed.");
  }
}

/**
 * Requires a logged-in staff member and exposes them as `staff` on the context. Uses `derive`
 * so it runs BEFORE body validation (an anonymous caller gets 401, not a field-error hint).
 *
 * Usage: `new Elysia({ prefix: "/admin/x" }).use(staffGuard({ roles: ["EDITOR"] })).get(...)`
 */
export function staffGuard(opts: GuardOptions = {}) {
  const roles = [...(opts.roles ?? [])].sort();
  return new Elysia({ name: `staff-guard:${opts.adminOnly ? "admin" : roles.join(",") || "any"}:${opts.allowPasswordChangePending ? "pw" : ""}` }).derive(
    { as: "scoped" },
    async ({ request }) => {
      assertWriteIntent(request);
      const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
      const staff = await resolveSession(token);
      if (!staff) throw AppError.unauthenticated();
      if (staff.mustChangePassword && !opts.allowPasswordChangePending) throw AppError.passwordChangeRequired();
      if (opts.adminOnly && staff.role !== "ADMIN") throw AppError.forbidden("Only an ADMIN can do that.");
      if (roles.length > 0 && staff.role !== "ADMIN" && !roles.includes(staff.role)) throw AppError.forbidden();
      return { staff };
    },
  );
}
