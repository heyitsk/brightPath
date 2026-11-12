import { createHash } from "node:crypto";

// Homepage hero text and the announcement strip (Phase 4f): the rules, kept free of the database so they are easy to test.
// The values live in the ordinary site settings (hero.*, announcement.*); this file decides what is shown and what is valid.

export interface StripValues {
  text: string | null;
  linkLabel: string | null;
  linkUrl: string | null;
  isActive: boolean;
  showFrom: string | null;
  showUntil: string | null;
}

/**
 * OFF       the switch is off
 * EMPTY     switched on but there is no text, so nothing is shown
 * SCHEDULED switched on, waiting for `showFrom`
 * LIVE      being shown right now
 * EXPIRED   `showUntil` has passed
 */
export type StripStatus = "OFF" | "EMPTY" | "SCHEDULED" | "LIVE" | "EXPIRED";

export function stripStatus(v: StripValues, now: Date): StripStatus {
  if (!v.isActive) return "OFF";
  if (!v.text) return "EMPTY";
  if (v.showFrom && now.getTime() < new Date(v.showFrom).getTime()) return "SCHEDULED";
  if (v.showUntil && now.getTime() >= new Date(v.showUntil).getTime()) return "EXPIRED";
  return "LIVE";
}

/** Changes whenever the wording or link changes, so a visitor who dismissed the old strip sees the new one. */
export function stripId(v: Pick<StripValues, "text" | "linkLabel" | "linkUrl">): string | null {
  if (!v.text) return null;
  return createHash("sha1").update(JSON.stringify([v.text, v.linkLabel, v.linkUrl])).digest("hex").slice(0, 12);
}

/** What the public site config exposes: the strip only while it is live; a link only when both its text and address exist. */
export function publicAnnouncement(v: StripValues, now: Date) {
  if (stripStatus(v, now) !== "LIVE") return null;
  const link = v.linkUrl && v.linkLabel;
  return { id: stripId(v)!, text: v.text!, linkLabel: link ? v.linkLabel : null, linkUrl: link ? v.linkUrl : null };
}

/** Trimmed text, with empty meaning "clear it" (null). */
export const cleanText = (v: string | null | undefined): string | null | undefined => (v === undefined || v === null ? v : v.trim() || null);
