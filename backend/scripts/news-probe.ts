// Live check of one news source, by hand. Stores nothing and changes no health.
//   bun run news:probe himachal-amru
//   bun run news:probe https://example.org/feed/ rss        (an address not yet in the database)
//   bun run news:probe --all                                 (every source that has an adapter)
import type { NewsSource, NewsSourceKind } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/prisma";
import { previewSource } from "../src/modules/news/ingest";
import { isSupportedKind } from "../src/modules/news/adapters";

const [arg, kindArg] = process.argv.slice(2);
if (!arg) {
  console.error("Usage: bun run news:probe <source-slug | url [rss|wp_rest]> | --all");
  process.exit(1);
}

async function show(source: NewsSource) {
  const r = await previewSource(source, 10);
  console.log(`\n== ${source.slug} (${source.kind}) ${r.requestedUrl}`);
  if (!r.ok) return console.log(`   FAILED: ${r.error}${r.httpStatus ? ` [HTTP ${r.httpStatus}]` : ""}`);
  console.log(`   HTTP ${r.httpStatus}, ${r.itemsFound} notices found, ${r.itemsNew} not stored yet`);
  for (const i of r.items) console.log(`   ${i.sourcePublishedAt?.slice(0, 10) ?? "no date  "}  ${i.isNew ? "NEW" : "   "}  ${i.title.slice(0, 90)}\n              ${i.url}`);
}

if (arg === "--all") {
  const sources = await prisma.newsSource.findMany({ orderBy: { slug: "asc" } });
  for (const s of sources.filter((s) => isSupportedKind(s.kind))) await show(s);
} else if (/^https?:\/\//.test(arg)) {
  const kind = (kindArg ?? "rss").toUpperCase() as NewsSourceKind;
  // A throwaway object: nothing is written, and an unsaved source has no stored items to compare with.
  await show({ id: "00000000-0000-0000-0000-000000000000", slug: "adhoc", kind, listUrl: arg, config: {}, etag: null, lastModified: null } as unknown as NewsSource);
} else {
  const source = await prisma.newsSource.findUnique({ where: { slug: arg } });
  if (!source) {
    console.error(`No source with slug "${arg}".`);
    process.exit(1);
  }
  await show(source);
}
await prisma.$disconnect();
process.exit(0);
