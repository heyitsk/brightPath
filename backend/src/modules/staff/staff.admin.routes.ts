import { Elysia, t } from "elysia";
import { audit } from "../../lib/audit";
import { AppError, errorResponses } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { staffGuard } from "../../plugins/auth";
import { MAX_PASSWORD_LENGTH, assertAcceptablePassword, hashPassword } from "../auth/password";
import { revokeAllSessions } from "../auth/auth.service";
import { StaffRoleSchema, StaffUserSchema, normalizeEmail, toStaffDto } from "./staff.schemas";

const TAG = "Admin · Staff";
const note = " Requires role ADMIN. Writes need the `X-BP-Admin: 1` header.";
const idParam = t.Object({ id: t.String({ format: "uuid", description: "Staff user id" }) });

const emailField = t.String({ format: "email", maxLength: 254, description: "Login email (stored lower-case)" });
const passwordField = t.String({
  minLength: 1,
  maxLength: MAX_PASSWORD_LENGTH,
  description: "Temporary password, at least 12 characters. The user must change it at first login.",
});

export const staffAdminRoutes = new Elysia({ prefix: "/admin/users", tags: [TAG] })
  .use(staffGuard({ adminOnly: true }))
  .get(
    "",
    async () => {
      const users = await prisma.staffUser.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
      return { items: users.map(toStaffDto) };
    },
    {
      detail: { summary: "List staff", description: "All staff accounts, active first." + note },
      response: { 200: t.Object({ items: t.Array(StaffUserSchema) }), ...errorResponses(401, 403) },
    },
  )
  .post(
    "",
    async ({ staff, body, set }) => {
      const email = normalizeEmail(body.email);
      assertAcceptablePassword(body.password, email);
      if (await prisma.staffUser.findUnique({ where: { email }, select: { id: true } })) {
        throw AppError.invalid("Please fix 1 thing below.", [{ path: "email", message: "A staff member with this email already exists." }]);
      }
      const passwordHash = await hashPassword(body.password);
      const created = await prisma.$transaction(async (tx) => {
        const u = await tx.staffUser.create({
          data: { email, name: body.name.trim(), role: body.role, passwordHash, mustChangePassword: true },
        });
        await audit(tx, { actor: staff, action: "staff.create", entityType: "StaffUser", entityId: u.id, after: toStaffDto(u) });
        return u;
      });
      set.status = 201;
      return { user: toStaffDto(created) };
    },
    {
      body: t.Object({
        email: emailField,
        name: t.String({ minLength: 1, maxLength: 120, description: "Display name" }),
        role: StaffRoleSchema,
        password: passwordField,
      }),
      detail: { summary: "Create staff member", description: "Creates an account with a temporary password and `mustChangePassword = true`." + note },
      response: { 201: t.Object({ user: StaffUserSchema }, { description: "Created" }), ...errorResponses(401, 403, 422) },
    },
  )
  .get(
    "/:id",
    async ({ params }) => {
      const user = await prisma.staffUser.findUnique({ where: { id: params.id } });
      if (!user) throw AppError.notFound("Staff member not found.");
      return { user: toStaffDto(user) };
    },
    {
      params: idParam,
      detail: { summary: "Get staff member", description: "One staff account." + note },
      response: { 200: t.Object({ user: StaffUserSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .patch(
    "/:id",
    async ({ staff, params, body }) => {
      const before = await prisma.staffUser.findUnique({ where: { id: params.id } });
      if (!before) throw AppError.notFound("Staff member not found.");
      if (params.id === staff.id && (body.role !== undefined || body.isActive !== undefined)) {
        throw AppError.invalid("You cannot change your own role or active status.", [
          { path: body.role !== undefined ? "role" : "isActive", message: "Ask another ADMIN to change this." },
        ]);
      }
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.staffUser.update({
          where: { id: params.id },
          data: {
            ...(body.name !== undefined ? { name: body.name.trim() } : {}),
            ...(body.role !== undefined ? { role: body.role } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          },
        });
        await audit(tx, { actor: staff, action: "staff.update", entityType: "StaffUser", entityId: u.id, before: toStaffDto(before), after: toStaffDto(u) });
        return u;
      });
      // Deactivation and role changes take effect immediately.
      if (body.isActive === false || (body.role !== undefined && body.role !== before.role)) await revokeAllSessions(params.id);
      return { user: toStaffDto(updated) };
    },
    {
      params: idParam,
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        role: t.Optional(StaffRoleSchema),
        isActive: t.Optional(t.Boolean({ description: "false deactivates the account and ends its sessions" })),
      }),
      detail: {
        summary: "Update staff member",
        description:
          "Change name, role or active status. Role changes and deactivation end the user's sessions. An ADMIN cannot change their own role or active status." + note,
      },
      response: { 200: t.Object({ user: StaffUserSchema }), ...errorResponses(401, 403, 404, 422) },
    },
  )
  .post(
    "/:id/reset-password",
    async ({ staff, params, body }) => {
      const user = await prisma.staffUser.findUnique({ where: { id: params.id } });
      if (!user) throw AppError.notFound("Staff member not found.");
      assertAcceptablePassword(body.password, user.email);
      const passwordHash = await hashPassword(body.password);
      await prisma.$transaction(async (tx) => {
        await tx.staffUser.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
        await audit(tx, { actor: staff, action: "staff.reset_password", entityType: "StaffUser", entityId: user.id });
      });
      await revokeAllSessions(user.id);
      return { ok: true as const };
    },
    {
      params: idParam,
      body: t.Object({ password: passwordField }),
      detail: {
        summary: "Reset a staff member's password",
        description: "Sets a temporary password, clears any lockout, forces a change at next login and ends all their sessions." + note,
      },
      response: { 200: t.Object({ ok: t.Literal(true) }), ...errorResponses(401, 403, 404, 422) },
    },
  );
