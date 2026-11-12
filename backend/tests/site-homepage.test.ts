import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { invalidate } from "../src/lib/cache";
import { prisma } from "../src/lib/prisma";
import { publicAnnouncement, stripId, stripStatus, type StripValues } from "../src/modules/site/site.homepage";
import { call } from "./helpers";
import { cleanup, createStaff, loginAs } from "./admin-helpers";

const emails: string[] = [];

async function reset() {
  await prisma.siteSetting.deleteMany({ where: { OR: [{ key: { startsWith: "hero." } }, { key: { startsWith: "announcement." } }] } });
  await invalidate("site");
}
beforeEach(reset);
afterAll(async () => {
  await reset();
  await cleanup(emails);
});

type H = Record<string, string>;
async function as(role: "ADMIN" | "EDITOR" = "ADMIN"): Promise<H> {
  const u = await createStaff(role);
  emails.push(u.email);
  return loginAs(u.email);
}
const body = (r: { body: unknown }) => r.body as any;
const fieldPaths = (r: { body: unknown }): string[] => ((r.body as any).error.fields ?? []).map((f: any) => f.path);
const patch = (h: H, json: unknown) => call("/admin/site/homepage", { method: "PATCH", headers: h, json });
const publicConfig = async () => body(await call("/site/config"));
const hoursFromNow = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const auditCount = (key: string) => prisma.auditLog.count({ where: { action: "setting.update", entityId: key } });

const strip = (over: Partial<StripValues> = {}): StripValues => ({ text: "Counselling starts soon", linkLabel: null, linkUrl: null, isActive: true, showFrom: null, showUntil: null, ...over });
const NOW = new Date("2026-12-10T12:00:00Z");

describe("the strip's rules (pure)", () => {
  test("status: off, empty, scheduled, live, expired", () => {
    expect(stripStatus(strip({ isActive: false }), NOW)).toBe("OFF");
    expect(stripStatus(strip({ isActive: false, text: null }), NOW)).toBe("OFF");
    expect(stripStatus(strip({ text: null }), NOW)).toBe("EMPTY");
    expect(stripStatus(strip({ showFrom: "2026-12-11T00:00:00Z" }), NOW)).toBe("SCHEDULED");
    expect(stripStatus(strip({ showFrom: "2026-12-10T12:00:00Z" }), NOW)).toBe("LIVE"); // the start moment itself is live
    expect(stripStatus(strip({ showFrom: "2026-12-01T00:00:00Z", showUntil: "2026-12-20T00:00:00Z" }), NOW)).toBe("LIVE");
    expect(stripStatus(strip({ showUntil: "2026-12-10T12:00:00Z" }), NOW)).toBe("EXPIRED"); // the end moment itself is over
    expect(stripStatus(strip({ showUntil: "2026-12-01T00:00:00Z" }), NOW)).toBe("EXPIRED");
  });

  test("the id changes with the wording or the link, not with the schedule or the switch", () => {
    const a = stripId(strip());
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(stripId(strip({ text: "Counselling starts tomorrow" }))).not.toBe(a);
    expect(stripId(strip({ linkLabel: "Know more", linkUrl: "/x" }))).not.toBe(a);
    expect(stripId(strip({ showUntil: "2026-12-31T00:00:00Z", isActive: false }))).toBe(a);
    expect(stripId(strip({ text: null }))).toBeNull();
  });

  test("the public strip appears only while live, and a link only when both its text and address exist", () => {
    expect(publicAnnouncement(strip({ isActive: false }), NOW)).toBeNull();
    expect(publicAnnouncement(strip({ showUntil: "2026-12-01T00:00:00Z" }), NOW)).toBeNull();
    expect(publicAnnouncement(strip(), NOW)).toEqual({ id: stripId(strip())!, text: "Counselling starts soon", linkLabel: null, linkUrl: null });
    expect(publicAnnouncement(strip({ linkLabel: "Know more", linkUrl: "/neet" }), NOW)).toMatchObject({ linkLabel: "Know more", linkUrl: "/neet" });
    expect(publicAnnouncement(strip({ linkLabel: "Know more" }), NOW)).toMatchObject({ linkLabel: null, linkUrl: null });
    expect(publicAnnouncement(strip({ linkUrl: "/neet" }), NOW)).toMatchObject({ linkLabel: null, linkUrl: null });
  });
});

