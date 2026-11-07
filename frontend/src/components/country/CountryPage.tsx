import type { AbroadCollegeRow } from '../../data/colleges'
import type { CountryDetail } from '../../data/countries'
import { isLive, type NavItem } from '../../data/navigation'
import { Icon } from '../Icon'
import { MenuLink } from '../site/MenuLink'
import { useRootData } from '../site/config'
import { Crumbs } from '../shared/Crumbs'
import { Estimate } from '../shared/Estimate'
import { FaqList } from '../shared/FaqList'
import { HOME } from '../shared/home'
import {
  courseLength,
  currencyName,
  formatDate,
  formatLakh,
  formatLakhRange,
  formatRate,
  NO_DATE,
  slot,
} from '../shared/format'

const link = (label: string, href: string): NavItem => ({ label, href, published: isLive(href) })

/** How many college records the page shows before "See all". */
const SHOWN = 3

const OWNERSHIP = { GOVERNMENT: 'Public university', PRIVATE: 'Private university', DEEMED: 'Deemed university', TRUST: 'Trust' } as const

/** "Checked 14 Oct 2026" with a capital, for lines that stand on their own. */
const Checked = ({ at }: { at: string | null }) => (
  <p className="small muted">{at ? `Checked ${formatDate(at)}` : `Checked: ${NO_DATE}`}</p>
)

