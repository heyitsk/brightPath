import { XMLParser } from "fast-xml-parser";
import { clip, decodeEntities, parseDate, toPlainText } from "../text";
import { normalizeUrl } from "../url";
import { AdapterError, type Adapter, type Candidate } from "./types";

// RSS 2.0 and Atom. Only the title, address, date and a short excerpt are kept.

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** A text node may be a string, a number, or `{ "#text": ..., "@_type": ... }`. */
function text(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as object)) return String((node as Record<string, unknown>)["#text"] ?? "");
  return "";
}

/** Atom has several `<link>` elements; the alternate one (or the only one) is the page address. */
function atomLink(link: unknown): string {
  const links = asArray(link as Array<Record<string, unknown> | string> | Record<string, unknown> | string);
  for (const l of links) {
    if (typeof l === "string") return l;
    const rel = l["@_rel"];
    if (!rel || rel === "alternate") return String(l["@_href"] ?? "");
  }
  return "";
}

export const extractRss: Adapter = ({ body, url, now }) => {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(body);
  } catch (e) {
    throw new AdapterError(`The feed is not valid XML (${(e as Error).message}).`);
  }
  const items: any[] = asArray(doc.rss?.channel?.item ?? doc.feed?.entry ?? doc["rdf:RDF"]?.item);
  if (!doc.rss && !doc.feed && !doc["rdf:RDF"]) throw new AdapterError("The address did not return an RSS or Atom feed.");

  const out: Candidate[] = [];
  for (const item of items) {
    const title = decodeEntities(toPlainText(text(item.title)));
    const link = doc.feed ? atomLink(item.link) : text(item.link);
    const normalized = normalizeUrl(link || text(item.guid), url);
    if (!title || !normalized) continue;
    const date = parseDate(text(item.pubDate) || text(item["dc:date"]) || text(item.published) || text(item.updated), now);
    const desc = text(item.description) || text(item["content:encoded"]) || text(item.summary) || text(item.content);
    const snippet = desc ? clip(toPlainText(desc), 400) : null;
    out.push({ title, url: normalized, sourcePublishedAt: date, dateBasis: date ? "SOURCE" : "FIRST_SEEN", snippet: snippet || null });
  }
  return out;
};
