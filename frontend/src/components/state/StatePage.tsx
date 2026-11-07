import { isLive, type NavItem } from '../../data/navigation'
import type { StateCounsellingDetail } from '../../data/states'
import { Icon } from '../Icon'
import { MenuLink } from '../site/MenuLink'
import { useRootData } from '../site/config'
import { Crumbs } from '../shared/Crumbs'
import { Estimate } from '../shared/Estimate'
import { FaqList } from '../shared/FaqList'
import { HOME } from '../shared/home'
import { checkedOn, formatDate, formatInrShort, formatNumber, NO_DATE, slot } from '../shared/format'

const link = (label: string, href: string): NavItem => ({ label, href, published: isLive(href) })

const OWNERSHIP = { GOVERNMENT: 'Government', PRIVATE: 'Private', DEEMED: 'Deemed', TRUST: 'Trust' } as const

/** Shown on a counselling step until the official notice gives its date. Never a guessed date. */
const NOT_ANNOUNCED = 'date not announced yet'

export function StatePage({ detail }: { detail: StateCounsellingDetail }) {
  const { state, counselling, source } = detail
  const { navigation } = useRootData()
  const finder = navigation.tools.find((t) => t.icon === 'college')?.item

  return (
    <>
      <div className="wrap">
        <Crumbs parents={[HOME, link('MBBS in India', '/neet-counselling')]} current={state.name} />
        <header className="page-head">
          <h1>NEET UG counselling in {state.name}</h1>
          <p className="lead">
            How state quota seats are filled in {state.code}, which colleges take part, their fees and the ranks that got a seat last year.
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            Updated {counselling.updatedAt ? formatDate(counselling.updatedAt) : NO_DATE} · Checked against notices from the{' '}
            {source?.publisher ?? slot('counselling authority')}, {checkedOn(counselling.checkedAt)}
          </p>
        </header>
      </div>

      <section className="wrap" style={{ paddingBottom: 36 }}>
        <div className="facts-band">
          <div>
            <h2>Who runs it</h2>
            <p>
              {counselling.runnerName}{' '}
              <a href={counselling.runnerUrl} rel="noopener noreferrer" target="_blank">
                Official site <Icon name="ext" size={14} />
              </a>
            </p>
          </div>
          <div>
            <h2>Which seats</h2>
            <p>{counselling.seatsRule}</p>
          </div>
          <div>
            <h2>Who can apply</h2>
            <p>
              {counselling.whoCanApply}{' '}
              <a href={counselling.runnerUrl} rel="noopener noreferrer" target="_blank">
                Check the rules
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="band-cover" style={{ padding: '28px 0' }}>
        <div className="wrap tool-band">
          <div>
            <h2 style={{ fontSize: '1.375rem', color: '#fff' }}>See which {state.code} colleges fit your rank</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--cover-muted)' }}>
              Compares your likely rank with last year's closing ranks for your category.
            </p>
          </div>
          {finder && (
            <MenuLink className="btn btn-primary" item={finder}>
              Check my colleges in {state.code} <Icon name="arrow" />
            </MenuLink>
          )}
        </div>
      </section>

      <div className="wrap prose" style={{ padding: '40px var(--gut) 64px' }}>
        <CollegeTable detail={detail} />

        <h2>How {state.code} counselling works</h2>
        <ol className="timeline">
          {detail.steps.map((s) => (
            <li key={s.sort}>
              <span className="when">{s.date ? formatDate(s.date) : NOT_ANNOUNCED}</span>
              <h3 style={{ margin: '2px 0 4px' }}>{s.title}</h3>
              <p>{s.description}</p>
            </li>
          ))}
        </ol>
        <p className="small muted">
          Dates are filled in from the official notice once it's published. Steps{' '}
          {counselling.checkedAt ? `checked ${formatDate(counselling.checkedAt)}` : NO_DATE}.
        </p>

        <FaqList title={`Questions about ${state.code} counselling`} faqs={detail.faqs} />
      </div>
    </>
  )
}

function CollegeTable({ detail }: { detail: StateCounsellingDetail }) {
  const { state, colleges, closingRanks, totalColleges } = detail
  const { year, round, source } = closingRanks
  const roundLabel = round === 'STRAY' ? 'Stray round' : `Round ${round}`
  const checked = colleges.map((c) => c.closingRankCheckedAt).filter((d): d is string => !!d).sort().at(-1) ?? null
  const rank = (n: number | null) => (n == null ? '–' : formatNumber(n))

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Medical colleges in {state.code} counselling</h2>
      {colleges.length ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>College</th>
                <th>Type</th>
                <th className="r">Seats</th>
                <th className="r">Fees per year</th>
                <th className="r">General closing rank {year}</th>
                <th className="r">OBC closing rank {year}</th>
              </tr>
            </thead>
            <tbody>
              {colleges.map((c) => (
                <tr key={c.slug}>
                  <td>
                    <MenuLink item={link(c.name, `/colleges/${c.slug}`)} />
                  </td>
                  <td>{OWNERSHIP[c.ownership]}</td>
                  <td className="r">{c.mbbsSeats}</td>
                  <td className="r">{c.firstYearFeeInr ? formatInrShort(c.firstYearFeeInr) : slot('fee')}</td>
                  <td className="r">{rank(c.generalClosingRank)}</td>
                  <td className="r">{rank(c.obcClosingRank)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              {roundLabel} closing All-India ranks, state quota. Source: {source ? `${source.publisher}, ${source.title}` : 'source not recorded'},{' '}
              {checkedOn(checked)}. {colleges.length} of {totalColleges ?? slot('number')} colleges shown. A dash means no rank is
              recorded.
            </caption>
          </table>
        </div>
      ) : (
        <p>No colleges in {state.name} are on our list yet.</p>
      )}
      <p style={{ marginTop: 12 }}>
        <MenuLink className="btn btn-secondary" item={link(`See all colleges in ${state.code}`, '/college-finder')} />
      </p>
      <Estimate lead="Closing ranks change every year." />
    </>
  )
}
