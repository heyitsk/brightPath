import { Elysia, t } from "elysia";
import { clientIp } from "../../lib/client-ip";
import { clearSessionCookie, serializeSessionCookie } from "../../lib/cookies";
import { errorResponses } from "../../lib/errors";
import { hashIp } from "../../lib/hash";
import { assertWriteIntent, staffGuard } from "../../plugins/auth";
import { prisma } from "../../lib/prisma";
import { rateLimit } from "../../plugins/rate-limit";
import { StaffUserSchema, toStaffDto } from "../staff/staff.schemas";
import { MAX_PASSWORD_LENGTH } from "./password";
import { SESSION_COOKIE, changePassword, cookieSecure, login, logout, sessionMaxAgeSec } from "./auth.service";

const TAG = "Admin · Auth";
const csrfNote =
  " Cookie-authenticated writes must send the header `X-BP-Admin: 1` (CSRF protection); the browser also sends an `Origin` that must be on the allow-list.";

// Public (no session yet): login. Throttled harder than the default limiter.
const publicAuth = new Elysia({ prefix: "/admin/auth", tags: [TAG] })
  .use(rateLimit({ name: "admin-login", limit: 10, windowSec: 60 }))
  .post(
    "/login",
    async ({ request, server, body, set }) => {
      assertWriteIntent(request);
      const { token, user } = await login(body.email, body.password, {
        ipHash: hashIp(clientIp({ request, server })),
        userAgent: request.headers.get("user-agent"),
      });
      set.headers["set-cookie"] = serializeSessionCookie(SESSION_COOKIE, token, { maxAgeSec: sessionMaxAgeSec, secure: cookieSecure });
      return { user: toStaffDto(user) };
    },
    {
      body: t.Object({
        email: t.String({ format: "email", maxLength: 254, description: "Staff email (case-insensitive)", examples: ["priya@example.com"] }),
        password: t.String({ minLength: 1, maxLength: MAX_PASSWORD_LENGTH, description: "Account password" }),
      }),
      detail: {
        summary: "Log in",
        description:
          "Starts a staff session and sets the `bp_session` cookie (httpOnly, SameSite=Lax, Secure in production). " +
          "Wrong email and wrong password give the same 401 message. After 5 wrong passwords the account is locked for 15 minutes (429). " +
          "Limited to 10 attempts per minute per IP." +
          csrfNote,
      },
      response: {
        200: t.Object({ user: StaffUserSchema }, { description: "Logged in; session cookie set" }),
        ...errorResponses(401, 403, 422, 429),
      },
    },
  );

const authed = new Elysia({ prefix: "/admin/auth", tags: [TAG] })
  .use(staffGuard({ allowPasswordChangePending: true }))
  .get(
    "/me",
    async ({ staff }) => {
      
      const user = await prisma.staffUser.findUniqueOrThrow({ where: { id: staff.id } });
      return { user: toStaffDto(user) };
    },
    {
      detail: {
        summary: "Current staff member",
        description: "Returns the logged-in staff member. The frontend calls this on load to learn the role and whether `mustChangePassword` is set.",
      },
      response: { 200: t.Object({ user: StaffUserSchema }), ...errorResponses(401) },
    },
  )
  .post(
    "/logout",
    async ({ staff, set }) => {
      await logout(staff.sessionId, staff);
      set.headers["set-cookie"] = clearSessionCookie(SESSION_COOKIE, cookieSecure);
      return { ok: true as const };
    },
    {
      detail: { summary: "Log out", description: "Ends the current session and clears the cookie." + csrfNote },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403) },
    },
  )
  .post(
    "/change-password",
    async ({ staff, body }) => {
      await changePassword(staff, body.currentPassword, body.newPassword);
      return { ok: true as const };
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1, maxLength: MAX_PASSWORD_LENGTH, description: "The password you use now" }),
        newPassword: t.String({
          minLength: 1,
          maxLength: MAX_PASSWORD_LENGTH,
          description: "At least 12 characters, not containing your email, different from the current one",
        }),
      }),
      detail: {
        summary: "Change own password",
        description:
          "Verifies the current password, sets the new one, clears `mustChangePassword`, and ends every OTHER session of this user." +
          csrfNote,
      },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403, 422) },
    },
  );

export const authRoutes = new Elysia().use(publicAuth).use(authed);
