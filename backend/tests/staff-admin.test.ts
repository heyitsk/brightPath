import { afterAll, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { call } from "./helpers";
import { GOOD_PASSWORD, WRITE, cleanup, createStaff, loginAs, uniqueEmail } from "./admin-helpers";

const emails: string[] = [];
afterAll(async () => {
  await cleanup(emails);
});

async function admin() {
  const a = await createStaff("ADMIN");
  emails.push(a.email);
  return { ...a, headers: await loginAs(a.email) };
}

describe("role matrix on admin routes", () => {
  const routes: Array<{ method: string; path: string; body?: unknown; label: string }> = [
    { method: "GET", path: "/admin/users", label: "list staff" },
    { method: "GET", path: "/admin/settings", label: "list settings" },
    { method: "GET", path: "/admin/disclaimers", label: "list disclaimers" },
    { method: "GET", path: "/admin/audit-logs", label: "audit log" },
  ];

  for (const role of ["EDITOR", "COUNSELLOR"] as const) {
    test(`${role} gets 403 on every ADMIN-only route`, async () => {
      const u = await createStaff(role);
      emails.push(u.email);
      const h = await loginAs(u.email);
      for (const r of routes) {
        const res = await call(r.path, { method: r.method, headers: h });
        expect(res.status, r.label).toBe(403);
        expect((res.body as any).error.code).toBe("FORBIDDEN");
      }
    });
  }

  test("anonymous gets 401 on every admin route", async () => {
    for (const r of routes) expect((await call(r.path, { method: r.method })).status, r.label).toBe(401);
  });

  test("ADMIN can reach them all", async () => {
    const a = await admin();
    for (const r of routes) expect((await call(r.path, { method: r.method, headers: a.headers })).status, r.label).toBe(200);
  });

  test("writes without X-BP-Admin are refused even for a logged-in ADMIN", async () => {
    const a = await admin();
    const { "x-bp-admin": _omit, ...cookieOnly } = a.headers;
    const res = await call("/admin/users", { method: "POST", headers: cookieOnly, json: { email: uniqueEmail(), name: "X", role: "EDITOR", password: GOOD_PASSWORD } });
    expect(res.status).toBe(403);
  });
});

describe("staff management", () => {
  test("create -> mustChangePassword, audited, new user can log in; duplicate email -> 422", async () => {
    const a = await admin();
    const email = uniqueEmail("newbie");
    emails.push(email);
    const res = await call("/admin/users", { method: "POST", headers: a.headers, json: { email: email.toUpperCase(), name: "  New Person ", role: "COUNSELLOR", password: "temporary-pass-123" } });
    expect(res.status).toBe(201);
    expect((res.body as any).user).toMatchObject({ email, name: "New Person", role: "COUNSELLOR", mustChangePassword: true, isActive: true });

    const logs = await call(`/admin/audit-logs?entityType=StaffUser&entityId=${(res.body as any).user.id}`, { headers: a.headers });
    const entry = (logs.body as any).items.find((i: any) => i.action === "staff.create");
    expect(entry.actorEmail).toBe(a.email);
    expect(JSON.stringify(entry)).not.toMatch(/passwordHash|temporary-pass/);

    expect((await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email, password: "temporary-pass-123" } })).status).toBe(200);

    const dup = await call("/admin/users", { method: "POST", headers: a.headers, json: { email, name: "Dup", role: "EDITOR", password: "temporary-pass-123" } });
    expect(dup.status).toBe(422);
    expect((dup.body as any).error.fields[0].path).toBe("email");
  });

  test("weak temporary password -> 422 on password", async () => {
    const a = await admin();
    const res = await call("/admin/users", { method: "POST", headers: a.headers, json: { email: uniqueEmail(), name: "X", role: "EDITOR", password: "short" } });
    expect(res.status).toBe(422);
    expect((res.body as any).error.fields[0].path).toBe("password");
  });

  test("changing role or deactivating ends the user's sessions; admins cannot change themselves", async () => {
    const a = await admin();
    const target = await createStaff("EDITOR");
    emails.push(target.email);
    const targetHeaders = await loginAs(target.email);

    const promote = await call(`/admin/users/${target.user.id}`, { method: "PATCH", headers: a.headers, json: { role: "COUNSELLOR" } });
    expect(promote.status).toBe(200);
    expect((promote.body as any).user.role).toBe("COUNSELLOR");
    expect((await call("/admin/auth/me", { headers: targetHeaders })).status).toBe(401); // session ended

    const self = await call(`/admin/users/${a.user.id}`, { method: "PATCH", headers: a.headers, json: { isActive: false } });
    expect(self.status).toBe(422);
    const selfRename = await call(`/admin/users/${a.user.id}`, { method: "PATCH", headers: a.headers, json: { name: "Renamed Admin" } });
    expect(selfRename.status).toBe(200);

    const deact = await call(`/admin/users/${target.user.id}`, { method: "PATCH", headers: a.headers, json: { isActive: false } });
    expect((deact.body as any).user.isActive).toBe(false);
    expect((await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email: target.email, password: target.password } })).status).toBe(401);
  });

  test("reset-password forces a change, clears lockout, ends sessions", async () => {
    const a = await admin();
    const target = await createStaff("EDITOR");
    emails.push(target.email);
    const oldSession = await loginAs(target.email);
    await prisma.staffUser.update({ where: { id: target.user.id }, data: { lockedUntil: new Date(Date.now() + 600_000), failedLogins: 3 } });

    const res = await call(`/admin/users/${target.user.id}/reset-password`, { method: "POST", headers: a.headers, json: { password: "reset-temp-passphrase" } });
    expect(res.status).toBe(200);
    expect((await call("/admin/auth/me", { headers: oldSession })).status).toBe(401);
    const fresh = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email: target.email, password: "reset-temp-passphrase" } });
    expect(fresh.status).toBe(200);
    expect((fresh.body as any).user.mustChangePassword).toBe(true);
  });

  test("unknown id -> 404, malformed id -> 422", async () => {
    const a = await admin();
    expect((await call("/admin/users/018f0000-0000-7000-8000-000000000000", { headers: a.headers })).status).toBe(404);
    expect((await call("/admin/users/not-a-uuid", { headers: a.headers })).status).toBe(422);
  });
});
