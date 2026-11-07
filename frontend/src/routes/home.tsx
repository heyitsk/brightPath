import { useState, type CSSProperties, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { MenuLink } from '../components/site/MenuLink'
import { useRootData } from '../components/site/config'
import { TalkToCounsellor } from '../components/site/TalkToCounsellor'
import {
  SAMPLE_ABROAD,
  SAMPLE_COLLEGE,
  SAMPLE_GUIDES,
  SAMPLE_INDIA,
  SAMPLE_STAMP_DATES,
  type Destination,
} from '../data/home'
import homeStyles from '../styles/pages/home.css?url'
import type { Route } from './+types/home'

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: homeStyles }]

export const meta: Route.MetaFunction = () => [
  { title: 'NEET score to likely rank and colleges you can get | MBBS in India and abroad' },
  {
    name: 'description',
    content:
      'See your likely All-India NEET rank from official NTA results, then MBBS colleges in India and abroad that fit your rank and budget, with full fees.',
  },
]

const rot = (deg: string) => ({ '--rot': deg }) as CSSProperties

export default function Home() {
  return (
    <>
      <Hero />
      <hr className="perf" />
      <StampExplainer />
      <RouteSteps />
      <Destinations />
      <Guides />
      <TalkToCounsellor />
    </>
  )
}

function Hero() {
  const [scoreError, setScoreError] = useState(false)

  // Check the score before handing off to the rank predictor; without JS the browser submits as is.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem('score') as HTMLInputElement
    const v = input.value.trim()
    const s = Number(v)
    const ok = v !== '' && Number.isInteger(s) && s >= 0 && s <= 720
    setScoreError(!ok)
    if (!ok) {
      e.preventDefault()
      input.focus()
    }
  }

  return (
    <section className="hero">
      <div className="wrap hero-grid">
        <div>
          <h1>Your NEET score, turned into a likely rank and a list of colleges you can really get</h1>
          <p className="lead">
            See your All-India rank range from official NTA results, then colleges in India and abroad that fit your
            rank and budget, with full fees.
          </p>
          <div className="hero-proof">
            <div className="mini-record">
              <p
                style={{
                  fontWeight: 700,
                  fontSize: '1.1875rem',
                  lineHeight: 1.25,
                  margin: 0,
                  fontVariationSettings: "'wdth' 92",
                }}
              >
                {SAMPLE_COLLEGE.name}
              </p>
              <p className="small muted" style={{ margin: '4px 0 12px' }}>
                {SAMPLE_COLLEGE.place}
              </p>
              <div className="marks">
                {SAMPLE_COLLEGE.marks.map((m) => (
                  <span key={m.label} className={m.tone === 'violet' ? 'mark' : `mark ${m.tone}`}>
                    {m.icon && <Icon name={m.icon} size={14} />} {m.label}
                  </span>
                ))}
              </div>
              <span className="stamp navy" aria-hidden="true">
                Checked<span className="d">{SAMPLE_COLLEGE.checkedOn}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="hero-form">
          <form
            className="visa security"
            id="rank-form"
            method="get"
            action="/neet-rank-predictor"
            noValidate
            onSubmit={onSubmit}
          >
            <div className="visa-head">
              <h2>Check your likely rank</h2>
            </div>
            <div className={scoreError ? 'field err' : 'field'} id="f-score">
              <label htmlFor="score">Your NEET score (out of 720)</label>
              <input
                className="input big"
                id="score"
                name="score"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="e.g. 585"
                autoComplete="off"
                aria-describedby="score-err"
                aria-invalid={scoreError || undefined}
                onChange={() => scoreError && setScoreError(false)}
              />
              <p className="err-msg" id="score-err" hidden={!scoreError}>
                <Icon name="alert" size={18} />
                <span>Enter a score from 0 to 720.</span>
              </p>
            </div>
            <div className="row-2 hero-row">
              <div className="field">
                <label htmlFor="cat">Category</label>
                <select className="select" id="cat" name="category" defaultValue="OBC">
                  <option value="GENERAL">General</option>
                  <option value="EWS">EWS</option>
                  <option value="OBC">OBC</option>
                  <option value="SC">SC</option>
                  <option value="ST">ST</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="year">Compare with</label>
                <select className="select" id="year" name="year" defaultValue="2026">
                  <option value="2026">NEET 2026</option>
                  <option value="2025">NEET 2025</option>
                </select>
              </div>
            </div>
            <label className="check" style={{ marginBottom: 16 }}>
              <input type="checkbox" id="pwd" name="pwd" value="1" />
              <span>I have a PwD certificate</span>
            </label>
            <button className="btn btn-primary btn-block" type="submit">
              Show my likely rank <Icon name="arrow" />
            </button>
          </form>
          <span className="stamp" aria-hidden="true">
            Official NTA data<span className="d">2024 – 2026</span>
          </span>
        </div>
      </div>
    </section>
  )
}

