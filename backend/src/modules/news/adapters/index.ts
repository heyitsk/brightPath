import type { NewsSourceKind } from "../../../generated/prisma/client";
import { extractHtmlList } from "./html-list";
import { extractRss } from "./rss";
import type { Adapter } from "./types";
import { extractWpRest } from "./wp-rest";

export { AdapterError, type Candidate } from "./types";

const ADAPTERS: Partial<Record<NewsSourceKind, Adapter>> = {
  RSS: extractRss,
  WP_REST: extractWpRest,
  HTML_LIST: extractHtmlList,
  // HTML_JS (pages built by JavaScript) arrives in step N5.
};

export const adapterFor = (kind: NewsSourceKind): Adapter | null => ADAPTERS[kind] ?? null;
export const isSupportedKind = (kind: NewsSourceKind) => kind in ADAPTERS;
