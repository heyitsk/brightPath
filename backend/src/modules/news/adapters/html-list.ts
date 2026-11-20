import * as cheerio from "cheerio";
import { clip, findDateInText, parseDate, toPlainText } from "../text";
import { normalizeUrl } from "../url";
import { AdapterError, type Adapter, type Candidate } from "./types";

// Reads a normal web page that lists notices as links (plan §15.5 step 2). Each site is described
// by a few settings kept on the source, so a broken site is fixed by editing data, not code (D-136):
//
//   scope        CSS selector(s) of the area that holds the notices. Required, so menus and footers are never read.
//   exclude      CSS selector(s) removed from the page first (a "Latest news" box inside the scope, say).
//   row          CSS selector for the block around one notice (default: nearest li, tr, article, dd or p).
//   titleSelector  where the title is, inside the row. Default: the link's own text; if that is too short, the row's text.
//   dateSelector   where the date is, inside the row. Default: a date in the title, then in the row, then in the link address.
//   dateFromUrl  regex with named groups y, m, d, for sites that put the date in the file name.
//   skipText / onlyText  lists of regex sources tested against the title.
//   skipHref / onlyHref  the same, tested against the link address (for menus mixed in with notices).
//   minTitleLength (12), maxItems (150), order ("auto", "newest-first", "oldest-first").
//   generic      true to read the whole page when no scope is given (only for trying a new site out).

interface HtmlConfig {
  scope: string[];
  exclude: string[];
  row: string;
  titleSelector?: string;
  dateSelector?: string;
  dateFromUrl?: RegExp;
  skipText: RegExp[];
  onlyText: RegExp[];
  skipHref: RegExp[];
  onlyHref: RegExp[];
  minTitleLength: number;
  maxItems: number;
  order: "auto" | "newest-first" | "oldest-first";
}

const list = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

function regexes(name: string, v: unknown): RegExp[] {
  return list(v).map((src) => {
    try {
      return new RegExp(src, "i");
    } catch {
      throw new AdapterError(`The setting "${name}" has an invalid pattern: ${src}`);
    }
  });
}

export function parseHtmlConfig(raw: Record<string, unknown>): HtmlConfig {
  const scope = list(raw.scope);
  if (scope.length === 0 && raw.generic !== true) {
    throw new AdapterError('This source has no "scope" setting yet, so it does not know where on the page the notices are.');
  }
  let dateFromUrl: RegExp | undefined;
  if (typeof raw.dateFromUrl === "string" && raw.dateFromUrl) {
    try {
      dateFromUrl = new RegExp(raw.dateFromUrl);
    } catch {
      throw new AdapterError('The setting "dateFromUrl" is not a valid pattern.');
    }
  }
  const order = raw.order === "newest-first" || raw.order === "oldest-first" ? raw.order : "auto";
  return {
    scope: scope.length ? scope : ["body"],
    exclude: list(raw.exclude),
    row: typeof raw.row === "string" && raw.row ? raw.row : "li, tr, article, dd, p",
    titleSelector: typeof raw.titleSelector === "string" && raw.titleSelector ? raw.titleSelector : undefined,
    dateSelector: typeof raw.dateSelector === "string" && raw.dateSelector ? raw.dateSelector : undefined,
    dateFromUrl,
    skipText: regexes("skipText", raw.skipText),
    onlyText: regexes("onlyText", raw.onlyText),
    skipHref: regexes("skipHref", raw.skipHref),
    onlyHref: regexes("onlyHref", raw.onlyHref),
    minTitleLength: typeof raw.minTitleLength === "number" ? raw.minTitleLength : 12,
    maxItems: typeof raw.maxItems === "number" ? Math.min(Math.max(raw.maxItems, 1), 500) : 150,
    order,
  };
}

const NOT_A_PAGE = /^(#|javascript:|mailto:|tel:|data:)/i;
/** Links that are navigation, not notices, whatever the site. */
const GENERIC_LABEL = /^(read more|more|view all|view more|click here|download|home|next|previous|back|top|login|log in|archive|archives|\d+|…|\.\.\.)\W*$/i;
// Punctuation is spelled out because `\W` also matches Hindi and Tamil letters, which would be eaten.
const PUNCT = "[\\s\\[\\](){}.,;:|\\-–—]";
const LEADING_DATE = new RegExp(`^${PUNCT}*(?:\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?[\\s.\\-,]*[a-z]{3,9}\\.?[\\s.\\-,]*\\d{2,4})${PUNCT}{0,3}`, "i");
const TRAILING_NOISE = /(?:\s*[-–—:|]?\s*(?:download|view|new!?|pdf|click here)\b)?\s*(?:\(\s*[\d.,]+\s*(?:kb|mb)\s*\))?\s*(?:new!?)?\s*$/i;

/** Titles come with dates in front ("[17-11-2026] - NOTICE: ...") and file sizes behind ("(0.52 MB)"); neither is part of the title. */
export function cleanTitle(raw: string): string {
  let t = toPlainText(raw);
  const stripped = t.replace(/^\[\s*[^\]]{4,20}\]\s*[-–—:]?\s*/, "").replace(LEADING_DATE, "");
  if (stripped.length >= 8) t = stripped;
  t = t.replace(TRAILING_NOISE, "").trim();
  return t.replace(/^[-–—:|\s]+/, "").replace(/\s+/g, " ");
}

