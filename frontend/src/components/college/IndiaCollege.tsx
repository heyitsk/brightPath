import { isLive } from '../../data/navigation'
import type { CollegePage, IndiaCollegePage } from '../../data/colleges'
import { Icon } from '../Icon'
import { MenuLink } from '../site/MenuLink'
import { TalkToCounsellor } from '../site/TalkToCounsellor'
import { Crumbs } from '../shared/Crumbs'
import { HOME } from '../shared/home'
import { Estimate } from '../shared/Estimate'
import { FaqList } from '../shared/FaqList'
import { About } from './AbroadCollege'
import { feesChecked, sortedFees } from './college-data'
import { SourcesList } from './SourcesList'
import { checkedOn, formatDate, formatInr, formatLakh, NO_DATE, slot } from '../shared/format'

type Props = { college: IndiaCollegePage }

const OWNERSHIP = { GOVERNMENT: 'Government', PRIVATE: 'Private', DEEMED: 'Deemed university', TRUST: 'Trust' } as const

/** The source with this purpose, e.g. SEAT_LIST or COUNSELLING. */
const source = (college: CollegePage, purpose: string) => college.sources.find((s) => s.purpose === purpose)

const counsellingLink = (college: IndiaCollegePage, label: string) => {
  const href = `/neet-counselling/${college.state?.slug ?? ''}`
  return { label, href, published: isLive(href) }
}

const seats = (p: IndiaCollegePage['india']) => (p.mbbsSeats != null ? Number(p.mbbsSeats) : slot('number'))
const totalFee = (college: IndiaCollegePage) =>
  college.totalCourseFeeInr != null ? formatLakh(Number(college.totalCourseFeeInr)) : slot('total fee')
const stipend = (p: IndiaCollegePage['india']) =>
  p.stipendInr != null ? `${formatInr(Number(p.stipendInr))} a month` : `${slot('₹ amount')} a month`

export function IndiaCollege({ college }: Props) {
  const counselling = counsellingLink(college, `NEET counselling: ${college.state?.name ?? college.country?.name ?? slot('state')}`)
  return (
    <>
      <div className="wrap">
        <Crumbs parents={[HOME, counselling]} current={college.name} />
        <Header college={college} />
      </div>
      <hr className="perf" />
      <div className="wrap" style={{ paddingTop: 40, paddingBottom: 64 }}>
        <div className="prose" style={{ maxWidth: 880 }}>
          {/* Closing ranks are not in the API yet (phase 5). */}
          <h2 style={{ marginTop: 0 }}>Past closing ranks</h2>
          <p>Closing ranks are not recorded yet for this college.</p>
          <Fees college={college} />
          <HospitalAndTraining college={college} />
          <SeatRoute college={college} />
          {college.description && <About text={college.description} />}
          <FaqList faqs={college.faqs} />
          <SourcesList sources={college.sources} />
        </div>
      </div>
      <TalkToCounsellor />
    </>
  )
}

