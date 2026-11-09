import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { invalidate } from "../src/lib/cache";
import { prisma } from "../src/lib/prisma";
import { app } from "../src/app";
import { GOOD_PASSWORD, WRITE, cleanup, createStaff } from "./admin-helpers";

// Every other test calls `app.handle()`, which never goes through Bun.serve. Elysia 1.4.31 broke
// numeric path params (t.Integer / t.Numeric) ONLY on a real server (500 "Attempting to change
// configurable attribute of unconfigurable property"), and in-process tests could not see it.
// These tests start a real listener and use real fetch(). See history.md.

let base = "";
const emails: string[] = [];

async function wipe() {
  await prisma.neetExamYear.deleteMany();
  await prisma.source.deleteMany();
  await invalidate("neet");
}

beforeAll(async () => {
  await wipe();
  app.listen(0); // any free port
  base = `http://localhost:${app.server!.port}`;
});

afterAll(async () => {
  await wipe();
  await cleanup(emails);
  await app.stop();
});

describe("numeric path params on a real server", () => {
  test("GET/PATCH /admin/neet/years/:year work over real HTTP", async () => {
    const u = await createStaff("ADMIN");
    emails.push(u.email);

    const login = await fetch(`${base}/admin/auth/login`, {
      method: "POST",
      headers: { ...WRITE, "content-type": "application/json" },
      body: JSON.stringify({ email: u.email, password: GOOD_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const h = { ...WRITE, cookie: (login.headers.get("set-cookie") ?? "").split(";")[0]! };

    const source = await prisma.source.create({ data: { kind: "NTA", title: "NEET (UG) result notice", publisher: "National Testing Agency", url: "https://exams.nta.ac.in/NEET/" } });
    const created = await fetch(`${base}/admin/neet/years`, {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify({ year: 2024, appeared: 100, sourceId: source.id, checkedAt: new Date().toISOString() }),
    });
    expect(created.status).toBe(201);

    const get = await fetch(`${base}/admin/neet/years/2024`, { headers: h });
    expect(get.status).toBe(200);
    expect(((await get.json()) as any).examYear.year).toBe(2024);

    const patch = await fetch(`${base}/admin/neet/years/2024`, {
      method: "PATCH",
      headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify({ appeared: 120 }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as any).examYear.appeared).toBe(120);

    // a non-numeric / out-of-range year is a validation error, never a 500
    expect((await fetch(`${base}/admin/neet/years/abc`, { headers: h })).status).toBe(422);
    expect((await fetch(`${base}/admin/neet/years/1900`, { headers: h })).status).toBe(422);
  });
});
