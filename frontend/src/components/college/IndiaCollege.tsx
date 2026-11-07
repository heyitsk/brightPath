import { useState } from 'react'
import type { ClosingRank, CollegeFeeLine, IndiaCollegeDetail } from '../../data/colleges'
import { Icon } from '../Icon'
import { MenuLink } from '../site/MenuLink'
import { TalkToCounsellor } from '../site/TalkToCounsellor'
import { Crumbs } from './Crumbs'
import { HOME } from './home'
import { Estimate } from './Estimate'
import { FaqList } from './FaqList'
import { About } from './AbroadCollege'
import { SourcesList } from './SourcesList'
import { checkedOn, formatDate, formatInr, formatLakh, NO_DATE, slot } from './format'

const OWNERSHIP = { GOVERNMENT: 'Government', PRIVATE: 'Private', DEEMED: 'Deemed university', TRUST: 'Trust' } as const

const QUOTA_LABEL: Record<ClosingRank['quota'], string> = {
  STATE: 'State quota (85%)',
  ALL_INDIA: 'All India Quota',
  MANAGEMENT: 'Management quota',
  NRI: 'NRI quota',
  DEEMED: 'Deemed university quota',
}

const CATEGORY_ORDER: ClosingRank['category'][] = ['GENERAL', 'EWS', 'OBC', 'SC', 'ST']
const CATEGORY_LABEL: Record<ClosingRank['category'], string> = { GENERAL: 'General', EWS: 'EWS', OBC: 'OBC', SC: 'SC', ST: 'ST' }
const ROUNDS: ClosingRank['round'][] = [1, 2, 3, 'STRAY']
const roundLabel = (r: ClosingRank['round']) => (r === 'STRAY' ? 'Stray round' : `Round ${r}`)

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

const number = (n: number) => formatInr(n).replace(/^₹ /, '')

export function IndiaCollege({ detail }: { detail: IndiaCollegeDetail }) {
  const { college } = detail
  const counselling = {
    label: `NEET counselling: ${detail.stateName ?? detail.countryName}`,
    href: `/neet-counselling/${detail.stateSlug ?? ''}`,
    published: false,
  }
  return (
    <>
      <div className="wrap">
        <Crumbs parents={[HOME, counselling]} current={college.name} />
        <Header detail={detail} />
      </div>
      <hr className="perf" />
      <div className="wrap" style={{ paddingTop: 40, paddingBottom: 64 }}>
        <div className="prose" style={{ maxWidth: 880 }}>
          <ClosingRanks detail={detail} />
          <Fees detail={detail} />
          <HospitalAndTraining detail={detail} />
          <SeatRoute detail={detail} />
          {college.description && <About text={college.description} />}
          <FaqList faqs={detail.faqs} />
          <SourcesList detail={detail} />
        </div>
      </div>
      <TalkToCounsellor />
    </>
  )
}

/** The newest OBC state-quota rank, for the headline. Falls back to null when nothing is recorded. */
function headlineRank(ranks: ClosingRank[]): ClosingRank | null {
  const obc = ranks.filter((r) => r.category === 'OBC' && r.quota === 'STATE' && !r.isPwd)
  if (!obc.length) return null
  const year = Math.max(...obc.map((r) => r.year))
  const order = (r: ClosingRank['round']) => (r === 'STRAY' ? 4 : r)
  return obc.filter((r) => r.year === year).sort((a, b) => order(b.round) - order(a.round))[0]
}

