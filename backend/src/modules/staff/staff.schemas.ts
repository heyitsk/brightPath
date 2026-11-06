import { t } from "elysia";
import type { StaffUser } from "../../generated/prisma/client";

export const StaffRoleSchema = t.Union([t.Literal("ADMIN"), t.Literal("EDITOR"), t.Literal("COUNSELLOR")], {
  description:
    "ADMIN: everything including users and settings. EDITOR: colleges, ranks, content and imports. COUNSELLOR: enquiries only.",
  examples: ["EDITOR"],
});

export const StaffUserSchema = t.Object(
  {
    id: t.String({ format: "uuid", description: "Staff user id" }),
    email: t.String({ format: "email", description: "Login email, always lower-case" }),
    name: t.String({ description: "Display name" }),
    role: StaffRoleSchema,
    isActive: t.Boolean({ description: "Inactive users cannot log in and their sessions are revoked" }),
    mustChangePassword: t.Boolean({
      description: "True after an admin created the account or reset the password. Only change-password, me and logout work until it is cleared.",
    }),
    lastLoginAt: t.Union([t.String({ format: "date-time" }), t.Null()], { description: "Last successful login" }),
    createdAt: t.String({ format: "date-time" }),
  },
  { description: "A staff member who can use the admin API" },
);

type StaffRow = Pick<StaffUser, "id" | "email" | "name" | "role" | "isActive" | "mustChangePassword" | "lastLoginAt" | "createdAt">;

export const toStaffDto = (u: StaffRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