export function CountryPage({ detail }: { detail: CountryDetail }) {
  const { country, content } = detail
  return (
    <>
      <div className="wrap">
        <Crumbs parents={[HOME, link('MBBS abroad', '/mbbs-abroad')]} current={country.name} />
        <header className="page-head head-grid">
          <div>
            <h1>MBBS in {country.name}</h1>
            <p className="lead">{content.intro}</p>
            <p className="small muted" style={{ margin: 0 }}>
              Written by {content.writtenBy ?? '[Counsellor name]'} · Reviewed by {content.reviewedBy ?? '[Reviewer name]'} · Updated{' '}
              {content.updatedAt ? formatDate(content.updatedAt) : NO_DATE}
            </p>
          </div>
          {content.heroImageUrl ? (
            <img src={content.heroImageUrl} alt="" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', borderRadius: 'var(--r-lg)' }} />
          ) : (
            <div className="photo" style={{ aspectRatio: '16/10' }}>
              <span>
                <strong>City or campus photo</strong>
                {content.heroImageHint}
              </span>
            </div>
          )}
        </header>
      </div>
      <Glance detail={detail} />
      <hr className="perf" />

      <div className="wrap split side" style={{ padding: '40px var(--gut) 64px' }}>
        <article className="prose">
          <Valid detail={detail} />
          <Colleges detail={detail} />
          <Cost detail={detail} />

          <h2 id="eligible">Who can apply</h2>
          <ul>
            {content.admissionSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <Checked at={content.lastCheckedAt} />

          <h2 id="weigh">Things to weigh up honestly</h2>
          <div className="weigh">
            <div>
              <h3>Why students choose it</h3>
              <ul>
                {content.whyStudy.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>What to be careful about</h3>
              <ul>
                {content.cautions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>

          <FaqList id="faq" title={`Questions about MBBS in ${country.name}`} faqs={detail.faqs} />
        </article>
        <OnThisPage detail={detail} />
      </div>
    </>
  )
}

function Glance({ detail }: { detail: CountryDetail }) {
  const { country, content, colleges, nmcNotices } = detail
  const collegeAlerts = colleges.filter((c) => c.nmcAlertStatus === 'ALERT').length
  let alerts = 'None found'
  if (nmcNotices.length) alerts = 'Country alert'
  else if (collegeAlerts) alerts = `On ${collegeAlerts} ${collegeAlerts === 1 ? 'college' : 'colleges'}`

  return (
    <section className="wrap" style={{ paddingBottom: 28 }}>
      <dl className="glance">
        <div>
          <dt>Course length</dt>
          <dd>{courseLength(content.courseLengthMonths)}</dd>
        </div>
        <div>
          <dt>Taught in</dt>
          <dd>{content.teachingLanguage}</dd>
        </div>
        <div>
          <dt>Total fees (range)</dt>
          <dd>{formatLakhRange(content.typicalFeeRange.minInr, content.typicalFeeRange.maxInr)}</dd>
        </div>
        <div>
          <dt>Intake</dt>
          <dd>{content.intakeMonths.length ? content.intakeMonths.join(', ') : slot('month')}</dd>
        </div>
        <div>
          <dt>Colleges on our list</dt>
          <dd>{colleges.length} checked</dd>
        </div>
        <div>
          <dt>NMC alerts</dt>
          <dd style={alerts === 'None found' ? undefined : { color: 'var(--red)' }}>{alerts}</dd>
        </div>
        <div>
          <dt>Flight from Delhi</dt>
          <dd>{country.typicalFlightFromDelhi ?? slot('hours')}</dd>
        </div>
        <div>
          <dt>Winter low</dt>
          <dd>{content.winterLow ?? slot('temperature')}</dd>
        </div>
      </dl>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        {content.lastCheckedAt ? `Country facts checked ${formatDate(content.lastCheckedAt)}.` : `Country facts: ${NO_DATE}.`} Each college on
        the list shows its own check date.
      </p>
      <div style={{ marginTop: 16 }}>
        <Estimate lead="Fees are estimates." />
      </div>
    </section>
  )
}

function Valid({ detail }: { detail: CountryDetail }) {
  const { country, content } = detail
  return (
    <>
      <h2 id="valid" style={{ marginTop: 0 }}>
        Is an MBBS from {country.name} valid in India?
      </h2>
      <p>{content.recognitionExplainer}</p>
      <ul className="rule-list">
        {content.recognitionRules.map((r) => (
          <li key={r.strong}>
            <Icon name="check" />
            <span>
              <strong>{r.strong}</strong>
              {r.rest}
            </span>
          </li>
        ))}
      </ul>
      <Estimate disclaimer="FOREIGN_COLLEGES_NMC" />
      <p style={{ marginTop: 16 }}>
        <MenuLink item={link('Read the full NMC rules guide', '/neet/nmc-rules-mbbs-abroad')}>
          Read the full NMC rules guide <Icon name="arrow" size={16} />
        </MenuLink>
      </p>
      <Checked at={content.lastCheckedAt} />
    </>
  )
}

/** The marks on a college record. Never "approved": WDOMS listing, NMC 2021 rules, NMC alert. */
function Marks({ c }: { c: AbroadCollegeRow }) {
  return (
    <div className="marks">
      {c.wdomsListed === 'LISTED' && (
        <span className="mark green">
          <Icon name="check" size={14} /> Listed in WDOMS
        </span>
      )}
      {c.wdomsListed === 'NOT_LISTED' && <span className="mark red">Not listed in WDOMS</span>}
      {c.wdomsListed === 'UNKNOWN' && <span className="mark grey">WDOMS listing unknown</span>}
      {c.nmc2021Status === 'MEETS' && (
        <span className="mark">
          <Icon name="shield" size={14} /> Meets NMC 2021 rules
        </span>
      )}
      {c.nmc2021Status === 'DOES_NOT_MEET' && <span className="mark red">Does not meet NMC 2021 rules</span>}
      {c.nmc2021Status === 'UNKNOWN' && <span className="mark grey">NMC 2021 rules unknown</span>}
      {c.nmcAlertStatus === 'ALERT' && (
        <span className="mark red">
          <Icon name="alert" size={14} /> NMC alert
        </span>
      )}
    </div>
  )
}

function Colleges({ detail }: { detail: CountryDetail }) {
  const { country, colleges } = detail
  const allListed = colleges.length > 0 && colleges.every((c) => c.wdomsListed === 'LISTED')
  return (
    <>
      <h2 id="colleges">Colleges in {country.name} we have checked</h2>
      <p>
        {allListed
          ? 'Each college is listed in the World Directory of Medical Schools.'
          : 'Each college shows its World Directory of Medical Schools status.'}{' '}
        Fees are for the whole course, in rupees, at the exchange rate on the date shown on the college page.
      </p>
      {colleges.length ? (
        <ul className="records" style={{ marginTop: 16 }}>
          {colleges.slice(0, SHOWN).map((c) => (
            <li key={c.slug} className="record" style={{ gridTemplateColumns: '1fr' }}>
              <div>
                <h3>
                  <MenuLink item={link(c.name, `/colleges/${c.slug}`)} />
                </h3>
                <p className="place">
                  {c.city} · {OWNERSHIP[c.ownership]}
                </p>
                <Marks c={c} />
              </div>
              <dl className="facts" style={{ gridTemplateColumns: 'repeat(3,auto)', justifyContent: 'start', gap: '8px 28px' }}>
                <div>
                  <dt>Total fees</dt>
                  <dd>{c.totalCourseFeeInr ? formatLakh(c.totalCourseFeeInr) : slot('total fee')}</dd>
                </div>
                <div>
                  <dt>Course</dt>
                  <dd>{courseLength(c.courseLengthMonths)}</dd>
                </div>
                <div>
                  <dt>Checked</dt>
                  <dd>{c.lastCheckedAt ? formatDate(c.lastCheckedAt) : NO_DATE}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p>No colleges in {country.name} are on our list yet.</p>
      )}
      {colleges.length > SHOWN && (
        <p style={{ marginTop: 16 }}>
          <MenuLink className="btn btn-secondary" item={link(`See all ${colleges.length} colleges in ${country.name}`, '/college-finder')} />
        </p>
      )}
    </>
  )
}

function Cost({ detail }: { detail: CountryDetail }) {
  const { content } = detail
  const fx = content.fx
  return (
    <>
      <h2 id="cost">What it really costs</h2>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Cost</th>
              <th className="r">Per year</th>
              <th className="r">Whole course</th>
            </tr>
          </thead>
          <tbody>
            {content.costRows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="r">{formatLakhRange(r.perYearInr.min, r.perYearInr.max)}</td>
                <td className="r">{formatLakhRange(r.wholeCourseInr.min, r.wholeCourseInr.max)}</td>
              </tr>
            ))}
          </tbody>
          <caption>
            {content.costNote}{' '}
            {fx
              ? `Exchange rate ${formatRate(fx.rateToInr)} per ${currencyName(fx.currency)} on ${formatDate(fx.asOf)}.`
              : `Exchange rate ${NO_DATE}.`}{' '}
            {content.lastCheckedAt ? `Checked ${formatDate(content.lastCheckedAt)}.` : `Checked: ${NO_DATE}.`}
          </caption>
        </table>
      </div>
      <Estimate lead="Fees are estimates." style={{ marginTop: 14 }} />
    </>
  )
}

function OnThisPage({ detail }: { detail: CountryDetail }) {
  const { navigation } = useRootData()
  const finder = navigation.tools.find((t) => t.icon === 'college')?.item
  const items = [
    ['valid', 'Is it valid in India?'],
    ['colleges', "Colleges we've checked"],
    ['cost', 'What it really costs'],
    ['eligible', 'Who can apply'],
    ['weigh', 'Things to weigh up'],
    ...(detail.faqs.length ? [['faq', 'Questions']] : []),
  ]
  return (
    <aside className="toc-side">
      <div className="visa security">
        <h2 style={{ fontSize: '1.125rem' }}>On this page</h2>
        <nav className="toc" style={{ marginTop: 8 }} aria-label="On this page">
          <ol>
            {items.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>
        {finder && (
          <>
            <hr className="perf" style={{ margin: '18px 0' }} />
            <p style={{ fontWeight: 650, marginBottom: 10 }}>Which colleges in {detail.country.name} fit your rank and budget?</p>
            <MenuLink className="btn btn-primary btn-block" item={finder}>
              Open the College Finder
            </MenuLink>
          </>
        )}
      </div>
    </aside>
  )
}

