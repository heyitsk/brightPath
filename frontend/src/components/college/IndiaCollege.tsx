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
import { checkedOn, formatDate, formatInr, formatInrShort, NO_DATE, NOT_RECORDED } from '../shared/format'

type Props = { college: IndiaCollegePage }

const OWNERSHIP = { GOVERNMENT: 'Government', PRIVATE: 'Private', DEEMED: 'Deemed university', TRUST: 'Trust' } as const

/** The source with this purpose, e.g. SEAT_LIST or COUNSELLING. */
const source = (college: CollegePage, purpose: string) => college.sources.find((s) => s.purpose === purpose)

const counsellingLink = (college: IndiaCollegePage, label: string) => {
  const href = `/neet-counselling/${college.state?.slug ?? ''}`
  return { label, href, published: isLive(href) }
}

const seats = (p: IndiaCollegePage['india']) => (p.mbbsSeats != null ? Number(p.mbbsSeats) : NOT_RECORDED)
const totalFee = (college: IndiaCollegePage) =>
  college.totalCourseFeeInr != null ? formatInrShort(Number(college.totalCourseFeeInr)) : NOT_RECORDED
const stipend = (p: IndiaCollegePage['india']) =>
  p.stipendInr != null ? `${formatInr(Number(p.stipendInr))} a month` : NOT_RECORDED

/**
 * Service bond in short (card) and long (section) wording. null means not recorded; only
 * years === 0 means the college has no bond.
 */
function bondText(bond: IndiaCollegePage['india']['serviceBond']): { short: string; long: string } {
  if (bond == null) return { short: NOT_RECORDED, long: NOT_RECORDED }
  const years = Number(bond.years)
  if (years === 0) return { short: 'None', long: 'No service bond' }
  const penalty = bond.penaltyInr != null ? `, or a ${formatInr(Number(bond.penaltyInr))} penalty` : ' (penalty not recorded)'
  return { short: `${years} years`, long: `${years} years of service after MBBS${penalty}` }
}

export function IndiaCollege({ college }: Props) {
  const place = college.state?.name ?? college.country?.name
  const counselling = counsellingLink(college, place ? `NEET counselling: ${place}` : 'NEET counselling')
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
  const bond = bondText(p.serviceBond).short
  // Facts the API has no value for are left out of the line.
  const lead = [
    [college.city, college.state?.name].filter(Boolean).join(', '),
    college.ownership ? OWNERSHIP[college.ownership] : null,
    college.establishedYear != null ? `Established ${Number(college.establishedYear)}` : null,
    p.mbbsSeats != null ? `MBBS seats: ${Number(p.mbbsSeats)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <header className="c-head">
      <div>
        <h1>{college.name}</h1>
        <p className="lead" style={{ marginTop: 10 }}>
          {lead}
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
          {p.mbbsSeats != null && (
            <span className="stamp" style={{ '--rot': '2deg' } as React.CSSProperties}>
              Seats: {Number(p.mbbsSeats)}
              <span className="d">
                {seatSource?.title ?? 'Seat list'}, {seatSource ? formatDate(seatSource.checkedAt) : NO_DATE}
              </span>
            </span>
          )}
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
            <dd>{p.hospital.beds != null ? Number(p.hospital.beds) : NOT_RECORDED}</dd>
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
        <p>Fees not recorded yet.</p>
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
  const bond = bondText(p.serviceBond).long
  const beds = p.hospital.beds != null ? `${Number(p.hospital.beds)} beds` : null
  const hospital = [p.hospital.name, beds].filter(Boolean).join(', ') || NOT_RECORDED

  return (
    <>
      <h2>Hospital and training</h2>
      <dl className="kv">
        <dt>Teaching hospital</dt>
        <dd>{hospital}</dd>
        <dt>Daily outpatients</dt>
        <dd>{p.hospital.dailyOutpatients != null ? Number(p.hospital.dailyOutpatients) : NOT_RECORDED}</dd>
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
        {p.domicileRule ?? 'Domicile rule not recorded yet.'} <MenuLink item={guide} /> <Icon name="arrow" size={16} />
      </p>
      <p className="small muted">{checkedOn(checked)}</p>
    </>
  )
}
