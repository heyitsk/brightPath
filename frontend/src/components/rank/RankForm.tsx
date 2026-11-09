import { useState, type FormEvent } from 'react'
import { Form } from 'react-router'
import { Icon } from '../Icon'
import { CATEGORIES, isValidScore, num, PATH, type DataSourceYear } from './labels'

export type RankQuery = { score: string; category: string; pwd: boolean; year: string }

/** Score form. Submits by GET, so the result lives in the URL and can be shared. */
export function RankForm({
  query,
  years,
  fieldErrors,
  busy,
}: {
  query: RankQuery
  years: DataSourceYear[]
  fieldErrors: Record<string, string>
  busy: boolean
}) {
  const [scoreError, setScoreError] = useState(false)

  // Without JS the browser submits as is and the API answers with a 422.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem('score') as HTMLInputElement
    const ok = isValidScore(input.value)
    setScoreError(!ok)
    if (!ok) {
      e.preventDefault()
      input.focus()
    }
  }

  const scoreMsg = scoreError ? 'Enter a whole number from -180 to 720.' : fieldErrors.score
  const yearMsg = fieldErrors.year
  const catMsg = fieldErrors.category
  const newest = years[0] ? String(num(years[0].year)) : ''
  const year = query.year || newest

  return (
    // key: a new URL re-mounts the form, so shared links and back/forward pre-fill it.
    <Form
      key={`${query.score}|${query.category}|${query.pwd}|${query.year}`}
      className="visa security"
      method="get"
      action={PATH}
      noValidate
      onSubmit={onSubmit}
    >
      <div className="visa-head">
        <h2>Your details</h2>
      </div>
      <div className={scoreMsg ? 'field err' : 'field'}>
        <label htmlFor="score">NEET score (out of 720)</label>
        <input
          className="input big"
          id="score"
          name="score"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 585"
          defaultValue={query.score}
          aria-describedby="score-hint score-err"
          aria-invalid={scoreMsg ? true : undefined}
          onChange={() => scoreError && setScoreError(false)}
        />
        <p className="hint" id="score-hint">
          From -180 to 720. Use the marks on your NTA scorecard.
        </p>
        <p className="err-msg" id="score-err" hidden={!scoreMsg}>
          <Icon name="alert" size={18} />
          <span>{scoreMsg}</span>
        </p>
      </div>
      <div className={catMsg ? 'field err' : 'field'}>
        <label htmlFor="cat">Category</label>
        <select className="select" id="cat" name="category" defaultValue={query.category || 'GENERAL'}>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {catMsg && (
          <p className="err-msg">
            <Icon name="alert" size={18} />
            <span>{catMsg}</span>
          </p>
        )}
      </div>
      <label className="check" style={{ marginBottom: 12 }}>
        <input type="checkbox" name="pwd" value="1" defaultChecked={query.pwd} />
        <span>I have a PwD certificate</span>
      </label>
      <div className={yearMsg ? 'field err' : 'field'}>
        <label htmlFor="year">Compare with results from</label>
        <select className="select" id="year" name="year" defaultValue={year}>
          {years.length === 0 && <option value="">Newest published year</option>}
          {years.map((y) => {
            const v = String(num(y.year))
            return (
              <option key={v} value={v}>
                NEET UG {v}
              </option>
            )
          })}
        </select>
        {yearMsg && (
          <p className="err-msg">
            <Icon name="alert" size={18} />
            <span>{yearMsg}</span>
          </p>
        )}
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Show my likely rank'} <Icon name="arrow" />
      </button>
    </Form>
  )
}