describe("access", () => {
  test("only an ADMIN may read or change the homepage text; the CSRF header is needed to write", async () => {
    expect((await call("/admin/site/homepage")).status).toBe(401);
    expect((await call("/admin/site/homepage", { headers: await as("EDITOR") })).status).toBe(403);
    expect((await patch(await as("EDITOR"), { hero: { headline: "x" } })).status).toBe(403);
    const admin = await as();
    const { "x-bp-admin": _drop, ...readOnly } = admin;
    expect((await patch(readOnly, { hero: { headline: "x" } })).status).toBe(403);
    expect((await call("/admin/site/homepage", { headers: admin })).status).toBe(200);
  });
});

describe("starting state", () => {
  test("nothing is set: the built-in hero text is used and there is no strip", async () => {
    const h = await as();
    expect(body(await call("/admin/site/homepage", { headers: h }))).toEqual({
      hero: { headline: null, subtext: null },
      announcement: { text: null, linkLabel: null, linkUrl: null, isActive: false, showFrom: null, showUntil: null, status: "OFF", id: null },
    });
    const cfg = await publicConfig();
    expect(cfg.hero).toEqual({ headline: null, subtext: null });
    expect(cfg.announcement).toBeNull();
  });
});

describe("hero text", () => {
  test("is set, trimmed, shown on the public site at once, and cleared with empty text or null", async () => {
    const h = await as();
    const r = await patch(h, { hero: { headline: "  Your MBBS journey, made clear  ", subtext: "Plan your NEET counselling." } });
    expect(r.status).toBe(200);
    expect(body(r).hero).toEqual({ headline: "Your MBBS journey, made clear", subtext: "Plan your NEET counselling." });
    expect((await publicConfig()).hero).toEqual({ headline: "Your MBBS journey, made clear", subtext: "Plan your NEET counselling." });

    await patch(h, { hero: { subtext: "   " } });
    expect((await publicConfig()).hero).toEqual({ headline: "Your MBBS journey, made clear", subtext: null });
    await patch(h, { hero: { headline: null } });
    expect((await publicConfig()).hero).toEqual({ headline: null, subtext: null });
  });

  test("length limits are explained in words", async () => {
    const h = await as();
    const long = await patch(h, { hero: { headline: "x".repeat(121) } });
    expect([long.status, fieldPaths(long)]).toEqual([422, ["hero.headline"]]);
    const long2 = await patch(h, { hero: { subtext: "x".repeat(301) } });
    expect(long2.status).toBe(422);
    expect((await patch(h, { hero: { headline: "x".repeat(120) } })).status).toBe(200);
  });
});

