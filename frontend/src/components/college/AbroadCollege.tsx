import { Fragment, type CSSProperties } from 'react'
import { collegeLink, isLive } from '../../data/navigation'
import type { AbroadCollegePage, CollegePage } from '../../data/colleges'
import { Icon } from '../Icon'
import { MenuLink } from '../site/MenuLink'
import { TalkToCounsellor } from '../site/TalkToCounsellor'
import { useDisclaimer } from '../site/config'
import { MissingDisclaimer } from '../site/MissingDisclaimer'
import { Crumbs } from '../shared/Crumbs'
import { HOME } from '../shared/home'
import { Estimate } from '../shared/Estimate'
import { FaqList } from '../shared/FaqList'
import { feesChecked, sortedFees } from './college-data'
import { SourcesList } from './SourcesList'
import {
  checkedOn,
  courseLength,
  currencyName,
  formatDate,
  formatInr,
  formatLakh,
  formatRate,
  MONTHS,
  NO_DATE,
  slot,
} from '../shared/format'

type FeeLine = CollegePage['fees'][number]
type Props = { college: AbroadCollegePage }

const ownership = { GOVERNMENT: 'Public', PRIVATE: 'Private', DEEMED: 'Deemed', TRUST: 'Trust' } as const

/** Fee lines are in the college's currency; the page shows rupees at the line's own rate. */
const inr = (amount: number, line: FeeLine) => Math.round(amount * line.rateToInr)

/** True when every line is in the same currency at the same rate, so one rate can be quoted. */
const oneRate = (fees: FeeLine[]) =>
  fees.length > 0 && fees.every((l) => l.currency === fees[0].currency && l.rateToInr === fees[0].rateToInr)

/**
 * The NEET rule. Staff may set it as the "NEET UG" eligibility entry. Without one, it is the NMC
 * rule for every Indian student studying MBBS abroad, not a fact about the college.
 */
const NEET_KEY = 'NEET UG'
const neetRule = (p: AbroadCollegePage['abroad']) => p.eligibility?.[NEET_KEY] ?? 'Qualified'

const countryName = (college: AbroadCollegePage) => college.country?.name ?? slot('country')

