import { listColleges } from './colleges'
import { SAMPLE_COUNTRY_SLUGS } from './countries'
import { collegeLink, SAMPLE_NAVIGATION, type Navigation } from './navigation'

const countrySlug = (href: string) => href.replace('/mbbs-abroad/', '')
const stateSlug = (href: string) => href.replace('/neet-counselling/', '')

/**
 * Menu, footer and tab bar data. The labels are SAMPLE until GET /navigation/explore exists
 * (phase 7). For countries and states that have a page, the counts come from the facets of one
 * GET /colleges/ call and the college lists from GET /colleges/?kind=ABROAD&country=…, so the
 * menus and the pages agree. Countries without a page keep a null count, and the menus show none.
 * The menus list only states that have a page (see navigation.ts).
 *
 * Never throws: if the colleges API fails, the menus show no counts and no college lists for
 * those countries, and the rest of the site keeps working.
 */
export async function getNavigation(): Promise<Navigation> {
  const { explore } = SAMPLE_NAVIGATION
  try {
    const [{ facets }, ...lists] = await Promise.all([
      listColleges({ pageSize: 1 }),
      ...SAMPLE_COUNTRY_SLUGS.map((country) => listColleges({ kind: 'ABROAD', country })),
    ])
    const countryCount = new Map(facets.countries.map((f) => [f.slug, Number(f.count)]))
    const stateCount = new Map(facets.states.map((f) => [f.slug, Number(f.count)]))

    const countries = explore.countries.map((c) => {
      const slug = countrySlug(c.href)
      const index = SAMPLE_COUNTRY_SLUGS.indexOf(slug)
      if (index === -1) return c
      const colleges = lists[index].items.map((card) => collegeLink(card, card.shortName ?? card.name))
      return {
        ...c,
        total: countryCount.get(slug) ?? 0,
        colleges,
        mobileColleges: colleges.slice(0, c.mobileColleges.length),
      }
    })
    const states = explore.states.map((s) => ({ ...s, count: stateCount.get(stateSlug(s.href)) ?? 0 }))
    return { ...SAMPLE_NAVIGATION, explore: { ...explore, countries, states } }
  } catch {
    const countries = explore.countries.map((c) =>
      SAMPLE_COUNTRY_SLUGS.includes(countrySlug(c.href)) ? { ...c, total: null, colleges: [], mobileColleges: [] } : c,
    )
    return { ...SAMPLE_NAVIGATION, explore: { ...explore, countries } }
  }
}
