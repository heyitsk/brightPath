import type { CSSProperties } from 'react'
import { isLive } from '../../data/navigation'
import type { AbroadCollegeDetail, CollegeFeeLine, CollegeSourceLink } from '../../data/colleges'
import { Icon } from '../Icon'
import { MenuLink } from '../site/MenuLink'
import { TalkToCounsellor } from '../site/TalkToCounsellor'
import { useDisclaimer } from '../site/config'
import { MissingDisclaimer } from '../site/MissingDisclaimer'
import { Crumbs } from '../shared/Crumbs'
import { HOME } from '../shared/home'
import { Estimate } from '../shared/Estimate'
import { FaqList } from '../shared/FaqList'
import { SourcesList } from './SourcesList'
import { checkedOn, courseLength, currencyName, formatDate, formatInr, formatLakh, formatRate, NO_DATE, slot } from '../shared/format'

const linkDate = (links: CollegeSourceLink[], purpose: CollegeSourceLink['purpose']) =>
  links.find((l) => l.purpose === purpose)?.checkedAt ?? null

const ownership = { GOVERNMENT: 'Public', PRIVATE: 'Private', DEEMED: 'Deemed', TRUST: 'Trust' } as const

/** Fee lines are in the foreign currency; the page shows rupees at the line's own rate. */
const inr = (amount: number, line: CollegeFeeLine) => Math.round(amount * line.fxRateToInr)