describe("announcement strip", () => {
  test("switching it on with text shows it publicly; its id changes when the wording changes; switching off hides it but keeps the text", async () => {
    const h = await as();
    const on = await patch(h, { announcement: { text: "  NEET counselling dates announced  ", linkLabel: "Know more", linkUrl: "/neet-rank-predictor", isActive: true } });
    expect(on.status).toBe(200);
    expect(body(on).announcement).toMatchObject({ text: "NEET counselling dates announced", linkLabel: "Know more", linkUrl: "/neet-rank-predictor", isActive: true, status: "LIVE" });
    const cfg = await publicConfig();
    expect(cfg.announcement).toEqual({ id: body(on).announcement.id, text: "NEET counselling dates announced", linkLabel: "Know more", linkUrl: "/neet-rank-predictor" });

    const reworded = await patch(h, { announcement: { text: "NEET counselling dates announced today" } });
    expect(body(reworded).announcement.id).not.toBe(body(on).announcement.id);
    expect((await publicConfig()).announcement.id).toBe(body(reworded).announcement.id);

    const off = await patch(h, { announcement: { isActive: false } });
    expect(body(off).announcement).toMatchObject({ isActive: false, status: "OFF", text: "NEET counselling dates announced today" });
    expect((await publicConfig()).announcement).toBeNull();

    const back = await patch(h, { announcement: { isActive: true } }); // nothing to retype
    expect(body(back).announcement.status).toBe("LIVE");
    expect((await publicConfig()).announcement.text).toBe("NEET counselling dates announced today");
  });

  test("a full web address is accepted as a link, as is a path on this site", async () => {
    const h = await as();
    expect((await patch(h, { announcement: { text: "Hi", linkLabel: "Go", linkUrl: "https://www.nmc.org.in/notice", isActive: true } })).status).toBe(200);
    expect((await publicConfig()).announcement.linkUrl).toBe("https://www.nmc.org.in/notice");
    expect((await patch(h, { announcement: { linkUrl: "/colleges?country=russia" } })).status).toBe(200);
  });

  test("it can be scheduled: waiting for its start, live inside the window, gone after the end", async () => {
    const h = await as();
    const later = await patch(h, { announcement: { text: "Coming up", isActive: true, showFrom: hoursFromNow(2), showUntil: hoursFromNow(5) } });
    expect(body(later).announcement.status).toBe("SCHEDULED");
    expect((await publicConfig()).announcement).toBeNull();

    const now = await patch(h, { announcement: { showFrom: hoursFromNow(-1), showUntil: hoursFromNow(1) } });
    expect(body(now).announcement.status).toBe("LIVE");
    expect((await publicConfig()).announcement.text).toBe("Coming up");

    const over = await patch(h, { announcement: { showFrom: hoursFromNow(-5), showUntil: hoursFromNow(-1) } });
    expect(body(over).announcement.status).toBe("EXPIRED");
    expect((await publicConfig()).announcement).toBeNull();

    const open = await patch(h, { announcement: { showFrom: null, showUntil: null } });
    expect(body(open).announcement.status).toBe("LIVE");
  });

  test("the rules between fields are checked, each error naming its field", async () => {
    const h = await as();
    const noText = await patch(h, { announcement: { isActive: true } });
    expect([noText.status, fieldPaths(noText)]).toEqual([422, ["announcement.text"]]);
    expect(body(noText).error.fields[0].message).toBe("Write the announcement text before turning the strip on.");

    await patch(h, { announcement: { text: "Hello" } });
    const labelOnly = await patch(h, { announcement: { linkLabel: "Know more" } });
    expect(fieldPaths(labelOnly)).toEqual(["announcement.linkUrl"]);
    const urlOnly = await patch(h, { announcement: { linkUrl: "/neet" } });
    expect(fieldPaths(urlOnly)).toEqual(["announcement.linkLabel"]);
    const backwards = await patch(h, { announcement: { showFrom: hoursFromNow(5), showUntil: hoursFromNow(2) } });
    expect(fieldPaths(backwards)).toEqual(["announcement.showUntil"]);
    const equal = hoursFromNow(5);
    expect(fieldPaths(await patch(h, { announcement: { showFrom: equal, showUntil: equal } }))).toEqual(["announcement.showUntil"]);

    const several = await patch(h, { announcement: { isActive: true, text: null, linkLabel: "x" } });
    expect(fieldPaths(several).sort()).toEqual(["announcement.linkUrl", "announcement.text"]);
  });

  test("unsafe or odd link addresses are refused with a plain-words reason", async () => {
    const h = await as();
    for (const linkUrl of ["javascript:alert(1)", "//evil.example.com", "ftp://files.example.com", "neet-rank-predictor", "/has space", "data:text/html,hi"]) {
      const r = await patch(h, { announcement: { text: "Hi", linkLabel: "Go", linkUrl } });
      expect([linkUrl, r.status, fieldPaths(r)]).toEqual([linkUrl, 422, ["announcement.linkUrl"]]);
    }
    const r = await patch(h, { announcement: { linkUrl: "javascript:alert(1)", linkLabel: "Go" } });
    expect(body(r).error.fields[0].message).toContain("starting with http:// or https://, or a path on this site starting with a single /");
    expect((await patch(h, { announcement: { showFrom: "tomorrow" } })).status).toBe(422);
    expect((await patch(h, { announcement: { text: "x".repeat(201) } })).status).toBe(422);
    expect((await patch(h, { announcement: { linkLabel: "x".repeat(41), linkUrl: "/a" } })).status).toBe(422);
  });
});

