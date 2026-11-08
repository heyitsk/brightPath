import { Link } from 'react-router'
import { Icon } from '../Icon'
import { Estimate } from '../shared/Estimate'
import {
  categoryLabel,
  checkedDate,
  fmt,
  formatPercentile,
  formatRange,
  groupLabel,
  num,
  rankHref,
  type OtherYear,
  type RankResponse,
  type RankResultData,
} from './labels'

/** One rank answer: the data page, the disclaimer from the response, explanation and source. */
export function RankResult({ data }: { data: RankResponse }) {
  const { result, otherYears, meta } = data
  return (
    <>
      <DataPage result={result} />
      <Estimate text={meta.disclaimer.text} disclaimer={meta.disclaimer.key} />
      <Explain result={result} />
      {otherYears.length > 0 && <OtherYears result={result} otherYears={otherYears} />}
    </>
  )
}

function DataPage({ result }: { result: RankResultData }) {
  const year = num(result.year)
  const score = fmt(result.score)
  const category = categoryLabel(result.category)
  return (
    <div className="datapage">
      <span className="stamp stamp-press">
        Based on NTA results<span className="d">NEET UG {year}</span>
      </span>

      {result.outcome === 'OK' && result.allIndiaRank && (
        <>
          <p className="k">
            {result.approximate ? 'Approximate All-India rank' : 'Likely All-India rank'} for {score} marks
          </p>
          <p className="big">{formatRange(result.allIndiaRank)}</p>
          {result.approximate && (
            <p className="note">
              <span className="mark">approximate</span>{' '}
              {result.possibleRankSpan
                ? `NTA published only mark ranges for ${year}, so students with this score could be anywhere from rank ${formatRange(result.possibleRankSpan).replace(' – ', ' to ')}.`
                : `NTA published only mark ranges for ${year}, so this rank is an estimate.`}
            </p>
          )}
        </>
      )}

      {result.outcome === 'BELOW_CUTOFF' && (
        <>
          <p className="k">
            {score} marks, {category}
            {result.pwd ? ', PwD' : ''}
          </p>
          <p className="big" style={{ fontSize: '1.75rem' }}>
            Below the qualifying cut-off
          </p>
          <p className="note">
            This score is below the {year} qualifying cut-off for {category}, so no rank is shown.
          </p>
        </>
      )}

      {result.outcome === 'NOT_PUBLISHED_BY_NTA' && (
        <>
          <p className="k">
            {score} marks, {category}
            {result.pwd ? ', PwD' : ''}
          </p>
          <p className="big" style={{ fontSize: '1.75rem' }}>
            No rank for {year}
          </p>
          {result.explanation.length > 0 && (
            <ul>
              {result.explanation.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <dl>
        {result.categoryRank && (
          <div>
            <dt>Likely {category} category rank</dt>
            <dd>{formatRange(result.categoryRank)}</dd>
          </div>
        )}
        {result.pwdRank && (
          <div>
            <dt>Likely PwD rank</dt>
            <dd>{formatRange(result.pwdRank)}</dd>
          </div>
        )}
        {result.percentile !== null && (
          <div>
            <dt>Percentile{result.approximate ? ' (approx.)' : ''}</dt>
            <dd>{formatPercentile(result.percentile)}</dd>
          </div>
        )}
        {result.studentsAhead !== null && (
          <div>
            <dt>Students who scored more</dt>
            <dd>{fmt(result.studentsAhead)}</dd>
          </div>
        )}
        <div>
          <dt>Students who appeared</dt>
          <dd>{fmt(result.studentsAppeared)}</dd>
        </div>
        {result.studentsWithSameScore !== null && (
          <div>
            <dt>Students with the same score</dt>
            <dd>{fmt(result.studentsWithSameScore)}</dd>
          </div>
        )}
        <div>
          <dt>Qualifying cut-off</dt>
          <dd>
            <Qualification result={result} />
          </dd>
        </div>
      </dl>
    </div>
  )
}

function Qualification({ result }: { result: RankResultData }) {
  const q = result.qualification
  if (q.qualified === null) return <>No cut-off loaded for this category in {num(result.year)}</>
  const parts = [
    q.cutoffScore !== null ? `${fmt(q.cutoffScore)} marks` : null,
    q.cutoffPercentile !== null ? `${formatPercentile(q.cutoffPercentile)} percentile` : null,
    q.appliedGroup ? groupLabel(q.appliedGroup) : null,
  ].filter(Boolean)
  const detail = parts.length ? ` (cut-off ${parts.join(', ')})` : ''
  return <>{q.qualified ? `Qualifies${detail}` : `Below the cut-off${detail}`}</>
}

function Explain({ result }: { result: RankResultData }) {
  // NOT_PUBLISHED_BY_NTA shows the explanation in the data page instead of a rank.
  const bullets = result.outcome === 'NOT_PUBLISHED_BY_NTA' ? [] : result.explanation
  const { source } = result
  return (
    <div className="explain">
      {bullets.length > 0 && (
        <>
          <h3>What this means, in plain words</h3>
          <ul>
            {bullets.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      <div className="src-row">
        <span className="mark green">
          <Icon name="check" size={14} /> Source: {source.title}
        </span>
        {source.url && (
          <a href={source.url} rel="noopener noreferrer" target="_blank">
            See the official data <Icon name="ext" size={14} />
          </a>
        )}
        {source.publisher && <span className="muted">{source.publisher}</span>}
        <span className="muted">Checked {checkedDate(result.checkedAt)}</span>
      </div>
    </div>
  )
}

function otherYearText(y: OtherYear) {
  if (y.outcome === 'BELOW_CUTOFF') return 'Below the qualifying cut-off'
  if (y.outcome === 'NOT_PUBLISHED_BY_NTA' || !y.allIndiaRank) return 'NTA published no score counts'
  return `${formatRange(y.allIndiaRank)}${y.approximate ? ' (approx.)' : ''}`
}

function OtherYears({ result, otherYears }: { result: RankResultData; otherYears: OtherYear[] }) {
  return (
    <div className="explain">
      <h3>Same score in other years</h3>
      <ul className="other-years">
        {otherYears.map((y) => (
          <li key={String(y.year)}>
            <Link
              to={rankHref({ score: result.score, category: result.category, pwd: result.pwd, year: num(y.year) })}
            >
              NEET UG {num(y.year)}
            </Link>
            <span className="r">{otherYearText(y)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
