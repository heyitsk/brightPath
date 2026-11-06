import { afterAll, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { call } from "./helpers";
import { GOOD_PASSWORD, WRITE, cleanup, createStaff, loginAs, uniqueEmail } from "./admin-helpers";

const emails: string[] = [];
afterAll(async () => {
  await cleanup(emails);
});

describe("login", () => {
  test("succeeds, sets an httpOnly SameSite cookie, and /me works with it", async () => {
    const { email } = await createStaff("EDITOR");
    emails.push(email);
    const res = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email: email.toUpperCase(), password: GOOD_PASSWORD } });
    expect(res.status).toBe(200);
    expect((res.body as any).user).toMatchObject({ email, role: "EDITOR", isActive: true });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("bp_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const me = await call("/admin/auth/me", { headers: { cookie: cookie.split(";")[0]! } });
    expect(me.status).toBe(200);
    expect((me.body as any).user.email).toBe(email);
  });

  test("wrong password and unknown email give the same 401 message", async () => {
    const { email } = await createStaff("EDITOR");
    emails.push(email);
    const wrong = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email, password: "nope-nope-nope" } });
    const unknown = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email: uniqueEmail("ghost"), password: "nope-nope-nope" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((wrong.body as any).error.message).toBe((unknown.body as any).error.message);
  });

  test("inactive account cannot log in and gets the generic message", async () => {
    const { email, password } = await createStaff("EDITOR", { isActive: false });
    emails.push(email);
    const res = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email, password } });
    expect(res.status).toBe(401);
    expect((res.body as any).error.message).toBe("Email or password is incorrect.");
  });

  test("5 wrong passwords lock the account, even for the right password", async () => {
    const { email, password } = await createStaff("EDITOR");
    emails.push(email);
    for (let i = 0; i < 5; i++) {
      const r = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email, password: "wrong-wrong-wrong" } });
      expect(r.status).toBe(401);
    }
    const locked = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email, password } });
    expect(locked.status).toBe(429);
    expect((locked.body as any).error.message).toContain("Try again in");
    expect(locked.headers.get("retry-after")).toBeTruthy();
  });

  test("login without the X-BP-Admin header is rejected (CSRF), as is a foreign Origin", async () => {
    const { email, password } = await createStaff("EDITOR");
    emails.push(email);
    const noHeader = await call("/admin/auth/login", { method: "POST", json: { email, password } });
    expect(noHeader.status).toBe(403);
    const badOrigin = await call("/admin/auth/login", { method: "POST", headers: { ...WRITE, origin: "https://evil.example" }, json: { email, password } });
    expect(badOrigin.status).toBe(403);
  });

  test("invalid email format -> 422 with a field error", async () => {
    const res = await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email: "not-an-email", password: "x" } });
    expect(res.status).toBe(422);
    expect((res.body as any).error.fields[0].path).toBe("email");
  });
});

describe("sessions", () => {
  test("no cookie -> 401; garbage cookie -> 401; the 401 beats body validation", async () => {
    expect((await call("/admin/auth/me")).status).toBe(401);
    expect((await call("/admin/auth/me", { headers: { cookie: "bp_session=garbage" } })).status).toBe(401);
    const anonBadBody = await call("/admin/users", { method: "POST", headers: WRITE, json: { nonsense: true } });
    expect(anonBadBody.status).toBe(401);
  });

  test("logout ends the session", async () => {
    const { email } = await createStaff("EDITOR");
    emails.push(email);
    const h = await loginAs(email);
    expect((await call("/admin/auth/me", { headers: h })).status).toBe(200);
    expect((await call("/admin/auth/logout", { method: "POST", headers: h })).status).toBe(200);
    expect((await call("/admin/auth/me", { headers: h })).status).toBe(401);
  });

  test("expired session is rejected", async () => {
    const { email, user } = await createStaff("EDITOR");
    emails.push(email);
    const h = await loginAs(email);
    await prisma.staffSession.updateMany({ where: { staffUserId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call("/admin/auth/me", { headers: h })).status).toBe(401);
  });

  test("deactivating a user kills their session immediately", async () => {
    const { email, user } = await createStaff("EDITOR");
    emails.push(email);
    const h = await loginAs(email);
    await prisma.staffUser.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await call("/admin/auth/me", { headers: h })).status).toBe(401);
  });

  test("session token is stored hashed, never in clear", async () => {
    const { email, user } = await createStaff("EDITOR");
    emails.push(email);
    const h = await loginAs(email);
    const token = decodeURIComponent(h.cookie!.split("=")[1]!);
    const rows = await prisma.staffSession.findMany({ where: { staffUserId: user.id } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toHaveLength(64);
  });
});

describe("change password and forced change", () => {
  test("mustChangePassword blocks other routes until the password is changed", async () => {
    const { email, password } = await createStaff("ADMIN", { mustChangePassword: true });
    emails.push(email);
    const h = await loginAs(email, password);
    const blocked = await call("/admin/users", { headers: h });
    expect(blocked.status).toBe(403);
    expect((blocked.body as any).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await call("/admin/auth/me", { headers: h })).status).toBe(200);

    const changed = await call("/admin/auth/change-password", { method: "POST", headers: h, json: { currentPassword: password, newPassword: "a-brand-new-passphrase" } });
    expect(changed.status).toBe(200);
    expect((await call("/admin/users", { headers: h })).status).toBe(200);
    // new password works, old does not
    expect((await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email, password } })).status).toBe(401);
    expect((await call("/admin/auth/login", { method: "POST", headers: WRITE, json: { email, password: "a-brand-new-passphrase" } })).status).toBe(200);
  });

  test("rejects a wrong current password and weak new passwords with field errors", async () => {
    const { email, password } = await createStaff("EDITOR");
    emails.push(email);
    const h = await loginAs(email, password);
    const wrong = await call("/admin/auth/change-password", { method: "POST", headers: h, json: { currentPassword: "nope", newPassword: "a-brand-new-passphrase" } });
    expect(wrong.status).toBe(422);
    expect((wrong.body as any).error.fields[0].path).toBe("currentPassword");
    const short = await call("/admin/auth/change-password", { method: "POST", headers: h, json: { currentPassword: password, newPassword: "short" } });
    expect(short.status).toBe(422);
    expect((short.body as any).error.fields[0].path).toBe("newPassword");
    const sameAsEmail = await call("/admin/auth/change-password", { method: "POST", headers: h, json: { currentPassword: password, newPassword: `${email.split("@")[0]}-xx-yy` } });
    expect(sameAsEmail.status).toBe(422);
  });

  test("changing the password ends the user's other sessions but keeps this one", async () => {
    const { email, password } = await createStaff("EDITOR");
    emails.push(email);
    const a = await loginAs(email, password);
    const b = await loginAs(email, password);
    const res = await call("/admin/auth/change-password", { method: "POST", headers: a, json: { currentPassword: password, newPassword: "yet-another-passphrase" } });
    expect(res.status).toBe(200);
    expect((await call("/admin/auth/me", { headers: a })).status).toBe(200);
    expect((await call("/admin/auth/me", { headers: b })).status).toBe(401);
  });
});
