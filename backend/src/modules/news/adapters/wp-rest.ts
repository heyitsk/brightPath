import { clip, parseDate, toPlainText } from "../text";
import { normalizeUrl } from "../url";
import { AdapterError, type Adapter, type Candidate } from "./types";

// WordPress JSON API: `GET /wp-json/wp/v2/posts?per_page=30&_fields=link,title,date_gmt,excerpt`.

interface WpPost {
  link?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  date_gmt?: string;
  date?: string;
}

/** WordPress gives `date_gmt` without a zone ("2026-11-20T11:39:30"); it is UTC. */
const asUtc = (v: string | undefined) => (v ? (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : undefined);

export const extractWpRest: Adapter = ({ body, url, now }) => {
  let posts: unknown;
  try {
    posts = JSON.parse(body);
  } catch {
    throw new AdapterError("The address did not return JSON (the site may have switched its API off).");
  }
  if (!Array.isArray(posts)) throw new AdapterError("The WordPress API answered with something other than a list of posts.");

  const out: Candidate[] = [];
  for (const post of posts as WpPost[]) {
    const title = toPlainText(post.title?.rendered ?? "");
    const normalized = post.link ? normalizeUrl(post.link, url) : null;
    if (!title || !normalized) continue;
    const date = parseDate(asUtc(post.date_gmt) ?? asUtc(post.date), now);
    const excerpt = post.excerpt?.rendered ? clip(toPlainText(post.excerpt.rendered), 400) : null;
    out.push({ title, url: normalized, sourcePublishedAt: date, dateBasis: date ? "SOURCE" : "FIRST_SEEN", snippet: excerpt || null });
  }
  return out;
};

/** The default address for a WordPress site's posts, built from its home address. Sources may override it with `config.apiUrl`. */
export function defaultWpApiUrl(siteUrl: string): string {
  const u = new URL(siteUrl);
  return `${u.origin}/wp-json/wp/v2/posts?per_page=30&_fields=link,title,date_gmt,excerpt`;
}