export const extractHtmlList: Adapter = ({ body, url, config, now }) => {
  const cfg = parseHtmlConfig(config);
  const $ = cheerio.load(body);
  $("script, style, noscript, template").remove();
  for (const sel of cfg.exclude) $(sel).remove();

  const scopeEls = $(cfg.scope.join(", "));
  if (scopeEls.length === 0) {
    throw new AdapterError(`The notice area (${cfg.scope.join(", ")}) was not found on the page. The site may have changed its layout.`);
  }

  const validAnchor = (a: any) => {
    const href = ($(a).attr("href") ?? "").trim();
    return href !== "" && !NOT_A_PAGE.test(href);
  };
  const anchors = scopeEls.find("a[href]").filter((_, a) => validAnchor(a)).toArray();
  const seenAnchor = new Set(anchors);

  const out: Candidate[] = [];
  const seenUrl = new Set<string>();
  for (const a of new Set(anchors)) {
    const href = ($(a).attr("href") ?? "").trim();
    const normalized = normalizeUrl(href, url);
    if (!normalized || seenUrl.has(normalized)) continue;
    if (cfg.onlyHref.length && !cfg.onlyHref.some((r) => r.test(normalized))) continue;
    if (cfg.skipHref.some((r) => r.test(normalized))) continue;

    const $a = $(a);
    let row = $a.closest(cfg.row);
    // A row that reaches outside the notice area (the whole page's list item, say) is not a row.
    if (row.length === 0 || !scopeEls.toArray().some((s) => s === row[0] || cheerio.contains(s, row[0]!))) row = $a.parent();
    const anchorsInRow = row.find("a[href]").toArray().filter((x) => seenAnchor.has(x));

    const linkText = $a.text().replace(/\s+/g, " ").trim();
    let rawTitle = cfg.titleSelector ? row.find(cfg.titleSelector).first().text() : linkText;
    if (!cfg.titleSelector && cleanTitle(rawTitle).length < cfg.minTitleLength && anchorsInRow.length === 1) rawTitle = row.text();
    const title = cleanTitle(rawTitle);
    if (title.length < cfg.minTitleLength || GENERIC_LABEL.test(title)) continue;
    if (cfg.onlyText.length && !cfg.onlyText.some((r) => r.test(title))) continue;
    if (cfg.skipText.some((r) => r.test(title))) continue;

    // A date counts only when it clearly belongs to this notice: the date selector, the title itself,
    // a row that holds just this one link, or the file address. A date shared by several links is ambiguous.
    let date: Date | null = null;
    if (cfg.dateSelector) date = findDateInText(row.find(cfg.dateSelector).first().text(), now);
    date ??= findDateInText(rawTitle, now);
    if (!date && anchorsInRow.length === 1) date = findDateInText(row.text(), now);
    if (!date && cfg.dateFromUrl) {
      const g = cfg.dateFromUrl.exec(decodeURIComponent(normalized))?.groups;
      if (g?.y && g.m && g.d) date = parseDate(new Date(Date.UTC(+g.y, +g.m - 1, +g.d, 6, 30)).toISOString(), now);
    }

    seenUrl.add(normalized);
    out.push({ title: clip(title, 300), url: normalized, sourcePublishedAt: date, dateBasis: date ? "SOURCE" : "FIRST_SEEN", snippet: null });
  }

  return orderNewestFirst(out, cfg.order).slice(0, cfg.maxItems);
};

/** The rest of the pipeline assumes newest first. Pages that list oldest first are turned around, judged from the dates they carry. */
export function orderNewestFirst(items: Candidate[], order: HtmlConfig["order"]): Candidate[] {
  if (order === "newest-first") return items;
  if (order === "oldest-first") return [...items].reverse();
  const dated = items.map((i) => i.sourcePublishedAt?.getTime()).filter((t): t is number => t !== undefined);
  if (dated.length < 4) return items;
  let up = 0;
  let down = 0;
  for (let i = 1; i < dated.length; i++) {
    if (dated[i]! > dated[i - 1]!) up++;
    else if (dated[i]! < dated[i - 1]!) down++;
  }
  return up >= (up + down) * 0.7 && up > down * 2 ? [...items].reverse() : items;
}