function Header({ detail }: { detail: IndiaCollegeDetail }) {
  const { college, indiaProfile: p, sourceLinks } = detail
  const headline = headlineRank(detail.closingRanks)
  const seatLink = sourceLinks.find((l) => l.purpose === 'SEAT_LIST')
  const seatSource = seatLink && detail.sources.find((s) => s.id === seatLink.sourceId)
  const recognitionDate = p.nmcRecognitionCheckedAt ?? sourceLinks.find((l) => l.purpose === 'NMC_RECOGNITION')?.checkedAt ?? null
  const bond =
    p.serviceBondYears == null ? slot('service bond') : p.serviceBondYears === 0 ? 'None' : `${p.serviceBondYears} years`

  return (
    <header className="c-head">
      <div>
        <h1>{college.name}</h1>
        <p className="lead" style={{ marginTop: 10 }}>
          {college.city}, {detail.stateName} · {OWNERSHIP[college.ownership]} · Established {college.establishedYear ?? slot('year')} · MBBS
          seats: {p.mbbsSeats}
        </p>
        <div className="stamps">
          {p.nmcRecognised === true && (
            <span className="stamp navy">
              Recognised by NMC<span className="d">{checkedOn(recognitionDate)}</span>
            </span>
          )}
          {p.nmcRecognised === false && (
            <span className="stamp red">
              Not on the NMC recognised list<span className="d">{checkedOn(recognitionDate)}</span>
            </span>
          )}
          {p.nmcRecognised === null && (
            <span className="stamp navy">
              NMC recognition not confirmed<span className="d">{checkedOn(recognitionDate)}</span>
            </span>
          )}
          <span className="stamp" style={{ '--rot': '2deg' } as React.CSSProperties}>
            Seats: {p.mbbsSeats}
            <span className="d">
              {seatSource?.title ?? 'Seat list'}, {seatLink ? formatDate(seatLink.checkedAt) : NO_DATE}
            </span>
          </span>
        </div>
      </div>
      <div className="datapage datacard">
        {headline ? (
          <>
            <p className="k">Last OBC closing rank, state quota</p>
            <p className="big">{number(headline.closingRank)}</p>
            <p className="k" style={{ marginBottom: 16 }}>
              {detail.counsellingBody.name} {headline.year}, {roundLabel(headline.round).toLowerCase()} (All-India rank)
              <br />
              {checkedOn(headline.checkedAt)}
            </p>
          </>
        ) : (
          <>
            <p className="k">Fees, whole course</p>
            <p className="big">{detail.totalCourseFeeInr ? formatLakh(detail.totalCourseFeeInr) : slot('total fee')}</p>
            <p className="k" style={{ marginBottom: 16 }}>
              Closing ranks are not recorded yet for this college
            </p>
          </>
        )}
        <dl style={{ marginTop: 0 }}>
          <div>
            <dt>{headline ? 'Fees, whole course' : 'MBBS seats'}</dt>
            <dd>{headline ? (detail.totalCourseFeeInr ? formatLakh(detail.totalCourseFeeInr) : slot('total fee')) : p.mbbsSeats}</dd>
          </div>
          <div>
            <dt>Service bond</dt>
            <dd>{bond}</dd>
          </div>
          <div>
            <dt>Hospital beds</dt>
            <dd>{p.hospitalBeds ?? slot('number')}</dd>
          </div>
          <div>
            <dt>Stipend (intern)</dt>
            <dd>{p.stipendInr ? `${formatInr(p.stipendInr)} a month` : `${slot('₹ amount')} a month`}</dd>
          </div>
        </dl>
        <div style={{ display: 'grid', gap: 10 }}>
          <a className="btn btn-primary btn-block" href="#talk">
            Check my chances here
          </a>
          {/* The compare page is not built yet, so this does not link. */}
          <MenuLink className="btn btn-light btn-block" item={{ label: 'Add to compare', href: '/compare', published: false }}>
            <Icon name="scale" /> Add to compare
          </MenuLink>
        </div>
        <div style={{ marginTop: 14 }}>
          <Estimate lead="Past ranks don't promise a seat." />
        </div>
      </div>
    </header>
  )
}

