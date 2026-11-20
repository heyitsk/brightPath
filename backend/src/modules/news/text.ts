// Small text helpers for the news tool: feeds and pages carry HTML entities, tags and odd spacing.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  rsaquo: "›",
  laquo: "«",
  raquo: "»",
};

/** Decode `&amp;`, `&#8211;`, `&#x2013;` and a few common named entities. Unknown ones are left as they are. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1]!.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Remove tags, decode entities and squeeze whitespace. */
export function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut to `max` characters on a word boundary, adding an ellipsis when something was removed. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A date that is real and not absurd, otherwise null. Feeds sometimes carry junk like `0000-00-00`. */
export function parseDate(value: unknown, now = new Date()): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 2000) return null;
  if (d.getTime() > now.getTime() + 2 * 86_400_000) return null; // more than two days ahead is a typo, not news
  return d;
}

// ---- dates written by people ------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const NUMERIC_DATE = /(?<!\d)(?<!\d[/.\-])(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?![\d/.\-]\d)/;
const DAY_MONTH_NAME = new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[\\s.\\-,]*(${MON})[a-z]*\\.?[\\s.\\-,]*(\\d{4}|\\d{2})(?!\\d)`, "i");
const MONTH_NAME_DAY = new RegExp(`(${MON})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, "i");

function buildDate(day: number, month: number, year: number, now: Date): Date | null {
  if (year < 100) year += 2000;
  if (year < 2010) return null; // a notice is never this old; it is a founding date or a typo
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Noon in India (06:30 UTC), so the calendar day reads the same in both zones.
  const d = new Date(Date.UTC(year, month - 1, day, 6, 30));
  if (d.getUTCMonth() !== month - 1) return null; // 31 Feb and the like
  return parseDate(d.toISOString(), now);
}

/** The first date written in the text, day first as Indian sites write it (`20-11-2026`, `20.11.26`, `20 Nov 2026`, `Nov 20, 2026`). Null if none, or if it is junk or in the future. */
export function findDateInText(text: string, now = new Date()): Date | null {
  let m = NUMERIC_DATE.exec(text);
  const candidates: Array<{ index: number; date: Date | null }> = [];
  if (m) candidates.push({ index: m.index, date: buildDate(+m[1]!, +m[2]!, +m[3]!, now) });
  m = DAY_MONTH_NAME.exec(text);
  if (m) candidates.push({ index: m.index, date: buildDate(+m[1]!, MONTHS[m[2]!.toLowerCase().slice(0, 3)]!, +m[3]!, now) });
  m = MONTH_NAME_DAY.exec(text);
  if (m) candidates.push({ index: m.index, date: buildDate(+m[2]!, MONTHS[m[1]!.toLowerCase().slice(0, 3)]!, +m[3]!, now) });
  return candidates.filter((c) => c.date).sort((a, b) => a.index - b.index)[0]?.date ?? null;
}