function Header({ college }: Props) {
  const p = college.india
  const seatSource = source(college, 'SEAT_LIST')
  const recognitionDate = p.nmcRecognitionCheckedAt ?? source(college, 'NMC_RECOGNITION')?.checkedAt ?? null
  const bond = p.serviceBond && Number(p.serviceBond.years) > 0 ? `${Number(p.serviceBond.years)} years` : 'None'

  return (
    <header className="c-head">
      <div>
        <h1>{college.name}</h1>
        <p className="lead" style={{ marginTop: 10 }}>
          {college.city}, {college.state?.name ?? slot('state')} · {college.ownership ? OWNERSHIP[college.ownership] : slot('ownership')} ·
          Established {college.establishedYear != null ? Number(college.establishedYear) : slot('year')} · MBBS seats: {seats(p)}
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
            Seats: {seats(p)}
            <span className="d">
              {seatSource?.title ?? 'Seat list'}, {seatSource ? formatDate(seatSource.checkedAt) : NO_DATE}
            </span>
          </span>
        </div>
      </div>
      <div className="datapage datacard">
        <p className="k">Fees, whole course</p>
        <p className="big">{totalFee(college)}</p>
        <p className="k" style={{ marginBottom: 16 }}>
          Closing ranks are not recorded yet for this college
        </p>
        <dl style={{ marginTop: 0 }}>
          <div>
            <dt>MBBS seats</dt>
            <dd>{seats(p)}</dd>
          </div>
          <div>
            <dt>Service bond</dt>
            <dd>{bond}</dd>
          </div>
          <div>
            <dt>Hospital beds</dt>
            <dd>{p.hospital.beds != null ? Number(p.hospital.beds) : slot('number')}</dd>
          </div>
          <div>
            <dt>Stipend (intern)</dt>
            <dd>{stipend(p)}</dd>
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

function Fees({ college }: Props) {
  const lines = sortedFees(college.fees)
  if (!lines.length) {
    return (
      <>
        <h2>Fees</h2>
        <p>{slot('Fees not recorded yet')}</p>
      </>
    )
  }
  const first = lines[0]
  // Full years are identical; the last line may be a part year, so it is left out of the comparison.
  const sameEveryYear = lines.slice(0, -1).every((l) => l.tuition === first.tuition && l.hostel === first.hostel && l.other === first.other)
  const sum = (key: 'tuition' | 'hostel' | 'other') => lines.reduce((s, l) => s + l[key], 0)
  const rows = [
    ['Tuition', 'tuition'],
    ['Hostel', 'hostel'],
    ['Other college fees', 'other'],
  ] as const
  const years = lines.length

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
                <b>{formatInr(Number(first.totalInr))}</b>
              </td>
              <td className="r">
                <b>{formatInr(lines.reduce((s, l) => s + Number(l.totalInr), 0))}</b>
              </td>
            </tr>
          </tbody>
          <caption>
            Source: {first.source?.title ?? 'college fee notice'}, {checkedOn(feesChecked(lines))}. Whole course adds {years}{' '}
            {years === 1 ? 'year' : 'years'}.
          </caption>
        </table>
      </div>
      <Estimate lead="Fees can change." style={{ marginTop: 14 }} />
    </>
  )
}

function HospitalAndTraining({ college }: Props) {
  const p = college.india
  const { serviceBond } = p
  let bond = 'No service bond'
  if (serviceBond && Number(serviceBond.years) > 0) {
    const penalty = serviceBond.penaltyInr != null ? formatInr(Number(serviceBond.penaltyInr)) : slot('₹ amount')
    bond = `${Number(serviceBond.years)} years of service after MBBS, or a ${penalty} penalty`
  }

  return (
    <>
      <h2>Hospital and training</h2>
      <dl className="kv">
        <dt>Teaching hospital</dt>
        <dd>
          {p.hospital.name ?? slot('Hospital name')}, {p.hospital.beds != null ? Number(p.hospital.beds) : slot('beds')} beds
        </dd>
        <dt>Daily outpatients</dt>
        <dd>{p.hospital.dailyOutpatients != null ? Number(p.hospital.dailyOutpatients) : slot('number')}</dd>
        <dt>Service bond</dt>
        <dd>{bond}</dd>
        <dt>Stipend (intern)</dt>
        <dd>{stipend(p)}</dd>
      </dl>
      <p className="small muted">{college.dataCheckedAt ? `Checked ${formatDate(college.dataCheckedAt)}` : `Checked: ${NO_DATE}`}</p>
    </>
  )
}

function SeatRoute({ college }: Props) {
  const p = college.india
  const checked = source(college, 'COUNSELLING')?.checkedAt ?? null
  const guide = counsellingLink(college, `How ${college.state?.name ?? 'state'} counselling works`)
  return (
    <>
      <h2>How to get a seat here</h2>
      <p>
        {p.domicileRule ?? slot('domicile rule')} <MenuLink item={guide} /> <Icon name="arrow" size={16} />
      </p>
      <p className="small muted">{checkedOn(checked)}</p>
    </>
  )
}
