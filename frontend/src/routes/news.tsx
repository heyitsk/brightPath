import { useState } from 'react'
import { Form, Link } from 'react-router'
import { Icon } from '../components/Icon'
import { Crumbs } from '../components/shared/Crumbs'
import { PageError } from '../components/shared/PageError'
import { formatNumber } from '../components/shared/format'
import {
  CATEGORY_LABEL,
  checkedLine,
  isNewsCategory,
  placeName,
  publicDateLine,
  type NewsCategory,
} from '../components/shared/news'
import { OfficialLink } from '../components/news/OfficialLink'
import { MenuLink } from '../components/site/MenuLink'
import { useRootData } from '../components/site/config'
import { listNews, type NewsCard, type NewsList, type NewsListQuery } from '../data/news'
import newsStyles from '../styles/pages/news.css?url'
import type { Route } from './+types/news'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: newsStyles }]

const PATH = '/news'
const DEFAULT_PAGE_SIZE = 20
/** The "Where" choice for national notices; maps to the API's central=true. */
const CENTRAL = 'central'

/** The filters as the page uses them: empty string means "not set". */
type Filters = { state: string; category: NewsCategory | ''; q: string; page: number; pageSize: number }

/** A whole number from the URL within the API's limits, else undefined (so a bad URL never hits a 422). */
function wholeNumber(value: string | null, max: number): number | undefined {
  if (!value || !/^\d{1,4}$/.test(value)) return undefined
  const n = Number(value)
  return n >= 1 && n <= max ? n : undefined
}

function readFilters(url: URL): Filters {
  const p = url.searchParams
  const central = p.get('central') === 'true'
  const state = (p.get('state') ?? '').trim().toLowerCase()
  const category = p.get('category') ?? ''
  return {
    state: central || state === CENTRAL ? CENTRAL : /^[a-z0-9-]{1,60}$/.test(state) ? state : '',
    category: isNewsCategory(category) ? category : '',
    q: (p.get('q') ?? '').trim().slice(0, 100),
    page: wholeNumber(p.get('page'), 1000) ?? 1,
    pageSize: wholeNumber(p.get('pageSize'), 50) ?? DEFAULT_PAGE_SIZE,
  }
}

function toQuery(f: Filters): NewsListQuery {
  const query: NewsListQuery = { page: f.page, pageSize: f.pageSize }
  if (f.state === CENTRAL) query.central = true
  else if (f.state) query.state = f.state
  if (f.category) query.category = f.category
  if (f.q) query.q = f.q
  return query
}

/** A link to this page with the given filters; defaults are left out so links stay short. */
function hrefFor(f: Filters, page = 1): string {
  const p = new URLSearchParams()
  if (f.state) p.set('state', f.state)
  if (f.category) p.set('category', f.category)
  if (f.q) p.set('q', f.q)
  if (page > 1) p.set('page', String(page))
  if (f.pageSize !== DEFAULT_PAGE_SIZE) p.set('pageSize', String(f.pageSize))
  const qs = p.toString()
  return qs ? `${PATH}?${qs}` : PATH
}

/** Published notices from GET /news/, pinned first then newest, with the filter choices. */
export async function loader({ request }: Route.LoaderArgs) {
  const filters = readFilters(new URL(request.url))
  const list = await listNews(toQuery(filters))
  return { filters, list }
}

// Same for every visitor, so shared caches may keep it for five minutes.
export function headers() {
  return { 'Cache-Control': 'public, s-maxage=300' }
}

export const meta: Route.MetaFunction = ({ data: page }) => {
  const state =
    page?.filters.state === CENTRAL
      ? 'MCC, NMC and NTA'
      : page?.list.facets.states.find((s) => s.slug === page.filters.state)?.name
  return [
    { title: `NEET UG counselling news${state ? ` for ${state}` : ''}: official notices, checked by our team` },
    {
      name: 'description',
      content: `Admission and counselling notices${state ? ` for ${state}` : ''} from the official sites, checked by our team. Each one says who published it, its date, when we checked it, and links to the official notice.`,
    },
  ]
}

const n = (v: string | number) => Number(v)

export default function News({ loaderData }: Route.ComponentProps) {
  const { filters, list } = loaderData
  const total = n(list.total)
  const pageSize = n(list.pageSize)
  const page = n(list.page)
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const filtered = Boolean(filters.state || filters.category || filters.q)

  return (
    <>
      <div className="wrap">
        <Crumbs parents={[{ label: 'Home', href: '/', published: true }]} current="News" />
        <header className="page-head" style={{ paddingBottom: 20 }}>
          <h1>Counselling news</h1>
          <p className="lead">
            Admission and counselling notices from the official sites. Our team checks each one against the original
            and writes a short summary. Always read the official notice before you act on it.
          </p>
        </header>
      </div>

      <div className="wrap finder news" style={{ paddingBottom: 64 }}>
        <NewsFilters filters={filters} facets={list.facets} filtered={filtered} />
        <div>
          {list.items.length > 0 ? (
            <>
              <div className="summary">
                <h2>
                  <span className="num">{formatNumber(total)}</span> {total === 1 ? 'notice' : 'notices'}
                </h2>
                <span className="muted small">Pinned first, then newest</span>
              </div>
              <ul className="records">
                {list.items.map((item) => (
                  <NoticeRecord key={item.slug} item={item} />
                ))}
              </ul>
              {pages > 1 && <Pager filters={filters} page={page} pages={pages} />}
            </>
          ) : (
            <EmptyState filters={filters} filtered={filtered} total={total} />
          )}
        </div>
      </div>
    </>
  )
}

