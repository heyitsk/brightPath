import type { NavItem } from '../../data/navigation'

export const HOME: NavItem = { label: 'Home', href: '/', published: true }

/** The home page hero wording used while an admin has not set their own (`/site/config` → `hero` is null). */
export const HERO_DEFAULT = {
  headline: 'Your NEET score, turned into a likely rank and a list of colleges you can really get',
  subtext:
    'See your All-India rank range from official NTA results, then colleges in India and abroad that fit your rank and budget, with full fees.',
} as const