export function AbroadCollege({ detail }: { detail: AbroadCollegeDetail }) {
  const { college } = detail
  const countryHref = `/mbbs-abroad/${detail.countrySlug}`
  const country = { label: `MBBS in ${detail.countryName}`, href: countryHref, published: isLive(countryHref) }
  const asideTitle = detail.related.every((r) => r.city === college.city) ? college.city : detail.countryName
  return (
    <>
      <div className="wrap">
        <Crumbs parents={[HOME, country]} current={college.name} />
        <Header detail={detail} />
      </div>
      <hr className="perf" />
      <div className="wrap split side" style={{ padding: '40px var(--gut) 64px' }}>
        <article className="prose">
          <Gallery detail={detail} />
          <About text={college.description} />
          <Fees detail={detail} />
          <Recognition detail={detail} />
          <Eligibility detail={detail} />
          <FaqList faqs={detail.faqs} />
          <SourcesList detail={detail} />
        </article>
        <aside>
          <div className="visa security sticky-cta">
            <h2 style={{ fontSize: '1.125rem' }}>Other colleges in {asideTitle}</h2>
            {detail.related.length ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 16px' }}>
                {detail.related.map((r) => (
                  <li key={r.slug} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <MenuLink item={{ label: r.name, href: `/colleges/${r.slug}`, published: true }} />
                    <br />
                    <span className="small muted">
                      {r.totalCourseFeeInr ? `${formatLakh(r.totalCourseFeeInr)} total` : `${slot('total fee')} total`}
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

function Header({ detail }: { detail: AbroadCollegeDetail }) {
  const { college, abroadProfile: p, feeLines, sourceLinks } = detail
  const mrz = `COL<${detail.countryCode}<${college.slug.toUpperCase().replaceAll('-', '<')}<<${p.wdomsId ?? ''}`.padEnd(44, '<')
  const rate = feeLines[0]
  const sameRate = rate && feeLines.every((l) => l.fxRateToInr === rate.fxRateToInr && l.fxRateDate === rate.fxRateDate)
  const feeDate = linkDate(sourceLinks, 'FEE_NOTICE')
  let rateNote = 'No fee lines recorded yet'
  if (rate && sameRate) {
    const when = rate.fxRateDate ? ` on ${formatDate(rate.fxRateDate)}` : ` (rate ${NO_DATE})`
    rateNote = `Tuition, hostel and fees for ${feeLines.length} years, at ${formatRate(rate.fxRateToInr)} per ${currencyName(rate.currency)}${when}`
  } else if (rate) {
    rateNote = `Tuition, hostel and fees for ${feeLines.length} years, at the rates shown in the fee table`
  }

  return (
    <header className="c-head">
      <div>
        <h1>{college.name}</h1>
        <p className="lead" style={{ marginTop: 10 }}>
          {college.city}, {detail.countryName} · {ownership[college.ownership]} university · MBBS, {courseLength(p.courseLengthMonths)}
        </p>
        <Stamps detail={detail} />
        <p className="small muted">
          Each mark shows the date it was checked. <a href="#sources">See all sources</a>
        </p>
      </div>
      <div className="datapage datacard">
        <p className="k">Total cost, whole course</p>
        <p className="big">{detail.totalCourseFeeInr ? formatLakh(detail.totalCourseFeeInr) : slot('total fee')}</p>
        <p className="k" style={{ marginBottom: 16 }}>
          {rateNote}
        </p>
        <dl style={{ marginTop: 0 }}>
          <div>
            <dt>Taught in</dt>
            <dd>
              {p.teachingLanguage}
              {p.languageNote ? `, ${p.languageNote}` : ''}
            </dd>
          </div>
          <div>
            <dt>Intake</dt>
            <dd>{p.intakeMonths.length ? p.intakeMonths.join(', ') : slot('month')}</dd>
          </div>
          <div>
            <dt>Seats for Indians</dt>
            <dd>{p.seatsForIndians ?? slot('number')}</dd>
          </div>
          <div>
            <dt>Min. NEET</dt>
            <dd>{p.minNeet === 'QUALIFIED' ? 'Qualified' : slot('rule')}</dd>
          </div>
        </dl>
        <p className="k" style={{ marginBottom: 16 }}>
          {college.lastCheckedAt ? `Course facts checked ${formatDate(college.lastCheckedAt)}` : `Course facts ${NO_DATE}`}
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
function Stamps({ detail }: { detail: AbroadCollegeDetail }) {
  const { college, abroadProfile: p, sourceLinks, nmcNotices } = detail
  const wdomsDate = checkedOn(linkDate(sourceLinks, 'WDOMS'))
  // The 2021 rules check has no date of its own yet, so it uses the college's last check.
  const nmcRulesDate = checkedOn(college.lastCheckedAt)
  const alert = nmcNotices.find((n) => n.isActive)
  const alertDate = checkedOn(linkDate(sourceLinks, 'NMC_NOTICES'))
  const id = p.wdomsId ? `ID ${p.wdomsId} · ` : ''

  return (
    <div className="stamps">
      {p.wdomsListed === 'LISTED' && (
        <span className="stamp green">
          Listed in WDOMS
          <span className="d">
            {id}
            {wdomsDate}
          </span>
        </span>
      )}
      {p.wdomsListed === 'NOT_LISTED' && (
        <span className="stamp red">
          Not listed in WDOMS<span className="d">{wdomsDate}</span>
        </span>
      )}
      {p.wdomsListed === 'UNKNOWN' && (
        <span className="stamp navy">
          WDOMS listing unknown<span className="d">{wdomsDate}</span>
        </span>
      )}

      {p.nmc2021Status === 'MEETS' && (
        <span className="stamp">
          Meets NMC 2021 rules<span className="d">{nmcRulesDate}</span>
        </span>
      )}
      {p.nmc2021Status === 'DOES_NOT_MEET' && (
        <span className="stamp red">
          Does not meet NMC 2021 rules<span className="d">{nmcRulesDate}</span>
        </span>
      )}
      {p.nmc2021Status === 'UNKNOWN' && (
        <span className="stamp navy">
          NMC 2021 rules unknown<span className="d">{nmcRulesDate}</span>
        </span>
      )}

      {alert ? (
        <a className="stamp red" href={alert.url} rel="noopener noreferrer" target="_blank" style={{ textDecoration: 'none' }}>
          NMC alert<span className="d">notice of {formatDate(alert.publishedAt)}</span>
        </a>
      ) : (
        <span className="stamp navy">
          No NMC alert found<span className="d">{alertDate}</span>
        </span>
      )}
    </div>
  )
}

function Gallery({ detail }: { detail: AbroadCollegeDetail }) {
  const items = detail.college.galleryJSON
  if (!items.length) return null
  return (
    <div className="gallery">
      {items.map((g, i) =>
        g.url ? (
          <img key={g.caption} src={g.url} alt={g.caption} style={{ width: '100%', borderRadius: 'var(--r-lg)' }} />
        ) : (
          <div className="photo" key={g.caption}>
            <span>
              <strong>{g.caption}</strong>
              {i === 0 && 'Real photo, from the college or our visit, with credit'}
            </span>
          </div>
        ),
      )}
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

function Fees({ detail }: { detail: AbroadCollegeDetail }) {
  const lines = [...detail.feeLines].sort((a, b) => (a.yearNumber ?? 99) - (b.yearNumber ?? 99))
  if (!lines.length) {
    return (
      <>
        <h2>Fees, year by year</h2>
        <p>{slot('Fees not recorded yet')}</p>
      </>
    )
  }
  const first = lines[0]
  const src = detail.sources.find((s) => s.id === first.sourceId)
  const total = lines.reduce((sum, l) => sum + l.totalInr, 0)
  const checked = lines.map((l) => l.checkedAt).sort().at(-1) ?? null
  const unit = currencyName(first.currency)

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
              <tr key={l.academicYear + l.scope}>
                <td>{l.scope === 'ONE_TIME' ? 'One time' : `Year ${l.yearNumber}`}</td>
                <td className="r">{formatInr(inr(l.tuition, l))}</td>
                <td className="r hide-sm">{formatInr(inr(l.hostel, l))}</td>
                <td className="r hide-sm">{formatInr(inr(l.other, l))}</td>
                <td className="r">
                  <b>{formatInr(l.totalInr)}</b>
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
        Total includes hostel and other fees. Amounts are converted from {unit}s at {formatRate(first.fxRateToInr)} per {unit}
        {first.fxRateDate ? ` on ${formatDate(first.fxRateDate)}` : ` (rate ${NO_DATE})`}. Source: {src?.title ?? 'college fee notice'},{' '}
        {checkedOn(checked)}. Food, flights and visa are not included.
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

function Recognition({ detail }: { detail: AbroadCollegeDetail }) {
  const { college, abroadProfile: p, sourceLinks, nmcNotices } = detail
  const foreign = useDisclaimer('FOREIGN_COLLEGES_NMC')
  const wdomsChecked = linkDate(sourceLinks, 'WDOMS')
  const alertChecked = linkDate(sourceLinks, 'NMC_NOTICES')
  const alerts = nmcNotices.filter((n) => n.isActive)
  const redH3: CSSProperties = { color: 'var(--red)' }
  const rulesNote = `NMC does not approve foreign colleges; it is your course that must meet these rules.`

  return (
    <>
      <h2>Recognition, explained</h2>

      <div className="callout">
        {p.wdomsListed === 'LISTED' && (
          <>
            <h3>
              <Icon name="check" size={16} /> Listed in the World Directory of Medical Schools
            </h3>
            <p>
              The college has an entry in WDOMS{p.wdomsId ? `, ID ${p.wdomsId}` : ''}. {checkedOn(wdomsChecked)}.{' '}
              {p.wdomsUrl && (
                <a href={p.wdomsUrl} rel="noopener noreferrer" target="_blank">
                  View the entry <Icon name="ext" size={14} />
                </a>
              )}
            </p>
          </>
        )}
        {p.wdomsListed === 'NOT_LISTED' && (
          <>
            <h3 style={redH3}>
              <Icon name="alert" size={16} /> Not listed in the World Directory of Medical Schools
            </h3>
            <p>We could not find this college in WDOMS. {checkedOn(wdomsChecked)}.</p>
          </>
        )}
        {p.wdomsListed === 'UNKNOWN' && (
          <>
            <h3>WDOMS listing not confirmed yet</h3>
            <p>We have not yet confirmed whether this college is in WDOMS. {checkedOn(wdomsChecked)}.</p>
          </>
        )}
      </div>

      <div className="callout">
        {p.nmc2021Status === 'MEETS' && (
          <>
            <h3>
              <Icon name="shield" size={16} /> Meets NMC's 2021 rules for study abroad
            </h3>
            <p>
              The course runs {courseLength(p.courseLengthMonths)}, is taught in {p.teachingLanguage}
              {p.internshipMonths ? `, and includes a ${p.internshipMonths}-month internship` : ''}. {checkedOn(college.lastCheckedAt)}.{' '}
              {rulesNote}
            </p>
          </>
        )}
        {p.nmc2021Status === 'DOES_NOT_MEET' && (
          <>
            <h3 style={redH3}>
              <Icon name="alert" size={16} /> Does not meet NMC's 2021 rules for study abroad
            </h3>
            <p>
              At least one of the three rules is not met. {checkedOn(college.lastCheckedAt)}. {rulesNote}
            </p>
          </>
        )}
        {p.nmc2021Status === 'UNKNOWN' && (
          <>
            <h3>NMC 2021 rules: not fully checked yet</h3>
            <p>
              We have not been able to confirm all three rules for this course. {checkedOn(college.lastCheckedAt)}. {rulesNote}
            </p>
          </>
        )}
        <ul>
          <Check ok={p.nmcLengthOk} label="Course length of at least 54 months" />
          <Check ok={p.nmcEnglishOk} label="Taught in English" />
          <Check ok={p.nmcInternshipOk} label="12-month internship at the same college" />
        </ul>
      </div>

      {alerts.length ? (
        <div className="callout" style={{ borderColor: 'var(--red)' }}>
          <h3 style={redH3}>
            <Icon name="alert" size={16} /> NMC alert
          </h3>
          {alerts.map((n) => (
            <p key={n.url}>
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
            {alertChecked ? `We checked NMC's public notices on ${formatDate(alertChecked)}.` : `NMC notices check ${NO_DATE}.`} If
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

function Eligibility({ detail }: { detail: AbroadCollegeDetail }) {
  const { college, abroadProfile: p } = detail
  const pcb = p.eligibility.class12Pcb.map((c) => `${c.category} ${c.percent}%`).join(', ')
  return (
    <>
      <h2>Who can apply</h2>
      <dl className="kv">
        <dt>NEET UG</dt>
        <dd>{p.minNeet === 'QUALIFIED' ? 'Qualified' : slot('rule')}</dd>
        <dt>Class 12 PCB</dt>
        <dd>{pcb || slot('marks rule')}</dd>
        <dt>Age</dt>
        <dd>{p.eligibility.ageRule ?? slot('age rule')}</dd>
        <dt>Documents</dt>
        <dd>{p.documents.length ? p.documents.join(', ') : slot('documents')}</dd>
      </dl>
      <p className="small muted">{college.lastCheckedAt ? `Checked ${formatDate(college.lastCheckedAt)}` : `Checked: ${NO_DATE}`}</p>
    </>
  )
}
