import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/modules/auth/password";
import { call } from "./helpers";

export const GOOD_PASSWORD = "correct-horse-battery";
export const WRITE = { "x-bp-admin": "1" } as const;

let counter = 0;
export const uniqueEmail = (prefix = "user") => `${prefix}-${Date.now()}-${counter++}@test.example`;

export async function createStaff(role: "ADMIN" | "EDITOR" | "COUNSELLOR", opts: { mustChangePassword?: boolean; isActive?: boolean } = {}) {
  const email = uniqueEmail(role.toLowerCase());
  const user = await prisma.staffUser.create({
    data: {
      email,
      name: `Test ${role}`,
      role,
      passwordHash: await hashPassword(GOOD_PASSWORD),
      mustChangePassword: opts.mustChangePassword ?? false,
      isActive: opts.isActive ?? true,
    },
  });
  return { user, email, password: GOOD_PASSWORD };
}

/** Logs in and returns headers (cookie + CSRF header) to use on later calls. */
export async function loginAs(email: string, password = GOOD_PASSWORD) {
  const res = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email, password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { ...WRITE, cookie } as Record<string, string>;
}

export async function cleanup(emails: string[]) {
  await prisma.auditLog.deleteMany({ where: { actorEmail: { in: emails } } });
  await prisma.staffUser.deleteMany({ where: { email: { in: emails } } });
}