describe("saving behaviour", () => {
  test("all or nothing: a valid hero change is not saved when the strip part is refused", async () => {
    const h = await as();
    const r = await patch(h, { hero: { headline: "Should not be saved" }, announcement: { isActive: true } });
    expect(r.status).toBe(422);
    expect((await publicConfig()).hero.headline).toBeNull();
    expect(await prisma.siteSetting.count({ where: { key: "hero.headline" } })).toBe(0);
  });

  test("nothing to change, or an unknown field, is refused; sending the same values again changes and audits nothing", async () => {
    const h = await as();
    expect((await patch(h, {})).status).toBe(422);
    expect((await patch(h, { hero: {} })).status).toBe(422);
    const typo = await patch(h, { announcement: { txt: "Hello" } });
    expect([typo.status, fieldPaths(typo)]).toEqual([422, ["announcement.txt"]]);
    expect(fieldPaths(await patch(h, { banner: { text: "x" } }))).toEqual(["banner"]);

    await patch(h, { hero: { headline: "Same" } });
    const before = await auditCount("hero.headline");
    const again = await patch(h, { hero: { headline: "Same" } });
    expect(again.status).toBe(200);
    expect(await auditCount("hero.headline")).toBe(before);
  });

  test("each changed field is audited with its old and new value", async () => {
    const h = await as();
    await patch(h, { hero: { headline: "First" } });
    await patch(h, { hero: { headline: "Second" } });
    const rows = await prisma.auditLog.findMany({ where: { action: "setting.update", entityId: "hero.headline" }, orderBy: { at: "desc" }, take: 2 });
    expect(rows[0]!.before).toEqual({ value: "First" });
    expect(rows[0]!.after).toEqual({ value: "Second" });
    expect(rows[1]!.before).toEqual({ value: null });
  });

  test("a hero-only edit is not blocked by a half-finished strip set through the generic settings screen", async () => {
    const h = await as();
    expect((await call("/admin/settings/announcement.isActive", { method: "PUT", headers: h, json: { value: true } })).status).toBe(200); // on, with no text
    const state = body(await call("/admin/site/homepage", { headers: h }));
    expect(state.announcement).toMatchObject({ isActive: true, text: null, status: "EMPTY" });
    expect((await publicConfig()).announcement).toBeNull();
    expect((await patch(h, { hero: { headline: "Still works" } })).status).toBe(200);
    expect((await patch(h, { announcement: { text: "Now it has text" } })).status).toBe(200);
    expect(body(await call("/admin/site/homepage", { headers: h })).announcement.status).toBe("LIVE");
  });
});

describe("the generic settings screen sees the same keys", () => {
  test("they are listed as public settings and refuse bad values in plain words", async () => {
    const h = await as();
    const list = body(await call("/admin/settings", { headers: h })).items as Array<{ key: string; isPublic: boolean }>;
    for (const key of ["hero.headline", "hero.subtext", "announcement.text", "announcement.linkLabel", "announcement.linkUrl", "announcement.isActive", "announcement.showFrom", "announcement.showUntil"]) {
      expect(list.find((s) => s.key === key)).toMatchObject({ isPublic: true });
    }
    const bad = await call("/admin/settings/announcement.isActive", { method: "PUT", headers: h, json: { value: "yes" } });
    expect(bad.status).toBe(422);
    const badUrl = await call("/admin/settings/announcement.linkUrl", { method: "PUT", headers: h, json: { value: "javascript:alert(1)" } });
    expect(body(badUrl).error.fields[0].message).toContain("a full web address starting with http:// or https://, or a path on this site");
    expect((await call("/admin/settings/hero.headline", { method: "PUT", headers: h, json: { value: "Via generic route" } })).status).toBe(200);
    expect((await publicConfig()).hero.headline).toBe("Via generic route");
  });
});
