import { clip, parseSiteDate, toPlainText } from "../text";
import { normalizeUrl } from "../url";
import { orderNewestFirst } from "./html-list";
import { AdapterError, type Adapter, type Candidate } from "./types";

// Reads a JSON address that returns a list of notices: the data behind a page that is built by
// JavaScript (plan §15, step N5). Found with `bun run news:discover <page>`, which shows what
// requests a page makes. Settings, kept on the source like the HTML ones:
//
//   itemsPath    dotted path to the list, e.g. "Data.LatestUpdateList"; or a list of paths to join several lists. Required.
//   titlePath    where the title is inside one item, e.g. "Achievement". Required.
//   urlPath      where the notice's address is (absolute, or relative to the API address).
//   urlTemplate  otherwise, an address built from the item's fields: "https://site/order/detail/964/0/{Id}".
//                One of urlPath or urlTemplate is required; urlPath is tried first.
//   datePath     where the date is (ISO, or written like "20-11-2026").
//   snippetPath  where a short excerpt is.
//   minTitleLength (12), maxItems (150), order ("auto", "newest-first", "oldest-first").

const list = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/** `get({a: {b: [1]}}, "a.b")` is `[1]`. Undefined as soon as a step is missing. */
export function getPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export const extractJsonList: Adapter = ({ body, url, config, now }) => {
  const itemsPaths = list(config.itemsPath);
  const titlePath = typeof config.titlePath === "string" ? config.titlePath : "";
  const urlPath = typeof config.urlPath === "string" && config.urlPath ? config.urlPath : null;
  const urlTemplate = typeof config.urlTemplate === "string" && config.urlTemplate ? config.urlTemplate : null;
  if (itemsPaths.length === 0 || !titlePath || (!urlPath && !urlTemplate)) {
    throw new AdapterError('This source needs the settings "itemsPath", "titlePath" and one of "urlPath" or "urlTemplate" before it can be read.');
  }
  const datePath = typeof config.datePath === "string" && config.datePath ? config.datePath : null;
  const snippetPath = typeof config.snippetPath === "string" && config.snippetPath ? config.snippetPath : null;
  const minTitleLength = typeof config.minTitleLength === "number" ? config.minTitleLength : 12;
  const maxItems = typeof config.maxItems === "number" ? Math.min(Math.max(config.maxItems, 1), 500) : 150;
  const order = config.order === "newest-first" || config.order === "oldest-first" ? config.order : "auto";

  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    throw new AdapterError("The address did not return JSON.");
  }

  const rows: unknown[] = [];
  for (const path of itemsPaths) {
    const found = getPath(doc, path);
    if (!Array.isArray(found)) throw new AdapterError(`The list "${path}" was not found in the answer. The site may have changed its data format.`);
    rows.push(...found);
  }

  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const title = toPlainText(text(getPath(row, titlePath)));
    if (title.length < minTitleLength) continue;
    let address = urlPath ? text(getPath(row, urlPath)).trim() : "";
    if (!address && urlTemplate) {
      // Every {Field} in the template must have a value; an item with a gap would get a wrong address.
      let missing = false;
      const filled = urlTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => {
        const value = text(getPath(row, key)).trim();
        if (!value) missing = true;
        return encodeURIComponent(value);
      });
      if (!missing) address = filled;
    }
    const normalized = address ? normalizeUrl(address, url) : null;
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const rawDate = datePath ? text(getPath(row, datePath)) : "";
    const date = rawDate ? parseSiteDate(rawDate, now) : null;
    const snippet = snippetPath ? clip(toPlainText(text(getPath(row, snippetPath))), 400) : "";
    out.push({ title: clip(title, 300), url: normalized, sourcePublishedAt: date, dateBasis: date ? "SOURCE" : "FIRST_SEEN", snippet: snippet || null });
  }
  return orderNewestFirst(out, order).slice(0, maxItems);
};
