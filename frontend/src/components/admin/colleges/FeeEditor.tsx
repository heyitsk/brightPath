import { useState, type ReactNode } from 'react'
import { Form, useNavigation } from 'react-router'
import { FormError } from '../AdminFormError'
import type { Opt } from '../crud/types'
import { today } from '../crud/util'
import { feeYears, inr, num } from './data'
import {
  draftFromServer,
  isChanged,
  MAX_FEE_YEARS,
  serverFee,
  type FailedFee,
  type FeeDraft,
  type FeeErrors,
  type FeeField,
  type FeeRefusal,
} from './fee-body'
import type { College } from './types'

/**
 * What the last "Save fees" left behind: rows that did not get through, and live-college refusals.
 * `at` tells one save's result from the next, even when both say the same thing.
 */
export type FeeResult = { formError?: string; failed: FailedFee[]; refusals: FeeRefusal[]; at: number }

type Row = FeeDraft & { key: number; errors: FeeErrors; refused?: boolean }

const money = (v: string | number, currency: string) => `${Number(v).toLocaleString('en-IN')} ${currency}`

/** Rows from the server, with any rows the last save did not get through put back on top. */
function startRows(college: College, result?: FeeResult): Row[] {
  const rows: Row[] = college.fees.map((f, i) => ({ ...draftFromServer(f), key: i, errors: {} }))
  let key = rows.length
  for (const f of result?.failed ?? []) {
    const at = f.saved ? rows.findIndex((r) => r.year === f.year) : -1
    const row: Row = { ...f, key: at >= 0 ? rows[at].key : key++ }
    if (at >= 0) rows[at] = row
    else rows.push({ ...row, saved: false, removed: false })
  }
  return rows
}

function nextYear(rows: Row[]): string {
  const used = new Set(rows.map((r) => r.year))
  for (let y = 1; y <= MAX_FEE_YEARS; y++) if (!used.has(String(y))) return String(y)
  return ''
}

/**
 * The fee table, edited in the browser and saved with one button. Unchanged rows show the API's
 * rupee figure; a changed or new row has none until it is saved (the browser never works it out).
 */