export function AbroadCollege({ college }: Props) {
  const countryHref = `/mbbs-abroad/${college.country?.slug ?? ''}`
  const country = { label: `MBBS in ${countryName(college)}`, href: countryHref, published: isLive(countryHref) }
  const asideTitle = college.nearby.every((r) => r.city === college.city) ? college.city : countryName(college)
  return (
    <>
      <div className="wrap">
        <Crumbs parents={[HOME, country]} current={college.name} />
        <Header college={college} />
      </div>
      <hr className="perf" />
      <div className="wrap split side" style={{ padding: '40px var(--gut) 64px' }}>
        <article className="prose">
          <Gallery college={college} />
          {college.description && <About text={college.description} />}
          <Fees college={college} />
          <Recognition college={college} />
          <Eligibility college={college} />
          <FaqList faqs={college.faqs} />
          <SourcesList sources={college.sources} />
        </article>
        <aside>
          <div className="visa security sticky-cta">
            <h2 style={{ fontSize: '1.125rem' }}>Other colleges in {asideTitle}</h2>
            {college.nearby.length ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 16px' }}>
                {college.nearby.map((r) => (
                  <li key={r.slug} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <MenuLink item={collegeLink(r)} />
                    <br />
                    <span className="small muted">
                      {r.totalCourseFeeInr != null ? `${formatLakh(Number(r.totalCourseFeeInr))} total` : `${slot('total fee')} total`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted" style={{ margin: '10px 0 16px' }}>
                No other colleges listed yet.
              </p>
            )}
            {/* The compare page is not built yet, so this does not link. */}
            <MenuLink
              className="btn btn-secondary btn-block"
              item={{ label: 'Compare with similar colleges', href: '/compare', published: false }}
            />
          </div>
        </aside>
      </div>
      <TalkToCounsellor />
    </>
  )
}

function Header({ college }: Props) {
  const p = college.abroad
  const fees = college.fees
  // The API sends no country code; this decorative line uses the first letters of the country slug.
  const code = (college.country?.slug ?? '').slice(0, 3).toUpperCase()
  const mrz = `COL<${code}<${college.slug.toUpperCase().replaceAll('-', '<')}<<${p.wdoms.id ?? ''}`.padEnd(44, '<')
  const rate = fees[0]
  const feeDate = feesChecked(fees)
  let rateNote = 'No fee lines recorded yet'
  if (rate && oneRate(fees) && rate.currency === 'INR') {
    rateNote = `Tuition, hostel and fees for ${fees.length} years, in rupees`
  } else if (rate && oneRate(fees)) {
    const when = college.feeRatesAsOf ? ` on ${formatDate(college.feeRatesAsOf)}` : ` (rate ${NO_DATE})`
    rateNote = `Tuition, hostel and fees for ${fees.length} years, at ${formatRate(rate.rateToInr)} per ${currencyName(rate.currency)}${when}`
  } else if (rate) {
    rateNote = `Tuition, hostel and fees for ${fees.length} years, at the rates shown in the fee table`
  }

  return (
    <header className="c-head">
      <div>
        <h1>{college.name}</h1>
        <p className="lead" style={{ marginTop: 10 }}>
          {college.city}, {countryName(college)} · {college.ownership ? ownership[college.ownership] : slot('ownership')} university ·
          MBBS, {courseLength(college.courseLengthMonths)}
        </p>
        <Stamps college={college} />
        <p className="small muted">
          Each mark shows the date it was checked. <a href="#sources">See all sources</a>
        </p>
      </div>
      <div className="datapage datacard">
        <p className="k">Total cost, whole course</p>
        <p className="big">{college.totalCourseFeeInr != null ? formatLakh(Number(college.totalCourseFeeInr)) : slot('total fee')}</p>
        <p className="k" style={{ marginBottom: 16 }}>
          {rateNote}
        </p>
        <dl style={{ marginTop: 0 }}>
          <div>
            <dt>Taught in</dt>
            <dd>
              {p.teachingLanguage ?? slot('language')}
              {p.languageNote ? `, ${p.languageNote}` : ''}
            </dd>
          </div>
          <div>
            <dt>Intake</dt>
            <dd>{p.intakeMonths.length ? p.intakeMonths.map((m) => MONTHS[Number(m) - 1] ?? String(m)).join(', ') : slot('month')}</dd>
          </div>
          <div>
            <dt>Seats for Indians</dt>
            <dd>{p.seatsForIndians != null ? Number(p.seatsForIndians) : slot('number')}</dd>
          </div>
          <div>
            <dt>Min. NEET</dt>
            <dd>{neetRule(p)}</dd>
          </div>
        </dl>
        <p className="k" style={{ marginBottom: 16 }}>
          {college.dataCheckedAt ? `Course facts checked ${formatDate(college.dataCheckedAt)}` : `Course facts ${NO_DATE}`}
          {feeDate ? `, fees checked ${formatDate(feeDate)}` : ''}
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <a className="btn btn-primary btn-block" href="#talk">
            Talk to a counsellor about this college
          </a>
          {/* The compare page is not built yet, so this does not link. */}
          <MenuLink className="btn btn-light btn-block" item={{ label: 'Add to compare', href: '/compare', published: false }}>
            <Icon name="scale" /> Add to compare
          </MenuLink>
        </div>
        <div style={{ marginTop: 14 }}>
          <Estimate lead="Fees can change." />
        </div>
        <p className="mrz" aria-hidden="true">
          {mrz}
        </p>
      </div>
    </header>
  )
}

/** The three official marks. Wording follows the rules: never "approved" for a foreign college. */
function Stamps({ college }: Props) {
  const { wdoms, nmc2021 } = college.abroad
  const { nmc } = college
  const wdomsDate = checkedOn(wdoms.checkedAt)
  const nmcRulesDate = checkedOn(nmc2021.checkedAt)
  const alert = nmc.alert !== 'NONE'
  const notice = alert ? nmc.notices[0] : undefined
  const alertDate = checkedOn(nmc.checkedAt)
  const id = wdoms.id ? `ID ${wdoms.id} · ` : ''

  return (
    <div className="stamps">
      {wdoms.status === 'LISTED' && (
        <span className="stamp green">
          Listed in WDOMS
          <span className="d">
            {id}
            {wdomsDate}
          </span>
        </span>
      )}
      {wdoms.status === 'NOT_LISTED' && (
        <span className="stamp red">
          Not listed in WDOMS<span className="d">{wdomsDate}</span>
        </span>
      )}
      {wdoms.status === 'UNKNOWN' && (
        <span className="stamp navy">
          WDOMS listing unknown<span className="d">{wdomsDate}</span>
        </span>
      )}

      {nmc2021.status === 'MEETS' && (
        <span className="stamp">
          Meets NMC 2021 rules<span className="d">{nmcRulesDate}</span>
        </span>
      )}
      {nmc2021.status === 'DOES_NOT_MEET' && (
        <span className="stamp red">
          Does not meet NMC 2021 rules<span className="d">{nmcRulesDate}</span>
        </span>
      )}
      {nmc2021.status === 'UNKNOWN' && (
        <span className="stamp navy">
          NMC 2021 rules unknown<span className="d">{nmcRulesDate}</span>
        </span>
      )}

      {notice && (
        <a className="stamp red" href={notice.url} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'none' }}>
          NMC alert<span className="d">notice of {formatDate(notice.publishedAt)}</span>
        </a>
      )}
      {alert && !notice && (
        <span className="stamp red">
          NMC alert<span className="d">{alertDate}</span>
        </span>
      )}
      {!alert && (
        <span className="stamp navy">
          No NMC alert found<span className="d">{alertDate}</span>
        </span>
      )}
    </div>
  )
}

/** The college's own photo, when there is one. No placeholder tile on a public page. */
function Gallery({ college }: Props) {
  if (!college.heroImageUrl) return null
  return (
    <div className="gallery">
      <img src={college.heroImageUrl} alt={college.name} style={{ width: '100%', borderRadius: 'var(--r-lg)' }} />
    </div>
  )
}

export function About({ text }: { text: string }) {
  return (
    <>
      <h2>About the college</h2>
      {text.split(/\n\s*\n/).map((para) => (
        <p key={para}>{para}</p>
      ))}
    </>
  )
}

function Fees({ college }: Props) {
  const lines = sortedFees(college.fees)
  if (!lines.length) {
    return (
      <>
        <h2>Fees, year by year</h2>
        <p>{slot('Fees not recorded yet')}</p>
      </>
    )
  }
  const first = lines[0]
  const total = lines.reduce((sum, l) => sum + Number(l.totalInr), 0)
  const checked = feesChecked(lines)
  const unit = currencyName(first.currency)
  const when = college.feeRatesAsOf ? ` on ${formatDate(college.feeRatesAsOf)}` : ` (rate ${NO_DATE})`
  let converted = 'Amounts are in rupees.'
  if (oneRate(lines) && first.currency !== 'INR') {
    converted = `Amounts are converted from ${unit}s at ${formatRate(first.rateToInr)} per ${unit}${when}.`
  } else if (!oneRate(lines)) {
    converted = `Amounts are converted to rupees at each line's own rate${when}.`
  }

  return (
    <>
      <h2>Fees, year by year</h2>
      <div className="tbl-wrap">
        <table className="fees-tbl">
          <thead>
            <tr>
              <th>Year</th>
              <th className="r">Tuition</th>
              <th className="r hide-sm">Hostel</th>
              <th className="r hide-sm">Other</th>
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={String(l.yearNumber)}>
                <td>Year {Number(l.yearNumber)}</td>
                <td className="r">{formatInr(inr(l.tuition, l))}</td>
                <td className="r hide-sm">{formatInr(inr(l.hostel, l))}</td>
                <td className="r hide-sm">{formatInr(inr(l.other, l))}</td>
                <td className="r">
                  <b>{formatInr(Number(l.totalInr))}</b>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Whole course</b>
              </td>
              <td className="r" />
              <td className="r hide-sm" />
              <td className="r hide-sm" />
              <td className="r">
                <b>{formatInr(total)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="tbl-note">
        Total includes hostel and other fees. {converted} Source: {first.source?.title ?? 'college fee notice'}, {checkedOn(checked)}. Food,
        flights and visa are not included.
      </p>
      <Estimate lead="Fees can change." />
    </>
  )
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <li>
      {label}: {ok === true ? 'yes' : ok === false ? 'no' : 'not checked yet'}
    </li>
  )
}

function Recognition({ college }: Props) {
  const p = college.abroad
  const { wdoms, nmc2021 } = p
  const { nmc } = college
  const foreign = useDisclaimer('FOREIGN_COLLEGES_NMC')
  const alerts = nmc.alert !== 'NONE' ? nmc.notices : []
  const redH3: CSSProperties = { color: 'var(--red)' }
  const rulesNote = `NMC does not approve foreign colleges; it is your course that must meet these rules.`

  return (
    <>
      <h2>Recognition, explained</h2>

      <div className="callout">
        {wdoms.status === 'LISTED' && (
          <>
            <h3>
              <Icon name="check" size={16} /> Listed in the World Directory of Medical Schools
            </h3>
            <p>
              The college has an entry in WDOMS{wdoms.id ? `, ID ${wdoms.id}` : ''}. {checkedOn(wdoms.checkedAt)}.{' '}
              {wdoms.url && (
                <a href={wdoms.url} rel="noopener noreferrer" target="_blank">
                  View the entry <Icon name="ext" size={14} />
                </a>
              )}
            </p>
          </>
        )}
        {wdoms.status === 'NOT_LISTED' && (
          <>
            <h3 style={redH3}>
              <Icon name="alert" size={16} /> Not listed in the World Directory of Medical Schools
            </h3>
            <p>We could not find this college in WDOMS. {checkedOn(wdoms.checkedAt)}.</p>
          </>
        )}
        {wdoms.status === 'UNKNOWN' && (
          <>
            <h3>WDOMS listing not confirmed yet</h3>
            <p>We have not yet confirmed whether this college is in WDOMS. {checkedOn(wdoms.checkedAt)}.</p>
          </>
        )}
      </div>

      <div className="callout">
        {nmc2021.status === 'MEETS' && (
          <>
            <h3>
              <Icon name="shield" size={16} /> Meets NMC's 2021 rules for study abroad
            </h3>
            <p>
              The course runs {courseLength(college.courseLengthMonths)}, is taught in {p.teachingLanguage ?? slot('language')}
              {p.internshipMonths != null ? `, and includes a ${Number(p.internshipMonths)}-month internship` : ''}.{' '}
              {checkedOn(nmc2021.checkedAt)}. {rulesNote}
            </p>
          </>
        )}
        {nmc2021.status === 'DOES_NOT_MEET' && (
          <>
            <h3 style={redH3}>
              <Icon name="alert" size={16} /> Does not meet NMC's 2021 rules for study abroad
            </h3>
            <p>
              At least one of the three rules is not met. {checkedOn(nmc2021.checkedAt)}. {rulesNote}
            </p>
          </>
        )}
        {nmc2021.status === 'UNKNOWN' && (
          <>
            <h3>NMC 2021 rules: not fully checked yet</h3>
            <p>
              We have not been able to confirm all three rules for this course. {checkedOn(nmc2021.checkedAt)}. {rulesNote}
            </p>
          </>
        )}
        <ul>
          <Check ok={nmc2021.lengthOk} label="Course length of at least 54 months" />
          <Check ok={nmc2021.englishOk} label="Taught in English" />
          <Check ok={nmc2021.internshipOk} label="12-month internship at the same college" />
        </ul>
      </div>

      {alerts.length ? (
        <div className="callout" style={{ borderColor: 'var(--red)' }}>
          <h3 style={redH3}>
            <Icon name="alert" size={16} /> NMC alert
          </h3>
          {alerts.map((n) => (
            <p key={`${n.url}-${n.publishedAt}`}>
              <a href={n.url} rel="noopener noreferrer" target="_blank">
                {n.title} <Icon name="ext" size={14} />
              </a>{' '}
              <span className="muted">
                Notice of {formatDate(n.publishedAt)}, {checkedOn(n.checkedAt)}.
              </span>
            </p>
          ))}
        </div>
      ) : (
        <div className="callout">
          <h3>No NMC alert found</h3>
          <p>
            {nmc.checkedAt ? `We checked NMC's public notices on ${formatDate(nmc.checkedAt)}.` : `NMC notices check ${NO_DATE}.`} If
            NMC issues an alert about this college, it will appear here in red.
          </p>
        </div>
      )}

      {foreign ? (
        <p className="estimate">
          <Icon name="info" />
          <span>{foreign}</span>
        </p>
      ) : (
        <MissingDisclaimer name="FOREIGN_COLLEGES_NMC" />
      )}
    </>
  )
}

function Eligibility({ college }: Props) {
  const p = college.abroad
  // Staff write eligibility as { label: rule } pairs; NEET UG has its own first row.
  const rules = Object.entries(p.eligibility ?? {}).filter(([label]) => label !== NEET_KEY)
  return (
    <>
      <h2>Who can apply</h2>
      <dl className="kv">
        <dt>NEET UG</dt>
        <dd>{neetRule(p)}</dd>
        {rules.length ? (
          rules.map(([label, rule]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{rule}</dd>
            </Fragment>
          ))
        ) : (
          <>
            <dt>Class 12 PCB</dt>
            <dd>{slot('marks rule')}</dd>
            <dt>Age</dt>
            <dd>{slot('age rule')}</dd>
          </>
        )}
        <dt>Documents</dt>
        <dd>{p.documents.length ? p.documents.join(', ') : slot('documents')}</dd>
      </dl>
      <p className="small muted">{college.dataCheckedAt ? `Checked ${formatDate(college.dataCheckedAt)}` : `Checked: ${NO_DATE}`}</p>
    </>
  )
}