function NewsFilters({
  filters,
  facets,
  filtered,
}: {
  filters: Filters
  facets: NewsList['facets']
  filtered: boolean
}) {
  // Controlled, and synced when the loader's filters change (pager, "Clear filters", back button).
  const [form, setForm] = useState(filters)
  const [shown, setShown] = useState(filters)
  if (shown !== filters) {
    setShown(filters)
    setForm(filters)
  }

  const states = [...facets.states]
  if (filters.state && filters.state !== CENTRAL && !states.some((s) => s.slug === filters.state)) {
    states.push({ slug: filters.state, name: filters.state, count: 0 })
  }
  const categories = [...facets.categories]
  if (filters.category && !categories.some((c) => c.category === filters.category)) {
    categories.push({ category: filters.category, count: 0 })
  }

  return (
    <Form className="visa security" method="get" action={PATH} aria-label="Filter notices">
      <div className="field">
        <label htmlFor="news-where">Where</label>
        <select
          className="select"
          id="news-where"
          name="state"
          value={form.state}
          onChange={(e) => setForm({ ...form, state: e.target.value })}
        >
          <option value="">All states and central</option>
          <option value={CENTRAL}>Central: MCC, NMC, NTA ({formatNumber(n(facets.centralCount))})</option>
          {states.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name} ({formatNumber(n(s.count))})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="news-cat">Type of notice</label>
        <select
          className="select"
          id="news-cat"
          name="category"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: isNewsCategory(e.target.value) ? e.target.value : '' })}
        >
          <option value="">All types</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {CATEGORY_LABEL[c.category]} ({formatNumber(n(c.count))})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="news-q">Search</label>
        <input
          className="input"
          id="news-q"
          name="q"
          type="search"
          maxLength={100}
          placeholder="e.g. round 2, seat matrix"
          value={form.q}
          onChange={(e) => setForm({ ...form, q: e.target.value })}
        />
      </div>
      {filters.pageSize !== DEFAULT_PAGE_SIZE && <input type="hidden" name="pageSize" value={filters.pageSize} />}
      <button className="btn btn-primary btn-block" type="submit">
        Show notices <Icon name="arrow" />
      </button>
      {filtered && (
        <p className="news-clear">
          <Link to={PATH}>Clear filters</Link>
        </p>
      )}
    </Form>
  )
}

function NoticeRecord({ item }: { item: NewsCard }) {
  return (
    <li className="record">
      <div>
        <h3>
          <Link to={`${PATH}/${item.slug}`} prefetch="intent">
            {item.title}
          </Link>
        </h3>
        <p className="place">{item.source.name}</p>
        <p className="news-summary">{item.summary}</p>
        <p className="checked">
          <Icon name="clock" size={14} />
          <span>
            {publicDateLine(item)} · {checkedLine(item)}
          </span>
        </p>
      </div>
      <dl className="facts">
        <div>
          <dt>Where</dt>
          <dd>{placeName(item)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{CATEGORY_LABEL[item.category]}</dd>
        </div>
      </dl>
      <div className="actions">
        <OfficialLink item={item} className="btn btn-secondary" />
      </div>
    </li>
  )
}

function Pager({ filters, page, pages }: { filters: Filters; page: number; pages: number }) {
  return (
    <nav className="news-pager" aria-label="Pages">
      {page > 1 ? (
        <Link className="btn btn-secondary" to={hrefFor(filters, page - 1)}>
          Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="muted small">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link className="btn btn-secondary" to={hrefFor(filters, page + 1)}>
          Older
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}

function EmptyState({ filters, filtered, total }: { filters: Filters; filtered: boolean; total: number }) {
  const { navigation } = useRootData()
  const predictor = navigation.tools.find((t) => t.icon === 'chart')?.item

  // Past the last page of a list that does have notices.
  if (total > 0) {
    return (
      <div className="news-empty">
        <h2>No notices on this page</h2>
        <p>
          <Link to={hrefFor(filters)}>Go to the first page</Link>
        </p>
      </div>
    )
  }
  if (filtered) {
    return (
      <div className="news-empty">
        <h2>No notices match these filters.</h2>
        <p>
          <Link to={PATH}>Clear filters and see all notices</Link>
        </p>
      </div>
    )
  }
  return (
    <div className="news-empty">
      <h2>No notices yet.</h2>
      <p>We add official counselling notices here once our team has checked them.</p>
      {predictor && (
        <p>
          <MenuLink className="link-arrow" item={predictor}>
            Meanwhile, check your likely NEET rank <Icon name="arrow" size={16} />
          </MenuLink>
        </p>
      )}
    </div>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} notFoundTitle="Page not found" />
}