function ClosingRanks({ detail }: { detail: IndiaCollegeDetail }) {
  const ranks = detail.closingRanks.filter((r) => !r.isPwd)
  const years = [...new Set(ranks.map((r) => r.year))].sort((a, b) => b - a)
  const quotas = [...new Set(ranks.map((r) => r.quota))]
  const [year, setYear] = useState(years[0])
  const [quota, setQuota] = useState(quotas[0])
  const [round, setRound] = useState<'ALL' | ClosingRank['round']>('ALL')

  if (!ranks.length) {
    return (
      <>
        <h2 style={{ marginTop: 0 }}>Past closing ranks</h2>
        <p>Closing ranks are not recorded yet for this college. {slot('source and date')}</p>
      </>
    )
  }

  const shown = ranks.filter((r) => r.year === year && r.quota === quota)
  const columns = round === 'ALL' ? ROUNDS : [round]
  const cell = (cat: ClosingRank['category'], r: ClosingRank['round']) => {
    const hit = shown.find((x) => x.category === cat && x.round === r)
    return hit ? number(hit.closingRank) : '–'
  }
  const source = detail.sources.find((s) => s.id === shown[0]?.sourceId)
  const checked = shown.map((r) => r.checkedAt).sort().at(-1) ?? null

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Past closing ranks</h2>
      <p>The last All-India rank that got a seat here, by quota, category and counselling round. Lower is harder.</p>
      <div className="filters">
        <select className="select" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Quota" value={quota} onChange={(e) => setQuota(e.target.value as ClosingRank['quota'])}>
          {quotas.map((q) => (
            <option key={q} value={q}>
              {QUOTA_LABEL[q]}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Round"
          value={String(round)}
          onChange={(e) => {
            const v = e.target.value
            setRound(v === 'ALL' ? 'ALL' : v === 'STRAY' ? 'STRAY' : (Number(v) as 1 | 2 | 3))
          }}
        >
          <option value="ALL">All rounds</option>
          {ROUNDS.map((r) => (
            <option key={r} value={String(r)}>
              {roundLabel(r)}
            </option>
          ))}
        </select>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              {columns.map((r) => (
                <th key={r} className={r === 'STRAY' && round === 'ALL' ? 'r hide-sm' : 'r'}>
                  {roundLabel(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((cat) => (
              <tr key={cat}>
                <td>{CATEGORY_LABEL[cat]}</td>
                {columns.map((r) => (
                  <td key={r} className={r === 'STRAY' && round === 'ALL' ? 'r hide-sm' : 'r'}>
                    {cell(cat, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <caption>
            Source: {source ? `${source.publisher}, ${source.title}` : 'source not recorded'}. {capitalize(checkedOn(checked))}. Candidates without a PwD
            certificate.
          </caption>
        </table>
      </div>
      <Estimate lead="Past ranks don't promise a seat." style={{ marginTop: 14 }} />
    </>
  )
}

function Fees({ detail }: { detail: IndiaCollegeDetail }) {
  const lines = [...detail.feeLines].sort((a, b) => (a.yearNumber ?? 99) - (b.yearNumber ?? 99))
  if (!lines.length) {
    return (
      <>
        <h2>Fees</h2>
        <p>{slot('Fees not recorded yet')}</p>
      </>
    )
  }
  const first = lines[0]
  // Full years are identical; the last line may be a half year, so it is left out of the comparison.
  const sameEveryYear = lines.slice(0, -1).every((l) => l.tuition === first.tuition && l.hostel === first.hostel && l.other === first.other)
  const sum = (key: 'tuition' | 'hostel' | 'other') => lines.reduce((s, l: CollegeFeeLine) => s + l[key], 0)
  const rows = [
    ['Tuition', 'tuition'],
    ['Hostel', 'hostel'],
    ['Other college fees', 'other'],
  ] as const
  const src = detail.sources.find((s) => s.id === first.sourceId)
  const checked = lines.map((l) => l.checkedAt).sort().at(-1) ?? null

  return (
    <>
      <h2>Fees</h2>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Fee</th>
              <th className="r">{sameEveryYear ? 'Per year' : 'Year 1'}</th>
              <th className="r">Whole course</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key]) => (
              <tr key={key}>
                <td>{label}</td>
                <td className="r">{formatInr(first[key])}</td>
                <td className="r">{formatInr(sum(key))}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Total</b>
              </td>
              <td className="r">
                <b>{formatInr(first.totalInr)}</b>
              </td>
              <td className="r">
                <b>{formatInr(lines.reduce((s, l) => s + l.totalInr, 0))}</b>
              </td>
            </tr>
          </tbody>
          <caption>
            Source: {src?.title ?? 'college fee notice'}, {checkedOn(checked)}. Whole course adds {lines.length - 1 + (lines.at(-1)!.academicYear.includes('half') ? 0.5 : 1)} years.
          </caption>
        </table>
      </div>
      <Estimate lead="Fees can change." style={{ marginTop: 14 }} />
    </>
  )
}

function HospitalAndTraining({ detail }: { detail: IndiaCollegeDetail }) {
  const { college, indiaProfile: p } = detail
  const penalty = p.serviceBondPenaltyInr ? formatInr(p.serviceBondPenaltyInr) : slot('₹ amount')
  let bond = slot('service bond')
  if (p.serviceBondYears === 0) bond = 'No service bond'
  else if (p.serviceBondYears != null) bond = `${p.serviceBondYears} years of service after MBBS, or a ${penalty} penalty`

  return (
    <>
      <h2>Hospital and training</h2>
      <dl className="kv">
        <dt>Teaching hospital</dt>
        <dd>
          {p.hospitalName ?? slot('Hospital name')}, {p.hospitalBeds ?? slot('beds')} beds
        </dd>
        <dt>Daily outpatients</dt>
        <dd>{p.dailyOutpatients ?? slot('number')}</dd>
        <dt>Service bond</dt>
        <dd>{bond}</dd>
        <dt>Stipend (intern)</dt>
        <dd>{p.stipendInr ? `${formatInr(p.stipendInr)} a month` : `${slot('₹ amount')} a month`}</dd>
      </dl>
      <p className="small muted">{college.lastCheckedAt ? `Checked ${formatDate(college.lastCheckedAt)}` : `Checked: ${NO_DATE}`}</p>
    </>
  )
}

function SeatRoute({ detail }: { detail: IndiaCollegeDetail }) {
  const { indiaProfile: p, sourceLinks } = detail
  const checked = sourceLinks.find((l) => l.purpose === 'COUNSELLING')?.checkedAt ?? null
  const guide = { label: `How ${detail.stateName ?? 'state'} counselling works`, href: '/neet-counselling', published: false }
  return (
    <>
      <h2>How to get a seat here</h2>
      <p>
        {p.domicileRule} <MenuLink item={guide} /> <Icon name="arrow" size={16} />
      </p>
      <p className="small muted">{checkedOn(checked)}</p>
    </>
  )
}
