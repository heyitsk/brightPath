import type { NewsSourceKind } from "../../../generated/prisma/client";
import { extractRss } from "./rss";
import type { Adapter } from "./types";
import { extractWpRest } from "./wp-rest";

export { AdapterError, type Candidate } from "./types";

const ADAPTERS: Partial<Record<NewsSourceKind, Adapter>> = {
  RSS: extractRss,
  WP_REST: extractWpRest,
  // HTML_LIST arrives in step N2, HTML_JS in step N5.
};

export const adapterFor = (kind: NewsSourceKind): Adapter | null => ADAPTERS[kind] ?? null;
export const isSupportedKind = (kind: NewsSourceKind) => kind in ADAPTERS;
