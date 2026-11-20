// Rewrites tests/fixtures/news/expected.json from the saved pages and the settings in prisma/seed/news.ts.
// Run it ONLY after changing a site's settings on purpose, then read the diff: it is the list of notices
// the tests will expect from now on.   bun run news:golden
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { HTML_SETUP, NEWS_SOURCES } from "../prisma/seed/news";
import { adapterFor } from "../src/modules/news/adapters";

export const FIXTURE_DIR = new URL("../tests/fixtures/news/", import.meta.url).pathname;
export const FIXTURE_NOW = new Date("2026-11-21T10:00:00Z");

export function fixtureKind(slug: string) {
  return HTML_SETUP[slug]?.kind ?? NEWS_SOURCES.find((s) => s.slug === slug)!.kind;
}
/** The saved page (HTML) or saved answer (JSON) of a source. */
export const fixturePath = (slug: string) => `${FIXTURE_DIR}${slug}.${fixtureKind(slug) === "JSON_LIST" ? "json" : "html"}`;

export function readFixture(slug: string) {
  const setup = HTML_SETUP[slug]!;
  const source = NEWS_SOURCES.find((s) => s.slug === slug)!;
  const url = setup.listUrl ?? source.listUrl;
  const body = readFileSync(fixturePath(slug), "utf8");
  return adapterFor(fixtureKind(slug))!({ body, url, config: setup.config, now: FIXTURE_NOW });
}

export function snapshot(slug: string) {
  const items = readFixture(slug);
  return {
    count: items.length,
    dated: items.filter((i) => i.sourcePublishedAt).length,
    first: items.slice(0, 3).map((i) => ({ title: i.title, url: i.url, date: i.sourcePublishedAt?.toISOString().slice(0, 10) ?? null })),
    last: { title: items.at(-1)!.title, url: items.at(-1)!.url },
  };
}

if (import.meta.main) {
  const out: Record<string, unknown> = {};
  for (const slug of Object.keys(HTML_SETUP).sort()) if (existsSync(fixturePath(slug))) out[slug] = snapshot(slug);
  writeFileSync(`${FIXTURE_DIR}expected.json`, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${Object.keys(out).length} entries`);
}