function StampExplainer() {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h2>Every fact carries its stamp</h2>
          <p>
            A college only appears on this site after someone on our team has checked it against an official source.
            You'll see these marks on every college, with a link to the source and the date it was checked.
          </p>
        </div>
        <div className="stamp-explain">
          <div>
            <span className="stamp green">
              Listed in WDOMS<span className="d">{SAMPLE_STAMP_DATES.wdoms}</span>
            </span>
            <h3>World Directory of Medical Schools</h3>
            <p>
              The official directory of medical schools that replaced the old WHO list. A college abroad must be listed
              here, so we link to its entry.
            </p>
          </div>
          <div>
            <span className="stamp" style={rot('2deg')}>
              Meets NMC 2021 rules<span className="d">{SAMPLE_STAMP_DATES.nmcRules}</span>
            </span>
            <h3>NMC rules for study abroad</h3>
            <p>
              NMC does not approve foreign colleges. It sets rules for the course: at least 54 months, taught in
              English, with a 12-month internship at the same college.
            </p>
          </div>
          <div>
            <span className="stamp red" style={rot('-2deg')}>
              NMC alert<span className="d">{SAMPLE_STAMP_DATES.alert}</span>
            </span>
            <h3>Warnings, shown plainly</h3>
            <p>
              When NMC issues an alert about a college or a country, we show it in red on that college and link to the
              notice. We never hide it.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  { icon: 'doc', title: 'Enter your score', text: 'Marks out of 720 and your category.' },
  { icon: 'chart', title: 'See your rank range', text: 'From official NTA results. Same score, same answer, every time.' },
  { icon: 'college', title: 'See your colleges', text: 'India and abroad, matched to your rank, budget and home state.' },
  { icon: 'scale', title: 'Compare two or three', text: 'Total fees, course length, language and recognition, side by side.' },
  { icon: 'chat', title: 'Talk to a counsellor', text: 'One call or WhatsApp, with your shortlist already in front of them.' },
] as const

function RouteSteps() {
  const { navigation } = useRootData()
  const finder = navigation.tools.find((t) => t.icon === 'college')?.item
  return (
    <section className="section band-2">
      <div className="wrap">
        <div className="section-head">
          <h2>From your score to a counsellor who already knows it</h2>
          <p>
            You type your details once. When a counsellor calls, they already have your score, rank, budget and the
            colleges you looked at.
          </p>
        </div>
        <ol className="route">
          {STEPS.map((s) => (
            <li key={s.title}>
              <span className="dot">
                <Icon name={s.icon} />
              </span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        {finder && (
          <p style={{ marginTop: 28 }}>
            <MenuLink className="btn btn-secondary" item={finder}>
              Open the College Finder <Icon name="arrow" />
            </MenuLink>
          </p>
        )}
      </div>
    </section>
  )
}

function DestList({ items }: { items: Destination[] }) {
  return (
    <ul className="dest-list">
      {items.map((d) => (
        <li key={d.code}>
          <MenuLink item={d.item}>
            <span className="code">{d.code}</span>
            <span>
              <span className="name">{d.name}</span>
              <span className="meta">{d.meta}</span>
            </span>
            <span className="go">
              <Icon name="arrow" />
            </span>
          </MenuLink>
        </li>
      ))}
    </ul>
  )
}

function Destinations() {
  return (
    <section className="section">
      <div className="wrap dest">
        <div>
          <h2>MBBS abroad</h2>
          <p className="muted" style={{ marginTop: 10 }}>
            Countries most Indian students choose. Fees are the full course, all years, in rupees.
          </p>
          <DestList items={SAMPLE_ABROAD} />
        </div>
        <div>
          <h2>MBBS in India</h2>
          <p className="muted" style={{ marginTop: 10 }}>
            State counselling, seats, fees and past closing ranks for government and private colleges.
          </p>
          <DestList items={SAMPLE_INDIA} />
        </div>
      </div>
    </section>
  )
}

function Guides() {
  return (
    <section className="section band-2">
      <div className="wrap">
        <div className="section-head">
          <h2>NEET guides in plain words</h2>
          <p>Written by our counsellors, checked against the official notice, with the date of the last review.</p>
        </div>
        <ul className="guides">
          {SAMPLE_GUIDES.map((g) => (
            <li key={g.title}>
              <MenuLink item={g.item}>
                <b>
                  {g.title}
                  <span>{g.summary}</span>
                </b>
                <Icon name="arrow" />
              </MenuLink>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
