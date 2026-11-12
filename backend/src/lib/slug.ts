/** Lower-case, accent-free, hyphen-separated URL part: "Saint-Petersburg State Univ." -> "saint-petersburg-state-univ". */
export const slugify = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Slugify, then cut to `max` characters at a hyphen so a very long name does not make an unreadable URL. */
export function slugifyShort(name: string, max = 90): string {
  const full = slugify(name);
  if (full.length <= max) return full;
  const cut = full.slice(0, max);
  const lastHyphen = cut.lastIndexOf("-");
  return lastHyphen > 40 ? cut.slice(0, lastHyphen) : cut;
}