export function FeeEditor(props: { college: College; sources: Opt[]; result?: FeeResult }) {
  const { college, sources, result } = props
  const busy = useNavigation().state !== 'idle'
  const [rows, setRows] = useState<Row[]>(() => startRows(college, result))
  // Start again from the server when its fees change (a save got through) or a new save result
  // arrives. Not done with a `key`: remounting duplicated the page's forms in the DOM.
  // Saving another section changes neither, so unsaved fee edits are kept.
  const fees = JSON.stringify(college.fees)
  const [seen, setSeen] = useState({ fees, at: result?.at })
  if (fees !== seen.fees || (result && result.at !== seen.at)) {
    setSeen({ fees, at: result?.at })
    setRows(startRows(college, result))
  }
  const required = num(college.readiness.feeYearsRequired)
  const live = college.status === 'READY'

  const edit = (key: number, field: FeeField, value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value, errors: { ...r.errors, [field]: undefined } } : r)))
  const setRemoved = (key: number, removed: boolean) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, removed, errors: {}, refused: false } : r)))
  const remove = (r: Row) => (r.saved ? setRemoved(r.key, true) : setRows((rs) => rs.filter((x) => x.key !== r.key)))
  const add = () => {
    const last = [...rows].reverse().find((r) => !r.removed)
    const currency = last?.currency || (college.kind === 'INDIA' ? 'INR' : '')
    setRows((rs) => [
      ...rs,
      { key: Math.max(-1, ...rs.map((r) => r.key)) + 1, year: nextYear(rs), tuition: '', hostel: '0', other: '0', currency, sourceId: last?.sourceId ?? '', checkedAt: today(), saved: false, removed: false, errors: {} },
    ])
  }

  const pending = rows.filter((r) => isChanged(r, r.saved ? serverFee(college.fees, r.year) : undefined)).length

  return (
    <Form method="post" className="adm-form adm-wide">
      <input type="hidden" name="intent" value="fees" />
      <input type="hidden" name="feeCount" value={rows.length} />
      <FormError message={result?.formError} />
      {result && result.refusals.length > 0 && <Refusals refusals={result.refusals} />}
      {live && (
        <p className="hint">
          This college is live. A change that would leave it incomplete is refused. To make such a change, use “Move back to draft”
          under Ready check first.
        </p>
      )}
      <p className="hint">
        {required == null
          ? 'Set the course length under Details to see how many years need fees.'
          : `This course has ${required} ${required === 1 ? 'year' : 'years'}. Fee years filled: ${feeYears(college.readiness)}.`}{' '}
        Each year needs a source before the college can be marked ready.
      </p>

      {rows.length === 0 ? (
        <p>No fee rows yet.</p>
      ) : (
        <div className="tbl-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th>Tuition</th>
                <th>Hostel</th>
                <th>Other</th>
                <th>Currency</th>
                <th>Source</th>
                <th>Checked on</th>
                <th>In rupees</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <FeeRow
                  key={r.key}
                  row={r}
                  index={i}
                  server={r.saved ? serverFee(college.fees, r.year) : undefined}
                  sources={sources}
                  onEdit={(field, value) => edit(r.key, field, value)}
                  onRemove={() => remove(r)}
                  onUndo={() => setRemoved(r.key, false)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p>
        Whole course in rupees: <strong>{inr(college.totalCourseFeeInr)}</strong>
        {pending > 0 && <span className="hint"> (before your unsaved changes)</span>}
      </p>
      {college.totalCourseFeeInr == null && (
        <p className="hint">The total appears once every course year has a row and every currency has an exchange rate.</p>
      )}

      <div className="adm-actions">
        <button className="btn btn-secondary" type="button" onClick={add} disabled={rows.length >= MAX_FEE_YEARS}>
          Add a year
        </button>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : pending > 0 ? `Save fees (${pending} ${pending === 1 ? 'change' : 'changes'})` : 'Save fees'}
        </button>
      </div>
    </Form>
  )
}

function Refusals({ refusals }: { refusals: FeeRefusal[] }) {
  return (
    <div className="callout" role="alert" style={{ marginBottom: 16 }}>
      <h3>Not saved: this college is live</h3>
      {refusals.map((x) => (
        <div key={x.year}>
          <p style={{ margin: '8px 0 4px' }}>
            <strong>
              Year {x.year} could not be {x.removing ? 'removed' : 'saved'}.
            </strong>{' '}
            {x.message}
          </p>
          {x.reasons.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {x.reasons.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p style={{ margin: '8px 0 0' }}>
        Your changes are still in the table. To make them, use “Move back to draft” under Ready check, save the fees, then mark the
        college ready again.
      </p>
    </div>
  )
}

function Cell(props: { error?: string; children: ReactNode; minWidth?: number }) {
  const { error, children, minWidth } = props
  return (
    <td style={{ verticalAlign: 'top', minWidth }}>
      <div className={error ? 'field err' : 'field'} style={{ margin: 0 }}>
        {children}
        {error && <p className="err-msg">{error}</p>}
      </div>
    </td>
  )
}

function FeeRow(props: {
  row: Row
  index: number
  server?: College['fees'][number]
  sources: Opt[]
  onEdit: (field: FeeField, value: string) => void
  onRemove: () => void
  onUndo: () => void
}) {
  const { row: r, index: i, server, sources, onEdit, onRemove, onUndo } = props
  const name = (f: string) => `fee.${i}.${f}`
  const label = (what: string) => `Year ${r.year || '(new)'} ${what}`
  const changed = isChanged(r, server)
  const hidden = (
    <>
      <input type="hidden" name={name('saved')} value={r.saved ? '1' : '0'} />
      <input type="hidden" name={name('removed')} value={r.removed ? '1' : '0'} />
    </>
  )

  if (r.removed) {
    return (
      <tr>
        <td>
          <s>{r.year}</s>
          {hidden}
          <input type="hidden" name={name('year')} value={r.year} />
        </td>
        <td colSpan={7}>
          <s>{server ? `${money(server.tuition, server.currency)} tuition` : 'Fee row'}</s>{' '}
          <span className="adm-badge off">Removed</span> <span className="hint">It will be deleted when you save.</span>
          {r.refused && <p className="err-msg">Refused. See the message above.</p>}
          {r.errors.row && <p className="err-msg">{r.errors.row}</p>}
        </td>
        <td>
          <button className="btn btn-secondary" type="button" onClick={onUndo}>
            Undo
          </button>
        </td>
      </tr>
    )
  }

  const input = (field: 'tuition' | 'hostel' | 'other' | 'currency', extra: object = {}) => (
    <input
      className="input"
      name={name(field)}
      value={r[field]}
      aria-label={label(field)}
      aria-invalid={r.errors[field] ? true : undefined}
      onChange={(e) => onEdit(field, field === 'currency' ? e.target.value.toUpperCase() : e.target.value)}
      {...extra}
    />
  )
  const amountProps = { inputMode: 'decimal', autoComplete: 'off' }

  let rupees: ReactNode
  if (!server || changed) rupees = <span className="hint">Save to update</span>
  else if (server.rateToInr == null) rupees = `No ${server.currency} rate yet`
  else rupees = inr(server.totalInr)

  return (
    <tr>
      <Cell error={r.errors.year} minWidth={72}>
        {hidden}
        {r.saved ? (
          <>
            <strong>{r.year}</strong>
            <input type="hidden" name={name('year')} value={r.year} />
          </>
        ) : (
          <input
            className="input"
            name={name('year')}
            value={r.year}
            aria-label="Year of the course"
            aria-invalid={r.errors.year ? true : undefined}
            inputMode="numeric"
            onChange={(e) => onEdit('year', e.target.value)}
            required
          />
        )}
        {!r.saved ? (
          <span className="adm-badge pub">New</span>
        ) : (
          changed && <span className="adm-badge pub">Changed</span>
        )}
      </Cell>
      <Cell error={r.errors.tuition} minWidth={120}>
        {input('tuition', { ...amountProps, required: true })}
      </Cell>
      <Cell error={r.errors.hostel} minWidth={110}>
        {input('hostel', amountProps)}
      </Cell>
      <Cell error={r.errors.other} minWidth={110}>
        {input('other', amountProps)}
      </Cell>
      <Cell error={r.errors.currency} minWidth={88}>
        {input('currency', { maxLength: 3, autoComplete: 'off', required: true })}
      </Cell>
      <Cell error={r.errors.sourceId} minWidth={200}>
        <select
          className="select"
          name={name('sourceId')}
          value={r.sourceId}
          aria-label={label('source')}
          aria-invalid={r.errors.sourceId ? true : undefined}
          onChange={(e) => onEdit('sourceId', e.target.value)}
        >
          <option value="">No source yet</option>
          {sources.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Cell>
      <Cell error={r.errors.checkedAt} minWidth={160}>
        <input
          className="input"
          type="date"
          name={name('checkedAt')}
          value={r.checkedAt}
          max={today()}
          aria-label={label('checked on')}
          aria-invalid={r.errors.checkedAt ? true : undefined}
          onChange={(e) => onEdit('checkedAt', e.target.value)}
          required
        />
      </Cell>
      <td style={{ verticalAlign: 'top', minWidth: 120 }}>
        {rupees}
        {r.refused && <p className="err-msg">Refused. See the message above.</p>}
        {r.errors.row && <p className="err-msg">{r.errors.row}</p>}
      </td>
      <td style={{ verticalAlign: 'top' }}>
        <button className="btn btn-secondary" type="button" onClick={onRemove}>
          Remove
        </button>
      </td>
    </tr>
  )
}
