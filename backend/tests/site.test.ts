import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { call } from "./helpers";
import { cleanup, createStaff, loginAs } from "./admin-helpers";

const emails: string[] = [];
afterAll(async () => {
  await prisma.siteSetting.deleteMany();
  await prisma.disclaimer.deleteMany();
  await cleanup(emails);
});

beforeEach(async () => {
  await prisma.siteSetting.deleteMany();
  await prisma.disclaimer.deleteMany();
  await redis.incr("cache:ver:site");
});

async function adminHeaders() {
  const a = await createStaff("ADMIN");
  emails.push(a.email);
  return loginAs(a.email);
}

describe("GET /site/config", () => {
  test("works on an empty database: nulls for contact, defaults, built-in disclaimers", async () => {
    const res = await call("/site/config");
    expect(res.status).toBe(200);
    const b = res.body as any;
    expect(b.brand.name).toBeNull();
    expect(b.contact.phone).toBeNull();
    expect(b.finder.freeResultsPerGroup).toBe(2);
    expect(b.disclaimers.NOT_GUARANTEED.version).toBe(0);
    expect(b.disclaimers.NOT_GUARANTEED.text).toContain("We do not guarantee rank or admission.");
    expect(Object.keys(b.disclaimers).sort()).toEqual(["ENQUIRY_CONSENT", "FOREIGN_COLLEGES_NMC", "NOT_GUARANTEED"]);
  });

  test("does not leak private settings", async () => {
    const h = await adminHeaders();
    await call("/admin/settings/enquiry.alertEmails", { method: "PUT", headers: h, json: { value: ["secret@counsellors.example"] } });
    const res = await call("/site/config");
    expect(res.text).not.toContain("secret@counsellors.example");
    expect(res.text).not.toContain("alertEmails");
  });

  test("sends ETag and answers 304 on a matching If-None-Match", async () => {
    const first = await call("/site/config");
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect(first.headers.get("cache-control")).toContain("max-age=60");
    const second = await call("/site/config", { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
  });

  test("a settings change shows up immediately (cache invalidated)", async () => {
    const h = await adminHeaders();
    expect(((await call("/site/config")).body as any).contact.phone).toBeNull();
    const put = await call("/admin/settings/contact.phone", { method: "PUT", headers: h, json: { value: "+91 98765 43210" } });
    expect(put.status).toBe(200);
    expect(((await call("/site/config")).body as any).contact.phone).toBe("+91 98765 43210");
  });
});

describe("settings admin", () => {
  test("validates values per key and rejects unknown keys", async () => {
    const h = await adminHeaders();
    const badType = await call("/admin/settings/finder.freeResultsPerGroup", { method: "PUT", headers: h, json: { value: "lots" } });
    expect(badType.status).toBe(422);
    expect((badType.body as any).error.fields[0].path).toBe("value");
    expect((await call("/admin/settings/finder.freeResultsPerGroup", { method: "PUT", headers: h, json: { value: 99 } })).status).toBe(422);
    expect((await call("/admin/settings/contact.email", { method: "PUT", headers: h, json: { value: "not-an-email" } })).status).toBe(422);
    expect((await call("/admin/settings/does.not.exist", { method: "PUT", headers: h, json: { value: 1 } })).status).toBe(404);
    expect((await call("/admin/settings/finder.freeResultsPerGroup", { method: "PUT", headers: h, json: {} })).status).toBe(422);
  });

  test("null clears a text setting; list shows isDefault; update is audited with before/after", async () => {
    const h = await adminHeaders();
    await call("/admin/settings/brand.name", { method: "PUT", headers: h, json: { value: "BrightPath" } });
    await call("/admin/settings/brand.name", { method: "PUT", headers: h, json: { value: null } });
    const list = (await call("/admin/settings", { headers: h })).body as any;
    const brand = list.items.find((i: any) => i.key === "brand.name");
    expect(brand.value).toBeNull();
    expect(list.items.find((i: any) => i.key === "finder.stretchPct").isDefault).toBe(true);

    const logs = ((await call("/admin/audit-logs?entityType=SiteSetting&entityId=brand.name", { headers: h })).body as any).items;
    expect(logs).toHaveLength(2);
    expect(logs[0].before).toEqual({ value: "BrightPath" }); // newest first
    expect(logs[0].after).toEqual({ value: null });
  });
});

describe("disclaimers", () => {
  test("publishing creates a new version, keeps history, updates the public config", async () => {
    const h = await adminHeaders();
    const text = "Estimates only. Admission is never guaranteed; confirm with the counselling authority.";
    const res = await call("/admin/disclaimers/NOT_GUARANTEED", { method: "PUT", headers: h, json: { text } });
    expect(res.status).toBe(200);
    expect((res.body as any).item).toMatchObject({ key: "NOT_GUARANTEED", version: 1, text, isBuiltIn: false });

    const text2 = text + " Fees can change without notice.";
    const second = await call("/admin/disclaimers/NOT_GUARANTEED", { method: "PUT", headers: h, json: { text: text2 } });
    expect((second.body as any).item.version).toBe(2);
    expect((second.body as any).item.history.map((v: any) => v.version)).toEqual([2, 1]);

    const pub = (await call("/site/config")).body as any;
    expect(pub.disclaimers.NOT_GUARANTEED).toEqual({ version: 2, text: text2 });
  });

  test("same text -> 409; unknown key -> 404; too short -> 422", async () => {
    const h = await adminHeaders();
    const current = ((await call("/admin/disclaimers", { headers: h })).body as any).items.find((i: any) => i.key === "NOT_GUARANTEED").text;
    expect((await call("/admin/disclaimers/NOT_GUARANTEED", { method: "PUT", headers: h, json: { text: current } })).status).toBe(409);
    expect((await call("/admin/disclaimers/NOPE", { method: "PUT", headers: h, json: { text: "A perfectly long enough text" } })).status).toBe(404);
    expect((await call("/admin/disclaimers/NOT_GUARANTEED", { method: "PUT", headers: h, json: { text: "short" } })).status).toBe(422);
  });
});

describe("audit log paging", () => {
  test("cursor pagination walks newest to oldest without gaps", async () => {
    const h = await adminHeaders();
    for (let i = 1; i <= 5; i++) await call("/admin/settings/finder.freeResultsPerGroup", { method: "PUT", headers: h, json: { value: i } });
    const p1 = (await call("/admin/audit-logs?entityId=finder.freeResultsPerGroup&limit=2", { headers: h })).body as any;
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await call(`/admin/audit-logs?entityId=finder.freeResultsPerGroup&limit=2&cursor=${p1.nextCursor}`, { headers: h })).body as any;
    const p3 = (await call(`/admin/audit-logs?entityId=finder.freeResultsPerGroup&limit=2&cursor=${p2.nextCursor}`, { headers: h })).body as any;
    const values = [...p1.items, ...p2.items, ...p3.items].map((i: any) => i.after.value);
    expect(values).toEqual([5, 4, 3, 2, 1]);
    expect(p3.nextCursor).toBeNull();
  });
});

describe("audit log with blank filters (Apidog-style)", () => {
  test("?entityType=&entityId=&actorId=&action=&limit=&cursor= behaves like no filters", async () => {
    const h = await adminHeaders();
    const res = await call("/admin/audit-logs?entityType=&entityId=&actorId=&action=&limit=&cursor=", { headers: h });
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as any).items)).toBe(true);
    expect((res.body as any).items.length).toBeGreaterThan(0);
  });
});
